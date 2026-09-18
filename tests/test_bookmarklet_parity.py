"""The scraper must extract the same items the bookmarklet previews, using the
selectors the bookmarklet generates. Cases are shared with
bookmarklet/test/parity.test.js via bookmarklet/test/cases.json."""
import json
from pathlib import Path

import pytest

from scraper import extract

BOOKMARKLET_TEST = Path(__file__).resolve().parent.parent / "bookmarklet" / "test"
CASES = json.loads((BOOKMARKLET_TEST / "cases.json").read_text(encoding="utf-8"))


def _published(date_text):
    parsed = extract.parse_date(date_text)
    return parsed.isoformat() if parsed else None


@pytest.mark.parametrize("case", CASES, ids=[c["fixture"] for c in CASES])
def test_scraper_extracts_what_the_bookmarklet_previews(case):
    html = (BOOKMARKLET_TEST / "fixtures" / case["fixture"]).read_text(encoding="utf-8")
    config = {"base_url": case["base_url"], **case["expected_selectors"]}

    items = extract.extract_listing(html, config)

    assert items == [
        {
            "url": e["url"],
            "title": e["title"],
            "category": e["category"],
            "published": _published(e["date_text"]),
        }
        for e in case["expected_items"]
    ]
