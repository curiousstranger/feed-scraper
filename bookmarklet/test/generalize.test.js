import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generalize, featuredGeneralize, itemContaining, overlaps } from '../src/generalize.js';
import { htmlDoc, loadFixture } from './helpers.js';

test('clicking a field climbs to the nearest repeating level that has a link', () => {
  const doc = loadFixture('anthropic.html');
  const { levels, index } = generalize(doc.querySelector('span[class*="title"]'));
  assert.equal(levels[0].el.localName, 'span'); // repeats, but no link
  assert.equal(levels[index].el.localName, 'a');
  assert.deepEqual(
    levels[index].items.map((a) => a.getAttribute('href')),
    ['/news/claude-5', '/news/interpretability-update', '/news/policy-brief'],
  );
});

test('decoys with a different stable class are not items', () => {
  const doc = loadFixture('anthropic.html');
  const { levels, index } = generalize(doc.querySelector('a[href="/news/claude-5"]'));
  assert.equal(index, 0);
  assert.equal(levels[0].items.length, 3); // not FeaturedGrid links or viewAll
});

test('blog: clicking an excerpt generalizes to the post cards', () => {
  const doc = loadFixture('blog.html');
  const { levels, index } = generalize(doc.querySelector('.post-card__excerpt'));
  assert.equal(levels[index].el.className, 'post-card');
  assert.equal(levels[index].items.length, 3);
});

test('tailwind: list items under main are separated from nav items by ancestry', () => {
  const doc = loadFixture('tailwind.html');
  const clicked = doc.querySelector('main li');
  const { levels, index } = generalize(clicked);
  assert.equal(levels[index].el, clicked);
  assert.deepEqual(levels[index].items, [...doc.querySelectorAll('main li')]);
});

test('no repeating level → index -1, levels still available for ↑', () => {
  const doc = htmlDoc('<main><article><h1><a href="/only">Only</a></h1></article></main>');
  const { levels, index } = generalize(doc.querySelector('h1'));
  assert.equal(index, -1);
  assert.deepEqual(levels.map((l) => l.el.localName), ['h1', 'article', 'main']);
});

test('itemContaining finds the item that holds a node', () => {
  const doc = loadFixture('blog.html');
  const items = [...doc.querySelectorAll('.post-card')];
  assert.equal(itemContaining(items, items[1].querySelector('time')), items[1]);
  assert.equal(itemContaining(items, doc.querySelector('footer a')), null);
});

test('clicking the list itself (e.g. the gap between rows) picks the repeating articles inside it', () => {
  const doc = loadFixture('blog.html');
  const { levels, index } = generalize(doc.querySelector('main.posts'));
  assert.equal(levels[index].el.className, 'post-card');
  assert.equal(levels[index].items.length, 3);
});

test('clicking a Tailwind list container picks its rows, not the nav', () => {
  const doc = loadFixture('tailwind.html');
  const { levels, index } = generalize(doc.querySelector('main ul'));
  assert.deepEqual(levels[index].items, [...doc.querySelectorAll('main li')]);
});

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

test('featuredGeneralize: a level overlapping `avoid` falls back to the nearest clean level below it', () => {
  const doc = loadFixture('sections.html');
  const clicked = doc.querySelector('.hero__title');
  const main = [...doc.querySelectorAll('a.row')];
  const plain = featuredGeneralize(clicked);
  assert.equal(plain.levels[plain.index].el.className, 'page-section'); // the sections repeat
  const { levels, index } = featuredGeneralize(clicked, main);
  assert.equal(index, 1);
  assert.equal(levels[index].el, doc.querySelector('a.hero__link'));
});

test('featuredGeneralize: every linked level overlapping `avoid` → -1', () => {
  const doc = loadFixture('sections.html');
  const main = [...doc.querySelectorAll('a.row')];
  assert.equal(featuredGeneralize(doc.querySelector('a[href="/news/two"] .row__title'), main).index, -1);
});

test('overlaps: same element, or either contains the other', () => {
  const doc = loadFixture('sections.html');
  const row = doc.querySelector('a.row');
  const li = row.parentElement;
  const hero = doc.querySelector('a.hero__link');
  assert.equal(overlaps([row], [row]), true);
  assert.equal(overlaps([li], [row]), true);
  assert.equal(overlaps([row.firstElementChild], [row]), true);
  assert.equal(overlaps([hero], [row, li]), false);
  assert.equal(overlaps([hero], []), false);
});
