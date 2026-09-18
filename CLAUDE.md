# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A generic site-to-RSS scraper: config-driven scraping for sites that don't publish
their own feed. Feeds are published as static XML under `docs/` and served via
GitHub Pages; a scheduled GitHub Action re-runs the scrape and commits updated
feeds/state back to the repo. There is no server component — everything runs as a
one-shot script, either locally or in CI.

## Commands

```bash
# install deps (uv is used for local dev; see pyproject.toml)
uv sync

# run the scraper for every configured site
uv run python -m scraper.run

# run for a single site, by its `id` (matches sites/<id>.yaml)
uv run python -m scraper.run anthropic-news

# check whether a candidate site already has a feed before writing a scraper config
uv run python check_feed.py https://example.com/blog

# run the test suite
uv run pytest

# bookmarklet (JS lives only under bookmarklet/)
cd bookmarklet && npm ci && npm test
cd bookmarklet && npm run build   # regenerates docs/bookmarklet.html — commit it
```

There is no linter config in this repo. `.github/workflows/test.yml` runs
`uv run pytest`, `npm test`, and `npm run build` + `git diff --exit-code
docs/bookmarklet.html` on pull requests, so the committed bookmarklet must be
rebuilt whenever `bookmarklet/src/` changes. Both local dev and CI use `uv`
against `pyproject.toml` / `uv.lock` — there's no separate `requirements.txt`
to keep in sync; `uv lock` after changing a dependency is the only step
needed.

## Architecture

Pipeline, run per site by `scraper/run.py:process_site`:

1. **`sites/<id>.yaml`** — one config file per site: listing URL, CSS selectors
   for the item/title/date/category, and options like `fetch_detail` and
   `max_items`. This is the only thing that differs between sites; the scraping
   logic itself is generic.
2. **`scraper/extract.py`** — fetches the listing page and applies the
   selectors (`extract_listing`) to pull `{url, title, category, published}`
   per item. `enrich_with_detail` optionally fetches a *new* item's own page
   once to backfill a description/title/date from its OpenGraph/meta tags.
3. **`scraper/state.py`** — merges freshly scraped items into
   `data/<id>.json`, keyed by URL. This is what makes feeds additive: a
   listing page only shows a site's newest N items, but state accumulates
   history across runs (trimmed to `max_items`, oldest dropped first). Only
   URLs not already in state are treated as "new" and passed through detail
   enrichment.
4. **`scraper/feedgen_util.py`** — builds an RSS 2.0 feed from the full set of
   persisted items for a site.
5. **`scraper/run.py`** — orchestrates the above for every `sites/*.yaml` (or
   one, if an id is passed on the CLI), writes `docs/feeds/<id>.xml`, and
   regenerates `docs/index.html` (a plain listing of all feeds) from
   whatever site state currently exists — even when only one site was
   targeted this run.

`.github/workflows/update-feeds.yml` runs `python -m scraper.run` on a
schedule (every 4 hours) and on any push touching `sites/**` or `scraper/**`,
then commits `data/` and `docs/` back to `main` if they changed. This is the
only place feeds get published from — there's no separate deploy step beyond
GitHub Pages serving `docs/` on `main`.

## Adding a new site

Always run `check_feed.py` against the candidate site first — most
blogs/CMSs already publish a feed, making a scraper config unnecessary. The
selector-picker bookmarklet (docs/bookmarklet.html) generates a config by
point-and-click. If no feed exists, `sites/anthropic-news.yaml` is the reference
example, including its comment explaining why selectors use
`[class*="partial-name"]` substring matching instead of full (often
build-hashed) class names. Full field-by-field guidance is in README.md's
"Adding another site" section.
