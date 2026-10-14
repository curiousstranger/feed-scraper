import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getText, extractPreview, extractSections, keptFeatured, selectorCounts, rawCheckVerdict } from '../src/extract.js';
import { htmlDoc, loadFixture } from './helpers.js';

test('getText mirrors BeautifulSoup get_text(sep, strip=True)', () => {
  const doc = htmlDoc('<p>  Hello <b> big </b>\n world <script>x()</script></p>');
  const p = doc.querySelector('p');
  assert.equal(getText(p, ''), 'Hellobigworld');
  assert.equal(getText(p, ' '), 'Hello big world');
});

test('extractPreview: item is the link; fields relative to it', () => {
  const doc = loadFixture('anthropic.html');
  const rows = extractPreview(doc, {
    base_url: 'https://www.anthropic.com',
    item_selector: 'a[class*="PublicationList"][class*="listItem"]',
    title_selector: 'span[class*="title"]',
    date_selector: 'time',
  });
  assert.deepEqual(rows[0], {
    url: 'https://www.anthropic.com/news/claude-5',
    title: 'Introducing Claude 5', // &nbsp; normalized like the scraper
    category: null,
    date_text: '2026-09-15T00:00:00Z',
  });
});

test('extractPreview: link_selector finds the URL inside a container', () => {
  const doc = loadFixture('container.html');
  const rows = extractPreview(doc, {
    base_url: 'https://news.example.org',
    item_selector: 'article.teaser',
    link_selector: 'a.teaser__link',
  });
  assert.deepEqual(rows.map((r) => r.url), [
    'https://news.example.org/stories/alpha',
    'https://news.example.org/stories/beta',
    'https://news.example.org/stories/gamma',
  ]);
  // No title_selector → whole item text, joined with spaces.
  assert.equal(rows[0].title, 'Policy Alpha story By Ann · 3 Sep 2026');
});

test('extractPreview: items without a link are skipped; missing fields stay blank', () => {
  const doc = htmlDoc(`
    <div class="c"><a href="/a">A</a><i>cat</i></div>
    <div class="c"><span>no link</span></div>
    <div class="c"><a>no href</a></div>
    <div class="c"><a href="/d">D</a></div>`);
  const rows = extractPreview(doc, {
    base_url: 'https://x.test',
    item_selector: 'div.c',
    link_selector: 'a',
    category_selector: 'i',
  });
  assert.deepEqual(rows, [
    { url: 'https://x.test/a', title: 'A cat', category: 'cat', date_text: null },
    { url: 'https://x.test/d', title: 'D', category: null, date_text: null },
  ]);
});

test('extractPreview: date falls back to text when there is no datetime attribute', () => {
  const doc = loadFixture('container.html');
  const rows = extractPreview(doc, {
    base_url: 'https://news.example.org',
    item_selector: 'article.teaser',
    link_selector: 'a.teaser__link',
    date_selector: 'span.teaser__date',
  });
  assert.equal(rows[0].date_text, '3 Sep 2026');
});

test('selectorCounts counts items and per-field hits', () => {
  const doc = loadFixture('blog.html');
  assert.deepEqual(
    selectorCounts(doc, { item_selector: 'div.post-card', link_selector: 'a', category_selector: 'span.post-card__tag' }),
    { items: 3, link_selector: 3, category_selector: 2 },
  );
});

test('rawCheckVerdict flags missing or much lower raw counts', () => {
  assert.equal(rawCheckVerdict(12, 12), 'ok');
  assert.equal(rawCheckVerdict(12, 7), 'ok');
  assert.equal(rawCheckVerdict(12, 5), 'js-rendered');
  assert.equal(rawCheckVerdict(12, 0), 'js-rendered');
});

test('extractPreview: invalid base_url falls back to raw href', () => {
  const doc = htmlDoc('<div class="c"><a href="/a">A</a></div>');
  const rows = extractPreview(doc, {
    base_url: 'not a url',
    item_selector: 'div.c',
    link_selector: 'a',
  });
  assert.deepEqual(rows, [
    { url: '/a', title: 'A', category: null, date_text: null },
  ]);
});

