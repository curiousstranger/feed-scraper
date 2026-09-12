"""Build an RSS 2.0 feed from a site's persisted items."""
from __future__ import annotations

import datetime as dt

from dateutil import parser as dateparser
from feedgen.feed import FeedGenerator

_MIN_DATE = dt.datetime.min.replace(tzinfo=dt.timezone.utc)


def _sort_key(item: dict) -> dt.datetime:
    raw = item.get("published") or item.get("first_seen")
    if not raw:
        return _MIN_DATE
    try:
        parsed = dateparser.parse(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed
    except (ValueError, OverflowError):
        return _MIN_DATE


def build_feed(site_config: dict, items: list[dict]) -> FeedGenerator:
    fg = FeedGenerator()
    fg.title(site_config["name"])
    fg.link(href=site_config["listing_url"], rel="alternate")
    fg.description(site_config.get("description") or f"Unofficial feed for {site_config['listing_url']}")
    fg.language("en")
    fg.lastBuildDate(dt.datetime.now(dt.timezone.utc))

    for item in sorted(items, key=_sort_key, reverse=True):
        fe = fg.add_entry()
        fe.id(item["url"])
        fe.link(href=item["url"])
        fe.title(item.get("title") or item["url"])
        if item.get("summary"):
            fe.description(item["summary"])
        if item.get("category"):
            fe.category(term=item["category"])
        pub_date = _sort_key(item)
        if pub_date != _MIN_DATE:
            fe.pubDate(pub_date)
    return fg
