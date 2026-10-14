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
