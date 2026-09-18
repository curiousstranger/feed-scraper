import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generalize, itemContaining } from '../src/generalize.js';
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
