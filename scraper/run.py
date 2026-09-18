"""Entry point: scrape every configured site, update persisted state, write feeds.

Usage:
    python -m scraper.run              # process every sites/*.yaml
    python -m scraper.run anthropic-news   # process just one site, by id
"""
from __future__ import annotations

import glob
import logging
import os
import sys

import yaml

from . import extract
from . import feedgen_util
from . import state as state_mod

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("run")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES_DIR = os.path.join(ROOT, "sites")
DATA_DIR = os.path.join(ROOT, "data")
DOCS_DIR = os.path.join(ROOT, "docs")
DOCS_FEEDS_DIR = os.path.join(DOCS_DIR, "feeds")


def load_site_configs(only_id: str | None = None) -> list[dict]:
    configs = []
    for path in sorted(glob.glob(os.path.join(SITES_DIR, "*.yaml"))):
        with open(path, encoding="utf-8") as f:
            cfg = yaml.safe_load(f)
        if only_id and cfg.get("id") != only_id:
            continue
        cfg["_path"] = path
        configs.append(cfg)
    return configs


def process_site(cfg: dict) -> dict:
    site_id = cfg["id"]
    log.info("Scraping %s (%s)", site_id, cfg["listing_url"])
    html = extract.fetch(cfg["listing_url"], cfg.get("user_agent"))
    scraped = extract.extract_items(html, cfg)
    log.info("  found %d item(s) on the listing page", len(scraped))
    if not scraped:
        log.warning(
            "  0 items matched item_selector %r — the site's markup likely changed; "
            "re-check the selectors in %s",
            cfg["item_selector"],
            cfg["_path"],
        )

    state_path = os.path.join(DATA_DIR, f"{site_id}.json")
    state = state_mod.load_state(state_path)
    new_urls = state_mod.merge_items(state, scraped, max_items=cfg.get("max_items", 100))
    log.info("  %d new item(s) since last run", len(new_urls))

    if cfg.get("fetch_detail", True):
        for url in new_urls:
            log.info("  fetching detail page for new item: %s", url)
            state["items"][url] = extract.enrich_with_detail(state["items"][url], cfg)

    state_mod.save_state(state_path, state)

    os.makedirs(DOCS_FEEDS_DIR, exist_ok=True)
    feed = feedgen_util.build_feed(cfg, list(state["items"].values()))
    feed_path = os.path.join(DOCS_FEEDS_DIR, f"{site_id}.xml")
    feed.rss_file(feed_path, pretty=True)
    log.info("  wrote %s", feed_path)

    return {
        "id": site_id,
        "name": cfg["name"],
        "listing_url": cfg["listing_url"],
        "count": len(state["items"]),
        "new": len(new_urls),
    }


def write_index(results: list[dict]) -> None:
    os.makedirs(DOCS_DIR, exist_ok=True)
    rows = "\n".join(
        f'    <li><a href="feeds/{r["id"]}.xml">{r["name"]}</a> '
        f'— {r["count"]} items — <a href="{r["listing_url"]}">source</a></li>'
        for r in results
    )
    html = f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Personal RSS feeds</title></head>
<body>
<h1>Personal RSS feeds</h1>
<p>Unofficial feeds generated for sites that don't publish their own, refreshed on a schedule.</p>
<ul>
{rows}
</ul>
<p>Adding a site? Use the <a href="bookmarklet.html">selector-picker bookmarklet</a>.</p>
</body>
</html>
"""
    with open(os.path.join(DOCS_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)


def main() -> None:
    only_id = sys.argv[1] if len(sys.argv) > 1 else None
    configs = load_site_configs(only_id)
    if not configs:
        log.error("No site configs found (looked in %s, filter=%r)", SITES_DIR, only_id)
        sys.exit(1)

    results = []
    had_error = False
    for cfg in configs:
        try:
            results.append(process_site(cfg))
        except Exception:
            had_error = True
            log.exception("Failed to process site %r", cfg.get("id"))

    # Always regenerate the index from whatever sites currently have state,
    # even if this run only targeted one site.
    all_ids = {c["id"] for c in load_site_configs()}
    for site_id in all_ids - {r["id"] for r in results}:
        state_path = os.path.join(DATA_DIR, f"{site_id}.json")
        if os.path.exists(state_path):
            cfg = next(c for c in load_site_configs() if c["id"] == site_id)
            state = state_mod.load_state(state_path)
            results.append(
                {
                    "id": site_id,
                    "name": cfg["name"],
                    "listing_url": cfg["listing_url"],
                    "count": len(state.get("items", {})),
                    "new": 0,
                }
            )

    write_index(results)

    if had_error:
        sys.exit(1)


if __name__ == "__main__":
    main()
