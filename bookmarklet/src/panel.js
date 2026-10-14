// The picker UI: a Shadow-DOM panel plus page-click interception.
import { itemSelectorFor, relativeSelector } from './selectors.js';
import { generalize, featuredGeneralize, itemContaining, MIN_ITEMS } from './generalize.js';
import { extractSections, keptFeatured, selectorCounts, rawCheckVerdict } from './extract.js';
import { toYaml, slugForUrl, githubNewFileUrl, isValidSiteId } from './yaml.js';

const FIELDS = ['link', 'title', 'date', 'category'];
const NEXT_ARMED = { item: 'title', title: 'date', date: 'category', category: null, link: null };
const FIELD_ORDER = ['title', 'date', 'category'];
// Plain-language guidance. Deliberately generic: sites differ in which parts
// they show, so every optional part says what to do when it's missing.
const PROMPTS = {
  item:
    'Step 1 — Click one article in the page\'s main list of articles ' +
    '(not a menu, sidebar or "featured" box). An orange box will appear around every article found.',
  link: 'Click the link, inside any orange box, that opens the article.',
  title: 'Step 2 — Click the article\'s headline, inside any orange box. No headline? Click Skip.',
  date: 'Step 3 — Click the date the article was published, inside any orange box. No date? Click Skip.',
  category:
    'Step 4 — Click the article\'s topic or section label, inside any orange box. No label? Click Skip.',
};
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
const DONE_PROMPT =
  'Done — check the table below shows the right headlines, dates and links, then click Copy YAML.';
const LEVEL_HINT =
  'Each orange box should hold exactly one article, and every article should have one. ' +
  'Box holds several articles? Click ↓ narrower. Box holds only part of an article? Click ↑ wider.';
const LABELS = { link: 'article link', title: 'headline', date: 'date', category: 'topic/section' };
const ID_MESSAGE = 'id must be lowercase letters, digits and hyphens — it names the feed and state files.';
const QUERY_WARNING =
  'listing_url has a query string. It is written into the YAML (and sent to GitHub by Open in GitHub), ' +
  'so remove any session tokens or keys from it before copying.';
// Which preview column shows the value a field's selector extracts.
const EXAMPLE_COLUMN = { link: 'url', title: 'title', date: 'date_text', category: 'category' };
const OUTLINES = {
  item: '2px solid #e8590c',
  featured: '2px solid #7048e8',
  field: '2px solid #1c7ed6',
  hover: '2px dashed #e8590c',
  overmatch: '2px dashed #7048e8',
};
const BLOCKED_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup'];
const PREVIEW_ROWS = 5;

const CSS = `
  :host { all: initial; }
  .panel { font: 13px/1.4 system-ui, sans-serif; color: #212529; background: #fff;
    border: 1px solid #adb5bd; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.2);
    width: 440px; max-height: 85vh; overflow: auto; padding: 10px 12px; }
  header { display: flex; justify-content: space-between; align-items: center; }
  section { margin-top: 8px; }
  code, pre, textarea { font: 12px ui-monospace, monospace; }
  pre { background: #f1f3f5; padding: 6px; white-space: pre-wrap; word-break: break-all; margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  td, th { border: 1px solid #dee2e6; padding: 2px 4px; text-align: left; max-width: 140px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  label { display: block; margin-top: 4px; }
  input { width: 100%; box-sizing: border-box; font: inherit; }
  textarea { width: 100%; height: 120px; }
  button { font: inherit; margin: 2px 2px 2px 0; }
  .row { display: flex; gap: 6px; align-items: center; }
  .row span { width: 84px; flex: none; }
  .row code { flex: 1; overflow-wrap: anywhere; }
  .row small { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #495057; }
  .warn { color: #c92a2a; }
  .ok { color: #2b8a3e; }
  .group { border-top: 1px solid #dee2e6; margin-top: 6px; padding-top: 4px; }
  .group h4 { margin: 2px 0; font-size: 13px; }
  [hidden] { display: none !important; }
  header .tools { display: flex; gap: 2px; }
  .collapsed section:not(.status) { display: none; }
  .collapsed .status > :not(.prompt):not(.message) { display: none; }
`;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

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

