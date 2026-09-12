"""Persist scraped items per-site so the feed can retain history beyond whatever
a single listing-page fetch currently shows (most sites only render their
newest N items without JS-driven pagination)."""
from __future__ import annotations

import datetime as dt
import json
import os


def load_state(path: str) -> dict:
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {"items": {}}


def save_state(path: str, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")


def merge_items(state: dict, scraped_items: list[dict], max_items: int = 100) -> list[str]:
    """Merge freshly scraped items into persisted state. Returns the list of URLs
    that are new (weren't previously known) so callers can enrich only those."""
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    items = state.setdefault("items", {})
    new_urls = []

    for it in scraped_items:
        url = it["url"]
        if url not in items:
            it = dict(it)
            it["first_seen"] = now
            items[url] = it
            new_urls.append(url)
        else:
            first_seen = items[url].get("first_seen", now)
            # Refresh any fields the site now provides, without clobbering
            # previously-enriched fields (like a summary) with blanks.
            for key, value in it.items():
                if value:
                    items[url][key] = value
            items[url]["first_seen"] = first_seen

    def sort_key(u: str) -> str:
        it = items[u]
        return it.get("published") or it.get("first_seen") or ""

    ordered = sorted(items.keys(), key=sort_key, reverse=True)
    for url in ordered[max_items:]:
        del items[url]

    return new_urls
