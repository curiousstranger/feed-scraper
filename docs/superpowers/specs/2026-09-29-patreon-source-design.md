# Patreon creator feeds — design

Date: 2026-09-29
Status: approved in brainstorming; awaiting written-spec review

## Goal

Publish a public, per-creator RSS feed of a Patreon creator's posts, built from
Patreon's anonymous (logged-out) data. Locked posts appear as title + date +
cover image + a "patrons only" label linking to the post; the subscriber clicks
through and reads on Patreon while logged in. Public posts additionally carry
their full (sanitized) body.

Motivating example: J. Kenji López-Alt, `patreon.com/kenjilopezalt`, served on
the custom domain `frienji.kenjilopezalt.com`.

### Non-goals

- No authentication of any kind: no OAuth, no session cookie, no secrets. Locked
  post content is never requested or published. (Rationale: feeds are public on
  GitHub Pages and state is committed to git; republishing paywalled content
  would breach Patreon's terms and the creator's copyright, and a `session_id`
  cookie in CI would expose the whole account.)
- No combined "all my subscriptions" feed — one feed per creator.
- No full-archive backfill.
- No generic JSON-API source type.

## Background: findings from the feasibility spike (2026-09-29)

Verified from a residential IP, logged out:

- `GET https://www.patreon.com/api/campaigns?filter[vanity]=<vanity>` returns
  the campaign (Kenji: `4148811`). Works even when the creator uses a custom
  domain.
- `GET https://www.patreon.com/api/posts?filter[campaign_id]=<id>&filter[contains_exclusive_posts]=true&sort=-published_at&page[count]=N`
  returns JSON:API post objects with `title`, `url`, `published_at`,
  `post_type`, `image`, `current_user_can_view`. A plain `curl` UA works.
- `is_public` is no longer populated (always null). **`current_user_can_view`
  is the public-post signal** for an anonymous request.
- The list endpoint returns empty `content` even for public posts. Public posts'
  full text *is* visible to logged-out visitors (confirmed by the user in a
  private window), so the body must be fetched per post.
- The custom domain itself (`frienji.kenjilopezalt.com`) serves a Cloudflare
  challenge to scripts; we never fetch it. Post `url`s use it, which is fine as
  a link target.
