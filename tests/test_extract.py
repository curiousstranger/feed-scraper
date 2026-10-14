import pathlib

import yaml
from bs4 import BeautifulSoup

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


# Trimmed from the live anthropic.com/news FeaturedGrid block (2026-10-04).
ANTHROPIC_FEATURED_HTML = """
<html><body>
<div class="FeaturedGrid-module-scss-module__W1FydW__root">
  <div class="FeaturedGrid-module-scss-module__W1FydW__featuredItem">
    <a class="FeaturedGrid-module-scss-module__W1FydW__content" href="/claude-sonnet-5-5">
      <h2 class="headline-4 FeaturedGrid-module-scss-module__W1FydW__featuredTitle">Introducing Claude Sonnet 5.5</h2>
      <div class="FeaturedGrid-module-scss-module__W1FydW__featuredItemContent">
        <div class="FeaturedGrid-module-scss-module__W1FydW__meta">
          <span class="caption bold">Announcements</span>
          <time class="FeaturedGrid-module-scss-module__W1FydW__date caption bold">Sep 28, 2026</time>
        </div>
      </div>
    </a>
  </div>
  <div class="FeaturedGrid-module-scss-module__W1FydW__sideItems">
    <a class="FeaturedGrid-module-scss-module__W1FydW__sideLink FeaturedGrid-module-scss-module__W1FydW__gridItem" href="/claude-opus-5-5">
      <div class="FeaturedGrid-module-scss-module__W1FydW__meta">
        <span class="caption bold">Announcements</span>
        <time class="FeaturedGrid-module-scss-module__W1FydW__date caption bold">Sep 22, 2026</time>
      </div>
      <h4 class="headline-6 FeaturedGrid-module-scss-module__W1FydW__title">Introducing Claude Opus 5.5</h4>
    </a>
  </div>
</div>
</body></html>
"""


def test_anthropic_config_scrapes_featured_hero_and_side_links():
    """The big hero at the top of anthropic.com/news is where the newest
    announcement goes, often before (or instead of) it reaching the
    chronological PublicationList. Missing it leaves the feed stale."""
    config_path = pathlib.Path(__file__).parent.parent / "sites" / "anthropic-news.yaml"
    config = yaml.safe_load(config_path.read_text())

    items = {i["url"]: i for i in extract.extract_items(ANTHROPIC_FEATURED_HTML, config)}

    hero = items["https://www.anthropic.com/claude-sonnet-5-5"]
    assert hero["title"] == "Introducing Claude Sonnet 5.5"
    assert hero["category"] == "Announcements"
    assert hero["published"] == "2026-09-28T00:00:00+00:00"

    side = items["https://www.anthropic.com/claude-opus-5-5"]
    assert side["title"] == "Introducing Claude Opus 5.5"
    assert side["published"] == "2026-09-22T00:00:00+00:00"


HERO_HTML = """
<html><body>
<div class="list">
  <article class="card featured"><a class="card-link" href="/posts/hero">
    <h2>Hero post</h2><span class="kicker">Essays</span><p>A long summary.</p>
  </a></article>
  <div>
    <article class="card"><a class="card-link" href="/posts/one">
      <h3>Post one</h3><time datetime="2026-09-03">Sep 3, 2026</time>
    </a></article>
  </div>
</div>
</body></html>
"""

HERO_CONFIG = {
    "base_url": "https://example.com",
    "item_selector": "a.card-link",
    "title_selector": "h3",
    "date_selector": "time",
    "featured_item_selector": "article.featured a.card-link",
    "featured_title_selector": "h2",
    "featured_category_selector": "span.kicker",
}


def test_element_matched_by_both_sections_is_extracted_once_as_featured():
    """The featured section claims its elements: a hero that the main
    item_selector also matches must not be scraped as a main-list item
    (whose title_selector misses its <h2>, so the title would be the whole
    card's text)."""
    items = extract.extract_items(HERO_HTML, HERO_CONFIG)

    assert items == [
        {
            "url": "https://example.com/posts/one",
            "title": "Post one",
            "category": None,
            "published": "2026-09-03T00:00:00+00:00",
        },
        {
            "url": "https://example.com/posts/hero",
            "title": "Hero post",
            "category": "Essays",
            "published": None,
        },
    ]