/**
 * Mount the picker on `doc`. Options (all injectable for tests):
 *   repo       "owner/name" for Open in GitHub (null disables it)
 *   fetchImpl  fetch used for the raw-HTML check
 *   clipboard  object with writeText(text) → Promise
 *   today      "YYYY-MM-DD" for the YAML header
 *   onDestroy  called after the picker is removed
 * Returns {state, host, root, destroy}.
 */
export function createPicker(doc, options = {}) {
  const win = doc.defaultView;
  const {
    repo = null,
    fetchImpl = win.fetch ? win.fetch.bind(win) : null,
    clipboard = win.navigator.clipboard,
    today = new Date().toISOString().slice(0, 10),
    onDestroy = () => {},
  } = options;

  const listingUrl = win.location.href.split('#')[0];
  const state = {
    armed: 'item',
    levels: [],
    index: -1,
    itemSelector: null,
    selectors: { link: null, title: null, date: null, category: null },
    meta: {
      id: slugForUrl(listingUrl),
      name: doc.title.trim(),
      description: `Unofficial RSS feed scraped from ${listingUrl}`,
      listing_url: listingUrl,
      base_url: win.location.origin,
    },
    message: '',
    blocked: false, // too few boxes while a repeating level exists: no output
    rawCheck: null,
    note: '',
    skipped: new Set(),
    featured: null,
  };
  let hovered = null;
  const savedOutlines = new Map();
  let checkGeneration = 0;
  let autoCollapsed = false; // shrunk by a Pick button, not by the user

  /** The first of title/date/category in `sec` that has neither been picked nor skipped. */
  function nextUnfinishedField(sec) {
    return FIELD_ORDER.find((f) => sec.selectors[f] == null && !sec.skipped.has(f)) ?? null;
  }

  const host = doc.createElement('div');
  host.setAttribute('data-feed-scraper-picker', '');
  Object.assign(host.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="panel">
      <header><strong>Feed selector picker</strong>
        <span class="tools">
          <button data-action="side" title="Move to other side">⇆</button>
          <button data-action="collapse" title="Minimise">–</button>
          <button data-action="close" title="Close (Esc)">✕</button>
        </span></header>
      <section class="status"></section>
      <section class="fields"></section>
      <section class="preview"></section>
      <section class="meta">
        ${Object.keys(state.meta)
          .map((k) => `<label>${k}<input data-meta="${k}" value="${escapeHtml(state.meta[k])}"></label>`)
          .join('')}
        <p class="warn query" hidden></p>
      </section>
      <section class="check"></section>
      <section class="output">
        <pre class="yaml"></pre>
        <button data-action="copy">Copy YAML</button>
        <button data-action="github">Open in GitHub</button>
        <p class="note"></p>
        <textarea hidden readonly></textarea>
      </section>
    </div>`;
  doc.body.appendChild(host);
  const $ = (sel) => root.querySelector(sel);

  /** The main list lives on `state` itself; the featured section on state.featured. */
  const sectionState = (name) => (name === 'featured' ? state.featured : state);
  const levelOf = (sec) => sec?.levels[sec.index] ?? null;
  const level = () => levelOf(state);

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

  /** What to arm after `field` of `section` is picked or skipped. A finished
   *  featured flow returns to the first unfinished main-list field, if any. */
  function nextArmed(section, field) {
    const next = field === 'link' ? nextUnfinishedField(sectionState(section)) : NEXT_ARMED[field];
    if (next) return armedFor(section, next);
    return section === 'featured' ? armedFor('main', nextUnfinishedField(state)) : null;
  }

  /** Too few boxes: point at the level that repeats, or allow continuing if none does. */
  function levelMessage(lv) {
    state.blocked = false;
    state.message = '';
    if (lv.items.length >= MIN_ITEMS) return;
    const repeats = (l) => l.items.length >= MIN_ITEMS && (l.el.matches('a[href]') || l.el.querySelector('a[href]'));
    const better = state.levels.findIndex(repeats);
    if (better === -1) {
      state.message = 'No repeating articles found — try ↑ wider, or continue with this one.';
      return;
    }
    state.blocked = true;
    state.message =
      better < state.index
        ? `Only ${lv.items.length} orange box — it's around the whole list, not one article. Click ↓ narrower.`
        : `Only ${lv.items.length} orange box — it holds part of an article. Click ↑ wider.`;
  }

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

  async function runRawCheck() {
    const cfg = config();
    if (!cfg) return;
    const generation = checkGeneration;
    state.rawCheck = { status: 'pending' };
    render();
    try {
      if (!fetchImpl) throw new Error('fetch unavailable');
      const resp = await fetchImpl(win.location.href, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rawDoc = new win.DOMParser().parseFromString(await resp.text(), 'text/html');
      const rendered = selectorCounts(doc, cfg);
      const raw = selectorCounts(rawDoc, cfg);
      if (generation !== checkGeneration) return; // level changed while the fetch was in flight
      state.rawCheck = {
        status: rawCheckVerdict(rendered.items, raw.items),
        featuredStatus: rendered.featured ? rawCheckVerdict(rendered.featured.items, raw.featured.items) : null,
        rendered,
        raw,
      };
    } catch (err) {
      if (generation !== checkGeneration) return;
      state.rawCheck = { status: 'failed', error: String(err) };
    }
    render();
  }

  function yamlText() {
    return toYaml(config(), { date: today });
  }

  async function copyYaml() {
    const text = yamlText();
    const textarea = $('textarea');
    try {
      await clipboard.writeText(text);
      textarea.hidden = true;
      state.note = 'Copied. Paste into sites/<id>.yaml.';
    } catch {
      textarea.hidden = false;
      textarea.value = text;
      textarea.select();
      state.note = 'Clipboard blocked — press ⌘C / Ctrl+C to copy the selected text.';
    }
    render();
  }

  function openGithub() {
    const { url, ok } = githubNewFileUrl(repo, state.meta.id, yamlText());
    if (ok) win.open(url, '_blank', 'noopener');
  }

  // --- rendering -----------------------------------------------------------

  function outline(el, value) {
    if (!savedOutlines.has(el)) savedOutlines.set(el, el.style.outline);
    el.style.outline = value;
  }

  function clearOutlines() {
    for (const [el, previous] of savedOutlines) el.style.outline = previous;
    savedOutlines.clear();
  }

  function paint() {
    clearOutlines();
    const lv = level();
    if (lv) {
      for (const it of lv.items) outline(it, OUTLINES.item);
      for (const el of overMatches()) outline(el, OUTLINES.overmatch);
    }
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
      const extra = overMatches();
      const total = mainMatches().length;
      if (extra.length && !state.featured) {
        parts.push(`<p class="warn overmatch">Your selector also catches ${extra.length} element(s) outside the list (purple) — e.g. a featured article.
          <button data-action="featured-from-overmatch">Add as featured section</button></p>`);
      } else if (total !== lv.items.length) {
        parts.push(`<p class="warn">Selector matches ${total} elements, not ${lv.items.length}.</p>`);
      }
    }
    if (state.message) parts.push(`<p class="warn message">${escapeHtml(state.message)}</p>`);
    $('.status').innerHTML = parts.join('');
  }

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

  function renderCheck() {
    const rc = state.rawCheck;
    let html = '';
    if (!rc) html = '';
    else if (rc.status === 'pending') html = '<p>Checking raw HTML…</p>';
    else if (rc.status === 'failed') {
      html = `<p class="warn">Couldn't verify — test with <code>uv run python -m scraper.run ${escapeHtml(state.meta.id)}</code></p>`;
    } else {
      const cls = rc.status === 'ok' ? 'ok' : 'warn';
      html = `<p class="${cls}">rendered: ${rc.rendered.items} · raw HTML: ${rc.raw.items} ${rc.status === 'ok' ? '✓' : '✗'}</p>`;
      if (rc.status === 'js-rendered') {
        html += `<p class="warn">This list looks JavaScript-rendered; the scraper fetches raw HTML and won't see it.</p>`;
      }
      if (rc.featuredStatus) {
        const ok = rc.featuredStatus === 'ok';
        html += `<p class="${ok ? 'ok' : 'warn'}">featured — rendered: ${rc.rendered.featured.items} · raw HTML: ${rc.raw.featured.items} ${ok ? '✓' : '✗'}</p>`;
        if (!ok) html += `<p class="warn">The featured section looks JavaScript-rendered; the scraper won't see it.</p>`;
      }
    }
    $('.check').innerHTML = `${html}${level() ? '<button data-action="check">Check raw HTML</button>' : ''}`;
  }

  function renderMeta() {
    const warning = $('.meta .warn');
    warning.textContent = QUERY_WARNING;
    warning.hidden = !state.meta.listing_url.includes('?');
  }

  function renderOutput() {
    const cfg = config();
    $('.output').hidden = !cfg;
    if (!cfg) return;
    const text = yamlText();
    $('.yaml').textContent = text;
    const github = $('[data-action="github"]');
    const validId = isValidSiteId(state.meta.id);
    const blocked = state.blocked || !validId;
    const { ok } = repo ? githubNewFileUrl(repo, state.meta.id, text) : { ok: false };
    $('[data-action="copy"]').disabled = blocked;
    github.disabled = !ok || blocked;
    github.title = !repo ? 'Repository unknown' : ok ? '' : 'Too long for a URL — use Copy instead';
    $('.note').textContent = !validId
      ? ID_MESSAGE
      : state.note || (repo && !ok ? 'Too long for GitHub — use Copy instead.' : '');
  }

  function render() {
    renderStatus();
    renderFields();
    renderPreview();
    renderMeta();
    renderCheck();
    renderOutput();
    paint();
  }

  // --- events --------------------------------------------------------------

  const inPanel = (e) => e.composedPath().includes(host);

  function onPageClick(e) {
    if (inPanel(e)) return;
    e.preventDefault();
    e.stopPropagation();
    if (state.armed && e.target.nodeType === 1) pick(e.target);
  }

  function onBlocked(e) {
    if (!inPanel(e)) e.stopPropagation();
  }

  function onOver(e) {
    if (inPanel(e)) return;
    hovered = e.target;
    paint();
  }

  function onKey(e) {
    if (e.key === 'Escape') destroy();
  }

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
    if (verb === 'featured-from-overmatch') {
      const el = overMatches()[0];
      if (el) {
        state.featured = emptySection();
        state.armed = 'featured:item';
        return pick(el);
      }
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

  // Minimised: only the header and the current instruction stay visible (see CSS).
  function setCollapsed(collapsed) {
    $('.panel').classList.toggle('collapsed', collapsed);
    const btn = $('[data-action="collapse"]');
    btn.textContent = collapsed ? '+' : '–';
    btn.title = collapsed ? 'Expand' : 'Minimise';
  }

  function toggleCollapsed() {
    autoCollapsed = false;
    setCollapsed(!$('.panel').classList.contains('collapsed'));
  }

  /** Undo a Pick button's automatic shrink; a user's own minimise is left alone. */
  function regrow() {
    if (!autoCollapsed) return;
    autoCollapsed = false;
    setCollapsed(false);
  }

  function switchSide() {
    const toLeft = host.style.right !== '';
    host.style.right = toLeft ? '' : '12px';
    host.style.left = toLeft ? '12px' : '';
  }

  function onMetaInput(e) {
    const key = e.target.dataset.meta;
    if (!key) return;
    state.meta[key] = e.target.value;
    render();
  }

  function destroy() {
    doc.removeEventListener('click', onPageClick, true);
    doc.removeEventListener('mouseover', onOver, true);
    doc.removeEventListener('keydown', onKey, true);
    for (const type of BLOCKED_EVENTS) doc.removeEventListener(type, onBlocked, true);
    clearOutlines();
    host.remove();
    onDestroy();
  }

  doc.addEventListener('click', onPageClick, true);
  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('keydown', onKey, true);
  for (const type of BLOCKED_EVENTS) doc.addEventListener(type, onBlocked, true);
  root.addEventListener('click', onPanelClick);
  root.addEventListener('input', onMetaInput);
  render();

  return { state, host, root, destroy };
}
