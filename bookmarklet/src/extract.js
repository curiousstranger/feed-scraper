// Preview extraction mirroring scraper/extract.py:_extract_items, so what the
// panel shows is what the scraper will produce.

const SKIP_TEXT_IN = new Set(['script', 'style', 'template']);

/** BeautifulSoup's el.get_text(separator, strip=True): every text node,
 *  stripped, empties dropped, joined with `separator`. */
export function getText(el, separator) {
  const parts = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = child.data.trim();
        if (text) parts.push(text);
      } else if (child.nodeType === 1 && !SKIP_TEXT_IN.has(child.localName)) {
        walk(child);
      }
    }
  };
  walk(el);
  return parts.join(separator);
}

function fieldText(el, selector) {
  if (!selector) return null;
  const found = el.querySelector(selector);
  return found ? getText(found, '') : null;
}

const FIELD_KEYS = ['link_selector', 'title_selector', 'date_selector', 'category_selector'];

/** The featured_* keys as a plain section config, like extract_items' featured_config. */
export function featuredConfig(config) {
  return {
    base_url: config.base_url,
    item_selector: config.featured_item_selector,
    link_selector: config.featured_link_selector,
    title_selector: config.featured_title_selector,
    date_selector: config.featured_date_selector,
    category_selector: config.featured_category_selector,
  };
}

/** Elements the featured section claims; the main list skips them. */
function claimedBy(root, config) {
  return config.featured_item_selector ? new Set(root.querySelectorAll(config.featured_item_selector)) : new Set();
}

function mainElements(root, config, claimed) {
  return [...root.querySelectorAll(config.item_selector)].filter((el) => !claimed.has(el));
}

/** Rows for `elements`, like scraper/extract.py:_extract_items.
 *  date_text is the raw string the scraper would hand to parse_date. */
function extractRows(elements, config) {
  const rows = [];
  for (const el of elements) {
    const linkEl = config.link_selector ? el.querySelector(config.link_selector) : el;
    const href = linkEl ? linkEl.getAttribute('href') : null;
    if (!href) continue;

    let title = fieldText(el, config.title_selector);
    if (!title) title = getText(el, ' ');
    title = title ? title.replaceAll('\u00A0', ' ').trim() : null;

    let dateText = null;
    if (config.date_selector) {
      const d = el.querySelector(config.date_selector);
      if (d) dateText = d.getAttribute('datetime') || getText(d, '');
    }

    let url = href;
    try {
      url = new URL(href, config.base_url).href;
    } catch {
      // Invalid base_url or href; fall back to raw href
    }

    rows.push({
      url,
      title,
      category: fieldText(el, config.category_selector),
      date_text: dateText,
    });
  }
  return rows;
}

/** {main, featured} rows. Main-list matches that featured_item_selector also
 *  matches are skipped (the featured section claims them), as in
 *  scraper/extract.py:extract_items. featured is before URL de-duplication. */
export function extractSections(root, config) {
  const claimed = claimedBy(root, config);
  return {
    main: extractRows(mainElements(root, config, claimed), config),
    featured: config.featured_item_selector ? extractRows([...claimed], featuredConfig(config)) : [],
  };
}

/** The featured rows the scraper keeps: URL not already seen (main list or an
 *  earlier featured row). */
export function keptFeatured(main, featured) {
  const seen = new Set(main.map((r) => r.url));
  const kept = [];
  for (const row of featured) {
    if (seen.has(row.url)) continue;
    seen.add(row.url);
    kept.push(row);
  }
  return kept;
}

/** [{url, title, category, date_text}] in extract_items order: main rows, then
 *  the featured rows it keeps. */
export function extractPreview(root, config) {
  const { main, featured } = extractSections(root, config);
  return [...main, ...keptFeatured(main, featured)];
}

function fieldCounts(items, config) {
  const counts = { items: items.length };
  for (const key of FIELD_KEYS) {
    if (config[key]) counts[key] = items.filter((it) => it.querySelector(config[key])).length;
  }
  return counts;
}

/** {items, <field>_selector: number of items where that selector hits}, main
 *  list minus claimed elements; plus featured: {...} when there is a featured section. */
export function selectorCounts(root, config) {
  const claimed = claimedBy(root, config);
  const counts = fieldCounts(mainElements(root, config, claimed), config);
  if (config.featured_item_selector) counts.featured = fieldCounts([...claimed], featuredConfig(config));
  return counts;
}

/** 'ok', or 'js-rendered' when the raw HTML has none / under half the items. */
export function rawCheckVerdict(renderedCount, rawCount) {
  return rawCount === 0 || rawCount < renderedCount / 2 ? 'js-rendered' : 'ok';
}
