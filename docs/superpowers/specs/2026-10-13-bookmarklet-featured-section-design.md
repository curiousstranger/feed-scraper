# Bookmarklet featured sections — design

Date: 2026-10-13
Status: approved in brainstorming; awaiting written-spec review

## Goal

Let the selector-picker bookmarklet generate a config for a listing page that
has a main list of articles **plus a single "featured" hero** marked up
differently, emitting the scraper's existing `featured_*` fields. Today the
picker only models one repeating group, so a hero is either silently lost or
silently caught with the wrong field selectors.

Motivating example: `https://www.anthropic.com/engineering` (config added by
hand in `sites/anthropic-engineering.yaml`, PR #11).

### Non-goals

- More than one extra section per page. Every page seen so far is "a list plus
  one hero". `anthropic.com/news` has two differently-marked featured groups
  (hero + side links); the picker can capture one or the other as the featured
  section, not both, and its hand-written config stays as is.
- A general `sections:` list in the config schema.
- Generating `:not(...)` selectors.

## Background: what the picker does today on /engineering

Verified by running the bookmarklet's own modules under jsdom against the saved
page (hero + 25 table rows; hero and rows share the same
`ArticleList-…__cardLink` anchor class; the hero sits in an
`article[class*="featured"]`, has an `<h2>` title, and has no `<time>`):

- **Click a table row:** `generalize` finds 25 items and outlines 25, but
  `itemSelectorFor` finds no selector matching exactly those 25 (nothing
  without `:not()` excludes the hero) and falls back to one that matches 26.
  The preview then silently includes the hero with its title extracted as the
  whole card's text ("Featured Redesigning source control… As our merges per
  day grew…"), because the row title selector (`h3.headline-4`) misses the
  hero's `<h2>`. The panel only shows "Selector matches 26 elements, not 25."
- **Click the hero:** every ancestor level has 1 match, so `generalize` returns
  index -1: "No repeating articles found."
- Separately, the hash `_tpu-a` in `ArticleList-module-scss-module___tpu-a__cardLink`
  isn't recognised as a hash, so the full class is emitted verbatim. That is
  being fixed independently (branch `fix/css-module-hash-signals`); see
  *Sequencing*.

## Decisions

| Question | Decision |
|---|---|
| Extra section's selectors | Its own item/link/title/date/category selectors, emitted as the existing `featured_*` fields |
| How many extra sections | Exactly one (optional) |
| Main selector over-matching into the hero | The featured section **claims its elements**: the scraper skips main-list elements that the featured selector also matched (element identity, not URL) |
| Alternative rejected | Emitting `:not(...)` in the main selector — harder to generate reliably and couples the main selector to the hero's markup |

## Scraper changes (`scraper/extract.py`)

1. **Featured claims its elements.** In `extract_items`, when
   `featured_item_selector` is set, compute the set of elements it matches
   *before* extracting the main list, and have the main-list pass skip any
   element in that set. Then extract the featured items as today. The existing
   URL de-duplication is unchanged: if the same URL appears as two *different*
   elements (one in each section), the main list's copy still wins.
   - `_extract_items` gains an optional `exclude` parameter (a set of
     elements) rather than a second code path.
   - Existing configs are unaffected: in `sites/anthropic-news.yaml` the main
     selector never matches a `FeaturedGrid` element (asserted by test).
2. **`featured_link_selector`.** Passed through into `featured_config` as
   `link_selector`, alongside the existing featured title/date/format/category
   keys. Needed because the picker auto-derives a link selector when the
   clicked item is a container rather than an `<a>`.

Item order is unchanged (main items, then featured items not already seen);
state sorts by date anyway.

## Bookmarklet

### State

The panel's state gains an optional `featured` sub-state with the same shape
as the main list's: `levels`, `index`, `itemSelector`, `selectors`
(`link/title/date/category`), `skipped`. `armed` values gain a featured
variant (e.g. `featured:item`, `featured:title`, …) so the existing
pick/skip/clear handlers work for either section.

### Entry points (both only once the main list's item is picked)

1. **Detected:** after removing featured-claimed elements, if the main item
   selector still matches elements outside the main item set, those elements
   are outlined **purple dashed**, and the existing "Selector matches N
   elements, not M" warning is replaced by:
   > Your selector also catches K element(s) outside the list (purple) — e.g.
   > a featured article. **[Add as featured section]**

   The button starts the featured flow with the first such element already
   picked as the featured item.
2. **Manual:** a **+ Add featured section** button, shown once the main flow
   reaches Done (and no featured section exists), arms `featured:item` with the
   prompt: *"Click the featured/hero article (outside the orange boxes)."*
   Every featured-flow prompt is marked as such: a purple **Featured section**
   badge leads it and the prompt line gets a purple left border and tint, so
   the switch from a main-list step (notably via the over-match button, where
   nothing is clicked on the page) can't be mistaken for the main-list
   prompt it replaces.

### Featured flow

- **Item:** run `generalize` on the click. If it finds a repeating level
  (≥ `MIN_ITEMS` with a link), use it. Otherwise — the expected case for a
  hero — fall back to the nearest ancestor-or-self that is `a[href]` or
  contains one, instead of index -1. Single-item featured sections are never
  "blocked". ↑ wider / ↓ narrower act on the featured section while it is the
  one being edited.
- **Item selector:** `itemSelectorFor(el, featuredItems)` — must match exactly
  the featured items. On /engineering the existing ancestor-scoping loop
  should yield e.g. `article[class*="featured"] a[class*="cardLink"]`.
- **Link:** auto-derived with `relativeSelector` when the item isn't itself a
  link, as for the main list.
- **Fields:** headline → date → topic, each with Skip, same as the main flow.
  The featured date prompt adds: *"No date? Click Skip — the article's own page
  usually has one."* (`fetch_detail` backfills `article:published_time`.)
- **Clicks for the featured section** must land inside a featured box; clicks
  elsewhere get the existing "outside the boxes" message, worded for purple.

### Panel layout

- The fields area becomes two groups, **Main list** and **Featured section**,
  each with its item-selector row (Re-pick), field rows (Pick/Clear), and its
  item count. The featured group has **Remove featured section**.
- Outlines: main items orange; featured items **purple solid**; unclaimed
  over-matches purple dashed; picked fields in either section blue.
- The main-list mismatch warning is computed on main matches minus
  featured-claimed elements, so it disappears once the hero is featured.
- Preview table: featured rows first, marked ★, then the first
  `PREVIEW_ROWS` main rows.

### Extraction mirror (`src/extract.js`)

`extractPreview` and `selectorCounts` apply the same claiming rule as the
scraper (featured matches excluded from the main pass; URL de-dup as in
`extract_items`) and return featured rows/counts, so outlines, preview and
scraper agree.

### Raw-HTML check

Also counts the featured selector in the fetched raw HTML. A featured section
with 0 raw matches gets its own warning ("The featured section looks
JavaScript-rendered; the scraper won't see it"), independent of the main
list's verdict.

### YAML output (`src/yaml.js`)

After the main selectors, in `anthropic-news.yaml` order:
`featured_item_selector`, then whichever of `featured_link_selector`,
`featured_title_selector`, `featured_date_selector`,
`featured_category_selector` were picked. Omitted entirely when there is no
featured section.

## Testing

TDD throughout: failing test first for each behaviour.

- **Python (`tests/test_extract.py`):**
  - an element matched by both main and featured selectors is extracted once,
    with the featured section's title/date/category;
  - `featured_link_selector` is honoured for a container featured item;
  - the same URL as two distinct elements keeps today's behaviour (main wins);
  - `anthropic-news`-shaped fixture: output unchanged.
- **Parity (`tests/test_bookmarklet_parity.py` + `bookmarklet/test/parity.test.js`):**
  - Python side switches from `extract_listing` to `extract_items`.
  - `cases.json` gains an optional `clicks.featured` block (`item`, `title`,
    `date`, `category`) and `featured_*` keys in `expected_selectors`; the JS
    helper replays featured clicks through the featured generalize path.
  - New fixture `bookmarklet/test/fixtures/engineering.html`: a trimmed copy
    of the real page (hero + ~4 rows, real class names), with a case that
    expects the hero once with its `<h2>` title and the rows with dates.
- **JS unit tests:** featured `generalize` fallback; `extractPreview` /
  `selectorCounts` claiming; `toYaml` featured keys, order and omission.
- **Panel tests (engineering fixture):** over-match prompt → *Add as featured
  section* → featured flow → expected YAML; manual *+ Add featured section*;
  *Remove featured section*; main mismatch warning clears once the hero is
  featured; featured raw-HTML warning.
- **Build:** `npm run build`; commit `docs/bookmarklet.html` (CI diffs it).
- **Manual:** run the built bookmarklet on live `anthropic.com/engineering`
  and `anthropic.com/news`, and report the generated YAML.

## Docs

- README "Adding another site": add the `featured_link_selector` row to the
  field table; a short paragraph in the bookmarklet bullet on adding a
  featured section and when the picker offers it.
- `CLAUDE.md`: one line in the `extract.py` pipeline step noting that the
  featured section claims its own elements.

## Sequencing

Start implementation after the CSS-module hash fix
(`fix/css-module-hash-signals`) has merged, or rebase onto it: it changes the
generated selectors for the engineering fixture (expected
`a[class*="ArticleList"][class*="cardLink"]`, not the full hashed class), so
parity expectations written before it would be wrong.
