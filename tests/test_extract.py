from scraper import extract

CONFIG = {
    "base_url": "https://example.com",
    "item_selector": 'a[class*="List"][class*="listItem"]',
    "title_selector": 'span[class*="title"]',
    "date_selector": "time",
    "category_selector": 'span[class*="subject"]',
    "featured_item_selector": 'a[class*="FeaturedGrid"][class*="sideLink"]',
    "featured_title_selector": 'h4[class*="title"]',
    "featured_date_selector": "time",
    "featured_category_selector": 'span[class*="caption"]',
}

HTML = """
<html><body>
<div class="FeaturedGrid">
  <a class="FeaturedGrid-sideLink" href="/news/featured-only-story">
    <span class="caption">Product</span>
    <time datetime="2026-09-10T00:00:00Z">Sep 10, 2026</time>
    <h4 class="title">Featured-only story</h4>
  </a>
</div>
<ul class="List">
  <li>
    <a class="List-listItem" href="/news/regular-story">
      <time datetime="2026-09-01T00:00:00Z">Sep 1, 2026</time>
      <span class="subject">Announcements</span>
      <span class="title">Regular story</span>
    </a>
  </li>
</ul>
</body></html>
"""


def test_extract_items_includes_featured_section_items():
    """Sites like anthropic.com/news show some articles only in a promoted
    'featured' block, not in the main chronological listing. When a site
    config declares featured_* selectors, those items must be scraped too,
    or announcements that never make it into the main list are silently
    dropped from the feed forever."""
    items = extract.extract_items(HTML, CONFIG)
    urls = {item["url"] for item in items}

    assert urls == {
        "https://example.com/news/regular-story",
        "https://example.com/news/featured-only-story",
    }


def test_extract_items_does_not_duplicate_item_seen_in_both_sections():
    config = dict(CONFIG, featured_item_selector='a[class*="List"][class*="listItem"]')

    items = extract.extract_items(HTML, config)
    urls = [item["url"] for item in items]

    assert urls.count("https://example.com/news/regular-story") == 1


CONTAINER_HTML = """
<html><body>
<article class="teaser">
  <span class="kicker">Policy</span>
  <h3 class="headline"><a class="teaser-link" href="/stories/alpha">Alpha story</a></h3>
  <p class="byline">By <a href="/people/ann">Ann</a></p>
</article>
<article class="teaser">
  <span class="kicker">Science</span>
  <h3 class="headline">No link in this one</h3>
</article>
<article class="teaser">
  <h3 class="headline"><a class="teaser-link">Anchor without href</a></h3>
</article>
<article class="teaser">
  <h3 class="headline"><a class="teaser-link" href="https://other.example/beta">Beta story</a></h3>
</article>
</body></html>
"""

LINK_CONFIG = {
    "base_url": "https://news.example.org",
    "item_selector": "article.teaser",
    "link_selector": "a.teaser-link",
}


def test_link_selector_takes_url_from_link_inside_container():
    items = extract.extract_listing(CONTAINER_HTML, dict(LINK_CONFIG, title_selector="h3.headline"))

    assert [item["url"] for item in items] == [
        "https://news.example.org/stories/alpha",
        "https://other.example/beta",
    ]
    assert items[0]["title"] == "Alpha story"


def test_link_selector_skips_containers_without_a_matching_link_or_href():
    items = extract.extract_listing(CONTAINER_HTML, LINK_CONFIG)

    assert len(items) == 2


def test_link_selector_leaves_field_selectors_relative_to_the_container():
    items = extract.extract_listing(CONTAINER_HTML, dict(LINK_CONFIG, category_selector="span.kicker"))

    assert items[0]["category"] == "Policy"


def test_link_selector_title_fallback_uses_whole_container_text():
    items = extract.extract_listing(CONTAINER_HTML, LINK_CONFIG)

    assert items[0]["title"] == "Policy Alpha story By Ann"


def test_without_link_selector_the_item_itself_must_carry_the_href():
    config = {"base_url": "https://news.example.org", "item_selector": "article.teaser"}

    assert extract.extract_listing(CONTAINER_HTML, config) == []
