from scraper import run


def test_index_links_to_the_bookmarklet_install_page(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DOCS_DIR", str(tmp_path))

    run.write_index([])

    assert '<a href="bookmarklet.html">' in (tmp_path / "index.html").read_text(encoding="utf-8")


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
