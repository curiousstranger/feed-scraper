import json
from pathlib import Path

import pytest

from scraper import run


def test_index_links_to_the_bookmarklet_install_page(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DOCS_DIR", str(tmp_path))

    run.write_index([])

    assert '<a href="bookmarklet.html">' in (tmp_path / "index.html").read_text(encoding="utf-8")


def test_index_escapes_site_name_and_listing_url(tmp_path, monkeypatch):
    # name defaults to the scraped page's <title> in the bookmarklet, so a
    # hostile site must not be able to inject markup into the published index.
    monkeypatch.setattr(run, "DOCS_DIR", str(tmp_path))

    run.write_index(
        [
            {
                "id": "x",
                "name": "Blog</a><script>alert(1)</script>",
                "count": 1,
                "listing_url": 'https://e.com/?a=1" onmouseover="alert(2)',
            }
        ]
    )

    html = (tmp_path / "index.html").read_text(encoding="utf-8")
    assert "<script>" not in html
    assert 'onmouseover="' not in html
    assert "Blog&lt;/a&gt;&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert 'href="https://e.com/?a=1&quot; onmouseover=&quot;alert(2)"' in html


def _write_site(sites_dir, filename, site_id):
    (sites_dir / filename).write_text(
        f'id: "{site_id}"\nname: x\nlisting_url: https://e.com/\nbase_url: https://e.com\nitem_selector: a\n',
        encoding="utf-8",
    )


def test_load_site_configs_rejects_ids_that_are_not_plain_slugs(tmp_path, monkeypatch):
    # id is used to build data/<id>.json and docs/feeds/<id>.xml paths.
    monkeypatch.setattr(run, "SITES_DIR", str(tmp_path))
    _write_site(tmp_path, "evil.yaml", "../evil")

    with pytest.raises(ValueError, match=r"evil\.yaml.*id.*\.\./evil"):
        run.load_site_configs()


def test_load_site_configs_accepts_slug_ids(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "SITES_DIR", str(tmp_path))
    _write_site(tmp_path, "ok.yaml", "my-site-2")

    assert [c["id"] for c in run.load_site_configs()] == ["my-site-2"]


def _result(**overrides):
    r = {
        "id": "site",
        "name": "Site",
        "listing_url": "https://example.com/",
        "count": 3,
        "new": 0,
        "last_updated": "2026-09-17T22:52:06.870064+00:00",
    }
    r.update(overrides)
    return r


def test_index_shows_when_each_feed_last_gained_an_item(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DOCS_DIR", str(tmp_path))

    run.write_index([_result()])

    assert "updated 2026-09-17 22:52 UTC" in (tmp_path / "index.html").read_text(encoding="utf-8")


def test_index_says_never_updated_for_a_feed_without_items(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DOCS_DIR", str(tmp_path))

    run.write_index([_result(count=0, last_updated=None)])

    assert "never updated" in (tmp_path / "index.html").read_text(encoding="utf-8")


# --- source-type dispatch ---------------------------------------------------

PATREON_SITE = {
    "id": "kenji-lopez-alt",
    "type": "patreon",
    "name": "Kenji (Patreon)",
    "vanity": "kenjilopezalt",
    "listing_url": "https://www.patreon.com/kenjilopezalt",
    "max_items": 100,
    "user_agent": "TestUA/1.0",
    "_path": "sites/kenji-lopez-alt.yaml",
}
HONING_URL = "https://frienji.kenjilopezalt.com/posts/how-honing-fixes-168800580"


@pytest.fixture
def out_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(run, "DOCS_FEEDS_DIR", str(tmp_path / "feeds"))
    return tmp_path


def _state(out_dirs, site_id="kenji-lopez-alt"):
    return json.loads((out_dirs / "data" / f"{site_id}.json").read_text(encoding="utf-8"))


def _no_html_fetch(*args, **kwargs):
    raise AssertionError("HTML path used for a Patreon site")


def test_patreon_site_uses_the_patreon_source(out_dirs, kenji_http, monkeypatch):
    monkeypatch.setattr(run.extract, "fetch", _no_html_fetch)

    result = run.process_site(dict(PATREON_SITE))

    assert (result["count"], result["new"]) == (4, 4)
    feed = (out_dirs / "feeds" / "kenji-lopez-alt.xml").read_text(encoding="utf-8")
    assert "Easy Weeknight Pasta with Mushrooms" in feed
    assert "Patrons only" in feed


def test_patreon_state_holds_only_item_fields(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))

    items = _state(out_dirs)["items"]
    for item in items.values():
        assert set(item) == {"url", "title", "published", "category", "summary", "first_seen"}
    assert "latest knife-sharpening video" in items[HONING_URL]["summary"]


def test_patreon_never_requests_locked_post_bodies(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))

    body_requests = sorted(p for p in kenji_http.paths() if p.startswith("/api/posts/"))
    assert body_requests == ["/api/posts/168800580", "/api/posts/169276035"]


def test_patreon_second_run_does_not_refetch_bodies(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))
    first = _state(out_dirs)["items"]
    kenji_http.calls.clear()

    result = run.process_site(dict(PATREON_SITE))

    assert result["new"] == 0
    assert kenji_http.paths() == ["/api/campaigns", "/api/posts"]
    assert {u: i["summary"] for u, i in _state(out_dirs)["items"].items()} == {
        u: i["summary"] for u, i in first.items()
    }


