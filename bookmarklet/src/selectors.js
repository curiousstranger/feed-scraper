// Selector generation: DOM element in, CSS selector string out.
//
// Only emits syntax that behaves identically in browser querySelector and in
// BeautifulSoup/soupsieve (which the scraper uses): type, .class, [attr="v"],
// [attr*="v"], the descendant combinator and ">". Never :nth-child etc.

const CSS_IN_JS = /^(css|sc|jsx|emotion|svelte|astro)-/;
const NOISE = new Set(['module', 'modules', 'scss', 'sass', 'less', 'css', 'style', 'styles']);
const UTILITY_WORDS = new Set([
  'flex', 'grid', 'block', 'inline', 'hidden', 'relative', 'absolute', 'fixed', 'sticky',
  'group', 'peer', 'container', 'truncate', 'underline', 'uppercase', 'lowercase', 'capitalize',
]);
const UTILITY_PREFIX =
  /^-?(m[trblxy]?|p[trblxy]?|text|bg|gap|space|items|justify|rounded|border|shadow|font|leading|tracking|col|row|min|max|overflow|z|opacity|transition|duration|ease|top|left|right|bottom|inset|order|basis|grow|shrink|self|content|place|line-clamp|aspect|object|cursor|select|pointer|flex|grid|inline)-/;
// w-/h- only when followed by a Tailwind-style size, so microformats' h-entry survives.
const UTILITY_SIZE = /^[wh]-(\d|full|screen|auto|px|fit|min|max)/;
const IDENT = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;

/** 5–8 alphanumerics that look machine-generated: letters mixed with digits,
 *  or mixed case that isn't a camelCase/PascalCase word (KxYrHG, a1b2c3). */
export function isHashLike(segment) {
  if (segment.length < 5 || segment.length > 8 || !/^[A-Za-z0-9]+$/.test(segment)) return false;
  if (/\d/.test(segment) && /[A-Za-z]/.test(segment)) return true;
  if (/[a-z]/.test(segment) && /[A-Z]/.test(segment)) {
    return !/^[A-Za-z][a-z]+(?:[A-Z][a-z]+)*$/.test(segment);
  }
  return false;
}

