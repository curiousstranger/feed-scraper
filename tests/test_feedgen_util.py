from xml.etree import ElementTree

from scraper import feedgen_util

SITE_CONFIG = {
    "name": "Example Feed",
    "listing_url": "https://example.com/news",
    "description": "An example feed",
}

ITEMS = [
    {
        "url": "https://example.com/a",
        "title": "A",
        "published": "2026-01-01T00:00:00+00:00",
    },
]


def test_last_build_date_reflects_latest_item_not_wall_clock():
    """lastBuildDate must be derived from item content (the newest item's
    published date), not the current time — otherwise every scheduled run
    writes a new lastBuildDate and the feed appears to change even when no
    item on the source site actually changed."""
    xml = feedgen_util.build_feed(SITE_CONFIG, ITEMS).rss_str(pretty=True)
    channel = ElementTree.fromstring(xml).find("channel")

    assert channel.find("lastBuildDate").text == "Thu, 01 Jan 2026 00:00:00 +0000"
