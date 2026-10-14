# Bookmarklet Featured Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the selector-picker bookmarklet capture one optional "featured" section (e.g. the hero on anthropic.com/engineering) alongside the main list and emit the scraper's `featured_*` fields, with the scraper letting the featured section claim the elements it matches.

**Architecture:** The scraper (`scraper/extract.py:extract_items`) skips main-list elements that `featured_item_selector` also matches (by element identity) and passes `featured_link_selector` through. The bookmarklet mirrors that rule in `src/extract.js`, gains a `featuredGeneralize` click→item fallback for single heroes, emits `featured_*` keys in `src/yaml.js`, and its panel (`src/panel.js`) grows a second "Featured section" sub-state with its own item/fields flow, two entry points (over-match detection and a manual button), purple outlines, ★ preview rows and a featured raw-HTML check.

**Tech Stack:** Python 3.13 + BeautifulSoup/soupsieve (`uv run pytest`); vanilla ES modules tested with `node:test` + jsdom (`cd bookmarklet && npm test`); esbuild bundles to `docs/bookmarklet.html` (`npm run build`).

**Spec:** `/Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured/docs/superpowers/specs/2026-10-13-bookmarklet-featured-section-design.md`

## Global Constraints

- **Working directory:** `/Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured` (git worktree, branch `bookmarklet-featured`). Every subagent dispatch must state this absolute path **and** tell the agent to `cd` there before its first write. Never touch `/Users/mcable/src/feed-scraper` (the main checkout) — it has the same subdirectory names.
- **TDD:** a failing test (run, failure seen) before each piece of implementation code.
- Python only via `uv run` (`uv run pytest`). JS from `bookmarklet/`: `npm ci` once, then `npm test`.
- **Never claim a pass without pasting the command and its full output** in the same report.
- Generated selectors may only use syntax that behaves identically in browser `querySelector` and soupsieve: type, `.class`, `[attr="v"]`, `[attr*="v"]`, descendant, `>`. **Never `:not(...)`**, `:nth-child`, etc.
- Exactly **one** optional featured section. No `sections:` list.
- The featured section **claims its elements by element identity**, not URL. URL de-dup is unchanged: main list's copy wins; featured rows also de-dup among themselves.
- Exact user-facing copy, verbatim from the spec:
  - Over-match prompt: `Your selector also catches K element(s) outside the list (purple) — e.g. a featured article.` + button `Add as featured section`
  - Manual button: `+ Add featured section`; manual prompt: `Featured — click the featured/hero article (outside the orange boxes).`
  - Featured date prompt includes: `No date? Click Skip — the article's own page usually has one.`
  - Featured raw-HTML warning: `The featured section looks JavaScript-rendered; the scraper won't see it.`
  - Group headings `Main list` / `Featured section`; button `Remove featured section`.
- Outline colours: main items `2px solid #e8590c` (existing), picked fields `2px solid #1c7ed6` (existing), featured items `2px solid #7048e8`, unclaimed over-matches `2px dashed #7048e8`.
- YAML order: after the main selectors, a blank line, then `featured_item_selector`, `featured_link_selector`, `featured_title_selector`, `featured_date_selector`, `featured_category_selector` (unpicked ones omitted; whole block omitted without a featured item selector).
- Preview: kept featured rows first, title prefixed `★ `, then the first `PREVIEW_ROWS` (5) main rows.
- `docs/bookmarklet.html` must be rebuilt (`npm run build`) and committed after `bookmarklet/src/` changes; CI diffs it.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Land via `gh pr create`; never push to `main`.

**Deliberate deviations from the spec (decided while planning; flag in the PR body):**

1. `_extract_items` takes `exclude_ids` (a set of `id()`s), not "a set of elements". bs4 Tags with identical markup compare **and hash** equal (verified: `a == b`, `b in {a}` both `True`), so a set of Tags would also skip an identical-looking main-list element.
2. Most panel tests use a new small fixture `bookmarklet/test/fixtures/hero.html` (plain class names, and a hero with a category) instead of the engineering fixture. That lets them exercise featured category picking, which the engineering hero lacks. Task 8 adds one end-to-end panel test on the engineering fixture.
3. The spec's predicted main selector for /engineering, `a[class*="ArticleList"][class*="cardLink"]`, is wrong. The merged hash fix (PR #12) actually generates `a[class*="cardLink"]`, measured with origin/main's code on the trimmed fixture and the live page. The featured selector is `article[class*="featured"] a[class*="cardLink"]`, as predicted.
4. A featured-item click whose resulting items overlap the main list's orange boxes is refused. The spec leaves this case undefined. Without the refusal, the featured section would claim the whole main list.
5. When the featured flow finishes, the panel returns to the first unfinished main-list field, if any.

## Review Focus

1. **Featured click inside or around the orange boxes** (a list row, or the list container) is refused with a message. It does not silently claim the main list. Pinned in Task 6 (`refuses an orange-box article as the featured item`).
2. **Identical-markup elements:** a main-list element whose markup matches a featured element exactly is still scraped as main, because claiming is by identity. Pinned in Task 2 (`test_claiming_is_by_element_identity_not_equal_markup`).
3. **Same URL as two distinct elements:** the main list's copy wins in the scraper, in the preview, and in the ★ rows. Pinned in Task 2 (`test_same_url_as_two_distinct_elements_keeps_the_main_list_copy`) and Task 3 (`same URL in both sections: main wins`).
4. **Remove featured section while a featured field is armed:** the state resets cleanly, the YAML loses every `featured_` key, and `+ Add featured section` returns. Pinned in Task 6 (`Remove featured section mid-flow`).
5. **Re-picking the main list after a featured section exists** keeps the featured section and its YAML. Pinned in Task 6 (`re-picking the main list keeps the featured section`).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `scraper/extract.py` | modify | `extract_items` claiming + `featured_link_selector`; `_extract_items(..., exclude_ids)` |
| `tests/test_extract.py` | modify | scraper tests for claiming, link selector, identity, news unchanged |
| `bookmarklet/src/extract.js` | modify | `extractSections`, `keptFeatured`, `featuredConfig`; `extractPreview`/`selectorCounts` apply claiming |
| `bookmarklet/test/extract.test.js` | modify | unit tests for the above |
| `bookmarklet/src/yaml.js` | modify | `featured_*` keys |
| `bookmarklet/test/yaml.test.js` | modify | featured YAML tests |
| `bookmarklet/src/generalize.js` | modify | `featuredGeneralize` |
| `bookmarklet/test/generalize.test.js` | modify | fallback tests |
| `bookmarklet/test/fixtures/hero.html` | create | small list+hero page for generalize/panel tests |
| `bookmarklet/src/panel.js` | modify | featured sub-state, groups, both entry points, outlines, preview, raw check |
| `bookmarklet/test/panel.test.js` | modify | one selector scoped to field rows (layout change) |
| `bookmarklet/test/panel-featured.test.js` | create | featured panel tests (hero fixture) + engineering E2E |
| `bookmarklet/test/fixtures/engineering.html` | create | trimmed real /engineering page |
| `bookmarklet/test/cases.json` | modify | engineering case with `clicks.featured` |
| `bookmarklet/test/parity.test.js` | modify | replay featured clicks via `featuredGeneralize` |
| `tests/test_bookmarklet_parity.py` | modify | use `extract_items` |
| `README.md`, `CLAUDE.md` | modify | docs |
| `docs/bookmarklet.html` | regenerate | built bookmarklet |

---

### Task 1: Bring the branch up to date with origin/main

The hash fix merged as PR #12 (`fix/css-module-hash-position`, merge commit `c13cd21`). origin/main also carries PR #11 (`sites/anthropic-engineering.yaml`). The branch was cut at `deb4322` and has only the spec commit `6beb01c`. This worktree was created by hand, not by the app, so merge with plain git.

**Files:** none edited (merge only).

- [ ] **Step 1: Fetch and confirm the fix is on origin/main**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured
git fetch origin
git merge-base --is-ancestor bcdce5b origin/main && echo "hash fix on origin/main"
```
Expected: `hash fix on origin/main`. If not printed, stop and report to the user.

- [ ] **Step 2: Merge origin/main**

```bash
git merge --no-edit origin/main
git log --oneline -3
```
Expected: a clean merge commit on top of `6beb01c` and `c13cd21` (no conflicts: the branch only added the spec file).

- [ ] **Step 3: Confirm the fix behaves as expected**

```bash
cd bookmarklet && npm ci
node --input-type=module -e "import { classSignals } from './src/selectors.js'; console.log(JSON.stringify(classSignals('ArticleList-module-scss-module___tpu-a__cardLink').map(s => s.selector)))"
```
Expected: `["[class*=\"ArticleList\"]","[class*=\"cardLink\"]"]` (not a single `.ArticleList-module-…` verbatim class).

- [ ] **Step 4: Baseline test runs (paste full output)**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured && uv run pytest
cd bookmarklet && npm test
```
Expected: both green. Record the pass counts; later tasks must not reduce them.

---

### Task 2: Scraper — featured section claims its elements; `featured_link_selector`

**Files:**
- Modify: `scraper/extract.py` (`extract_items`, `_extract_items`)
- Test: `tests/test_extract.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `extract_items(html, config)` semantics: when `featured_item_selector` is set, main-list elements it also matches are skipped; featured items honour `featured_link_selector`. `_extract_items(soup, config, exclude_ids=frozenset())`.

- [ ] **Step 1: Write the failing tests**

Add `from bs4 import BeautifulSoup` to the imports at the top of `tests/test_extract.py` (after `import yaml`), then append:

```python
HERO_HTML = """
<html><body>
<div class="list">
  <article class="card featured"><a class="card-link" href="/posts/hero">
    <h2>Hero post</h2><span class="kicker">Essays</span><p>A long summary.</p>
  </a></article>
  <div>
    <article class="card"><a class="card-link" href="/posts/one">
      <h3>Post one</h3><time datetime="2026-09-03">Sep 3, 2026</time>
    </a></article>
  </div>
</div>
</body></html>
"""

HERO_CONFIG = {
    "base_url": "https://example.com",
    "item_selector": "a.card-link",
    "title_selector": "h3",
    "date_selector": "time",
    "featured_item_selector": "article.featured a.card-link",
    "featured_title_selector": "h2",
    "featured_category_selector": "span.kicker",
}


def test_element_matched_by_both_sections_is_extracted_once_as_featured():
    """The featured section claims its elements: a hero that the main
    item_selector also matches must not be scraped as a main-list item
    (whose title_selector misses its <h2>, so the title would be the whole
    card's text)."""
    items = extract.extract_items(HERO_HTML, HERO_CONFIG)

    assert items == [
        {
            "url": "https://example.com/posts/one",
            "title": "Post one",
            "category": None,
            "published": "2026-09-03T00:00:00+00:00",
        },
        {
            "url": "https://example.com/posts/hero",
            "title": "Hero post",
            "category": "Essays",
            "published": None,
        },
    ]


def test_featured_link_selector_takes_url_from_link_inside_featured_container():
    html = """
    <section class="hero"><span class="kicker">News</span><h2><a href="/posts/hero">Hero</a></h2></section>
    <a class="row" href="/posts/one">Post one</a>
    """
    config = {
        "base_url": "https://example.com",
        "item_selector": "a.row",
        "featured_item_selector": "section.hero",
        "featured_link_selector": "a",
        "featured_title_selector": "h2",
        "featured_category_selector": "span.kicker",
    }

    items = extract.extract_items(html, config)

    assert len(items) == 2
    assert items[-1] == {
        "url": "https://example.com/posts/hero",
        "title": "Hero",
        "category": "News",
        "published": None,
    }


