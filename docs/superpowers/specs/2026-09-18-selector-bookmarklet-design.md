# Selector-picker bookmarklet — design

**Date:** 2026-09-18
**Status:** Approved in brainstorming; pending spec review

## Goal

Make adding a site config a point-and-click task: on a site's listing page,
click a bookmarklet, click one article and (optionally) its title, date and
category, and get a ready-to-paste `sites/<id>.yaml`. Today this requires
reading page source by hand and writing selectors that survive build-hashed
class names (see `sites/anthropic-news.yaml`).

## Non-goals (v1)

- Picking the optional `featured_*` block. Rare; hand-add to the YAML.
- Editing `date_format` / `max_items` / `fetch_detail` in the UI beyond the
  defaults emitted in the YAML (they are editable in the output).
- Committing or opening PRs via the GitHub API (no tokens in the browser).
- Headless-browser scraping for JS-rendered sites. The bookmarklet *detects*
  these; it doesn't make them scrapeable.

## Decisions

| Question | Decision | Why |
|---|---|---|
| Getting the config out of the browser | **Copy YAML** (primary) + **Open in GitHub** pre-filled new-file URL (secondary) | No auth; clipboard path keeps a local `scraper.run` in the loop |
| Delivery | **Self-contained `javascript:` URL** | Loader-stub injection is blocked by `script-src` CSP on many of the sites that most need a scraper. Cost: re-drag the bookmark after tool updates |
| Items whose `<a>` doesn't wrap the whole item | **Add optional `link_selector` to the scraper** | Common markup (`<article>` with link only around the title) is otherwise inexpressible |
| Rendered DOM vs raw HTML mismatch | **Built-in raw-HTML check** in the panel | Scraper uses `requests`, not a browser; catch JS-rendered lists before pasting |

## Scraper change: `link_selector`

In `scraper/extract.py:_extract_items`:

- If `config["link_selector"]` is set, `item_selector` matches a *container*;
  the item URL comes from `el.select_one(link_selector).get("href")`. If that
  finds no element or no `href`, the item is skipped (same as today's
  missing-`href` behavior).
- If unset, behavior is unchanged: the matched element itself must carry the
  `href`. `sites/anthropic-news.yaml` keeps working untouched.
- Title fallback (`el.get_text`) stays on the item element when
  `title_selector` is unset. Title/date/category selectors remain relative to
  the item element, not the link.
- `featured_*` does not get a `link_selector` counterpart in v1.
- README field table gains a `link_selector` row.

## Bookmarklet

### Picking flow

A fixed panel rendered inside a **Shadow DOM** (isolated from page CSS both
ways). While active, page clicks are intercepted in the capture phase with
`preventDefault`/`stopPropagation` so links don't navigate. `Esc` or ✕
removes all listeners, highlights and the panel.

1. **Pick item.** Hover outlines elements; click one article. The tool
   *generalizes* (below) to the full set of items and highlights all
   matches with a live count. **↑ / ↓** buttons widen/narrow one level.
2. **Link.** Skipped if the item element is itself `a[href]`. Otherwise
   auto-set to the first `a[href]` in the item; the user can click another
   link inside an item to override. Emitted as `link_selector`.
3. **Title / date / category** (each optional). Click the field inside any
   highlighted item; a selector relative to that item is generated and
   applied to all items. A preview table shows the first 5 rows
   (title | date | category | url), extracted exactly as the scraper would:
   title via `get_text` fallback, date from the `datetime` attribute else
   text, URL resolved against `base_url`. Items where a field selector
   misses are shown as blanks, not hidden.
4. **Metadata & output.** Editable fields pre-filled: `id` (slug from
   hostname + first path segment), `name` (`document.title`),
   `description`, `listing_url` (`location.href` minus hash),
   `base_url` (`location.origin`). Then: raw-HTML check result, YAML
   preview, **Copy YAML**, **Open in GitHub**.

### Generalization (click → item set)

From the clicked element, walk up ancestors. At each level compute the
element's best selector (next section) and count its matches in the
document. Choose the first ancestor (nearest the click) whose selector
matches ≥ 3 elements, where the clicked element's chain is included. ↑/↓
move the chosen level. If no level yields ≥ 3 matches, show "no repeating
items found" and allow proceeding with the single element or using ↑.

### Selector generation

Shared by item, link and field selectors.

**Class tokenizing.** Each class name is split on `__`, `--`, and `_`/`-`
boundaries into segments, then:

- *Hash-like segments are dropped*: 5–8 chars mixing case and/or digits
  (e.g. `KxYrHG`, `a1b2c3`), and known CSS-in-JS classes whole
  (`css-*`, `sc-*`, `jsx-*`, `emotion-*`, `svelte-*`).
- A class with a dropped segment contributes its remaining meaningful
  segments as `[class*="<segment>"]` fragments
  (`PublicationList-module-scss-module__KxYrHG__listItem` →
  `PublicationList`, `listItem`; `module`/`scss` are ignored as noise).
- A class with no hash-like segment is used verbatim as `.class`.
- Utility classes (Tailwind-like: containing `:`, `/`, `[`, or matching
  common utility prefixes such as `flex`, `grid`, `mt-`, `px-`, `text-`,
  `bg-`, `w-`, `h-`) are never used as the sole signal.

**Candidate order** — the first *correct* candidate wins:

