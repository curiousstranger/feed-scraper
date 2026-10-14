import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createPicker } from '../src/panel.js';
import { loadCases } from './helpers.js';

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
  // The main selector still catches the hero, so it reverts to the over-match offer (dashed), not the featured box.
  assert.equal(t.$('a[href="/posts/hero"]').style.outline, '2px dashed #7048e8');
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

const DASHED = '2px dashed #7048e8';

test('a main selector catching an element outside the list offers it as the featured section', () => {
  const t = setup();
  t.click(t.$('a[href="/posts/two"] h3'));
  assert.match(t.status(), /Your selector also catches 1 element\(s\) outside the list \(purple\) — e\.g\. a featured article\./);
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

const SECTIONS = readFileSync(new URL('./fixtures/sections.html', import.meta.url), 'utf8');

test('a hero inside one of several repeating page sections can still be the featured section', () => {
  const t = setup({}, SECTIONS, 'https://sections.example.com/news');
  t.click(t.$('a[href="/news/two"] .row__title'));
  t.click(t.$('a[href="/news/one"] .row__title'));
  t.button('skip').click(); // date
  t.button('skip').click(); // topic
  assert.equal(t.picker.state.itemSelector, 'a.row');
  t.button('add-featured').click();
  t.click(t.$('.hero__title'));
  assert.equal(t.picker.state.featured.itemSelector, 'a.hero__link');
  assert.equal(t.picker.state.armed, 'featured:title');
  assert.doesNotMatch(t.status(), /part of the main list/);
});

test('refuses a featured item whose only selector would also claim the main list', () => {
  // The hero has a subset of the rows' classes in the same parent, so every
  // selector for it (no :not()) also matches the rows.
  const html = `<!doctype html><title>Subset</title><div class="posts">
    <a class="card" href="/hero"><h2 class="card__title">Hero</h2></a>
    <a class="card card--row" href="/1"><h3 class="card__title">One</h3></a>
    <a class="card card--row" href="/2"><h3 class="card__title">Two</h3></a>
    <a class="card card--row" href="/3"><h3 class="card__title">Three</h3></a></div>`;
  const t = setup({}, html);
  t.click(t.$('a[href="/2"] h3'));
  t.click(t.$('a[href="/1"] h3'));
  t.button('skip').click();
  t.button('skip').click();
  assert.equal(t.picker.state.itemSelector, 'a.card--row');
  t.button('add-featured').click();
  t.click(t.$('a[href="/hero"] h2'));
  assert.equal(t.picker.state.featured.itemSelector, null);
  assert.equal(t.picker.state.armed, 'featured:item');
  assert.match(t.status(), /part of the main list/);
});
