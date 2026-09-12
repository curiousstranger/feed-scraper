"""Generic, selector-driven scraping of a site's article-listing page."""
from __future__ import annotations

import datetime as dt
import logging
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from dateutil import parser as dateparser

log = logging.getLogger(__name__)

DEFAULT_UA = "Mozilla/5.0 (compatible; PersonalSiteRSSBot/1.0)"
TIMEOUT = 20


def fetch(url: str, user_agent: str | None = None) -> str:
    headers = {"User-Agent": user_agent or DEFAULT_UA}
    resp = requests.get(url, headers=headers, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.text


def parse_date(text: str | None, date_format: str | None = None) -> dt.datetime | None:
    if not text:
        return None
    text = text.strip()
    if not text:
        return None
    try:
        if date_format:
            parsed = dt.datetime.strptime(text, date_format)
        else:
            parsed = dateparser.parse(text)
        if parsed and parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed
    except (ValueError, OverflowError):
        log.warning("Could not parse date text %r", text)
        return None


def extract_listing(html: str, config: dict) -> list[dict]:
    """Return a list of {url, title, category, published} dicts found on a listing page."""
    soup = BeautifulSoup(html, "html.parser")
    return _extract_items(soup, config)


def extract_items(html: str, config: dict) -> list[dict]:
    """Like extract_listing, but also scrapes a site's optional "featured" promo
    section (declared via featured_item_selector and friends) and merges it in.
    Some sites (e.g. anthropic.com/news) promote certain articles in a separate
    block that isn't part of the main chronological listing, so item_selector
    alone misses them."""
    soup = BeautifulSoup(html, "html.parser")
    items = _extract_items(soup, config)

    if config.get("featured_item_selector"):
        featured_config = {
            "base_url": config["base_url"],
            "item_selector": config["featured_item_selector"],
            "title_selector": config.get("featured_title_selector"),
            "date_selector": config.get("featured_date_selector"),
            "date_format": config.get("featured_date_format"),
            "category_selector": config.get("featured_category_selector"),
        }
        seen_urls = {item["url"] for item in items}
        for item in _extract_items(soup, featured_config):
            if item["url"] not in seen_urls:
                items.append(item)
                seen_urls.add(item["url"])

    return items


def _extract_items(soup: BeautifulSoup, config: dict) -> list[dict]:
    items = []
    for el in soup.select(config["item_selector"]):
        href = el.get("href")
        if not href:
            continue
        url = urljoin(config["base_url"], href)

        title = None
        if config.get("title_selector"):
            t = el.select_one(config["title_selector"])
            if t:
                title = t.get_text(strip=True)
        if not title:
            title = el.get_text(" ", strip=True)
        title = title.replace("\xa0", " ").strip() if title else None

        category = None
        if config.get("category_selector"):
            c = el.select_one(config["category_selector"])
            if c:
                category = c.get_text(strip=True)

        published = None
        if config.get("date_selector"):
            d = el.select_one(config["date_selector"])
            if d:
                date_text = d.get("datetime") or d.get_text(strip=True)
                published = parse_date(date_text, config.get("date_format"))

        items.append(
            {
                "url": url,
                "title": title,
                "category": category,
                "published": published.isoformat() if published else None,
            }
        )
    return items


def _meta(soup: BeautifulSoup, prop: str) -> str | None:
    tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


def enrich_with_detail(item: dict, config: dict) -> dict:
    """Fetch an article's own page once to fill in a description / missing title / date
    via OpenGraph and standard meta tags. Best-effort: failures are swallowed so one
    broken article page never breaks the whole run."""
    try:
        html = fetch(item["url"], config.get("user_agent"))
    except requests.RequestException as exc:
        log.warning("Could not fetch detail page %s: %s", item["url"], exc)
        return item

    soup = BeautifulSoup(html, "html.parser")

    if not item.get("summary"):
        item["summary"] = _meta(soup, "og:description") or _meta(soup, "description")
    if not item.get("title"):
        item["title"] = _meta(soup, "og:title")
    if not item.get("published"):
        pub_text = _meta(soup, "article:published_time")
        parsed = parse_date(pub_text)
        if parsed:
            item["published"] = parsed.isoformat()
    return item
