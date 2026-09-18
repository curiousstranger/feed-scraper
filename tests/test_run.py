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
