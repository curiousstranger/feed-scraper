"""Posts from a Patreon creator, read from Patreon's anonymous (logged-out) web API.

This is the undocumented JSON:API that patreon.com's own pages call, not the
official API, so it can change without notice. We request only what a
logged-out visitor can already see: metadata for every post, and the body only
of posts where `current_user_can_view` is true. A locked post's content is
never requested.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import urljoin

import requests

from . import extract
from .patreon_render import is_http_url

log = logging.getLogger(__name__)

API = "https://www.patreon.com/api"
LIST_FIELDS = "title,url,published_at,post_type,image,current_user_can_view"
# Without these, every response also embeds the campaign, creator, rewards...
NO_INCLUDES = {"json-api-use-default-includes": "false", "include": ""}

CATEGORY_LABELS = {
    "video_external_file": "Video",
    "video_embed": "Video",
    "image_file": "Images",
    "text_only": "Text",
    "link": "Link",
    "audio_file": "Audio",
    "audio_embed": "Audio",
    "poll": "Poll",
}


class PatreonBlockedError(RuntimeError):
    """Patreon answered with something other than JSON, e.g. a Cloudflare challenge."""


@dataclass
class Post:
    id: str
    # {url, title, published, category}: the same shape every source produces,
    # and the only part of a Post that is merged into state.
    item: dict
    # Per-run metadata used to build the summary; never persisted.
    public: bool
    image: str | None


def category_label(post_type) -> str | None:
    if not isinstance(post_type, str) or not post_type:
        return None
    return CATEGORY_LABELS.get(post_type) or post_type.replace("_", " ").strip().title()


def fetch_posts(cfg: dict) -> list[Post]:
    campaign_id = _campaign_id(cfg)
    count = max(1, min(int(cfg.get("max_items", 100)), 100))
    data = _get_json(
        f"{API}/posts",
        cfg,
        {
            "filter[campaign_id]": campaign_id,
            "filter[contains_exclusive_posts]": "true",
            "sort": "-published_at",
            "page[count]": str(count),
            "fields[post]": LIST_FIELDS,
            **NO_INCLUDES,
        },
    )
    posts = []
    for raw in data.get("data") or []:
        post = _to_post(raw)
        if post:
            posts.append(post)
    return posts


def _campaign_id(cfg: dict) -> str:
    path = cfg.get("_path", cfg.get("id"))
    vanity = cfg.get("vanity")
    if not vanity:
        raise ValueError(f"{path}: type: patreon requires 'vanity' (the name in patreon.com/<vanity>)")
    not_found = f"{path}: no Patreon campaign found for vanity {vanity!r}"
    try:
        data = _get_json(
            f"{API}/campaigns",
            cfg,
            {"filter[vanity]": vanity, "fields[campaign]": "vanity", **NO_INCLUDES},
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            raise ValueError(not_found) from exc
        raise
    campaigns = data.get("data") or []
    if not campaigns:
        raise ValueError(not_found)
    return str(campaigns[0]["id"])


def _get_json(url: str, cfg: dict, params: dict) -> dict:
    headers = {"User-Agent": cfg.get("user_agent") or extract.DEFAULT_UA}
    resp = requests.get(url, params=params, headers=headers, timeout=extract.TIMEOUT)
    content_type = resp.headers.get("Content-Type", "")
    # Checked before the status: a Cloudflare challenge usually arrives as a
    # 403 HTML page, and "non-JSON" is the message that explains it.
    if "json" not in content_type.split(";")[0].lower():
        raise PatreonBlockedError(
            f"Patreon returned non-JSON (HTTP {resp.status_code}, {content_type or 'no content-type'})"
            " — possibly a Cloudflare challenge"
        )
    resp.raise_for_status()
    return resp.json()


def _to_post(raw) -> Post | None:
    attrs = (raw.get("attributes") if isinstance(raw, dict) else None) or {}
    url = attrs.get("url")
    url = urljoin("https://www.patreon.com/", url) if isinstance(url, str) and url else None
    if not is_http_url(url):
        log.warning("Skipping Patreon post %s with no usable url (%r)", raw.get("id"), attrs.get("url"))
        return None
    published_at = attrs.get("published_at")
    published = extract.parse_date(published_at) if isinstance(published_at, str) else None
    title = attrs.get("title")
    item = {
        "url": url,
        "title": title.strip() if isinstance(title, str) and title.strip() else None,
        "category": category_label(attrs.get("post_type")),
        "published": published.isoformat() if published else None,
    }
    return Post(
        id=str(raw.get("id") or ""),
        item=item,
        public=attrs.get("current_user_can_view") is True,
        image=_cover_image(attrs.get("image")),
    )


def _cover_image(image) -> str | None:
    if not isinstance(image, dict):
        return None
    for key in ("large_url", "url", "thumb_url"):
        if is_http_url(image.get(key)):
            return image[key]
    return None
