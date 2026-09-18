import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHashLike, isUtilityClass, classSignals } from '../src/selectors.js';

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
