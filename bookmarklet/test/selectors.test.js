import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isHashLike,
  isUtilityClass,
  classSignals,
  candidateSelectors,
  itemSelectorFor,
  relativeSelector,
} from '../src/selectors.js';
import { htmlDoc, loadFixture } from './helpers.js';

const values = (cls) => classSignals(cls).map((s) => s.selector);

test('isHashLike: build hashes yes, words no', () => {
  for (const s of ['KxYrHG', 'a1b2c3', 'Ab12Cd', 'kXyZab', '3xYz9']) assert.equal(isHashLike(s), true, s);
  for (const s of ['listItem', 'Button', 'title', 'PublicationList', 'abc', 'subject']) {
    assert.equal(isHashLike(s), false, s);
  }
});

test('isUtilityClass: Tailwind-style utilities, not component classes', () => {
  for (const c of ['flex', 'mt-4', 'px-2', 'text-lg', 'bg-white', 'w-1/2', 'md:flex', 'hover:underline', 'h-4', 'w-full', '[mask:none]']) {
    assert.equal(isUtilityClass(c), true, c);
  }
  for (const c of ['post-card', 'h-entry', 'teaser__link', 'main-nav', 'body-3']) {
    assert.equal(isUtilityClass(c), false, c);
  }
});

test('classSignals: hashed CSS-modules class yields stable fragments, noise dropped', () => {
  assert.deepEqual(values('PublicationList-module-scss-module__KxYrHG__listItem'), [
    '[class*="PublicationList"]',
    '[class*="listItem"]',
  ]);
  assert.deepEqual(values('Card_title__a1b2c'), ['[class*="Card"]', '[class*="title"]']);
});

test('classSignals: plain BEM class is used verbatim', () => {
  assert.deepEqual(values('post-card__title'), ['.post-card__title']);
  assert.deepEqual(values('h-entry'), ['.h-entry']);
});

test('classSignals: CSS-in-JS, bare hashes and utilities contribute nothing', () => {
  for (const c of ['sc-bdVaJa', 'css-1x2y3z', 'jsx-123456', 'emotion-0', 'svelte-xyz123', 'kXyZab', 'mt-4', 'hover:underline']) {
    assert.deepEqual(values(c), [], c);
  }
});

test('candidateSelectors: element-naming fragment first, then pairs, semantic tag, attrs, bare tag', () => {
  const doc = htmlDoc('<li class="Feed-module__KxYrHG__item" data-testid="feed-item" role="listitem">x</li>');
  assert.deepEqual(candidateSelectors(doc.querySelector('li')), [
    'li[class*="item"]',
    'li[class*="Feed"]',
    'li[class*="Feed"][class*="item"]',
    'li',
    'li[data-testid="feed-item"]',
    'li[role="listitem"]',
  ]);
});

test('candidateSelectors: hash-like data-* values are not used', () => {
  const doc = htmlDoc('<div data-id="a1b2c3" data-kind="card">x</div>');
  assert.deepEqual(candidateSelectors(doc.querySelector('div')), ['div[data-kind="card"]', 'div']);
});

test('itemSelectorFor: adds fragments until decoys stop matching', () => {
  const doc = loadFixture('anthropic.html');
  const items = [...doc.querySelectorAll('ul[class*="PublicationList"] a')];
  assert.equal(itemSelectorFor(items[0], items), 'a[class*="PublicationList"][class*="listItem"]');
});

test('itemSelectorFor: scopes an over-matching bare tag under an ancestor', () => {
  const doc = loadFixture('tailwind.html');
  const items = [...doc.querySelectorAll('main li')];
  assert.equal(itemSelectorFor(items[0], items), 'main li');
});

test('relativeSelector: finds the clicked field inside its own item', () => {
  const doc = loadFixture('anthropic.html');
  const items = [...doc.querySelectorAll('ul[class*="PublicationList"] a')];
  const title = items[1].querySelector('span[class*="title"]');
  assert.equal(relativeSelector(title, items[1], items), 'span[class*="title"]');
});

test('relativeSelector: uses a > path when the bare target is ambiguous in the item', () => {
  const doc = loadFixture('container.html');
  const items = [...doc.querySelectorAll('article')];
  const author = items[0].querySelector('.teaser__byline a');
  assert.equal(relativeSelector(author, items[0], items), 'p.teaser__byline > a');
});

test('relativeSelector: prefers the candidate that hits the most items', () => {
  const doc = htmlDoc(`
    <div class="c"><b class="only-first">x</b><b>y</b></div>
    <div class="c"><b>y</b></div>
    <div class="c"><b>y</b></div>`);
  const items = [...doc.querySelectorAll('div.c')];
  assert.equal(relativeSelector(items[0].querySelector('b'), items[0], items), 'b');
});
