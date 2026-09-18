// The picker UI: a Shadow-DOM panel plus page-click interception.
import { itemSelectorFor, relativeSelector } from './selectors.js';
import { generalize, itemContaining, MIN_ITEMS } from './generalize.js';
import { extractPreview, selectorCounts, rawCheckVerdict } from './extract.js';
import { toYaml, slugForUrl, githubNewFileUrl } from './yaml.js';

const FIELDS = ['link', 'title', 'date', 'category'];
const NEXT_ARMED = { item: 'title', title: 'date', date: 'category', category: null, link: null };
const PROMPTS = {
  item: 'Click one article in the list.',
  link: 'Click the link inside an item that points to the article.',
  title: 'Click the title inside any highlighted item (or Skip).',
  date: 'Click the date inside any highlighted item (or Skip).',
  category: 'Click the category/tag inside any highlighted item (or Skip).',
};
const OUTLINES = { item: '2px solid #e8590c', field: '2px solid #1c7ed6', hover: '2px dashed #e8590c' };
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
  .row span { width: 64px; }
  .row code { flex: 1; overflow-wrap: anywhere; }
  .warn { color: #c92a2a; }
  .ok { color: #2b8a3e; }
  [hidden] { display: none !important; }
`;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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
    rawCheck: null,
    note: '',
  };
  let hovered = null;
  const savedOutlines = new Map();

  const host = doc.createElement('div');
  host.setAttribute('data-feed-scraper-picker', '');
  Object.assign(host.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <div class="panel">
      <header><strong>Feed selector picker</strong>
        <button data-action="close" title="Close (Esc)">✕</button></header>
      <section class="status"></section>
      <section class="fields"></section>
      <section class="preview"></section>
      <section class="meta">
        ${Object.keys(state.meta)
          .map((k) => `<label>${k}<input data-meta="${k}" value="${escapeHtml(state.meta[k])}"></label>`)
          .join('')}
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

  const level = () => state.levels[state.index] ?? null;

  function config() {
    const lv = level();
    if (!lv) return null;
    const cfg = { ...state.meta, item_selector: state.itemSelector };
    for (const f of FIELDS) cfg[`${f}_selector`] = state.selectors[f];
    return cfg;
  }

  function setIndex(index) {
    state.index = index;
    const lv = level();
    state.itemSelector = itemSelectorFor(lv.el, lv.items);
    const link = lv.el.matches('a[href]') ? null : lv.el.querySelector('a[href]');
    state.selectors = {
      link: link ? relativeSelector(link, lv.el, lv.items) : null,
      title: null,
      date: null,
      category: null,
    };
    state.message = lv.items.length < MIN_ITEMS ? 'No repeating items found — try ↑, or continue with this one.' : '';
  }

  function pick(target) {
    if (state.armed === 'item') {
      const { levels, index } = generalize(target);
      if (!levels.length) return;
      state.levels = levels;
      setIndex(Math.max(index, 0));
      state.armed = NEXT_ARMED.item;
    } else if (state.armed) {
      const lv = level();
      const item = itemContaining(lv.items, target);
      const field = state.armed === 'link' ? target.closest('a[href]') : target;
      if (!item || !field || field === item || !item.contains(field)) {
        state.message = 'Click inside one of the highlighted items.';
        render();
        return;
      }
      const sel = relativeSelector(field, item, lv.items);
      state.message = sel ? '' : 'Could not build a selector for that element — try a nearby one.';
      if (sel) {
        state.selectors[state.armed] = sel;
        state.armed = NEXT_ARMED[state.armed];
      }
    }
    render();
    if (state.armed === null && state.rawCheck === null) runRawCheck();
  }

  async function runRawCheck() {
    const cfg = config();
    if (!cfg) return;
    state.rawCheck = { status: 'pending' };
    render();
    try {
      if (!fetchImpl) throw new Error('fetch unavailable');
      const resp = await fetchImpl(win.location.href, { credentials: 'include' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rawDoc = new win.DOMParser().parseFromString(await resp.text(), 'text/html');
      const rendered = selectorCounts(doc, cfg);
      const raw = selectorCounts(rawDoc, cfg);
      state.rawCheck = { status: rawCheckVerdict(rendered.items, raw.items), rendered, raw };
    } catch (err) {
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
      for (const f of ['title', 'date', 'category']) {
        const sel = state.selectors[f];
        if (!sel) continue;
        for (const it of lv.items) {
          const hit = it.querySelector(sel);
          if (hit) outline(hit, OUTLINES.field);
        }
      }
    }
    if (hovered && state.armed && !savedOutlines.has(hovered)) outline(hovered, OUTLINES.hover);
  }

  function renderStatus() {
    const lv = level();
    const parts = [`<p>${escapeHtml(state.armed ? PROMPTS[state.armed] : 'Done — review, then copy.')}</p>`];
    if (lv) {
      const total = doc.querySelectorAll(state.itemSelector).length;
      parts.push(
        `<p><b class="count">${lv.items.length}</b> items · level ${state.index + 1}/${state.levels.length}
          <button data-action="up" ${state.index + 1 >= state.levels.length ? 'disabled' : ''}>↑ wider</button>
          <button data-action="down" ${state.index <= 0 ? 'disabled' : ''}>↓ narrower</button></p>
         <div class="row"><span>item</span><code>${escapeHtml(state.itemSelector)}</code>
           <button data-action="arm:item">Re-pick</button></div>`,
      );
      if (total !== lv.items.length) {
        parts.push(`<p class="warn">Selector matches ${total} elements, not ${lv.items.length}.</p>`);
      }
    }
    if (state.message) parts.push(`<p class="warn message">${escapeHtml(state.message)}</p>`);
    $('.status').innerHTML = parts.join('');
  }

  function renderFields() {
    const lv = level();
    if (!lv) {
      $('.fields').innerHTML = '';
      return;
    }
    const itemIsLink = lv.el.matches('a[href]');
    $('.fields').innerHTML = FIELDS.filter((f) => !(f === 'link' && itemIsLink))
      .map(
        (f) => `<div class="row"><span>${f}</span>
          <code data-field="${f}">${escapeHtml(state.selectors[f] ?? '—')}</code>
          <button data-action="arm:${f}">${state.armed === f ? 'Picking…' : 'Pick'}</button>
          ${state.armed === f ? `<button data-action="skip">Skip</button>` : ''}
          <button data-action="clear:${f}">Clear</button></div>`,
      )
      .join('');
  }

  function renderPreview() {
    const cfg = config();
    if (!cfg) {
      $('.preview').innerHTML = '';
      return;
    }
    const rows = extractPreview(doc, cfg).slice(0, PREVIEW_ROWS);
    $('.preview').innerHTML = `<table><tr><th>title</th><th>date</th><th>category</th><th>url</th></tr>${rows
      .map(
        (r) => `<tr><td>${escapeHtml(r.title)}</td><td>${escapeHtml(r.date_text)}</td>
          <td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.url)}</td></tr>`,
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
    }
    $('.check').innerHTML = `${html}${level() ? '<button data-action="check">Check raw HTML</button>' : ''}`;
  }

  function renderOutput() {
    const cfg = config();
    $('.output').hidden = !cfg;
    if (!cfg) return;
    const text = yamlText();
    $('.yaml').textContent = text;
    const github = $('[data-action="github"]');
    const { ok } = repo ? githubNewFileUrl(repo, state.meta.id, text) : { ok: false };
    github.disabled = !ok;
    github.title = !repo ? 'Repository unknown' : ok ? '' : 'Too long for a URL — use Copy instead';
    $('.note').textContent = state.note || (repo && !ok ? 'Too long for GitHub — use Copy instead.' : '');
  }

  function render() {
    renderStatus();
    renderFields();
    renderPreview();
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
    const [verb, arg] = action.split(':');
    if (verb === 'close') return destroy();
    if (verb === 'up' && state.index + 1 < state.levels.length) setIndex(state.index + 1);
    if (verb === 'down' && state.index > 0) setIndex(state.index - 1);
    if (verb === 'arm') state.armed = arg;
    if (verb === 'skip') state.armed = NEXT_ARMED[state.armed];
    if (verb === 'clear') state.selectors[arg] = null;
    if (verb === 'check') return runRawCheck();
    if (verb === 'copy') return copyYaml();
    if (verb === 'github') return openGithub();
    render();
    if (verb === 'skip' && state.armed === null && state.rawCheck === null) runRawCheck();
  }

  function onMetaInput(e) {
    const key = e.target.dataset.meta;
    if (!key) return;
    state.meta[key] = e.target.value;
    renderOutput();
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