export function isUtilityClass(cls) {
  return /[:/[]/.test(cls) || UTILITY_WORDS.has(cls) || UTILITY_PREFIX.test(cls) || UTILITY_SIZE.test(cls);
}

/** What one class name contributes to a selector: [] (unusable), one verbatim
 *  `.class`, or `[class*="segment"]` fragments for classes carrying a hash. */
export function classSignals(cls) {
  if (isUtilityClass(cls) || CSS_IN_JS.test(cls)) return [];
  const segments = cls.split(/[_-]+/).filter(Boolean);
  if (!segments.some(isHashLike)) {
    return IDENT.test(cls) ? [{ value: cls, selector: `.${cls}` }] : [];
  }
  return segments
    .filter((s) => /^[A-Za-z0-9]{3,}$/.test(s) && !isHashLike(s) && !NOISE.has(s.toLowerCase()))
    .map((s) => ({ value: s, selector: `[class*="${s}"]` }));
}

const SEMANTIC = new Set(['article', 'time', 'h1', 'h2', 'h3', 'h4', 'li']);
const SAFE_ATTR_VALUE = /^[A-Za-z0-9 _.:/-]{1,40}$/;
const MAX_SIGNALS = 6;
const MAX_PATH_STEPS = 3;

/** All class signals of an element, most specific first. Within a class the
 *  last segment (listItem in PublicationList-…__listItem) names the element,
 *  so it ranks first; `pos` preserves source order for rendering. */
export function elementSignals(el) {
  const signals = [];
  const seen = new Set();
  [...el.classList].forEach((cls, c) => {
    const sigs = classSignals(cls);
    sigs.forEach((s, i) => {
      if (seen.has(s.value)) return;
      seen.add(s.value);
      signals.push({ ...s, pos: c * 100 + i, rank: c * 100 + (sigs.length - 1 - i) });
    });
  });
  return signals.sort((a, b) => a.rank - b.rank).slice(0, MAX_SIGNALS);
}

function combinations(arr, k, start = 0) {
  if (k === 0) return [[]];
  const out = [];
  for (let i = start; i <= arr.length - k; i++) {
    for (const rest of combinations(arr, k - 1, i + 1)) out.push([arr[i], ...rest]);
  }
  return out;
}

function attributeSelectors(el) {
  const tag = el.localName;
  const out = [];
  for (const { name, value } of el.attributes) {
    const stable = name === 'itemprop' || name === 'role' || name.startsWith('data-');
    if (!stable || !/^[a-z][a-z0-9-]*$/.test(name)) continue;
    if (!SAFE_ATTR_VALUE.test(value) || value.split(/[^A-Za-z0-9]+/).some(isHashLike)) continue;
    out.push(`${tag}[${name}="${value}"]`);
  }
  const isTestId = (s) => s.includes('[data-testid=');
  return out.sort((a, b) => isTestId(b) - isTestId(a));
}

/** Single-step selectors for `el`, in preference order:
 *  tag + class signals (fewest first), semantic tag, stable attribute, bare tag. */
export function candidateSelectors(el) {
  const tag = el.localName;
  const signals = elementSignals(el);
  const out = [];
  for (let k = 1; k <= Math.min(3, signals.length); k++) {
    for (const combo of combinations(signals, k)) {
      out.push(tag + [...combo].sort((a, b) => a.pos - b.pos).map((s) => s.selector).join(''));
    }
  }
  if (SEMANTIC.has(tag)) out.push(tag);
  out.push(...attributeSelectors(el));
  out.push(tag);
  return [...new Set(out)];
}

/** `parent > target` and `grandparent > parent > target` paths, never
 *  climbing to `stopAt` (the item, for relative selectors) or <body>. */
function pathSelectors(target, stopAt) {
  const steps = [];
  const body = target.ownerDocument.body;
  for (let n = target; n && n !== stopAt && n !== body && steps.length < MAX_PATH_STEPS; n = n.parentElement) {
    steps.unshift(candidateSelectors(n).slice(0, 4));
  }
  const out = [];
  for (let len = 2; len <= steps.length; len++) {
    let paths = [[]];
    for (const options of steps.slice(steps.length - len)) {
      paths = paths.flatMap((p) => options.map((o) => [...p, o]));
    }
    out.push(...paths.map((p) => p.join(' > ')));
  }
  return out;
}

function sameSet(nodeList, wanted) {
  return nodeList.length === wanted.size && [...nodeList].every((n) => wanted.has(n));
}

/** A selector matching exactly `items` in el's document (el is one of them).
 *  Falls back to el's first candidate (which over-matches) if none is exact. */
export function itemSelectorFor(el, items) {
  const doc = el.ownerDocument;
  const wanted = new Set(items);
  const exact = (sel) => sameSet(doc.querySelectorAll(sel), wanted);
  const own = candidateSelectors(el);
  for (const sel of own) if (exact(sel)) return sel;
  // Over-matches: scope it under one ancestor, nearest first.
  for (let a = el.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
    for (const sel of own) {
      for (const prefix of candidateSelectors(a)) {
        if (exact(`${prefix} ${sel}`)) return `${prefix} ${sel}`;
      }
    }
  }
  for (const sel of pathSelectors(el, null)) if (exact(sel)) return sel;
  return own[0];
}

/** A selector, evaluated as item.querySelector(sel), that finds `target` in its
 *  own item; among those, the one that finds something in the most items. */
export function relativeSelector(target, item, items) {
  let best = null;
  let bestHits = -1;
  for (const sel of [...candidateSelectors(target), ...pathSelectors(target, item)]) {
    if (item.querySelector(sel) !== target) continue;
    const hits = items.filter((it) => it.querySelector(sel)).length;
    if (hits > bestHits) {
      best = sel;
      bestHits = hits;
    }
  }
  return best;
}