def test_same_url_as_two_distinct_elements_keeps_the_main_list_copy():
    """Claiming is by element, not URL: when the hero and a main-list row are
    different elements linking to the same article, the main list's copy wins
    (URL de-duplication unchanged)."""
    html = """
    <div class="hero"><a class="hero-link" href="/posts/same"><h2>Hero title</h2></a></div>
    <a class="row" href="/posts/same"><h3>Row title</h3></a>
    """
    config = {
        "base_url": "https://example.com",
        "item_selector": "a.row",
        "title_selector": "h3",
        "featured_item_selector": "div.hero a.hero-link",
        "featured_title_selector": "h2",
    }

    assert extract.extract_items(html, config) == [
        {"url": "https://example.com/posts/same", "title": "Row title", "category": None, "published": None}
    ]


def test_claiming_is_by_element_identity_not_equal_markup():
    """bs4 Tags with identical markup compare (and hash) equal, so a set of
    featured Tags would also swallow an identical-looking main-list element."""
    card = '<a class="card-link" href="/posts/same">Same <span class="kicker">K</span></a>'
    html = f'<div class="hero">{card}</div><div class="rows">{card}</div>'
    config = {
        "base_url": "https://example.com",
        "item_selector": "a.card-link",
        "featured_item_selector": "div.hero a.card-link",
        "featured_title_selector": "span.kicker",
    }

    assert extract.extract_items(html, config) == [
        {"url": "https://example.com/posts/same", "title": "Same K", "category": None, "published": None}
    ]


ANTHROPIC_NEWS_HTML = ANTHROPIC_FEATURED_HTML.replace(
    "</body>",
    """<ul class="PublicationList-module-scss-module__KxYrHG__list"><li>
  <a class="PublicationList-module-scss-module__KxYrHG__listItem" href="/news/policy-brief">
    <time class="PublicationList-module-scss-module__KxYrHG__date body-3" datetime="2026-09-01T00:00:00Z">Sep 1, 2026</time>
    <span class="PublicationList-module-scss-module__KxYrHG__subject body-3">Policy</span>
    <span class="PublicationList-module-scss-module__KxYrHG__title body-3">A policy brief</span>
  </a>
</li></ul>
</body>""",
)


def test_anthropic_news_main_selector_never_matches_a_featured_element():
    """Claiming must not change existing configs: on anthropic.com/news the
    main and featured selectors match disjoint elements."""
    config_path = pathlib.Path(__file__).parent.parent / "sites" / "anthropic-news.yaml"
    config = yaml.safe_load(config_path.read_text())
    soup = BeautifulSoup(ANTHROPIC_NEWS_HTML, "html.parser")

    main = {id(el) for el in soup.select(config["item_selector"])}
    featured = {id(el) for el in soup.select(config["featured_item_selector"])}

    assert main and featured and not (main & featured)
    assert [i["url"] for i in extract.extract_items(ANTHROPIC_NEWS_HTML, config)] == [
        "https://www.anthropic.com/news/policy-brief",
        "https://www.anthropic.com/claude-sonnet-5-5",
        "https://www.anthropic.com/claude-opus-5-5",
    ]
```

(`ANTHROPIC_NEWS_HTML` must be defined after `ANTHROPIC_FEATURED_HTML`; appending at the end of the file guarantees that.)

- [ ] **Step 2: Run to verify the right ones fail**

Run: `uv run pytest tests/test_extract.py -v`
Expected: these FAIL:
- `test_element_matched_by_both_sections_is_extracted_once_as_featured`: the hero comes first with title `Hero post Essays A long summary.`
- `test_featured_link_selector_takes_url_from_link_inside_featured_container`: `len(items) == 1`
- `test_claiming_is_by_element_identity_not_equal_markup`: two `Same K` items

These PASS already, as characterization tests: `test_same_url_as_two_distinct_elements_keeps_the_main_list_copy` and `test_anthropic_news_main_selector_never_matches_a_featured_element`.

- [ ] **Step 3: Implement**

In `scraper/extract.py`, replace `extract_items` and the head of `_extract_items` with:

```python
def extract_items(html: str, config: dict) -> list[dict]:
    """Like extract_listing, but also scrapes a site's optional "featured" promo
    section (declared via featured_item_selector and friends) and merges it in.
    Some sites (e.g. anthropic.com/news) promote certain articles in a separate
    block that isn't part of the main chronological listing, so item_selector
    alone misses them.

    The featured section claims its elements: a main-list match that
    featured_item_selector also matches is scraped once, as featured, so the
    main selector may over-match into it (e.g. a hero sharing the list's link
    class on anthropic.com/engineering)."""
    soup = BeautifulSoup(html, "html.parser")
    featured_selector = config.get("featured_item_selector")
    # By id(): bs4 Tags with identical markup compare and hash equal.
    claimed = {id(el) for el in soup.select(featured_selector)} if featured_selector else set()
    items = _extract_items(soup, config, exclude_ids=claimed)

    if featured_selector:
        featured_config = {
            "base_url": config["base_url"],
            "item_selector": featured_selector,
            "link_selector": config.get("featured_link_selector"),
            "title_selector": config.get("featured_title_selector"),
            "date_selector": config.get("featured_date_selector"),
            "date_format": config.get("featured_date_format"),
            "category_selector": config.get("featured_category_selector"),
        }
        seen_urls = {item["url"] for item in items}
        for item in _extract_items(soup, featured_config):
            if item["url"] not in seen_urls:
                items.append(item)
                seen_urls.add(item["url"])

    return items


def _extract_items(soup: BeautifulSoup, config: dict, exclude_ids: set[int] | frozenset = frozenset()) -> list[dict]:
    items = []
    # With link_selector, item_selector matches a container (e.g. an <article>
    # whose <a> wraps only the title) and the URL comes from a link inside it.
    link_selector = config.get("link_selector")
    for el in soup.select(config["item_selector"]):
        if id(el) in exclude_ids:
            continue
        link = el.select_one(link_selector) if link_selector else el
```
(the rest of `_extract_items` is unchanged.)

- [ ] **Step 4: Run all Python tests (paste full output)**

Run: `uv run pytest`
Expected: all pass, count = Task 1 baseline + 5.

- [ ] **Step 5: Commit**

```bash
git add scraper/extract.py tests/test_extract.py
git commit -m "$(cat <<'EOF'
Scraper: featured section claims its elements; featured_link_selector

Main-list elements that featured_item_selector also matches are skipped
(by id(): bs4 Tags with equal markup compare equal), and featured items
honour featured_link_selector.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Bookmarklet extraction mirror — claiming, featured rows and counts

**Files:**
- Modify: `bookmarklet/src/extract.js`
- Test: `bookmarklet/test/extract.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `src/extract.js`):
  - `featuredConfig(config) → {base_url, item_selector, link_selector, title_selector, date_selector, category_selector}` built from the `featured_*` keys.
  - `extractSections(root, config) → {main: Row[], featured: Row[]}`. `main` skips claimed elements. `featured` comes **before** URL de-dup (`[]` without `featured_item_selector`).
  - `keptFeatured(main, featured) → Row[]`: the featured rows the scraper keeps (URL not in `main`, first occurrence only).
  - `extractPreview(root, config) → Row[]` = `[...main, ...keptFeatured(main, featured)]`, the same order as `extract_items`.
  - `selectorCounts(root, config)`: main counts exclude claimed elements. Adds `featured: {items, <field>_selector…}` only when `featured_item_selector` is set.
  - `Row = {url, title, category, date_text}` (unchanged).

- [ ] **Step 1: Write the failing tests**

Change the import line of `bookmarklet/test/extract.test.js` to:

```js
import { getText, extractPreview, extractSections, keptFeatured, selectorCounts, rawCheckVerdict } from '../src/extract.js';
```

Append:

```js
const HERO_LIST = `
  <div class="list">
    <article class="card featured"><a class="card-link" href="/posts/hero"><h2>Hero post</h2><span class="kicker">Essays</span><p>Summary</p></a></article>
    <div>
      <article class="card"><a class="card-link" href="/posts/one"><h3>Post one</h3><time datetime="2026-09-03">Sep 3</time></a></article>
      <article class="card"><a class="card-link" href="/posts/two"><h3>Post two</h3><time datetime="2026-08-20">Aug 20</time></a></article>
    </div>
  </div>`;
const HERO_CFG = {
  base_url: 'https://x.test',
  item_selector: 'a.card-link',
  title_selector: 'h3',
  date_selector: 'time',
  featured_item_selector: 'article.featured a.card-link',
  featured_title_selector: 'h2',
  featured_category_selector: 'span.kicker',
};
const HERO_ROW = { url: 'https://x.test/posts/hero', title: 'Hero post', category: 'Essays', date_text: null };
const ONE = { url: 'https://x.test/posts/one', title: 'Post one', category: null, date_text: '2026-09-03' };
const TWO = { url: 'https://x.test/posts/two', title: 'Post two', category: null, date_text: '2026-08-20' };

test('extractSections: the featured section claims elements the main selector also matches', () => {
  assert.deepEqual(extractSections(htmlDoc(HERO_LIST), HERO_CFG), { main: [ONE, TWO], featured: [HERO_ROW] });
});

test('extractSections: no featured_item_selector → no featured rows, nothing claimed', () => {
  const { featured_item_selector, ...cfg } = HERO_CFG;
  const { main, featured } = extractSections(htmlDoc(HERO_LIST), cfg);
  assert.equal(main.length, 3);
  assert.deepEqual(featured, []);
});

test('extractPreview: main rows, then kept featured rows (extract_items order)', () => {
  assert.deepEqual(extractPreview(htmlDoc(HERO_LIST), HERO_CFG), [ONE, TWO, HERO_ROW]);
});

test('extractSections: featured_link_selector finds the URL inside a featured container', () => {
  const doc = htmlDoc(`
    <section class="hero"><span class="kicker">News</span><h2><a href="/posts/hero">Hero</a></h2></section>
    <a class="row" href="/posts/one">Post one</a>`);
  const { featured } = extractSections(doc, {
    base_url: 'https://x.test',
    item_selector: 'a.row',
    featured_item_selector: 'section.hero',
    featured_link_selector: 'a',
    featured_title_selector: 'h2',
  });
  assert.deepEqual(featured, [{ url: 'https://x.test/posts/hero', title: 'Hero', category: null, date_text: null }]);
});

test('same URL in both sections: main wins; featured duplicates collapse', () => {
  const doc = htmlDoc(`
    <div class="hero"><a class="f" href="/posts/same"><h2>Hero title</h2></a><a class="f" href="/posts/other"><h2>Other</h2></a><a class="f" href="/posts/other"><h2>Other again</h2></a></div>
    <a class="row" href="/posts/same"><h3>Row title</h3></a>`);
  const cfg = {
    base_url: 'https://x.test',
    item_selector: 'a.row',
    title_selector: 'h3',
    featured_item_selector: 'div.hero a.f',
    featured_title_selector: 'h2',
  };
  const { main, featured } = extractSections(doc, cfg);
  assert.deepEqual(keptFeatured(main, featured).map((r) => r.title), ['Other']);
  assert.deepEqual(extractPreview(doc, cfg).map((r) => r.title), ['Row title', 'Other']);
});

