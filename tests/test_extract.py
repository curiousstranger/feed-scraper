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


# Trimmed from the live anthropic.com/news (2026-11-09), after the redesign
# that dropped the PublicationList/FeaturedGrid markup. The top of the page
# holds a hero <article> plus tiles (same header/tileLink structure), and a
# carousel below it; each can carry a story the row listing lacks.
ANTHROPIC_NEWS_HTML = """
<html><body>
<div class="W1FydW_root">
  <article class="W1FydW_featured">
    <header class="nUeDbq_header W1FydW_header">
      <div class="nUeDbq_headerButton"><button aria-label="Related to Introducing Claude Fable 5.2">…</button></div>
      <p><a class="wN10Da_link" href="/news/announcements">Announcements</a></p>
      <time>Nov 9, 2026</time>
    </header>
    <a class="W1FydW_tileLink" href="https://www.anthropic.com/claude-fable-and-mythos-5-2">
      <h2 class="tOQyXa_headline-3 W1FydW_featuredTitle" data-component="Headline">Introducing Claude Fable 5.2 and Claude Mythos 5.2</h2>
      <p class="tOQyXa_body-3 W1FydW_featuredSummary" data-component="Body">Our most capable models.</p>
    </a>
  </article>
  <article class="W1FydW_tile">
    <header class="nUeDbq_header W1FydW_header">
      <p><a class="wN10Da_link" href="/science">Science</a></p>
      <time>Oct 27, 2026</time>
    </header>
    <a class="W1FydW_tileLink" href="/research/early-progress-drug-development">
      <h3 class="tOQyXa_headline-5 W1FydW_tileTitle" data-component="Headline">Early progress on accelerating drug development with Claude</h3>
      <p class="tOQyXa_body-4 W1FydW_summary" data-component="Body">We're at the start of a major effort.</p>
    </a>
  </article>
</div>
<div class="_5NNTzG_carousel-info"><div class="_5NNTzG_carousel-info-slides">
  <div aria-hidden="true" class="_5NNTzG_carousel-info-body" data-inactive="true" inert="">
    <header class="nUeDbq_header _5NNTzG_carousel-info-meta">
      <p><a class="wN10Da_link" href="/news/features">Features</a></p>
      <time class="_5NNTzG_carousel-info-date">Feb 23, 2026</time>
    </header>
    <a class="_5NNTzG_carousel-info-link" href="/features/making-of-claude-code"><h2 class="tOQyXa_headline-5 _5NNTzG_carousel-info-title" data-component="Headline">The making of Claude Code</h2></a>
    <p class="_5NNTzG_carousel-info-description">Some description.</p>
  </div>
</div></div>
<ul>
<li class="bxgyUW_row" data-listing-row="91aeb467">
  <div class="_2Zn0cq_container bxgyUW_expander" data-expanded="false">
    <div class="bxgyUW_summary" data-peek="true">
      <div class="bxgyUW_title"><a class="bxgyUW_title-link" href="https://www.anthropic.com/claude-fable-and-mythos-5-2"><span class="mpFHfW_panningText"><span class="mpFHfW_nowrapText"><h3 class="font-medium">Introducing Claude Fable 5.2 and Claude Mythos 5.2</h3></span></span></a></div>
      <div class="bxgyUW_description"><a class="bxgyUW_above-link" href="https://www.anthropic.com/claude-fable-and-mythos-5-2" tabindex="-1"><p>Our most capable models.</p></a></div>
      <div class="bxgyUW_category"><a class="wN10Da_link bxgyUW_above-link bxgyUW_category-link" href="/news/announcements">Announcements</a></div>
      <div class="bxgyUW_date"><time>Nov 9, 2026</time></div>
    </div>
  </div>
</li>
<li class="bxgyUW_row" data-listing-row="article-8ca07213">
  <div class="_2Zn0cq_container bxgyUW_expander" data-expanded="false">
    <div class="bxgyUW_summary" data-peek="true">
      <div class="bxgyUW_title"><a class="bxgyUW_title-link" href="/news/s1-sec"><span class="mpFHfW_panningText"><span class="mpFHfW_nowrapText"><h3 class="font-medium">Anthropic files S-1 with the SEC</h3></span></span></a></div>
      <div class="bxgyUW_description"><a class="bxgyUW_above-link" href="/news/s1-sec" tabindex="-1"><p>A description.</p></a></div>
      <div class="bxgyUW_category"><a class="wN10Da_link bxgyUW_above-link bxgyUW_category-link" href="/news/announcements">Announcements</a></div>
      <div class="bxgyUW_date"><time>Oct 26, 2026</time></div>
    </div>
    <div aria-hidden="true" class="bxgyUW_details" inert="" role="region">
      <div class="bxgyUW_details-meta"><div>Oct 26, 2026</div><div><a class="wN10Da_link" href="/news/announcements">Announcements</a></div></div>
      <a class="bxgyUW_details-title" href="/news/s1-sec" tabindex="-1"><h3>Anthropic files S-1 with the SEC</h3></a>
    </div>
  </div>
</li>
</ul>
</body></html>
"""


def _news_config():
    config_path = pathlib.Path(__file__).parent.parent / "sites" / "anthropic-news.yaml"
    return yaml.safe_load(config_path.read_text())