- This `/api/` surface is Patreon's internal, undocumented web API — not the
  official API v1 (retiring 2026-10-07) nor v2 (whose `campaigns.posts` scope
  only covers the token holder's own campaign). It can change without notice.
- **Unverified:** whether GitHub Actions runner IPs are served JSON or a
  Cloudflare challenge.

## Architecture

Dispatch on a new optional `type` field in the site config. `type` defaults to
`html` (all existing configs, unchanged). `type: patreon` routes the *listing*
and *enrichment* steps of `scraper/run.py:process_site` to a new module
`scraper/patreon.py`; state merge, feed build, and index generation are shared
and unchanged.

```
process_site(cfg)
  type == html    → extract.fetch + extract.extract_items      (unchanged)
  type == patreon → patreon.fetch_posts(cfg)
  state_mod.merge_items(...)                                     (unchanged)
  for new urls:
    html    → extract.enrich_with_detail (if fetch_detail)      (unchanged)
    patreon → patreon.enrich_new(item, post, cfg)
  save state, feedgen_util.build_feed, write feed                (unchanged)
```

An unknown `type` value raises a `ValueError` naming the config file.

### Config

```yaml
id: kenji-lopez-alt
type: patreon
name: "J. Kenji López-Alt (Patreon, unofficial)"
description: "Post titles and public posts from Kenji's Patreon; locked posts link through."
vanity: kenjilopezalt                                   # patreon.com/<vanity>
listing_url: "https://www.patreon.com/kenjilopezalt"   # feed <link> + index "source" link
max_items: 100
user_agent: "Mozilla/5.0 (compatible; PersonalSiteRSSBot/1.0; run by a single subscriber for personal use)"
```

`vanity` is required for `type: patreon`. `listing_url` remains required so
`run.py`, `feedgen_util`, and `write_index` need no special-casing. Selector
fields and `fetch_detail` are ignored for Patreon configs.

### `scraper/patreon.py`

Public API:

- `@dataclass Post: item: dict; public: bool; image: str | None`
  — `item` is exactly the shape every source produces
  (`{url, title, published, category}`); `public`/`image` are per-run metadata
  that never enter state.
- `fetch_posts(cfg) -> list[Post]`
  1. Resolve the campaign id via the vanity endpoint (every run; one request).
     No matching campaign → `ValueError` naming the vanity and config path.
  2. One list request, `page[count] = min(cfg.get("max_items", 100), 100)`,
     requesting only the fields
     `title,url,published_at,post_type,image,current_user_can_view`. No
     pagination (first run = newest ≤100 posts; later runs add what's new).
  3. Map each post to a `Post`: `item.url` = post `url` (state key; the
     custom-domain link for Kenji), `item.title`, `item.published` =
     `published_at`, `item.category` = a human label from `post_type`
     (`video_external_file`/`video_embed` → "Video", `image_file` → "Images",
     `text_only` → "Text", `link` → "Link", `audio_file`/`audio_embed` →
     "Audio", `poll` → "Poll"; unknown → underscores to spaces, title-cased);
     `public` = `current_user_can_view`; `image` = best available cover-image
     URL or None.
- `enrich_new(item, post, cfg) -> dict` — returns `item` with `summary` set.
  - If `post.public`: fetch that one post's body (endpoint pinned during
    implementation — see "Open implementation detail"), sanitize it, and build
    the summary with the body. On any fetch/parse failure: log a warning and
    fall back to the label-only summary (no retry on later runs, matching
    `fetch_detail` semantics).
  - If not `post.public`: build the label-only summary. **No request is made
    for locked posts.**

In `process_site`, the Patreon branch merges `[p.item for p in posts]` and
calls `enrich_new(state["items"][url], posts_by_url[url], cfg)` for each new
URL. Because only `item` dicts reach `merge_items`, state never contains
per-run metadata. Summaries are built once, for new items only; existing
items keep their stored summary (same as `fetch_detail`).

Summary HTML, assembled by our code with every API-derived value escaped:

```
<p><img src="{image}" alt=""></p>          (if image)
{sanitized body}                             (public posts only)
<p>🔒 Patrons only · {category} · <a href="{url}">Read on Patreon →</a></p>   (locked)
<p>Public · {category}</p>                                                    (public)
```

Internal helper `_get_json(url, cfg)`: GET with the config's UA and the shared
timeout, `raise_for_status()`, then require a JSON content type; otherwise raise
`PatreonBlockedError("Patreon returned non-JSON (HTTP {status}, {content-type}) — possibly a Cloudflare challenge")`.

### Sanitizing

New dependency: `nh3`. Allowlist: `p, br, hr, strong, b, em, i, u, s, a, ul, ol,
li, blockquote, h2, h3, h4, img, figure, figcaption, code, pre`. Attributes:
`a[href]`, `img[src, alt]`. URL schemes: `http`, `https`. Everything else
(scripts, iframes, styles, event handlers, `javascript:` URLs) is stripped.

## Error handling

Follows existing `run.py` behavior: an exception in `process_site` is logged,
the site is marked failed, other sites still run, and the process exits
non-zero.

| Condition | Behavior |
|---|---|
| vanity not found | `ValueError` → site fails |
| HTTP error on vanity/list | `requests.HTTPError` → site fails |
| non-JSON response | `PatreonBlockedError` → site fails, clear message |
| public-body fetch fails | warning; item kept with label-only summary |
| unknown `type` in config | `ValueError` → site fails |

## CI / GitHub Actions risk

The first implementation task is a smoke test proving runner IPs get JSON from
the vanity and list endpoints — run on the feature branch's PR (e.g. a
temporary step or workflow limited to the feature branch, removed before
merge). Pushing that branch requires explicit user approval at that point. If
runners are challenged, stop and revisit (candidate fallback: run on the QNAP
from a residential IP).

## Open implementation detail

Which endpoint returns a public post's body anonymously (candidates:
`GET /api/posts/{id}` with `fields[post]=content`, or the post page's embedded
data). Pin it during implementation by probing **only posts where
`current_user_can_view` is true**; never request body fields for locked posts.
Record the chosen endpoint in a trimmed fixture.

## Testing

TDD, no network in tests. Fixtures under `tests/fixtures/patreon/`, trimmed from
real responses (vanity lookup, a list page with public + locked posts, a public
post body, an empty vanity result, a non-JSON challenge page). `requests` is
stubbed (monkeypatch), matching the existing test style.

Cases:
- post → item mapping (public and locked; custom-domain url; missing image)
- `post_type` → category labels, including unknown types
- summary construction and escaping (title/url/image with `"<>&`)
- sanitizer drops `<script>`, `<iframe>`, `onerror=`, `javascript:` hrefs;
  keeps allowed tags
- locked posts trigger no body request
- body-fetch failure falls back to label-only summary
- vanity not found → `ValueError`; non-JSON → `PatreonBlockedError`
- `process_site` dispatch: `type: patreon` uses the Patreon path; missing `type`
  uses the HTML path unchanged; unknown `type` raises
- state written for a Patreon site contains only item fields (`url, title, published, category, summary, first_seen`)

Gate: `uv run pytest` passes (full output shown), and existing HTML configs
still run (`uv run python -m scraper.run anthropic-news`).

## Deliverables

- `scraper/patreon.py`, dispatch in `scraper/run.py`
- `nh3` added via `uv add nh3` (updates `pyproject.toml` + `uv.lock`)
- `sites/kenji-lopez-alt.yaml`
- tests + fixtures
- README "Adding a Patreon creator" section; one line in `CLAUDE.md`
  architecture noting `type:` dispatch