def test_patreon_listing_larger_than_max_items_does_not_crash(out_dirs, kenji_http):
    # The fake answers with all 4 fixture posts whatever page[count] says, so
    # merge_items reports 4 new URLs but keeps only the 2 newest.
    result = run.process_site(dict(PATREON_SITE, max_items=2))

    assert result["count"] == 2
    assert all(i.get("summary") for i in _state(out_dirs)["items"].values())


@pytest.mark.parametrize("type_field", [{}, {"type": "html"}])
def test_site_without_patreon_type_uses_the_html_path(out_dirs, monkeypatch, type_field):
    monkeypatch.setattr(run.patreon, "fetch_posts", lambda cfg: pytest.fail("Patreon path used for an HTML site"))
    monkeypatch.setattr(run.extract, "fetch", lambda url, user_agent=None: '<a href="/p/1">One</a>')
    cfg = {
        "id": "plain",
        "name": "Plain",
        "listing_url": "https://e.com/",
        "base_url": "https://e.com",
        "item_selector": "a",
        "fetch_detail": False,
        "_path": "sites/plain.yaml",
        **type_field,
    }

    result = run.process_site(cfg)

    assert result["count"] == 1
    assert list(_state(out_dirs, "plain")["items"]) == ["https://e.com/p/1"]


def test_unknown_type_raises_naming_the_config_file(out_dirs):
    cfg = {"id": "weird", "type": "rss", "name": "W", "listing_url": "https://e.com/", "_path": "sites/weird.yaml"}

    with pytest.raises(ValueError, match=r"sites/weird\.yaml.*'rss'"):
        run.process_site(cfg)


def test_patreon_post_locked_later_loses_its_stored_body(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))
    assert "latest knife-sharpening video" in _state(out_dirs)["items"][HONING_URL]["summary"]

    listing = json.loads((Path(__file__).parent / "fixtures" / "patreon" / "posts.json").read_text(encoding="utf-8"))
    for raw in listing["data"]:
        if raw["id"] == "168800580":
            raw["attributes"]["current_user_can_view"] = False
    kenji_http.route("/api/posts", body=json.dumps(listing))
    kenji_http.calls.clear()

    result = run.process_site(dict(PATREON_SITE))

    assert result["new"] == 0
    assert kenji_http.paths() == ["/api/campaigns", "/api/posts"]
    summary = _state(out_dirs)["items"][HONING_URL]["summary"]
    assert "latest knife-sharpening video" not in summary
    assert "🔒 Patrons only" in summary
    feed = (out_dirs / "feeds" / "kenji-lopez-alt.xml").read_text(encoding="utf-8")
    assert "latest knife-sharpening video" not in feed


def test_listing_larger_than_max_items_enriches_only_kept_items(tmp_path, monkeypatch):
    # First run of a site whose listing shows more items than max_items:
    # merge_items trims the overflow, so enrichment must not look it up.
    monkeypatch.setattr(run, "DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(run, "DOCS_FEEDS_DIR", str(tmp_path / "feeds"))
    monkeypatch.setattr(
        run.extract,
        "fetch",
        lambda url, user_agent=None: '<a href="/1">1</a><a href="/2">2</a><a href="/3">3</a>',
    )
    enriched = []

    def passthrough(item, cfg):
        enriched.append(item["url"])
        return item

    monkeypatch.setattr(run.extract, "enrich_with_detail", passthrough)
    cfg = {
        "id": "x",
        "name": "x",
        "listing_url": "https://e.com/",
        "base_url": "https://e.com",
        "item_selector": "a",
        "max_items": 2,
        "fetch_detail": True,
        "_path": "sites/x.yaml",
    }

    result = run.process_site(cfg)

    assert result["count"] == 2
    assert result["new"] == 2
    assert len(enriched) == 2