def test_anthropic_news_config_scrapes_redesigned_listing_and_featured_blocks():
    """Rows, plus the hero, tiles and carousel at the top of anthropic.com/news:
    the newest announcement (and some stories, e.g. a /research tile or a
    carousel feature) appear there before or instead of reaching the rows."""
    items = extract.extract_items(ANTHROPIC_NEWS_HTML, _news_config())

    assert items == [
        {
            "url": "https://www.anthropic.com/claude-fable-and-mythos-5-2",
            "title": "Introducing Claude Fable 5.2 and Claude Mythos 5.2",
            "category": "Announcements",
            "published": "2026-11-09T00:00:00+00:00",
        },
        {
            "url": "https://www.anthropic.com/news/s1-sec",
            "title": "Anthropic files S-1 with the SEC",
            "category": "Announcements",
            "published": "2026-10-26T00:00:00+00:00",
        },
        {
            "url": "https://www.anthropic.com/research/early-progress-drug-development",
            "title": "Early progress on accelerating drug development with Claude",
            "category": "Science",
            "published": "2026-10-27T00:00:00+00:00",
        },
        {
            "url": "https://www.anthropic.com/features/making-of-claude-code",
            "title": "The making of Claude Code",
            "category": "Features",
            "published": "2026-02-23T00:00:00+00:00",
        },
    ]


def test_anthropic_news_main_selector_never_matches_a_featured_element():
    """On anthropic.com/news the main and featured selectors match disjoint
    elements, so no row is claimed (and re-scraped) as featured."""
    config = _news_config()
    soup = BeautifulSoup(ANTHROPIC_NEWS_HTML, "html.parser")

    main = {id(el) for el in soup.select(config["item_selector"])}
    featured = {id(el) for el in soup.select(config["featured_item_selector"])}

    assert len(main) == 2 and len(featured) == 3 and not (main & featured)



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


# Trimmed from the live anthropic.com/research listing (2026-11-09), after the
# redesign that dropped the PublicationList/listItem markup.
ANTHROPIC_RESEARCH_HTML = """
<html><body>
<article class="nUeDbq_article" data-listing-row="b951c42c">
  <header class="nUeDbq_header">
    <p><a class="wN10Da_link" href="/science">Science</a></p>
    <time>Nov 9, 2026</time>
  </header>
  <figure class="nUeDbq_imageWrapper nUeDbq_bordered"><img alt="" src="x.jpg"/></figure>
  <div class="nUeDbq_meta">
    <h3 class="tOQyXa_headline-6 nUeDbq_metaTitle" data-component="Headline">
      <a class="nUeDbq_metaTitleLink" href="/research/claude-electronics-design">Testing Claude on real-world electronics design</a>
    </h3>
    <p class="nUeDbq_metaDescription">We asked Claude to design three electronic devices.</p>
  </div>
</article>
<a href="/research/team/alignment"><h2 class="kMamaW_item-title">Alignment</h2></a>
</body></html>
"""


def test_anthropic_research_config_scrapes_redesigned_listing():
    config_path = pathlib.Path(__file__).parent.parent / "sites" / "anthropic-research.yaml"
    config = yaml.safe_load(config_path.read_text())

    items = extract.extract_items(ANTHROPIC_RESEARCH_HTML, config)

    assert items == [
        {
            "url": "https://www.anthropic.com/research/claude-electronics-design",
            "title": "Testing Claude on real-world electronics design",
            "category": "Science",
            "published": "2026-11-09T00:00:00+00:00",
        }
    ]


# The /research hero carousel can hold stories that never reach the
# row listing (e.g. /institute/econ-scenarios on 2026-11-09).
ANTHROPIC_RESEARCH_CAROUSEL_HTML = """
<html><body>
<div class="_5NNTzG_carousel-info"><div class="_5NNTzG_carousel-info-slides">
  <div aria-hidden="true" class="_5NNTzG_carousel-info-body" data-inactive="true" inert="">
    <header class="nUeDbq_header _5NNTzG_carousel-info-meta">
      <div class="nUeDbq_headerButton"><button aria-label="Related to Economic scenarios">…</button></div>
      <p><a class="wN10Da_link" href="/economics">Economics</a></p>
      <time class="_5NNTzG_carousel-info-date">Nov 3, 2026</time>
    </header>
    <a class="_5NNTzG_carousel-info-link" href="/institute/econ-scenarios"><h2 class="_5NNTzG_carousel-info-title">Economic scenarios</h2></a>
    <p class="_5NNTzG_carousel-info-description">Some description.</p>
  </div>
</div></div>
</body></html>
"""


def test_anthropic_research_config_scrapes_carousel_only_stories():
    config_path = pathlib.Path(__file__).parent.parent / "sites" / "anthropic-research.yaml"
    config = yaml.safe_load(config_path.read_text())

    items = extract.extract_items(ANTHROPIC_RESEARCH_CAROUSEL_HTML, config)

    assert items == [
        {
            "url": "https://www.anthropic.com/institute/econ-scenarios",
            "title": "Economic scenarios",
            "category": "Economics",
            "published": "2026-11-03T00:00:00+00:00",
        }
    ]