def test_featured_link_selector_takes_url_from_link_inside_featured_container():
    html = """
    <section class="hero"><span class="kicker">News</span><h2><a href="/posts/hero">Hero</a></h2></section>
    <a class="row" href="/posts/one">Post one</a>
    """
    config = {
        "base_url": "https://example.com",
        "item_selector": "a.row",
        "featured_item_selector": "section.hero",
        "featured_link_selector": "a",
        "featured_title_selector": "h2",
        "featured_category_selector": "span.kicker",
    }

    items = extract.extract_items(html, config)

    assert len(items) == 2
    assert items[-1] == {
        "url": "https://example.com/posts/hero",
        "title": "Hero",
        "category": "News",
        "published": None,
    }


def test_same_url_as_two_distinct_elements_keeps_the_main_list_copy():
    """Claiming is by element, not URL: when the hero and a main-list row are
    different elements linking to the same article, the main list's copy wins
    (URL de-duplication unchanged)."""
    html = """
    <div class="hero"><a class="hero-link" href="/posts/same"><h2>Hero title</h2></a></div>
    <a class="row" href="/posts/same"><h3>Row title</h3></a>
    """
    config = {
        "base_url": "https://example.com",
        "item_selector": "a.row",
        "title_selector": "h3",
        "featured_item_selector": "div.hero a.hero-link",
        "featured_title_selector": "h2",
    }

    assert extract.extract_items(html, config) == [
        {"url": "https://example.com/posts/same", "title": "Row title", "category": None, "published": None}
    ]


def test_claiming_is_by_element_identity_not_equal_markup():
    """bs4 Tags with identical markup compare (and hash) equal, so a set of
    featured Tags would also swallow an identical-looking main-list element."""
    card = '<a class="card-link" href="/posts/same">Same <span class="kicker">K</span></a>'
    html = f'<div class="hero">{card}</div><div class="rows">{card}</div>'
    config = {
        "base_url": "https://example.com",
        "item_selector": "a.card-link",
        "featured_item_selector": "div.hero a.card-link",
        "featured_title_selector": "span.kicker",
    }

    assert extract.extract_items(html, config) == [
        {"url": "https://example.com/posts/same", "title": "Same K", "category": None, "published": None}
    ]


ANTHROPIC_NEWS_HTML = ANTHROPIC_FEATURED_HTML.replace(
    "</body>",
    """<ul class="PublicationList-module-scss-module__KxYrHG__list"><li>
  <a class="PublicationList-module-scss-module__KxYrHG__listItem" href="/news/policy-brief">
    <time class="PublicationList-module-scss-module__KxYrHG__date body-3" datetime="2026-09-01T00:00:00Z">Sep 1, 2026</time>
    <span class="PublicationList-module-scss-module__KxYrHG__subject body-3">Policy</span>
    <span class="PublicationList-module-scss-module__KxYrHG__title body-3">A policy brief</span>
  </a>
</li></ul>
</body>""",
)


def test_anthropic_news_main_selector_never_matches_a_featured_element():
    """Claiming must not change existing configs: on anthropic.com/news the
    main and featured selectors match disjoint elements."""
    config_path = pathlib.Path(__file__).parent.parent / "sites" / "anthropic-news.yaml"
    config = yaml.safe_load(config_path.read_text())
    soup = BeautifulSoup(ANTHROPIC_NEWS_HTML, "html.parser")

    main = {id(el) for el in soup.select(config["item_selector"])}
    featured = {id(el) for el in soup.select(config["featured_item_selector"])}

    assert main and featured and not (main & featured)
    assert [i["url"] for i in extract.extract_items(ANTHROPIC_NEWS_HTML, config)] == [
        "https://www.anthropic.com/news/policy-brief",
        "https://www.anthropic.com/claude-sonnet-5-5",
        "https://www.anthropic.com/claude-opus-5-5",
    ]
