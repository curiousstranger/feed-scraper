// Shared with tests/test_bookmarklet_parity.py: the scraper must extract the
// same items from each fixture using the selectors this tool generates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generalize, itemContaining } from '../src/generalize.js';
import { itemSelectorFor, relativeSelector } from '../src/selectors.js';
import { extractPreview } from '../src/extract.js';
import { loadCases, loadFixture } from './helpers.js';

function generateSelectors(doc, clicks) {
  const { levels, index } = generalize(doc.querySelector(clicks.item));
  const { el, items } = levels[index];
  const selectors = { item_selector: itemSelectorFor(el, items) };
  if (!el.matches('a[href]')) {
    selectors.link_selector = relativeSelector(el.querySelector('a[href]'), el, items);
  }
  for (const field of ['title', 'date', 'category']) {
    if (!clicks[field]) continue;
    const target = doc.querySelector(clicks[field]);
    selectors[`${field}_selector`] = relativeSelector(target, itemContaining(items, target), items);
  }
  return selectors;
}

for (const c of loadCases()) {
  test(`parity: ${c.fixture}`, () => {
    const doc = loadFixture(c.fixture);
    const selectors = generateSelectors(doc, c.clicks);
    assert.deepEqual(selectors, c.expected_selectors);
    assert.deepEqual(extractPreview(doc, { base_url: c.base_url, ...selectors }), c.expected_items);
  });
}