1. tag + stable class fragments, fewest fragments first
2. semantic tag alone (`article`, `time`, `h1`–`h4`, `li`)
3. stable attribute (`data-testid`, `data-*` without hash-like values,
   `itemprop`, `role`)
4. short structural path of the above joined by `>` (max 3 steps); never
   `:nth-child` / `:nth-of-type`

**Correctness:**

- *Item selector*: matches exactly the generalized set. If it over-matches,
  try prefixing one ancestor's selector (`<ancestor> <item>`).
- *Link / field selectors*: evaluated as `item.querySelector(sel)`; must
  select the clicked element in its own item, and are preferred when they
  hit something in the most items.

**Allowed syntax** (must behave identically in browser `querySelector` and
BeautifulSoup/soupsieve): type, `.class`, `[attr]`, `[attr="v"]`,
`[attr*="v"]`, descendant, `>`. Nothing else.

### Raw-HTML check

`fetch(location.href, {credentials: "include"})` (same origin, so no
CORS), parse with `DOMParser`, run item + link + field selectors against it
and show counts: `rendered: 12 · raw HTML: 12 ✓`. If raw count is 0 (or
much lower), warn that the list is JS-rendered and the scraper won't see
it. If the fetch fails (CSP `connect-src`, network), show "couldn't verify
— test with `uv run python -m scraper.run <id>`".

### Output

YAML emitted by a small hand-rolled emitter (fixed key order matching
`anthropic-news.yaml`, double-quoted strings, single-quoted selectors),
with a header comment noting it was generated by the bookmarklet from
`<listing_url>` on `<date>`. Omits unpicked optional selectors. Emits
`fetch_detail: true`, `max_items: 75`, and the repo's standard
`user_agent`.

- **Copy YAML**: `navigator.clipboard.writeText`, falling back to a
  selected `<textarea>` + "press ⌘C" if the clipboard API is refused.
- **Open in GitHub**:
  `https://github.com/<owner>/<repo>/new/main?filename=sites/<id>.yaml&value=<urlencoded>`,
  with `<owner>/<repo>` baked in at build time from `git remote`. Disabled
  with "use Copy instead" if the URL exceeds 8,000 chars.

## Code layout

```
bookmarklet/
  src/selectors.js    # tokenizing + selector generation (pure; DOM in, string out)
  src/generalize.js   # click → item set; ↑/↓ levels
  src/extract.js      # preview extraction mirroring scraper/extract.py
  src/yaml.js         # config → YAML string
  src/panel.js        # Shadow-DOM UI, picking state machine, raw check, output
  src/main.js         # entry; toggles tool on/off (second click closes it)
  test/*.test.js      # node:test + jsdom
  test/fixtures/*.html
  test/cases.json     # shared JS/Python parity cases
  build.mjs           # esbuild → minified IIFE → javascript: URL → docs/bookmarklet.html
  package.json        # devDependencies only: esbuild, jsdom
```

- `docs/bookmarklet.html`: generated, committed install page with the
  drag-to-bookmarks link and short usage notes. Separate from
  `docs/index.html` because `run.py` rewrites that file every run.
- `scraper/run.py:write_index`: adds a link to `bookmarklet.html`.
- `.gitignore`: add `bookmarklet/node_modules/`.

## Testing

- **Python (TDD, `uv run pytest`)**: `link_selector` — container + inner
  link, container with no link (skipped), link without `href` (skipped),
  unset `link_selector` unchanged behavior.
- **JS (`npm test` in `bookmarklet/`)**: tokenizer against real-world class
  names (hashed CSS-modules, styled-components, Tailwind, plain BEM);
  generalization on fixtures; candidate ordering; YAML output snapshot;
  GitHub URL length guard.
- **Parity**: `bookmarklet/test/cases.json` lists
  `{fixture, click paths, expected selectors, expected items}`. The JS test
  asserts generated selectors equal `expected selectors` and preview
  extraction yields `expected items`; `tests/test_bookmarklet_parity.py`
  runs `extract_listing` with the same selectors on the same fixture and
  asserts the same items. Fixtures: Anthropic-style hashed classes, plain
  `.post-card` blog, Tailwind-only markup, container-with-inner-link.
- **CI**: new `.github/workflows/test.yml` on pull requests: `uv run
  pytest`, `npm ci && npm test`, and `npm run build` followed by
  `git diff --exit-code docs/bookmarklet.html` so the committed bookmarklet
  never drifts from source.
- **Manual**: install from `docs/bookmarklet.html`, generate a config on
  anthropic.com/news, confirm it matches the selectors in
  `sites/anthropic-news.yaml` and `scraper.run` produces the same items.

## Error handling summary

| Situation | Behavior |
|---|---|
| No repeating siblings found | Message; allow single element or ↑ |
| Field selector misses some items | Blank cells in preview; still emitted |
| Raw-HTML fetch blocked | "Couldn't verify — run locally" |
| Raw-HTML count 0 / much lower | Warning: list is JS-rendered |
| Clipboard API refused | Selected textarea fallback |
| GitHub URL > 8,000 chars | Button disabled, "use Copy instead" |
| Bookmarklet clicked while active | Closes the tool |

## Docs

README "Adding another site", step 2: add "or use the bookmarklet (see
`docs/bookmarklet.html`)" with a short flow description, and the
`link_selector` field row.
