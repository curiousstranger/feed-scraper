// Shared with tests/test_bookmarklet_parity.py: the scraper must extract the
// same items from each fixture using the selectors this tool generates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

for (const c of loadCases()) {
  test(`parity: ${c.fixture}`, () => {
    const doc = loadFixture(c.fixture);
    const selectors = generateSelectors(doc, c.clicks);
    assert.deepEqual(selectors, c.expected_selectors);
    assert.deepEqual(extractPreview(doc, { base_url: c.base_url, ...selectors }), c.expected_items);
  });
}