test('selectorCounts: main counts exclude claimed elements; featured counted separately', () => {
  assert.deepEqual(selectorCounts(htmlDoc(HERO_LIST), HERO_CFG), {
    items: 2,
    title_selector: 2,
    date_selector: 2,
    featured: { items: 1, title_selector: 1, category_selector: 1 },
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd bookmarklet && npm test`
Expected: FAIL — `extractSections`/`keptFeatured` are not exported (SyntaxError on import fails every test in `extract.test.js`).

- [ ] **Step 3: Implement**

Replace everything in `bookmarklet/src/extract.js` from `function fieldText` down to (not including) `rawCheckVerdict` with:

```js
function fieldText(el, selector) {
  if (!selector) return null;
  const found = el.querySelector(selector);
  return found ? getText(found, '') : null;
}

const FIELD_KEYS = ['link_selector', 'title_selector', 'date_selector', 'category_selector'];

/** The featured_* keys as a plain section config, like extract_items' featured_config. */
export function featuredConfig(config) {
  return {
    base_url: config.base_url,
    item_selector: config.featured_item_selector,
    link_selector: config.featured_link_selector,
    title_selector: config.featured_title_selector,
    date_selector: config.featured_date_selector,
    category_selector: config.featured_category_selector,
  };
}

/** Elements the featured section claims; the main list skips them. */
function claimedBy(root, config) {
  return config.featured_item_selector ? new Set(root.querySelectorAll(config.featured_item_selector)) : new Set();
}

function mainElements(root, config, claimed) {
  return [...root.querySelectorAll(config.item_selector)].filter((el) => !claimed.has(el));
}

/** Rows for `elements`, like scraper/extract.py:_extract_items.
 *  date_text is the raw string the scraper would hand to parse_date. */
function extractRows(elements, config) {
  const rows = [];
  for (const el of elements) {
    const linkEl = config.link_selector ? el.querySelector(config.link_selector) : el;
    const href = linkEl ? linkEl.getAttribute('href') : null;
    if (!href) continue;

    let title = fieldText(el, config.title_selector);
    if (!title) title = getText(el, ' ');
    title = title ? title.replaceAll(' ', ' ').trim() : null;

    let dateText = null;
    if (config.date_selector) {
      const d = el.querySelector(config.date_selector);
      if (d) dateText = d.getAttribute('datetime') || getText(d, '');
    }

    let url = href;
    try {
      url = new URL(href, config.base_url).href;
    } catch {
      // Invalid base_url or href; fall back to raw href
    }

    rows.push({
      url,
      title,
      category: fieldText(el, config.category_selector),
      date_text: dateText,
    });
  }
  return rows;
}

/** {main, featured} rows. Main-list matches that featured_item_selector also
 *  matches are skipped (the featured section claims them), as in
 *  scraper/extract.py:extract_items. featured is before URL de-duplication. */
export function extractSections(root, config) {
  const claimed = claimedBy(root, config);
  return {
    main: extractRows(mainElements(root, config, claimed), config),
    featured: config.featured_item_selector ? extractRows(claimed, featuredConfig(config)) : [],
  };
}

/** The featured rows the scraper keeps: URL not already seen (main list or an
 *  earlier featured row). */
export function keptFeatured(main, featured) {
  const seen = new Set(main.map((r) => r.url));
  const kept = [];
  for (const row of featured) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    kept.push(row);
  }
  return kept;
}

/** [{url, title, category, date_text}] in extract_items order: main rows, then
 *  the featured rows it keeps. */
export function extractPreview(root, config) {
  const { main, featured } = extractSections(root, config);
  return [...main, ...keptFeatured(main, featured)];
}

function fieldCounts(items, config) {
  const counts = { items: items.length };
  for (const key of FIELD_KEYS) {
    if (config[key]) counts[key] = items.filter((it) => it.querySelector(config[key])).length;
  }
  return counts;
}

/** {items, <field>_selector: number of items where that selector hits}, main
 *  list minus claimed elements; plus featured: {...} when there is a featured section. */
export function selectorCounts(root, config) {
  const claimed = claimedBy(root, config);
  const counts = fieldCounts(mainElements(root, config, claimed), config);
  if (config.featured_item_selector) counts.featured = fieldCounts([...claimed], featuredConfig(config));
  return counts;
}
```

- [ ] **Step 4: Run tests (paste full output)**

Run: `cd bookmarklet && npm test`
Expected: all pass (existing `extractPreview`/`selectorCounts` tests unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/extract.js bookmarklet/test/extract.test.js
git commit -m "$(cat <<'EOF'
Bookmarklet: mirror featured claiming in preview extraction and counts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: YAML output — `featured_*` keys

**Files:**
- Modify: `bookmarklet/src/yaml.js` (`toYaml`)
- Test: `bookmarklet/test/yaml.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `toYaml(cfg, {date})` writes `featured_item_selector` + picked `featured_{link,title,date,category}_selector` after the main selectors, separated by a blank line; nothing featured when `cfg.featured_item_selector` is falsy.

- [ ] **Step 1: Write the failing tests**

Append to `bookmarklet/test/yaml.test.js`:

```js
const FEATURED = {
  featured_item_selector: 'article[class*="featured"] a',
  featured_link_selector: null,
  featured_title_selector: 'h2',
  featured_date_selector: null,
  featured_category_selector: "span[data-kind='tag']",
};

test('toYaml: a featured section follows the main selectors; unpicked featured fields omitted', () => {
  const yaml = toYaml({ ...CFG, ...FEATURED }, { date: '2026-10-13' });
  assert.match(
    yaml,
    /^category_selector: 'span\[data-kind=''tag''\]'\n\nfeatured_item_selector: 'article\[class\*="featured"\] a'\nfeatured_title_selector: 'h2'\nfeatured_category_selector: 'span\[data-kind=''tag''\]'\n\nfetch_detail: true$/m,
  );
});

test('toYaml: featured_link_selector sits between the featured item and title', () => {
  const yaml = toYaml({ ...CFG, ...FEATURED, featured_item_selector: 'section.hero', featured_link_selector: 'a' }, { date: '2026-10-13' });
  assert.match(yaml, /^featured_item_selector: 'section\.hero'\nfeatured_link_selector: 'a'\nfeatured_title_selector: 'h2'$/m);
});

test('toYaml: no featured_item_selector → no featured keys at all', () => {
  const yaml = toYaml({ ...CFG, ...FEATURED, featured_item_selector: null }, { date: '2026-10-13' });
  assert.doesNotMatch(yaml, /featured_/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd bookmarklet && npm test`
Expected: the first two FAIL (no `featured_item_selector` line); the third passes already.

- [ ] **Step 3: Implement**

In `bookmarklet/src/yaml.js`, after the `OPTIONAL_SELECTORS` constant add:

```js
const FEATURED_SELECTORS = [
  'featured_link_selector',
  'featured_title_selector',
  'featured_date_selector',
  'featured_category_selector',
];
```

Update the `toYaml` doc comment to `/** YAML in sites/anthropic-news.yaml key order; unpicked optional selectors (and an absent featured section) omitted. */` and, inside `toYaml`, directly after the `for (const key of OPTIONAL_SELECTORS)` loop, add:

```js
  if (cfg.featured_item_selector) {
    lines.push('', `featured_item_selector: ${singleQuoted(cfg.featured_item_selector)}`);
    for (const key of FEATURED_SELECTORS) {
      if (cfg[key]) lines.push(`${key}: ${singleQuoted(cfg[key])}`);
    }
  }
```

- [ ] **Step 4: Run tests (paste full output)**

Run: `cd bookmarklet && npm test`
Expected: all pass (existing snapshot test unchanged).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/yaml.js bookmarklet/test/yaml.test.js
git commit -m "$(cat <<'EOF'
Bookmarklet: write featured_* selectors to the YAML

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `featuredGeneralize` and the hero fixture

**Files:**
- Create: `bookmarklet/test/fixtures/hero.html`
- Modify: `bookmarklet/src/generalize.js`
- Test: `bookmarklet/test/generalize.test.js`

**Interfaces:**
- Consumes: `generalize(clicked) → {levels: [{el, items}], index}` (existing).
- Produces: `featuredGeneralize(clicked) → {levels, index}`, same shape as `generalize`. If `generalize` finds a repeating level, that result is returned unchanged. Otherwise `index` is the nearest level whose `el` is `a[href]` or contains one, with that level's own `items` (usually `[el]`). It is `-1` only when no level has a link.
- Produces: `bookmarklet/test/fixtures/hero.html`, used by Tasks 6–8. Measured with post-fix code:
  - clicking `a[href="/posts/two"] h3` → main item level `a` (3 items). `itemSelectorFor` → `a.card__link`, which matches 4 elements: the hero is the over-match. title `h3.card__title`, date `time`, category `span.card__tag`.
  - hero click (`.card__headline`) → `featuredGeneralize` index 1 (`a`, 1 item). `itemSelectorFor` → `article.card--featured a.card__link`. Featured title `h2.card__headline`, category `span.card__tag`. One level wider (the `article`) → `article.card--featured`.

- [ ] **Step 1: Create the fixture** `bookmarklet/test/fixtures/hero.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Hero Blog</title></head>
<body>
<!-- A main list plus one differently-marked "featured" hero. Hero and rows
     share the card__link anchor class and the rows' wrapper is a bare <div>,
     so no selector without :not() matches the rows but not the hero. -->
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<div class="posts">
  <article class="card card--featured"><a class="card__link" href="/posts/hero">
    <span class="card__label">Featured</span>
    <h2 class="card__headline">The hero post</h2>
    <p class="card__summary">A long summary of the hero post.</p>
    <span class="card__tag">Essays</span>
  </a></article>
  <div>
    <article class="card"><a class="card__link" href="/posts/one">
      <h3 class="card__title">Post one</h3><time datetime="2026-09-03">Sep 3, 2026</time><span class="card__tag">Notes</span>
    </a></article>
    <article class="card"><a class="card__link" href="/posts/two">
      <h3 class="card__title">Post two</h3><time datetime="2026-08-20">Aug 20, 2026</time><span class="card__tag">Travel</span>
    </a></article>
    <article class="card"><a class="card__link" href="/posts/three">
      <h3 class="card__title">Post three</h3><time datetime="2026-08-02">Aug 2, 2026</time><span class="card__tag">Notes</span>
    </a></article>
  </div>
</div>
<footer><a href="/contact">Contact</a></footer>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests**

Change the import in `bookmarklet/test/generalize.test.js` to `import { generalize, featuredGeneralize, itemContaining } from '../src/generalize.js';` and append:

```js
test('featuredGeneralize: a lone hero falls back to the nearest level with a link', () => {
  const doc = loadFixture('hero.html');
  const hero = doc.querySelector('a[href="/posts/hero"]');
  assert.equal(generalize(doc.querySelector('.card__headline')).index, -1);
  const { levels, index } = featuredGeneralize(doc.querySelector('.card__headline'));
  assert.equal(index, 1);
  assert.equal(levels[index].el, hero);
  assert.deepEqual(levels[index].items, [hero]);
});

test('featuredGeneralize: clicking the hero link itself uses that level', () => {
  const doc = loadFixture('hero.html');
  const hero = doc.querySelector('a[href="/posts/hero"]');
  const { levels, index } = featuredGeneralize(hero);
  assert.equal(index, 0);
  assert.equal(levels[0].el, hero);
});

test('featuredGeneralize: a repeating featured group is used like generalize', () => {
  const doc = loadFixture('hero.html');
  const clicked = doc.querySelector('a[href="/posts/two"] h3');
  const expected = generalize(clicked);
  const { levels, index } = featuredGeneralize(clicked);
  assert.equal(index, expected.index);
  assert.deepEqual(levels[index].items, expected.levels[expected.index].items);
});

test('featuredGeneralize: a two-item group keeps both items', () => {
  const doc = htmlDoc(`<main><div class="side">
    <a class="side__link" href="/a"><h4 class="side__title">A</h4></a>
    <a class="side__link" href="/b"><h4 class="side__title">B</h4></a></div></main>`);
  const { levels, index } = featuredGeneralize(doc.querySelector('.side__title'));
  assert.equal(levels[index].el.localName, 'a');
  assert.equal(levels[index].items.length, 2);
});

test('featuredGeneralize: no link at any level → -1', () => {
  const doc = htmlDoc('<main><div><p>No links here</p></div></main>');
  assert.equal(featuredGeneralize(doc.querySelector('p')).index, -1);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd bookmarklet && npm test`
Expected: FAIL — `featuredGeneralize` is not exported.

- [ ] **Step 4: Implement**

In `bookmarklet/src/generalize.js`, after `generalize`, add:

```js
/** generalize() for a featured section: when no level repeats — the usual case
 *  for a single hero — the nearest level that is or contains a link, instead
 *  of -1. Its items are whatever matches that level (usually just the one). */
export function featuredGeneralize(clicked) {
  const result = generalize(clicked);
  if (result.index !== -1) return result;
  return { levels: result.levels, index: result.levels.findIndex((l) => yieldsLink(l.el)) };
}
```

- [ ] **Step 5: Run tests (paste full output)**

Run: `cd bookmarklet && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add bookmarklet/src/generalize.js bookmarklet/test/generalize.test.js bookmarklet/test/fixtures/hero.html
git commit -m "$(cat <<'EOF'
Bookmarklet: featuredGeneralize falls back to a single linked item

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Panel — featured section via "+ Add featured section"

The core panel change. The main list keeps living on `state` itself (existing tests read `state.itemSelector`, `state.selectors`). The featured section is `state.featured` with the same shape. Section-generic code receives a "section object": `state` for main, `state.featured` for featured.

**Files:**
- Modify: `bookmarklet/src/panel.js`
- Modify: `bookmarklet/test/panel.test.js` (one selector, see Step 3)
- Create: `bookmarklet/test/panel-featured.test.js`

**Interfaces:**
- Consumes: `featuredGeneralize` (Task 5), `extractSections` (Task 3), `toYaml` featured keys (Task 4), `itemSelectorFor`/`relativeSelector`/`generalize`/`itemContaining` (existing).
- Produces (later panel tasks build on these names inside `createPicker`):
  - `state.featured`: `null` | `{levels, index, itemSelector, selectors: {link, title, date, category}, skipped: Set}`.
  - `state.armed`: `'item'|'link'|'title'|'date'|'category'` (main) or `'featured:item'|'featured:link'|'featured:title'|'featured:date'|'featured:category'`, or `null` (Done).
  - module helpers `parseArmed(armed) → {section: 'main'|'featured'|null, field}`, `armedFor(section, field) → armed|null`, `emptySection()`.
  - inside `createPicker`: `sectionState(name)`, `levelOf(sec)`, `level()`, `config()`, `setIndex(index, name = 'main')`, `nextUnfinishedField(sec)`, `nextArmed(section, field)`, `pickFeaturedItem(target)`, `shrinkForPick()`, `sectionGroup(name, firstRow)`.
  - panel actions: `add-featured`, `remove-featured`, `up:featured`, `down:featured`, `arm:featured:<field>`, `clear:featured:<field>`; groups `[data-group="main"]` / `[data-group="featured"]`; field rows `.row.field`, item rows `.row.item`; featured data attributes `data-field="featured:<f>"`, `data-example="featured:<f>"`.
  - `OUTLINES.featured = '2px solid #7048e8'`.

- [ ] **Step 1: Write the failing tests** — create `bookmarklet/test/panel-featured.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createPicker } from '../src/panel.js';

const HERO = readFileSync(new URL('./fixtures/hero.html', import.meta.url), 'utf8');
const PURPLE = '2px solid #7048e8';

function setup(options = {}, html = HERO, url = 'https://hero.example.com/posts') {
  const { window } = new JSDOM(html, { url });
  const doc = window.document;
  const picker = createPicker(doc, {
    repo: 'o/r',
    today: '2026-10-13',
    fetchImpl: async () => ({ ok: true, text: async () => html }),
    ...options,
  });
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const button = (action) => picker.root.querySelector(`[data-action="${action}"]`);
  const $ = (sel) => doc.querySelector(sel);
  const yaml = () => picker.root.querySelector('.yaml').textContent;
  const status = () => picker.root.querySelector('.status').textContent;
  return { window, doc, picker, click, button, $, yaml, status };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Main list: item, headline, date and topic picked → Done. */
function pickMainList(t) {
  t.click(t.$('a[href="/posts/two"] h3'));
  t.click(t.$('a[href="/posts/one"] h3'));
  t.click(t.$('a[href="/posts/one"] time'));
  t.click(t.$('a[href="/posts/one"] .card__tag'));
}

/** Featured: hero picked, headline picked, date skipped, topic picked. */
function pickFeatured(t) {
  t.button('add-featured').click();
  t.click(t.$('.card__headline'));
  t.click(t.$('.card__headline'));
  t.button('skip').click();
  t.click(t.$('.card--featured .card__tag'));
}

test('+ Add featured section appears once the main list is done and arms the featured item', () => {
  const t = setup();
  assert.equal(t.button('add-featured'), null);
  t.click(t.$('a[href="/posts/two"] h3'));
  assert.equal(t.button('add-featured'), null); // main flow not done yet
  t.click(t.$('a[href="/posts/one"] h3'));
  t.click(t.$('a[href="/posts/one"] time'));
  t.click(t.$('a[href="/posts/one"] .card__tag'));
  t.button('add-featured').click();
  assert.equal(t.picker.state.armed, 'featured:item');
  assert.match(t.status(), /Featured — click the featured\/hero article \(outside the orange boxes\)\./);
  assert.ok(t.picker.root.querySelector('[data-group="featured"]'));
});

test('a hero with no repeating siblings becomes a one-item featured section, outlined purple', () => {
  const t = setup();
  pickMainList(t);
  t.button('add-featured').click();
  t.click(t.$('.card__headline'));
  assert.equal(t.picker.state.featured.itemSelector, 'article.card--featured a.card__link');
  assert.equal(t.picker.state.armed, 'featured:title');
  assert.equal(t.$('a[href="/posts/hero"]').style.outline, PURPLE);
  assert.equal(t.picker.root.querySelector('[data-group="featured"] .count').textContent, '1');
  assert.equal(t.picker.state.itemSelector, 'a.card__link'); // main untouched
});

test('featured fields: headline, date (with the article-page hint), topic; Skip works', () => {
  const t = setup();
  pickMainList(t);
  t.button('add-featured').click();
  t.click(t.$('.card__headline'));
  t.click(t.$('.card__headline'));
  assert.equal(t.picker.state.armed, 'featured:date');
  assert.match(t.status(), /No date\? Click Skip — the article's own page usually has one\./);
  t.button('skip').click();
  assert.equal(t.picker.state.armed, 'featured:category');
  t.click(t.$('.card--featured .card__tag'));
  assert.equal(t.picker.state.armed, null);
  assert.deepEqual(t.picker.state.featured.selectors, {
    link: null,
    title: 'h2.card__headline',
    date: null,
    category: 'span.card__tag',
  });
  const example = (f) => t.picker.root.querySelector(`[data-example="featured:${f}"]`).textContent;
  assert.equal(example('title'), '“The hero post”');
  assert.equal(example('date'), 'Skipped');
});

test('YAML lists the featured selectors after the main ones', () => {
  const t = setup();
  pickMainList(t);
  pickFeatured(t);
  assert.match(
    t.yaml(),
    /^category_selector: 'span\.card__tag'\n\nfeatured_item_selector: 'article\.card--featured a\.card__link'\nfeatured_title_selector: 'h2\.card__headline'\nfeatured_category_selector: 'span\.card__tag'\n/m,
  );
});

test('featured field clicks outside the purple box are refused in purple wording', () => {
  const t = setup();
  pickMainList(t);
  t.button('add-featured').click();
  t.click(t.$('.card__headline'));
  t.click(t.$('a[href="/posts/one"] h3'));
  assert.match(t.status(), /outside the purple boxes/);
  assert.equal(t.picker.state.featured.selectors.title, null);
  assert.equal(t.picker.state.armed, 'featured:title');
});

test('refuses an orange-box article as the featured item', () => {
  const t = setup();
  pickMainList(t);
  t.button('add-featured').click();
  t.click(t.$('a[href="/posts/two"] h3')); // a main-list row
  assert.equal(t.picker.state.featured.itemSelector, null);
  assert.equal(t.picker.state.armed, 'featured:item');
  assert.match(t.status(), /part of the main list/);
  t.click(t.$('div.posts')); // the list container: generalizes to the rows
  assert.equal(t.picker.state.featured.itemSelector, null);
  assert.match(t.status(), /part of the main list/);
});

test('Remove featured section mid-flow resets it and drops it from the YAML', () => {
  const t = setup();
  pickMainList(t);
  t.button('add-featured').click();
  t.click(t.$('.card__headline'));
  assert.equal(t.picker.state.armed, 'featured:title');
  t.button('remove-featured').click();
  assert.equal(t.picker.state.featured, null);
  assert.equal(t.picker.state.armed, null);
  assert.doesNotMatch(t.yaml(), /featured_/);
  assert.equal(t.$('a[href="/posts/hero"]').style.outline, '');
  assert.equal(t.picker.root.querySelector('[data-group="featured"]'), null);
  assert.ok(t.button('add-featured'));
});

test('↑/↓ in the featured group act on the featured section only', () => {
  const t = setup();
  pickMainList(t);
  t.button('add-featured').click();
  t.click(t.$('.card__headline'));
  t.button('up:featured').click();
  assert.equal(t.picker.state.featured.itemSelector, 'article.card--featured');
  assert.equal(t.picker.state.itemSelector, 'a.card__link');
  t.button('down:featured').click();
  assert.equal(t.picker.state.featured.itemSelector, 'article.card--featured a.card__link');
});

test('re-picking the main list keeps the featured section', () => {
  const t = setup();
  pickMainList(t);
  pickFeatured(t);
  t.button('arm:item').click();
  t.click(t.$('a[href="/posts/three"] h3'));
  assert.equal(t.picker.state.itemSelector, 'a.card__link');
  assert.equal(t.picker.state.featured.itemSelector, 'article.card--featured a.card__link');
  assert.match(t.yaml(), /^featured_item_selector: /m);
});

test('the fields area has a Main list group and a Featured section group', () => {
  const t = setup();
  pickMainList(t);
  pickFeatured(t);
  const heads = [...t.picker.root.querySelectorAll('.fields .group h4')].map((h) => h.textContent);
  assert.deepEqual(heads, ['Main list', 'Featured section']);
  assert.ok(t.picker.root.querySelector('[data-group="featured"] [data-action="arm:featured:item"]'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd bookmarklet && npm test`
Expected: every test in `panel-featured.test.js` FAILS: there is no `add-featured` button, so `.click()` on `null` throws, and the first test's `armed` assertion fails. All other files stay green.

- [ ] **Step 3: Scope the one layout-dependent existing test**

The main list's count, ↑/↓ and item row move from `.status` into the Main list group, so `.fields .row` would now include the `item` row. In `bookmarklet/test/panel.test.js`, in test `field rows use plain labels`, change

```js
  const labels = [...picker.root.querySelectorAll('.fields .row > span:first-child')].map((s) => s.textContent);
```
to
```js
  const labels = [...picker.root.querySelectorAll('.fields .row.field > span:first-child')].map((s) => s.textContent);
```

- [ ] **Step 4: Implement in `bookmarklet/src/panel.js`**

4a. Imports (top of file):

```js
import { itemSelectorFor, relativeSelector } from './selectors.js';
import { generalize, featuredGeneralize, itemContaining, MIN_ITEMS } from './generalize.js';
import { extractPreview, extractSections, selectorCounts, rawCheckVerdict } from './extract.js';
import { toYaml, slugForUrl, githubNewFileUrl, isValidSiteId } from './yaml.js';
```

4b. Module constants: directly after the `NEXT_ARMED` line add `const FIELD_ORDER = ['title', 'date', 'category'];` and **delete** the `const FIELD_ORDER = …` line inside `createPicker`. After the `PROMPTS` object add:

```js
const FEATURED_PROMPTS = {
  item: 'Featured — click the featured/hero article (outside the orange boxes).',
  link: 'Featured — click the link, inside the purple box, that opens the article.',
  title: 'Featured — click the featured article\'s headline, inside the purple box. No headline? Click Skip.',
  date:
    'Featured — click the date the featured article was published, inside the purple box. ' +
    'No date? Click Skip — the article\'s own page usually has one.',
  category:
    'Featured — click the featured article\'s topic or section label, inside the purple box. No label? Click Skip.',
};
const FEATURED_IN_MAIN = 'That is part of the main list (orange boxes) — click the featured article outside them.';
const NO_FEATURED_LINK = 'No link found there — click the featured article itself.';
```

Change `OUTLINES` to:

```js
const OUTLINES = {
  item: '2px solid #e8590c',
  featured: '2px solid #7048e8',
  field: '2px solid #1c7ed6',
  hover: '2px dashed #e8590c',
};
```

Add to the `CSS` string (before `[hidden]`):

```css
  .group { border-top: 1px solid #dee2e6; margin-top: 6px; padding-top: 4px; }
  .group h4 { margin: 2px 0; font-size: 13px; }
```

After `escapeHtml`, add the module helpers:

```js
/** 'featured:title' → {section: 'featured', field: 'title'}; 'title' → {section: 'main', field: 'title'}. */
function parseArmed(armed) {
  if (!armed) return { section: null, field: null };
  const [a, b] = armed.split(':');
  return b ? { section: a, field: b } : { section: 'main', field: a };
}

/** The armed value for a section's field; null field → null (Done). */
function armedFor(section, field) {
  if (!field) return null;
  return section === 'featured' ? `featured:${field}` : field;
}

function emptySection() {
  return {
    levels: [],
    index: -1,
    itemSelector: null,
    selectors: { link: null, title: null, date: null, category: null },
    skipped: new Set(),
  };
}
```

4c. Inside `createPicker`: add `featured: null,` to the `state` literal (after `skipped: new Set(),`). Replace `nextUnfinishedField` with:

```js
  /** The first of title/date/category in `sec` that has neither been picked nor skipped. */
  function nextUnfinishedField(sec) {
    return FIELD_ORDER.find((f) => sec.selectors[f] == null && !sec.skipped.has(f)) ?? null;
  }
```

Replace `const level = () => …`, `config`, and `setIndex` with:

```js
  /** The main list lives on `state` itself; the featured section on state.featured. */
  const sectionState = (name) => (name === 'featured' ? state.featured : state);
  const levelOf = (sec) => sec?.levels[sec.index] ?? null;
  const level = () => levelOf(state);

  function config() {
    const lv = level();
    if (!lv) return null;
    const cfg = { ...state.meta, item_selector: state.itemSelector };
    for (const f of FIELDS) cfg[`${f}_selector`] = state.selectors[f];
    const fs = state.featured;
    if (fs?.itemSelector) {
      cfg.featured_item_selector = fs.itemSelector;
      for (const f of FIELDS) cfg[`featured_${f}_selector`] = fs.selectors[f];
    }
    return cfg;
  }

  function setIndex(index, name = 'main') {
    const sec = sectionState(name);
    sec.index = index;
    const lv = levelOf(sec);
    sec.itemSelector = itemSelectorFor(lv.el, lv.items);
    const link = lv.el.matches('a[href]') ? null : lv.el.querySelector('a[href]');
    sec.selectors = {
      link: link ? relativeSelector(link, lv.el, lv.items) : null,
      title: null,
      date: null,
      category: null,
    };
    if (name === 'main') levelMessage(lv);
    else state.message = '';
    state.rawCheck = null;
    state.armed = armedFor(name, 'title');
    sec.skipped = new Set();
    checkGeneration++;
  }

  /** What to arm after `field` of `section` is picked or skipped. */
  function nextArmed(section, field) {
    const next = field === 'link' ? nextUnfinishedField(sectionState(section)) : NEXT_ARMED[field];
    return armedFor(section, next);
  }
```

Replace `pick` with:

```js
  function pick(target) {
    const { section, field } = parseArmed(state.armed);
    if (field === 'item' && section === 'main') {
      const { levels, index } = generalize(target);
      if (!levels.length) return;
      state.levels = levels;
      setIndex(Math.max(index, 0));
      regrow();
    } else if (field === 'item') {
      pickFeaturedItem(target);
    } else if (field) {
      const sec = sectionState(section);
      const lv = levelOf(sec);
      const item = itemContaining(lv.items, target);
      const el = field === 'link' ? target.closest('a[href]') : target;
      if (!item || !el || el === item || !item.contains(el)) {
        const colour = section === 'featured' ? 'purple' : 'orange';
        state.message = `That was outside the ${colour} boxes — click inside one of them.`;
        render();
        return;
      }
      const sel = relativeSelector(el, item, lv.items);
      state.message = sel ? '' : 'Could not build a selector for that element — try a nearby one.';
      if (sel) {
        sec.selectors[field] = sel;
        state.armed = nextArmed(section, field);
        regrow();
      }
    }
    render();
    if (state.armed === null && state.rawCheck === null) runRawCheck();
  }

  /** A featured-item click: refused if its items are in or around the main
   *  list's boxes (it would claim the main list); otherwise the clicked hero
   *  (or its repeating group) becomes the featured section. */
  function pickFeaturedItem(target) {
    const { levels, index } = featuredGeneralize(target);
    if (index === -1) {
      state.message = NO_FEATURED_LINK;
      return;
    }
    const mainItems = level()?.items ?? [];
    const overlaps = levels[index].items.some((it) =>
      mainItems.some((m) => m === it || m.contains(it) || it.contains(m)),
    );
    if (overlaps) {
      state.message = FEATURED_IN_MAIN;
      return;
    }
    state.featured = { ...emptySection(), levels };
    setIndex(index, 'featured');
    regrow();
  }
```

Replace `paint` with:

```js
  function paint() {
    clearOutlines();
    const lv = level();
    if (lv) for (const it of lv.items) outline(it, OUTLINES.item);
    const flv = levelOf(state.featured);
    if (flv) for (const it of flv.items) outline(it, OUTLINES.featured);
    for (const sec of [state, state.featured]) {
      const slv = levelOf(sec);
      if (!slv) continue;
      for (const f of FIELD_ORDER) {
        const sel = sec.selectors[f];
        if (!sel) continue;
        for (const it of slv.items) {
          const hit = it.querySelector(sel);
          if (hit) outline(hit, OUTLINES.field);
        }
      }
    }
    if (hovered && state.armed && !savedOutlines.has(hovered)) outline(hovered, OUTLINES.hover);
  }
```

Replace `renderStatus` with (count/↑↓/item row move to the Main list group):

```js
  function renderStatus() {
    const lv = level();
    const { section, field } = parseArmed(state.armed);
    const prompt = !state.armed ? DONE_PROMPT : (section === 'featured' ? FEATURED_PROMPTS : PROMPTS)[field];
    const parts = [
      `<p class="prompt">${escapeHtml(prompt)}
        ${FIELD_ORDER.includes(field) ? '<button data-action="skip">Skip</button>' : ''}</p>`,
    ];
    if (lv) {
      parts.push(`<p class="hint">${escapeHtml(LEVEL_HINT)}</p>`);
      const total = doc.querySelectorAll(state.itemSelector).length;
      if (total !== lv.items.length) {
        parts.push(`<p class="warn">Selector matches ${total} elements, not ${lv.items.length}.</p>`);
      }
    }
    if (state.message) parts.push(`<p class="warn message">${escapeHtml(state.message)}</p>`);
    $('.status').innerHTML = parts.join('');
  }
```

Replace `renderFields` with:

```js
  function renderFields() {
    const cfg = config();
    if (!cfg) {
      $('.fields').innerHTML = '';
      return;
    }
    const { main, featured } = extractSections(doc, cfg);
    const groups = [sectionGroup('main', main[0] ?? {})];
    if (state.featured) groups.push(sectionGroup('featured', featured[0] ?? {}));
    else if (state.armed === null) groups.push('<button data-action="add-featured">+ Add featured section</button>');
    $('.fields').innerHTML = groups.join('');
  }

  /** One section's block: count, ↑/↓, item row, field rows (+ Remove for featured).
   *  `first` is that section's first extracted row, for the example values. */
  function sectionGroup(name, first) {
    const sec = sectionState(name);
    const lv = levelOf(sec);
    const featured = name === 'featured';
    const p = featured ? 'featured:' : ''; // prefix of this section's armed values
    const parts = [`<div class="group" data-group="${name}"><h4>${featured ? 'Featured section' : 'Main list'}</h4>`];
    if (lv) {
      const arg = featured ? ':featured' : '';
      parts.push(
        `<p><b class="count">${lv.items.length}</b> items · level ${sec.index + 1}/${sec.levels.length}
          <button data-action="up${arg}" ${sec.index + 1 >= sec.levels.length ? 'disabled' : ''}>↑ wider</button>
          <button data-action="down${arg}" ${sec.index <= 0 ? 'disabled' : ''}>↓ narrower</button></p>
         <div class="row item"><span>item</span><code>${escapeHtml(sec.itemSelector)}</code>
           <button data-action="arm:${p}item">Re-pick</button></div>`,
      );
      const example = (f) => {
        if (sec.selectors[f]) {
          const value = first[EXAMPLE_COLUMN[f]];
          return value ? `“${value}”` : '(nothing found in the first article)';
        }
        return sec.skipped.has(f) ? 'Skipped' : '';
      };
      const itemIsLink = lv.el.matches('a[href]');
      for (const f of FIELDS.filter((f) => !(f === 'link' && itemIsLink))) {
        parts.push(`<div class="row field"><span>${LABELS[f]}</span>
          <code data-field="${p}${f}">${escapeHtml(sec.selectors[f] ?? '—')}</code>
          <small data-example="${p}${f}" title="${escapeHtml(example(f))}">${escapeHtml(example(f))}</small>
          <button data-action="arm:${p}${f}">${state.armed === `${p}${f}` ? 'Picking…' : 'Pick'}</button>
          ${f !== 'link' ? `<button data-action="clear:${p}${f}">Clear</button>` : ''}</div>`);
      }
    } else {
      parts.push('<p>Click the featured article on the page.</p>');
    }
    if (featured) parts.push('<button data-action="remove-featured">Remove featured section</button>');
    parts.push('</div>');
    return parts.join('');
  }
```

Replace `onPanelClick` with (note: `action.split(':')` now keeps everything after the verb, since `arm:featured:title` has two colons):

```js
  function onPanelClick(e) {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const [verb, ...rest] = action.split(':');
    const arg = rest.join(':');
    if (verb === 'close') return destroy();
    if (verb === 'collapse') return toggleCollapsed();
    if (verb === 'side') return switchSide();
    if (verb === 'up' || verb === 'down') {
      const name = arg || 'main';
      const sec = sectionState(name);
      const next = sec.index + (verb === 'up' ? 1 : -1);
      if (next >= 0 && next < sec.levels.length) setIndex(next, name);
    }
    if (verb === 'arm') {
      state.armed = arg;
      shrinkForPick();
    }
    if (verb === 'add-featured') {
      state.featured = emptySection();
      state.armed = 'featured:item';
      shrinkForPick();
    }
    if (verb === 'remove-featured') {
      state.featured = null;
      // Back to the first unfinished main-list field (null = Done).
      if (parseArmed(state.armed).section === 'featured') state.armed = armedFor('main', nextUnfinishedField(state));
      state.message = '';
      state.rawCheck = null;
      checkGeneration++;
    }
    if (verb === 'skip') {
      const { section, field } = parseArmed(state.armed);
      sectionState(section).skipped.add(field);
      state.armed = nextArmed(section, field);
    }
    if (verb === 'clear') {
      const { section, field } = parseArmed(arg);
      sectionState(section).selectors[field] = null;
    }
    if (verb === 'check') return runRawCheck();
    if (verb === 'copy') return copyYaml();
    if (verb === 'github') return openGithub();
    render();
    if ((verb === 'skip' || verb === 'remove-featured') && state.armed === null && state.rawCheck === null) {
      runRawCheck();
    }
  }

  /** Get out of the way while the user clicks on the page; pick() grows it back. */
  function shrinkForPick() {
    if ($('.panel').classList.contains('collapsed')) return;
    setCollapsed(true);
    autoCollapsed = true;
  }
```

`extractPreview` is still used by `renderPreview` (until Task 8); `selectorCounts`/`rawCheckVerdict`/`MIN_ITEMS` stay used.

- [ ] **Step 5: Run all JS tests (paste full output)**

Run: `cd bookmarklet && npm test`
Expected: all pass. That covers every test in `panel.test.js` (with the one scoped selector) and all of `panel-featured.test.js`.

- [ ] **Step 6: Commit**

```bash
git add bookmarklet/src/panel.js bookmarklet/test/panel.test.js bookmarklet/test/panel-featured.test.js
git commit -m "$(cat <<'EOF'
Bookmarklet panel: optional featured section (manual entry)

A second section with its own item/link/title/date/category flow,
purple outlines, ↑/↓, Re-pick and Remove; featured_* keys in the YAML.
A featured click that overlaps the main list's boxes is refused.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Panel — over-match detection, "Add as featured section", claim-aware warning

**Files:**
- Modify: `bookmarklet/src/panel.js`
- Test: `bookmarklet/test/panel-featured.test.js`

**Interfaces:**
- Consumes: Task 6 names (`state.featured`, `emptySection`, `pick`, `pickFeaturedItem`, `nextArmed`, `nextUnfinishedField`, `parseArmed`, `armedFor`, `OUTLINES`).
- Produces: inside `createPicker`: `claimed() → Set<Element>`, `mainMatches() → Element[]`, `overMatches() → Element[]`. Action `featured-from-overmatch`. `OUTLINES.overmatch = '2px dashed #7048e8'`. `nextArmed` returns to the first unfinished main field once the featured flow finishes.

- [ ] **Step 1: Write the failing tests** — append to `bookmarklet/test/panel-featured.test.js`:

```js
const DASHED = '2px dashed #7048e8';

test('a main selector catching an element outside the list offers it as the featured section', () => {
  const t = setup();
  t.click(t.$('a[href="/posts/two"] h3'));
  assert.match(t.status(), /Your selector also catches 1 element\(s\) outside the list \(purple\) — e.g\. a featured article\./);
  assert.ok(t.button('featured-from-overmatch'));
  assert.equal(t.button('featured-from-overmatch').textContent.trim(), 'Add as featured section');
  assert.doesNotMatch(t.status(), /Selector matches/);
  assert.equal(t.$('a[href="/posts/hero"]').style.outline, DASHED);
});

test('Add as featured section starts the featured flow with that element picked; the warning clears', () => {
  const t = setup();
  t.click(t.$('a[href="/posts/two"] h3'));
  t.button('featured-from-overmatch').click();
  assert.equal(t.picker.state.featured.itemSelector, 'article.card--featured a.card__link');
  assert.equal(t.picker.state.armed, 'featured:title');
  assert.equal(t.$('a[href="/posts/hero"]').style.outline, PURPLE);
  assert.doesNotMatch(t.status(), /also catches/);
  assert.doesNotMatch(t.status(), /Selector matches/);
});

test('after the featured flow the panel returns to the unfinished main-list fields', () => {
  const t = setup();
  t.click(t.$('a[href="/posts/two"] h3'));
  t.button('featured-from-overmatch').click();
  t.click(t.$('.card__headline'));
  t.button('skip').click(); // featured date
  t.button('skip').click(); // featured topic
  assert.equal(t.picker.state.armed, 'title');
  assert.match(t.status(), /Step 2/);
});

test('removing the featured section brings the over-match offer back', () => {
  const t = setup();
  t.click(t.$('a[href="/posts/two"] h3'));
  t.button('featured-from-overmatch').click();
  t.button('remove-featured').click();
  assert.match(t.status(), /also catches 1 element\(s\)/);
  assert.equal(t.$('a[href="/posts/hero"]').style.outline, DASHED);
});

test('an exact main selector shows no over-match offer', () => {
  const html = HERO.replace(/<article class="card card--featured">[\s\S]*?<\/article>/, '');
  const t = setup({}, html);
  t.click(t.$('a[href="/posts/two"] h3'));
  assert.equal(t.button('featured-from-overmatch'), null);
  assert.doesNotMatch(t.status(), /also catches|Selector matches/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd bookmarklet && npm test`
Expected: the first four FAIL (no `featured-from-overmatch` button; status shows `Selector matches 4 elements, not 3.`); the last passes already.

- [ ] **Step 3: Implement in `bookmarklet/src/panel.js`**

Add `overmatch: '2px dashed #7048e8',` to `OUTLINES`.

Inside `createPicker`, after `level`/`levelOf`, add:

```js
  /** Elements the featured section claims; the scraper skips them in the main list. */
  function claimed() {
    const sel = state.featured?.itemSelector;
    return sel ? new Set(doc.querySelectorAll(sel)) : new Set();
  }

  /** Main-selector matches the scraper treats as main-list items. */
  function mainMatches() {
    const c = claimed();
    return [...doc.querySelectorAll(state.itemSelector)].filter((el) => !c.has(el));
  }

  /** Main-selector matches outside the orange boxes and not claimed by the featured section. */
  function overMatches() {
    const lv = level();
    if (!lv) return [];
    const items = new Set(lv.items);
    return mainMatches().filter((el) => !items.has(el));
  }
```

In `nextArmed`, make a finished featured flow fall back to the main list:

```js
  /** What to arm after `field` of `section` is picked or skipped. A finished
   *  featured flow returns to the first unfinished main-list field, if any. */
  function nextArmed(section, field) {
    const next = field === 'link' ? nextUnfinishedField(sectionState(section)) : NEXT_ARMED[field];
    if (next) return armedFor(section, next);
    return section === 'featured' ? armedFor('main', nextUnfinishedField(state)) : null;
  }
```

In `renderStatus`, replace the `total`/warning lines inside `if (lv) { … }` (after the hint push) with:

```js
      const extra = overMatches();
      const total = mainMatches().length;
      if (extra.length && !state.featured) {
        parts.push(`<p class="warn overmatch">Your selector also catches ${extra.length} element(s) outside the list (purple) — e.g. a featured article.
          <button data-action="featured-from-overmatch">Add as featured section</button></p>`);
      } else if (total !== lv.items.length) {
        parts.push(`<p class="warn">Selector matches ${total} elements, not ${lv.items.length}.</p>`);
      }
```

In `paint`, change the main-items line to:

```js
    if (lv) {
      for (const it of lv.items) outline(it, OUTLINES.item);
      for (const el of overMatches()) outline(el, OUTLINES.overmatch);
    }
```

In `onPanelClick`, after the `add-featured` block, add:

```js
    if (verb === 'featured-from-overmatch') {
      const el = overMatches()[0];
      if (el) {
        state.featured = emptySection();
        state.armed = 'featured:item';
        return pick(el);
      }
    }
```

- [ ] **Step 4: Run all JS tests (paste full output)**

Run: `cd bookmarklet && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/panel.js bookmarklet/test/panel-featured.test.js
git commit -m "$(cat <<'EOF'
Bookmarklet panel: offer over-matched elements as the featured section

Main-selector matches outside the list are outlined purple dashed and
offered via "Add as featured section"; the mismatch warning now counts
main matches minus featured-claimed elements.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Panel — ★ preview rows and the featured raw-HTML check

**Files:**
- Modify: `bookmarklet/src/panel.js` (`renderPreview`, `runRawCheck`, `renderCheck`, imports)
- Test: `bookmarklet/test/panel-featured.test.js`

**Interfaces:**
- Consumes: `extractSections`, `keptFeatured`, `selectorCounts` (with `.featured`), `rawCheckVerdict` (Task 3); Task 6/7 panel state.
- Produces: `state.rawCheck` gains `featuredStatus: 'ok'|'js-rendered'|null`; preview rows for kept featured entries carry `class="featured"` and a `★ ` title prefix.

- [ ] **Step 1: Write the failing tests** — append to `bookmarklet/test/panel-featured.test.js`:

```js
const previewRows = (t) =>
  [...t.picker.root.querySelectorAll('.preview tr')].slice(1).map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));

test('preview lists the kept featured rows first, marked ★, then the main rows', () => {
  const t = setup();
  pickMainList(t);
  pickFeatured(t);
  const rows = previewRows(t);
  assert.deepEqual(rows[0], ['★ The hero post', '', 'Essays', 'https://hero.example.com/posts/hero']);
  assert.deepEqual(rows.slice(1).map((r) => r[0]), ['Post one', 'Post two', 'Post three']);
  assert.ok(t.picker.root.querySelector('.preview tr.featured'));
});

test('raw check counts the featured section and passes when it is in the raw HTML', async () => {
  const t = setup();
  pickMainList(t);
  pickFeatured(t);
  await settle();
  const text = t.picker.root.querySelector('.check').textContent;
  assert.match(text, /rendered: 3 · raw HTML: 3 ✓/);
  assert.match(text, /featured — rendered: 1 · raw HTML: 1 ✓/);
  assert.doesNotMatch(text, /JavaScript-rendered/);
});

test('raw check warns when the featured section is missing from the raw HTML', async () => {
  const raw = HERO.replace(/<article class="card card--featured">[\s\S]*?<\/article>/, '');
  const t = setup({ fetchImpl: async () => ({ ok: true, text: async () => raw }) });
  pickMainList(t);
  pickFeatured(t);
  await settle();
  const text = t.picker.root.querySelector('.check').textContent;
  assert.match(text, /rendered: 3 · raw HTML: 3 ✓/);
  assert.match(text, /featured — rendered: 1 · raw HTML: 0 ✗/);
  assert.match(text, /The featured section looks JavaScript-rendered; the scraper won't see it\./);
  assert.doesNotMatch(text, /This list looks JavaScript-rendered/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd bookmarklet && npm test`
Expected: all three FAIL. In the preview, the hero row comes last and has no ★. The check text has no `featured —` line.

- [ ] **Step 3: Implement in `bookmarklet/src/panel.js`**

Change the extract import to:

```js
import { extractSections, keptFeatured, selectorCounts, rawCheckVerdict } from './extract.js';
```

Replace `renderPreview` with:

```js
  function renderPreview() {
    const cfg = config();
    if (!cfg) {
      $('.preview').innerHTML = '';
      return;
    }
    const { main, featured } = extractSections(doc, cfg);
    const rows = [
      ...keptFeatured(main, featured).map((r) => ({ ...r, star: true })),
      ...main.slice(0, PREVIEW_ROWS),
    ];
    $('.preview').innerHTML = `<table><tr><th>title</th><th>date</th><th>category</th><th>url</th></tr>${rows
      .map(
        (r) => `<tr${r.star ? ' class="featured"' : ''}><td>${r.star ? '★ ' : ''}${escapeHtml(r.title)}</td>
          <td>${escapeHtml(r.date_text)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.url)}</td></tr>`,
      )
      .join('')}</table>`;
  }
```

In `runRawCheck`, replace the `state.rawCheck = { status: … }` line with:

```js
      state.rawCheck = {
        status: rawCheckVerdict(rendered.items, raw.items),
        featuredStatus: rendered.featured ? rawCheckVerdict(rendered.featured.items, raw.featured.items) : null,
        rendered,
        raw,
      };
```

In `renderCheck`, inside the final `else { … }` branch, after the main `js-rendered` warning, add:

```js
      if (rc.featuredStatus) {
        const ok = rc.featuredStatus === 'ok';
        html += `<p class="${ok ? 'ok' : 'warn'}">featured — rendered: ${rc.rendered.featured.items} · raw HTML: ${rc.raw.featured.items} ${ok ? '✓' : '✗'}</p>`;
        if (!ok) html += `<p class="warn">The featured section looks JavaScript-rendered; the scraper won't see it.</p>`;
      }
```

- [ ] **Step 4: Run all JS tests (paste full output)**

Run: `cd bookmarklet && npm test`
Expected: all pass, including `panel.test.js`'s preview test (`tr:nth-child(2)` still the first main row when there's no featured section).

- [ ] **Step 5: Commit**

```bash
git add bookmarklet/src/panel.js bookmarklet/test/panel-featured.test.js
git commit -m "$(cat <<'EOF'
Bookmarklet panel: starred featured preview rows and featured raw-HTML check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Engineering fixture — parity with the scraper, and a panel end-to-end

**Files:**
- Create: `bookmarklet/test/fixtures/engineering.html`
- Modify: `bookmarklet/test/cases.json`, `bookmarklet/test/parity.test.js`, `tests/test_bookmarklet_parity.py`
- Test: `bookmarklet/test/panel-featured.test.js` (append)

**Interfaces:**
- Consumes: `featuredGeneralize` (Task 5), `extractPreview` with claiming (Task 3), `extract_items` claiming (Task 2), panel over-match flow (Task 7).
- Produces: `cases.json` entries may carry `clicks.featured: {item, title?, date?, category?}` and `featured_*` keys in `expected_selectors`.

Expected selectors were measured with origin/main's post-fix code (PR #12) on exactly this fixture: main `a[class*="cardLink"]` (the generator's fallback: it over-matches into the hero, which the featured section then claims), title `h3.headline-4`, date `time`, featured `article[class*="featured"] a[class*="cardLink"]`, featured title `h2.headline-1`. If a run disagrees, investigate before editing the expectations. Never change `expected_items`.

- [ ] **Step 1: Create the fixture** `bookmarklet/test/fixtures/engineering.html`:

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Engineering \ Anthropic</title></head>
<body>
<!-- Trimmed from the live https://www.anthropic.com/engineering (2026-10-13):
     the featured hero plus four rows of the article table, real class names.
     Hero and rows share the cardLink anchor class; the hero sits in an
     article[class*="featured"], has an <h2> title and no <time>. -->
<header class="SiteHeader-module-scss-module__Qw3rTy__root">
  <nav>
    <ul>
      <li><a href="/research">Research</a></li>
      <li><a href="/engineering">Engineering</a></li>
      <li><a href="/news">News</a></li>
    </ul>
  </nav>
</header>
<main id="main-content" class="bg-default"><article>
<section class="LandingPageSection-module-scss-module__ZSMdoa__root bg-default LandingPageSection-module-scss-module__ZSMdoa__flushBottom" data-theme="ivory"><div class="page-wrapper"><div class="BlogCta-module-scss-module__3OgYaa__wrapper"><h2 class="headline-4">Engineering at Anthropic: Inside the team building reliable AI systems</h2><div class="ButtonGroup-module-scss-module__DBorwq__wrapper BlogCta-module-scss-module__3OgYaa__buttonGroup" data-theme="ivory"><a href="https://platform.claude.com/" class="Button-module-scss-module__f9ZZrG__button Button-module-scss-module__f9ZZrG__large Button-module-scss-module__f9ZZrG__primary ButtonGroup-module-scss-module__DBorwq__button BlogCta-module-scss-module__3OgYaa__button"><span class="body-3">Start building</span></a><a href="https://www.anthropic.com/docs" class="Button-module-scss-module__f9ZZrG__button Button-module-scss-module__f9ZZrG__large Button-module-scss-module__f9ZZrG__secondary ButtonGroup-module-scss-module__DBorwq__button BlogCta-module-scss-module__3OgYaa__button"><span class="body-3">Developer docs</span></a></div></div></div></section>
<section class="LandingPageSection-module-scss-module__ZSMdoa__root bg-default LandingPageSection-module-scss-module__ZSMdoa__flushBottom" data-theme="ivory"><div class="page-wrapper ArticleList-module-scss-module___tpu-a__wrapper">
<div class="ArticleList-module-scss-module___tpu-a__imageRail"><div class="ArticleList-module-scss-module___tpu-a__imageContainer"><img alt=""></div></div>
<div class="ArticleList-module-scss-module___tpu-a__articles">
<article class="ArticleList-module-scss-module___tpu-a__article ArticleList-module-scss-module___tpu-a__featured"><a class="ArticleList-module-scss-module___tpu-a__cardLink" href="/engineering/redesigning-source-control"><div class="ArticleList-module-scss-module___tpu-a__mobileImage"><img alt=""></div><div class="ArticleList-module-scss-module___tpu-a__content"><span class="body-2 ArticleList-module-scss-module___tpu-a__featuredLabel">Featured</span><h2 class="headline-1"> Redesigning source control at Anthropic</h2><p class="body-large-1 serif tight ArticleList-module-scss-module___tpu-a__summary">As our merges per day grew more than tenfold, source control became our biggest development bottleneck.</p></div></a></article>
<div>
<article class="ArticleList-module-scss-module___tpu-a__article"><a class="ArticleList-module-scss-module___tpu-a__cardLink" href="/engineering/how-we-contain-claude"><div class="ArticleList-module-scss-module___tpu-a__spotIllo"><img alt=""></div><div class="ArticleList-module-scss-module___tpu-a__content"><h3 class="headline-4">How we contain Claude across products</h3><div class="body-2 ArticleList-module-scss-module___tpu-a__date"><time dateTime="2026-05-25">May 25, 2026</time></div></div></a></article>
<article class="ArticleList-module-scss-module___tpu-a__article"><a class="ArticleList-module-scss-module___tpu-a__cardLink" href="/engineering/april-23-postmortem"><div class="ArticleList-module-scss-module___tpu-a__spotIllo"><img alt=""></div><div class="ArticleList-module-scss-module___tpu-a__content"><h3 class="headline-4">An update on recent Claude Code quality reports</h3><div class="body-2 ArticleList-module-scss-module___tpu-a__date"><time dateTime="2026-04-23">Apr 23, 2026</time></div></div></a></article>
<article class="ArticleList-module-scss-module___tpu-a__article"><a class="ArticleList-module-scss-module___tpu-a__cardLink" href="/engineering/managed-agents"><div class="ArticleList-module-scss-module___tpu-a__spotIllo"><img alt=""></div><div class="ArticleList-module-scss-module___tpu-a__content"><h3 class="headline-4">Scaling Managed Agents: Decoupling the brain from the hands</h3><div class="body-2 ArticleList-module-scss-module___tpu-a__date"><time dateTime="2026-04-08">Apr 08, 2026</time></div></div></a></article>
<article class="ArticleList-module-scss-module___tpu-a__article"><a class="ArticleList-module-scss-module___tpu-a__cardLink" href="/engineering/infrastructure-noise"><div class="ArticleList-module-scss-module___tpu-a__content"><h3 class="headline-4">Quantifying infrastructure noise in agentic coding evals</h3><div class="body-2 ArticleList-module-scss-module___tpu-a__date"><time dateTime="2026-02-05">Feb 05, 2026</time></div></div></a></article>
</div>
</div>
</div></section>
</article></main>
</body>
</html>
```

- [ ] **Step 2: Add the case** — append this object to the array in `bookmarklet/test/cases.json` (add a comma after the previous last element):

```json
  {
    "fixture": "engineering.html",
    "base_url": "https://www.anthropic.com",
    "clicks": {
      "item": "a[href=\"/engineering/april-23-postmortem\"]",
      "title": "a[href=\"/engineering/how-we-contain-claude\"] h3",
      "date": "a[href=\"/engineering/how-we-contain-claude\"] time",
      "featured": {
        "item": "article[class*=\"featured\"] h2",
        "title": "article[class*=\"featured\"] h2"
      }
    },
    "expected_selectors": {
      "item_selector": "a[class*=\"cardLink\"]",
      "title_selector": "h3.headline-4",
      "date_selector": "time",
      "featured_item_selector": "article[class*=\"featured\"] a[class*=\"cardLink\"]",
      "featured_title_selector": "h2.headline-1"
    },
    "expected_items": [
      {"url": "https://www.anthropic.com/engineering/how-we-contain-claude", "title": "How we contain Claude across products", "category": null, "date_text": "2026-05-25"},
      {"url": "https://www.anthropic.com/engineering/april-23-postmortem", "title": "An update on recent Claude Code quality reports", "category": null, "date_text": "2026-04-23"},
      {"url": "https://www.anthropic.com/engineering/managed-agents", "title": "Scaling Managed Agents: Decoupling the brain from the hands", "category": null, "date_text": "2026-04-08"},
      {"url": "https://www.anthropic.com/engineering/infrastructure-noise", "title": "Quantifying infrastructure noise in agentic coding evals", "category": null, "date_text": "2026-02-05"},
      {"url": "https://www.anthropic.com/engineering/redesigning-source-control", "title": "Redesigning source control at Anthropic", "category": null, "date_text": null}
    ]
  }
```

- [ ] **Step 3: Run both parity suites to verify they fail**

Run: `cd bookmarklet && npm test` — Expected: `parity: engineering.html` FAILS (generated selectors lack the `featured_*` keys).
Run: `uv run pytest tests/test_bookmarklet_parity.py -v` — Expected: `engineering.html` FAILS: `extract_listing` ignores the featured keys and scrapes the hero first, with its whole card text as the title.

- [ ] **Step 4: Replay featured clicks in `bookmarklet/test/parity.test.js`**

Replace the imports and `generateSelectors` with:

```js
import { generalize, featuredGeneralize, itemContaining } from '../src/generalize.js';
import { itemSelectorFor, relativeSelector } from '../src/selectors.js';
import { extractPreview } from '../src/extract.js';
import { loadCases, loadFixture } from './helpers.js';

/** One section's selectors from its clicks, keys prefixed (e.g. 'featured_'). */
function sectionSelectors(doc, clicks, gen, prefix) {
  const { levels, index } = gen(doc.querySelector(clicks.item));
  const { el, items } = levels[index];
  const selectors = { [`${prefix}item_selector`]: itemSelectorFor(el, items) };
  if (!el.matches('a[href]')) {
    selectors[`${prefix}link_selector`] = relativeSelector(el.querySelector('a[href]'), el, items);
  }
  for (const field of ['title', 'date', 'category']) {
    if (!clicks[field]) continue;
    const target = doc.querySelector(clicks[field]);
    selectors[`${prefix}${field}_selector`] = relativeSelector(target, itemContaining(items, target), items);
  }
  return selectors;
}

function generateSelectors(doc, clicks) {
  return {
    ...sectionSelectors(doc, clicks, generalize, ''),
    ...(clicks.featured ? sectionSelectors(doc, clicks.featured, featuredGeneralize, 'featured_') : {}),
  };
}
```

(the `for (const c of loadCases())` loop is unchanged.)

- [ ] **Step 5: Switch the Python parity test to `extract_items`**

In `tests/test_bookmarklet_parity.py`, change `items = extract.extract_listing(html, config)` to `items = extract.extract_items(html, config)`, and update the module docstring's first sentence to: `"""The scraper (extract_items, including any featured section) must extract the same items the bookmarklet previews, using the selectors the bookmarklet generates.`

- [ ] **Step 6: Add the panel end-to-end** — append to `bookmarklet/test/panel-featured.test.js`:

```js
import { loadCases } from './helpers.js';

const ENGINEERING = readFileSync(new URL('./fixtures/engineering.html', import.meta.url), 'utf8');
const ENG_CASE = loadCases().find((c) => c.fixture === 'engineering.html');
const yamlLine = (key, value) => `${key}: '${value.replaceAll("'", "''")}'`;

test('engineering: over-match → Add as featured section → YAML matches the parity case', () => {
  const t = setup({}, ENGINEERING, 'https://www.anthropic.com/engineering');
  const { clicks } = ENG_CASE;
  t.click(t.$(clicks.item));
  assert.match(t.status(), /also catches 1 element\(s\) outside the list/);
  t.button('featured-from-overmatch').click();
  t.click(t.$(clicks.featured.title));
  t.button('skip').click(); // featured date: none in the listing
  t.button('skip').click(); // featured topic
  t.click(t.$(clicks.title)); // back on the main list
  t.click(t.$(clicks.date));
  t.button('skip').click(); // main topic
  for (const [key, value] of Object.entries(ENG_CASE.expected_selectors)) {
    assert.ok(t.yaml().includes(yamlLine(key, value)), `${key} in YAML`);
  }
  assert.doesNotMatch(t.status(), /also catches|Selector matches/);
});
```

Move the new `import { loadCases } from './helpers.js';` line up to the other imports at the top of the file. ES module imports are hoisted, but keep them together.

- [ ] **Step 7: Run both suites (paste full output)**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured && uv run pytest
cd bookmarklet && npm test
```
Expected: all pass; parity runs include `engineering.html` on both sides.

- [ ] **Step 8: Commit**

```bash
git add bookmarklet/test/fixtures/engineering.html bookmarklet/test/cases.json bookmarklet/test/parity.test.js bookmarklet/test/panel-featured.test.js tests/test_bookmarklet_parity.py
git commit -m "$(cat <<'EOF'
Parity: anthropic.com/engineering fixture with a featured hero

Shared cases may replay featured clicks; the Python side now uses
extract_items so featured sections take part in parity.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Docs

**Files:**
- Modify: `README.md` ("Adding another site": bookmarklet bullet and field table), `CLAUDE.md` (pipeline step 2)

**Interfaces:** none.

- [ ] **Step 1: README bookmarklet bullet** — after the paragraph ending `gives you the finished YAML to copy into` / `` `sites/<id>.yaml`. ``, add a new paragraph (same indentation, 3 spaces):

```markdown
   If the page also has one "featured" article marked up differently from
   the list (a hero at the top, say), the picker can capture it as a
   featured section, written as the `featured_*` fields. It offers this
   itself when your list selector also catches elements outside the list
   (outlined purple dashed): click **Add as featured section**. Otherwise,
   once the list is done, click **+ Add featured section** and click the
   featured article. The featured section claims what it matches, so the
   list selector may overlap it.
```

- [ ] **Step 2: README field table** — replace the two `featured_*` rows with:

```markdown
   | `featured_item_selector` | *(optional)* like `item_selector`, but for a separate "featured/promoted" block some sites show outside their main chronological listing — see `sites/anthropic-news.yaml`. An element both `item_selector` and `featured_item_selector` match is scraped once, as featured |
   | `featured_link_selector`, `featured_title_selector`, `featured_date_selector`, `featured_date_format`, `featured_category_selector` | *(optional)* counterparts to the fields above, evaluated inside each featured item |
```

- [ ] **Step 3: CLAUDE.md** — in pipeline step 2 (`scraper/extract.py`), after the sentence ending `` `link_selector` points at a link nested inside it. ``, insert:

```markdown
   `extract_items` adds an optional featured section (`featured_*` keys),
   which claims its own elements: main-list matches that
   `featured_item_selector` also matches are scraped once, as featured.
```
(keep the surrounding indentation and line wrapping consistent with the step.)

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Docs: featured sections in the bookmarklet and featured_link_selector

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Build, full verification, manual check, PR

**Files:**
- Regenerate: `docs/bookmarklet.html`

- [ ] **Step 1: Build and commit the bookmarklet**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured/bookmarklet && npm run build
cd .. && git status --short docs/bookmarklet.html
git add docs/bookmarklet.html
git commit -m "$(cat <<'EOF'
Rebuild docs/bookmarklet.html

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 2: Full gauntlet, as CI runs it (paste every command and its full output)**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured && uv run pytest
cd bookmarklet && npm ci && npm test
npm run build && git diff --exit-code ../docs/bookmarklet.html && echo "bookmarklet.html up to date"
```
Expected: all green, and `bookmarklet.html up to date`.

- [ ] **Step 3: Scraper smoke test on the real configs**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured && uv run python -c "
from scraper import extract; import yaml, pathlib
for sid in ['anthropic-news', 'anthropic-engineering']:
    cfg = yaml.safe_load(pathlib.Path(f'sites/{sid}.yaml').read_text())
    items = extract.extract_items(extract.fetch(cfg['listing_url'], cfg.get('user_agent')), cfg)
    print(sid, len(items), items[:2])
"
```
Expected: both return items. Claiming must not change `anthropic-news`, and `anthropic-engineering` has no `featured_*` keys. Do **not** commit any `data/` or `docs/feeds/` changes; this command writes none.

- [ ] **Step 4: Manual check of the built bookmarklet on live pages** (controller, not a subagent)

Use the built-in browser. Open `https://www.anthropic.com/engineering`. Run the bookmarklet by executing its decoded code in the page with `javascript_tool`. To get the code: read `docs/bookmarklet.html`, take the `href` of the link, strip `javascript:`, and `decodeURIComponent` it. Then:
1. Click a table row. Expect purple-dashed hero and the over-match prompt.
2. Click **Add as featured section**, then click the hero's headline. Skip, then Skip.
3. Click a row headline, click its date, then Skip.
4. Copy the YAML out of the panel's `<pre class="yaml">` with `get_page_text`.

Repeat on `https://www.anthropic.com/news`: click a PublicationList row. Then use **+ Add featured section** (or the over-match offer, if shown) on the FeaturedGrid hero. Paste both generated YAMLs in the report. If the browser can't run it, say so and ask the user to run it.

- [ ] **Step 5: Push the branch and open the PR**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/bookmarklet-featured
git push -u origin bookmarklet-featured
gh pr create --repo curiousstranger/feed-scraper --base main --head bookmarklet-featured \
  --title "Bookmarklet: optional featured section (featured_* fields)" \
  --body "$(cat <<'EOF'
## Summary
- Scraper: the featured section claims its elements (main-list matches that `featured_item_selector` also matches are scraped once, as featured); `featured_link_selector` is honoured.
- Bookmarklet: one optional featured section with its own item/link/title/date/category flow. It is offered when the main selector over-matches outside the list ("Add as featured section"), or via "+ Add featured section" once the list is done. Featured items are outlined purple, preview rows are starred, it has its own raw-HTML check, and the YAML gets `featured_*` keys.
- Parity: new trimmed anthropic.com/engineering fixture; the Python parity test now uses `extract_items`.

Spec: `docs/superpowers/specs/2026-10-13-bookmarklet-featured-section-design.md` · Plan: `docs/superpowers/plans/2026-10-13-bookmarklet-featured-section.md`

## Deviations from the spec
- `_extract_items(..., exclude_ids)` uses `id()`s: bs4 Tags with identical markup compare and hash equal.
- Most panel tests use a small `hero.html` fixture; one end-to-end panel test uses the engineering fixture.
- The engineering main selector is `a[class*="cardLink"]`, as generated after PR #12, not the spec's predicted `a[class*="ArticleList"][class*="cardLink"]`.
- A featured click overlapping the main list's boxes is refused; a finished featured flow returns to unfinished main fields.

## Test plan
- [ ] `uv run pytest`
- [ ] `cd bookmarklet && npm test`
- [ ] `npm run build` leaves `docs/bookmarklet.html` unchanged
- [ ] Manual: built bookmarklet on live anthropic.com/engineering and /news (YAML in PR comments)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then bind the PR with the ccd_pr tools (`get_status` / `bind_pr`) and post the two manual-check YAMLs as a PR comment only after confirming with the user.
