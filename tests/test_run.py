from scraper import run


def test_index_links_to_the_bookmarklet_install_page(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DOCS_DIR", str(tmp_path))

    run.write_index([])

    assert '<a href="bookmarklet.html">' in (tmp_path / "index.html").read_text(encoding="utf-8")
