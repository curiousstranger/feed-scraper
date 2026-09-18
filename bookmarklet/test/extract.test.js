import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getText, extractPreview, selectorCounts, rawCheckVerdict } from '../src/extract.js';
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
