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

/** [{url, title, category, date_text}] for every item, like the scraper.
 *  date_text is the raw string the scraper would hand to parse_date. */
export function extractPreview(root, config) {
  const rows = [];
  for (const el of root.querySelectorAll(config.item_selector)) {
    const linkEl = config.link_selector ? el.querySelector(config.link_selector) : el;
    const href = linkEl ? linkEl.getAttribute('href') : null;
    if (!href) continue;

    let title = fieldText(el, config.title_selector);
    if (!title) title = getText(el, ' ');
    title = title ? title.replaceAll(' ', ' ').trim() : null;

    let dateText = null;
    if (config.date_selector) {
      const d = el.querySelector(config.date_selector);
      if (d) dateText = d.getAttribute('datetime') || getText(d, '');
    }

    rows.push({
      url: new URL(href, config.base_url).href,
      title,
      category: fieldText(el, config.category_selector),
      date_text: dateText,
    });
  }
  return rows;
}

/** {items, <field>_selector: number of items where that selector hits}. */
export function selectorCounts(root, config) {
  const items = [...root.querySelectorAll(config.item_selector)];
  const counts = { items: items.length };
  for (const key of ['link_selector', 'title_selector', 'date_selector', 'category_selector']) {
    if (config[key]) counts[key] = items.filter((it) => it.querySelector(config[key])).length;
  }
  return counts;
}

/** 'ok', or 'js-rendered' when the raw HTML has none / under half the items. */
export function rawCheckVerdict(renderedCount, rawCount) {
  return rawCount === 0 || rawCount < renderedCount / 2 ? 'js-rendered' : 'ok';
}
