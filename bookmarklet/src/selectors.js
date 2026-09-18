// Selector generation: DOM element in, CSS selector string out.
//
// Only emits syntax that behaves identically in browser querySelector and in
// BeautifulSoup/soupsieve (which the scraper uses): type, .class, [attr="v"],
// [attr*="v"], the descendant combinator and ">". Never :nth-child etc.

const CSS_IN_JS = /^(css|sc|jsx|emotion|svelte)-/;
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
