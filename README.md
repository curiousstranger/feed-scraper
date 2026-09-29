# site-rss

Generates personal RSS feeds for sites that don't publish their own — starting
with [anthropic.com/news](https://www.anthropic.com/news), which has no
official feed. A scheduled GitHub Action re-scrapes each configured site every
few hours, and the resulting feeds are published for free via GitHub Pages so
any RSS reader can subscribe from anywhere.

Feeds are additive: each run keeps a small JSON history file per site
(`data/<site>.json`) so items don't disappear from the feed just because a
site's listing page only shows its newest handful of posts.

## One-time setup

1. **Create a GitHub repository** (public or private both work — this repo
   only aggregates already-public news, so public is simplest) and push this
   folder to it:

   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**: in the repo, go to *Settings → Pages*, and under
   *Build and deployment* set *Source* to *GitHub Actions*. The *Update RSS
   feeds* workflow deploys `docs/` itself after each scrape; don't pick
   *Deploy from a branch*, or every merge will show a cancelled Pages build.

3. Wait for the scheduled workflow to run once (or trigger it manually: repo
   → *Actions* → *Update RSS feeds* → *Run workflow*). Its `deploy` job
   publishes to Pages. Your feed will be live at:

   ```
   https://<you>.github.io/<repo>/feeds/anthropic-news.xml
   ```

   `https://<you>.github.io/<repo>/` shows a plain index page listing every
   configured feed. Add that feed URL to your RSS reader.

No secrets or tokens to configure — the workflow's built-in `GITHUB_TOKEN`
(granted `contents: write` in the workflow file) is enough for it to commit
updated feeds back to the repo.

## Adding another site

1. **Check whether the site already has a feed** before writing a scraper —
   most blogs (WordPress, Ghost, Substack, Medium...) do:

   ```
   uv run python check_feed.py https://example.com/blog
   ```

   If it finds one, just subscribe to that URL directly — no need for
   anything in this repo.

2. **If there's truly no feed**, inspect the listing page's HTML to find the
   repeating structure around each article (browser dev tools → "View Page
   Source", or `curl -A "Mozilla/5.0" <url> | less`). You're looking for:
   - a selector matching the `<a>` (or an element containing one) for each
     article in the list
   - optionally, selectors *within* that element for the title, date, and
     category/tag

   **Or use the selector-picker bookmarklet** (install it from
   `docs/bookmarklet.html`, served at `https://<you>.github.io/<repo>/bookmarklet.html`):
   on the listing page, click the bookmark, click one article (↑/↓ adjusts
   which element counts as "one article"), then click its title, date and
   category. It generates hash-proof selectors, previews the extracted items,
   checks that the list is present in the raw HTML (not rendered by
   JavaScript), and gives you the finished YAML to copy into
   `sites/<id>.yaml`.

   Prefer `[class*="partial-name"]` substring selectors over full class
   names — many sites (Next.js, CSS Modules, etc.) inject a build-specific
   hash into class names, e.g. `PublicationList-module-scss-module__KxYrHG__listItem`,
   which will change on the site's next deploy. `a[class*="PublicationList"][class*="listItem"]`
   survives that; the literal full class name won't. See
   `sites/anthropic-news.yaml` for a worked example.

3. Copy `sites/anthropic-news.yaml` to `sites/<your-site-id>.yaml` and adjust:

   | Field | Meaning |
   |---|---|
   | `id` | Short slug of lowercase letters, digits and hyphens — used for the state file and feed filename; the scraper refuses anything else |
   | `name` | Feed title |
   | `listing_url` | Page to scrape |
   | `base_url` | Used to resolve relative links |
   | `item_selector` | CSS selector matching each article's anchor — or, with `link_selector`, each article's container |
   | `link_selector` | *(optional)* selector, relative to the item, for the `<a href>` inside it. Use when the link wraps only part of the item (e.g. just the title). Items where it finds no link, or a link without `href`, are skipped |
   | `title_selector` | *(optional)* selector, relative to the item, for the title |
   | `date_selector` | *(optional)* selector for a `<time>` (uses its `datetime` attribute if present, else its text) |
   | `date_format` | *(optional)* `strptime` format if automatic date parsing gets it wrong |
   | `category_selector` | *(optional)* selector for a category/tag |
   | `featured_item_selector` | *(optional)* like `item_selector`, but for a separate "featured/promoted" block some sites show outside their main chronological listing — see `sites/anthropic-news.yaml` |
   | `featured_title_selector`, `featured_date_selector`, `featured_date_format`, `featured_category_selector` | *(optional)* counterparts to the fields above, evaluated inside each featured item |
   | `fetch_detail` | If true (default), fetch each *new* article's own page once to pull a description from its OpenGraph meta tags |
   | `max_items` | How many recent items to retain in the feed/state |

4. Test locally before committing:

   ```
   uv sync
   uv run python -m scraper.run <your-site-id>
   cat docs/feeds/<your-site-id>.xml
   ```

5. Commit and push. The workflow also runs automatically on any push that
   touches `sites/` or `scraper/`, so the new feed appears within a minute or
   two, in addition to its regular schedule.

## Adding a Patreon creator

A `type: patreon` config builds a feed from what a logged-out visitor can see
on a creator's Patreon, using the JSON API that patreon.com's own pages call
(not Patreon's official API). Every post appears with its title, date, post
type and cover image. Public posts also carry their full text. Locked posts
get a "🔒 Patrons only · Read on Patreon →" link, so you click through and
read them on Patreon while logged in. Nothing locked is ever requested or
published, and no Patreon login, cookie or token is involved.

1. Find the creator's vanity name, the `<vanity>` in `patreon.com/<vanity>`.
   It works even if the creator's page lives on a custom domain.
2. Copy `sites/kenji-lopez-alt.yaml` to `sites/<id>.yaml` and change `id`,
   `name`, `description`, `vanity` and `listing_url`:

   | Field | Meaning |
   |---|---|
   | `type` | `patreon` (leave it out, or use `html`, for a scraped site) |
   | `vanity` | The creator's name in `patreon.com/<vanity>` |
   | `listing_url` | The creator's Patreon page, used as the feed's link |
   | `max_items` | How many posts to keep. Each run asks for the newest `min(max_items, 100)` |
   | `user_agent` | As for scraped sites |

   Selector fields and `fetch_detail` don't apply to Patreon configs and are ignored.

3. Test locally with `uv run python -m scraper.run <id>`, then check
   `docs/feeds/<id>.xml`.

## Limitations

- This only works for sites that render their article list in the initial
  HTML. Sites that require JavaScript to load the list (rare for public
  blogs/newsrooms, but it happens) would need a headless-browser-based
  fetch instead of the plain `requests` call in `scraper/extract.py`.
- Only whatever the listing page shows on a single fetch (usually the most
  recent 10–20 items) is considered per run. That's fine for keeping up with
  new posts going forward — the schedule is frequent enough that nothing new
  gets missed — but it means very old posts that existed before you started
  monitoring a site won't retroactively appear.
- Be a considerate scraper: this is a handful of requests every few hours for
  personal use, with a descriptive `User-Agent` and a real timeout — well
  within reasonable, respectful use of a public page. If a site's terms of
  service explicitly forbid automated access, or it publishes a
  `robots.txt` disallow for these paths, don't add a config for it.
- If a configured site reworks its page layout, `item_selector` will
  suddenly match 0 items — the workflow logs a warning in that case (visible
  under the Actions run) rather than failing silently forever, so periodically
  check the Actions tab or your feed reader if a normally-active feed goes
  quiet.
- Patreon feeds use an undocumented API that can change without notice. If
  Patreon starts serving GitHub's runners a Cloudflare challenge, the run
  fails with "Patreon returned non-JSON … possibly a Cloudflare challenge".
- Patreon image URLs are signed and expire after about two weeks. Readers
  that cache images when they fetch an item keep them. Others show broken
  images on older posts.
- A Patreon post's summary is built once, when the post first appears. A
  post that is unlocked or locked later keeps its original summary, and edits
  to a public post's text aren't picked up.
