// Click → item set: which ancestor of the clicked element is "one article",
// and which other elements on the page are its repeating siblings.
import { elementSignals } from './selectors.js';

export const MIN_ITEMS = 3;
const MAX_LEVELS = 10;
const SIGNATURE_DEPTH = 3;

function signature(el, cache) {
  if (!cache) cache = new Map();
  if (cache.has(el)) return cache.get(el);
  const sig = `${el.localName}|${elementSignals(el).map((s) => s.value).sort().join(' ')}`;
  cache.set(el, sig);
  return sig;
}

// Tag + stable classes of the element, its parent and grandparent. Hashed and
// utility classes are ignored, so cards differing only in those still match.
function signaturePath(el, cache) {
  if (!cache) cache = new Map();
  const parts = [];
  for (let n = el; n && parts.length < SIGNATURE_DEPTH; n = n.parentElement) parts.push(signature(n, cache));
  return parts.join(' < ');
}

/** Every element in el's document with the same signature path as el (el included). */
export function similarElements(el, cache) {
  if (!cache) cache = new Map();
  const sig = signaturePath(el, cache);
  return [...el.ownerDocument.querySelectorAll(el.localName)].filter((o) => signaturePath(o, cache) === sig);
}

function yieldsLink(el) {
  return el.matches('a[href]') || el.querySelector('a[href]') !== null;
}

/** levels: [{el, items}] from the clicked element up to (excluding) <body>.
 *  index: nearest level with >= MIN_ITEMS similar elements that is or contains
 *  a link (an item without a URL can't become a feed entry); -1 if none. */
export function generalize(clicked) {
  const levels = [];
  const body = clicked.ownerDocument.body;
  const cache = new Map();
  for (let el = clicked; el && el !== body && levels.length < MAX_LEVELS; el = el.parentElement) {
    levels.push({ el, items: similarElements(el, cache) });
  }
  const index = levels.findIndex((l) => l.items.length >= MIN_ITEMS && yieldsLink(l.el));
  return { levels, index };
}

/** The item that is or contains `node`, or null. */
export function itemContaining(items, node) {
  return items.find((it) => it === node || it.contains(node)) ?? null;
}