const HERO_LIST = `
  <div class="list">
    <article class="card featured"><a class="card-link" href="/posts/hero"><h2>Hero post</h2><span class="kicker">Essays</span><p>Summary</p></a></article>
    <div>
      <article class="card"><a class="card-link" href="/posts/one"><h3>Post one</h3><time datetime="2026-09-03">Sep 3</time></a></article>
      <article class="card"><a class="card-link" href="/posts/two"><h3>Post two</h3><time datetime="2026-08-20">Aug 20</time></a></article>
    </div>
  </div>`;
const HERO_CFG = {
  base_url: 'https://x.test',
  item_selector: 'a.card-link',
  title_selector: 'h3',
  date_selector: 'time',
  featured_item_selector: 'article.featured a.card-link',
  featured_title_selector: 'h2',
  featured_category_selector: 'span.kicker',
};
const HERO_ROW = { url: 'https://x.test/posts/hero', title: 'Hero post', category: 'Essays', date_text: null };
const ONE = { url: 'https://x.test/posts/one', title: 'Post one', category: null, date_text: '2026-09-03' };
const TWO = { url: 'https://x.test/posts/two', title: 'Post two', category: null, date_text: '2026-08-20' };

test('extractSections: the featured section claims elements the main selector also matches', () => {
  assert.deepEqual(extractSections(htmlDoc(HERO_LIST), HERO_CFG), { main: [ONE, TWO], featured: [HERO_ROW] });
});

test('extractSections: no featured_item_selector → no featured rows, nothing claimed', () => {
  const { featured_item_selector, ...cfg } = HERO_CFG;
  const { main, featured } = extractSections(htmlDoc(HERO_LIST), cfg);
  assert.equal(main.length, 3);
  assert.deepEqual(featured, []);
});

test('extractPreview: main rows, then kept featured rows (extract_items order)', () => {
  assert.deepEqual(extractPreview(htmlDoc(HERO_LIST), HERO_CFG), [ONE, TWO, HERO_ROW]);
});

test('extractSections: featured_link_selector finds the URL inside a featured container', () => {
  const doc = htmlDoc(`
    <section class="hero"><span class="kicker">News</span><h2><a href="/posts/hero">Hero</a></h2></section>
    <a class="row" href="/posts/one">Post one</a>`);
  const { featured } = extractSections(doc, {
    base_url: 'https://x.test',
    item_selector: 'a.row',
    featured_item_selector: 'section.hero',
    featured_link_selector: 'a',
    featured_title_selector: 'h2',
  });
  assert.deepEqual(featured, [{ url: 'https://x.test/posts/hero', title: 'Hero', category: null, date_text: null }]);
});

test('same URL in both sections: main wins; featured duplicates collapse', () => {
  const doc = htmlDoc(`
    <div class="hero"><a class="f" href="/posts/same"><h2>Hero title</h2></a><a class="f" href="/posts/other"><h2>Other</h2></a><a class="f" href="/posts/other"><h2>Other again</h2></a></div>
    <a class="row" href="/posts/same"><h3>Row title</h3></a>`);
  const cfg = {
    base_url: 'https://x.test',
    item_selector: 'a.row',
    title_selector: 'h3',
    featured_item_selector: 'div.hero a.f',
    featured_title_selector: 'h2',
  };
  const { main, featured } = extractSections(doc, cfg);
  assert.deepEqual(keptFeatured(main, featured).map((r) => r.title), ['Other']);
  assert.deepEqual(extractPreview(doc, cfg).map((r) => r.title), ['Row title', 'Other']);
});

test('selectorCounts: main counts exclude claimed elements; featured counted separately', () => {
  assert.deepEqual(selectorCounts(htmlDoc(HERO_LIST), HERO_CFG), {
    items: 2,
    title_selector: 2,
    date_selector: 2,
    featured: { items: 1, title_selector: 1, category_selector: 1 },
  });
});
