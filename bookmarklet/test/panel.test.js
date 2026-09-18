import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createPicker } from '../src/panel.js';
import { toggle } from '../src/main.js';

const BLOG = readFileSync(new URL('./fixtures/blog.html', import.meta.url), 'utf8');

function setup(options = {}, url = 'https://blog.example.com/posts#top') {
  const { window } = new JSDOM(BLOG, { url });
  const doc = window.document;
  const picker = createPicker(doc, { repo: 'o/r', today: '2026-09-18', ...options });
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const button = (action) => picker.root.querySelector(`[data-action="${action}"]`);
  return { window, doc, picker, click, button };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('mounts in a shadow root with metadata defaults from the page', () => {
  const { doc, picker } = setup();
  assert.ok(doc.querySelector('[data-feed-scraper-picker]').shadowRoot);
  assert.deepEqual(picker.state.meta, {
    id: 'blog-example-posts',
    name: 'My Blog',
    description: 'Unofficial RSS feed scraped from https://blog.example.com/posts',
    listing_url: 'https://blog.example.com/posts',
    base_url: 'https://blog.example.com',
  });
});

test('page clicks are intercepted so links do not navigate', () => {
  const { doc, click } = setup();
  const link = doc.querySelector('.post-card a');
  let reachedPage = false;
  link.addEventListener('click', () => (reachedPage = true));
  const notCancelled = click(link);
  assert.equal(notCancelled, false); // preventDefault was called
  assert.equal(reachedPage, false); // stopPropagation in the capture phase
});

test('picking an item generalizes, auto-sets the link, and arms title', () => {
  const { doc, picker, click } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  assert.equal(picker.state.itemSelector, 'div.post-card');
  assert.equal(picker.state.selectors.link, 'a');
  assert.equal(picker.state.armed, 'title');
  assert.equal(picker.root.querySelector('.count').textContent, '3');
  assert.equal(doc.querySelector('.post-card').style.outline, '2px solid #e8590c');
});

test('link row has only a Pick button, no Skip or Clear', () => {
  const { doc, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  assert.equal(button('clear:link'), null);
  button('arm:link').click();
  assert.equal(button('skip'), null);
  assert.ok(button('arm:link'));
});

test('↑ widens and ↓ narrows the item level', () => {
  const { doc, picker, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  button('up').click();
  assert.equal(picker.state.itemSelector, 'main.posts');
  button('down').click();
  assert.equal(picker.state.itemSelector, 'div.post-card');
});

test('full flow fills the preview and YAML; unpicked fields are omitted', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => BLOG });
  const { doc, picker, click, button } = setup({ fetchImpl });
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelectorAll('.post-card__title')[1]);
  click(doc.querySelector('time'));
  button('skip').click(); // no category
  await settle();

  const cells = [...picker.root.querySelectorAll('.preview tr:nth-child(2) td')].map((td) => td.textContent);
  assert.deepEqual(cells, ['First post', '2026-09-01', '', 'https://blog.example.com/2026/09/first-post/']);
  const yaml = picker.root.querySelector('.yaml').textContent;
  assert.match(yaml, /^item_selector: 'div\.post-card'$/m);
  assert.match(yaml, /^link_selector: 'a'$/m);
  assert.match(yaml, /^title_selector: 'h2\.post-card__title'$/m);
  assert.match(yaml, /^date_selector: 'time'$/m);
  assert.doesNotMatch(yaml, /category_selector/);
  assert.match(picker.root.querySelector('.check').textContent, /rendered: 3 · raw HTML: 3 ✓/);
});

test('editing metadata updates the YAML', () => {
  const { window, doc, picker, click } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  const input = picker.root.querySelector('[data-meta="id"]');
  input.value = 'my-blog';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match(picker.root.querySelector('.yaml').textContent, /^id: my-blog$/m);
});

test('raw check warns when the raw HTML has no items', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => '<html><body><div id="app"></div></body></html>' });
  const { doc, picker, click, button } = setup({ fetchImpl });
  click(doc.querySelector('.post-card__excerpt'));
  button('check').click();
  await settle();
  const text = picker.root.querySelector('.check').textContent;
  assert.match(text, /raw HTML: 0/);
  assert.match(text, /JavaScript-rendered/);
});

test('raw check reports when the fetch is blocked', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const { doc, picker, click, button } = setup({ fetchImpl });
  click(doc.querySelector('.post-card__excerpt'));
  button('check').click();
  await settle();
  assert.match(picker.root.querySelector('.check').textContent, /Couldn't verify.*scraper\.run blog-example-posts/);
});

test('Copy YAML uses the clipboard, falling back to a selected textarea', async () => {
  let copied = null;
  const ok = setup({ clipboard: { writeText: async (t) => (copied = t) } });
  ok.click(ok.doc.querySelector('.post-card__excerpt'));
  ok.button('copy').click();
  await settle();
  assert.match(copied, /^item_selector: 'div\.post-card'$/m);

  const refused = setup({ clipboard: { writeText: async () => Promise.reject(new Error('denied')) } });
  refused.click(refused.doc.querySelector('.post-card__excerpt'));
  refused.button('copy').click();
  await settle();
  const textarea = refused.picker.root.querySelector('textarea');
  assert.equal(textarea.hidden, false);
  assert.match(textarea.value, /^item_selector: /m);
  assert.match(refused.picker.root.querySelector('.note').textContent, /press ⌘C/);
});

test('Open in GitHub is disabled when the URL would be too long', () => {
  const { window, doc, picker, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  assert.equal(button('github').disabled, false);
  const input = picker.root.querySelector('[data-meta="description"]');
  input.value = 'x'.repeat(9000);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(button('github').disabled, true);
  assert.match(picker.root.querySelector('.note').textContent, /use Copy instead/);
});

test('Esc removes the panel, listeners and highlights', () => {
  const { window, doc, click } = setup();
  const card = doc.querySelector('.post-card');
  click(doc.querySelector('.post-card__excerpt'));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.querySelector('[data-feed-scraper-picker]'), null);
  assert.equal(card.style.outline, '');
  assert.equal(click(doc.querySelector('.post-card a')), true); // no longer intercepted
});

test('↑ clears a stale raw-HTML verdict and re-arms title (Bug A)', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => BLOG });
  const { doc, picker, click, button } = setup({ fetchImpl });
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelectorAll('.post-card__title')[1]);
  click(doc.querySelector('time'));
  button('skip').click(); // no category -> triggers the raw check
  await settle();
  assert.match(picker.root.querySelector('.check').textContent, /raw HTML: 3/);

  button('up').click();

  const checkText = picker.root.querySelector('.check').textContent;
  assert.doesNotMatch(checkText, /✓/);
  assert.doesNotMatch(checkText, /raw HTML: 3/);
  assert.equal(picker.state.armed, 'title');
  assert.equal(picker.state.rawCheck, null);
});

test('a raw-HTML check still in flight does not overwrite state after the level changes (Bug A race)', async () => {
  let resolveFetch;
  const fetchImpl = () => new Promise((resolve) => (resolveFetch = resolve));
  const { doc, picker, click, button } = setup({ fetchImpl });
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelectorAll('.post-card__title')[1]);
  click(doc.querySelector('time'));
  button('skip').click(); // starts the check; fetch is still pending

  button('up').click(); // level changes while the fetch is in flight

  resolveFetch({ ok: true, text: async () => BLOG });
  await settle();

  assert.equal(picker.state.rawCheck, null);
});

test('overriding the link mid-flow arms the next unpicked field, not Done (Bug B)', () => {
  const { doc, picker, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  button('arm:link').click();
  const linkInAnotherItem = doc.querySelectorAll('.post-card')[1].querySelector('a');
  click(linkInAnotherItem);

  assert.equal(picker.state.armed, 'title');
  assert.equal(picker.state.rawCheck, null); // no raw check started
});

test('metadata edits re-render the whole panel, keeping the preview in sync (Bug C)', () => {
  const { window, doc, picker, click } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelectorAll('.post-card__title')[1]);
  const input = picker.root.querySelector('[data-meta="base_url"]');
  input.value = 'https://other.example';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  const urlCell = picker.root.querySelector('.preview tr:nth-child(2) td:nth-child(4)');
  assert.match(urlCell.textContent, /^https:\/\/other\.example\//);
});

test('toggle: second invocation closes the tool', () => {
  const { window } = new JSDOM(BLOG, { url: 'https://blog.example.com/' });
  assert.ok(toggle(window, { today: '2026-09-18' }));
  assert.ok(window.document.querySelector('[data-feed-scraper-picker]'));
  assert.equal(toggle(window), null);
  assert.equal(window.document.querySelector('[data-feed-scraper-picker]'), null);
  assert.ok(toggle(window, { today: '2026-09-18' })); // can reopen
});

// --- plain-language guidance: generic, step-by-step, no site-specific wording ---

const statusText = (picker) => picker.root.querySelector('.status').textContent;

test('guidance walks through numbered steps in plain words, each field saying what to do if it is missing', () => {
  const { doc, picker, click, button } = setup();
  assert.match(statusText(picker), /Step 1.*main list of articles/s);
  assert.match(statusText(picker), /not a menu, sidebar or "featured" box/);

  click(doc.querySelector('.post-card__excerpt'));
  assert.match(statusText(picker), /Step 2.*headline.*orange box.*No headline\? Click Skip/s);
  assert.match(statusText(picker), /Each orange box should hold exactly one article/);

  button('skip').click();
  assert.match(statusText(picker), /Step 3.*date.*published.*No date\? Click Skip/s);

  button('skip').click();
  assert.match(statusText(picker), /Step 4.*topic or section label.*No label\? Click Skip/s);

  button('skip').click();
  assert.match(statusText(picker), /Done.*table below.*Copy YAML/s);
});

test('clicking outside the orange boxes says so in plain words', () => {
  const { doc, picker, click } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelector('footer a'));
  assert.match(statusText(picker), /outside the orange boxes/);
});

test('each picked part shows the value it found on this page; skipped parts say Skipped', () => {
  const { doc, picker, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelectorAll('.post-card__title')[1]);
  const example = (f) => picker.root.querySelector(`[data-example="${f}"]`)?.textContent;
  assert.equal(example('title'), '“First post”');
  assert.equal(example('link'), '“https://blog.example.com/2026/09/first-post/”');
  button('skip').click(); // date
  assert.equal(example('date'), 'Skipped');
});

test('field rows use plain labels', () => {
  const { doc, picker, click } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  const labels = [...picker.root.querySelectorAll('.fields .row > span:first-child')].map((s) => s.textContent);
  assert.deepEqual(labels, ['article link', 'headline', 'date', 'topic/section']);
});

// --- getting the panel out of the way ---

test('Minimise shrinks the panel to its header and current instruction; picking still works', () => {
  const { doc, picker, click, button } = setup();
  const panel = picker.root.querySelector('.panel');
  button('collapse').click();
  assert.ok(panel.classList.contains('collapsed'));
  assert.equal(button('collapse').textContent, '+');
  assert.equal(button('collapse').title, 'Expand');

  click(doc.querySelector('.post-card__excerpt')); // picking while minimised
  assert.equal(picker.state.itemSelector, 'div.post-card');
  assert.ok(panel.classList.contains('collapsed')); // re-rendering keeps it minimised
  assert.match(picker.root.querySelector('.status .prompt').textContent, /Step 2/);

  button('collapse').click();
  assert.ok(!panel.classList.contains('collapsed'));
  assert.equal(button('collapse').textContent, '–');
});

test('minimised styling hides everything but the header and the current instruction', () => {
  const { picker } = setup();
  const css = picker.root.querySelector('style').textContent;
  assert.match(css, /\.collapsed section:not\(\.status\)\s*\{\s*display:\s*none/);
  assert.match(css, /\.collapsed \.status > :not\(\.prompt\):not\(\.message\)\s*\{\s*display:\s*none/);
});

test('Move to other side flips the panel between the right and left corners', () => {
  const { picker, button } = setup();
  assert.equal(picker.host.style.right, '12px');
  button('side').click();
  assert.equal(picker.host.style.left, '12px');
  assert.equal(picker.host.style.right, '');
  button('side').click();
  assert.equal(picker.host.style.right, '12px');
  assert.equal(picker.host.style.left, '');
});

test('Pick shrinks the panel while you click on the page, and it grows back after a successful pick', () => {
  const { doc, picker, click, button } = setup();
  const panel = picker.root.querySelector('.panel');
  click(doc.querySelector('.post-card__excerpt'));
  click(doc.querySelectorAll('.post-card__title')[0]);
  button('arm:title').click(); // redo the headline
  assert.ok(panel.classList.contains('collapsed'));

  click(doc.querySelector('footer a')); // outside the boxes: stays shrunk, message visible
  assert.ok(panel.classList.contains('collapsed'));
  assert.match(picker.root.querySelector('.status .message').textContent, /outside the orange boxes/);

  click(doc.querySelectorAll('.post-card__title')[2]);
  assert.ok(!panel.classList.contains('collapsed'));
  assert.equal(button('collapse').textContent, '–');
});

test('Re-pick of the item also shrinks and re-grows', () => {
  const { doc, picker, click, button } = setup();
  const panel = picker.root.querySelector('.panel');
  click(doc.querySelector('.post-card__excerpt'));
  button('arm:item').click();
  assert.ok(panel.classList.contains('collapsed'));
  click(doc.querySelectorAll('.post-card__excerpt')[1]);
  assert.ok(!panel.classList.contains('collapsed'));
});

test('a panel you minimised yourself stays minimised after a pick', () => {
  const { doc, picker, click, button } = setup();
  const panel = picker.root.querySelector('.panel');
  click(doc.querySelector('.post-card__excerpt'));
  button('collapse').click();
  button('arm:title').click();
  click(doc.querySelectorAll('.post-card__title')[0]);
  assert.ok(panel.classList.contains('collapsed'));
});

test('Skip sits in the instruction line, so it stays reachable while the panel is shrunk', () => {
  const { doc, picker, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  button('arm:date').click(); // shrinks
  const skips = picker.root.querySelectorAll('[data-action="skip"]');
  assert.equal(skips.length, 1);
  assert.ok(skips[0].closest('.status .prompt'));
  skips[0].click();
  assert.equal(picker.state.armed, 'category');
});

// --- steering away from "one box around the whole list" ---

test('the level hint says what one orange box should hold and which arrow to press', () => {
  const { doc, picker, click } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  const hint = picker.root.querySelector('.hint').textContent;
  assert.match(hint, /exactly one article/);
  assert.match(hint, /several articles\? Click ↓ narrower/);
  assert.match(hint, /only part of an article\? Click ↑ wider/);
});

test('with only one box outlined while a repeating level exists, Copy is disabled and the panel says ↓', () => {
  const { doc, picker, click, button } = setup();
  click(doc.querySelector('.post-card__excerpt'));
  button('up').click(); // main.posts: one box around the whole list
  assert.equal(button('copy').disabled, true);
  assert.equal(button('github').disabled, true);
  assert.match(picker.root.querySelector('.status .message').textContent, /whole list.*↓ narrower/);

  button('down').click();
  assert.equal(button('copy').disabled, false);
  assert.equal(button('github').disabled, false);
});

test('a page with no repeating articles can still continue with the single one (spec)', () => {
  const { window } = new JSDOM('<main><article><h1><a href="/only">Only</a></h1></article></main>', {
    url: 'https://solo.example/',
  });
  const picker = createPicker(window.document, { repo: 'o/r', today: '2026-09-18' });
  window.document.querySelector('h1').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(picker.root.querySelector('[data-action="copy"]').disabled, false);
});

function setMeta(t, key, value) {
  const input = t.picker.root.querySelector(`[data-meta="${key}"]`);
  input.value = value;
  input.dispatchEvent(new t.window.Event('input', { bubbles: true }));
}

test('an id that is not a plain slug disables Copy and Open in GitHub and says why', () => {
  const t = setup();
  t.click(t.doc.querySelector('.post-card__excerpt'));
  setMeta(t, 'id', '../evil');
  assert.equal(t.button('copy').disabled, true);
  assert.equal(t.button('github').disabled, true);
  assert.match(t.picker.root.querySelector('.note').textContent, /id must be lowercase letters, digits and hyphens/);

  setMeta(t, 'id', 'evil-blog');
  assert.equal(t.button('copy').disabled, false);
  assert.equal(t.button('github').disabled, false);
  assert.doesNotMatch(t.picker.root.querySelector('.note').textContent, /id must be/);
});

test('warns when the listing URL carries a query string, until it is edited out', () => {
  const t = setup({}, 'https://blog.example.com/posts?token=secret');
  const warning = () => t.picker.root.querySelector('.meta .warn');
  assert.equal(t.picker.state.meta.listing_url, 'https://blog.example.com/posts?token=secret');
  assert.match(warning().textContent, /query string/);
  assert.match(warning().textContent, /token/i);
  assert.equal(warning().hidden, false);

  setMeta(t, 'listing_url', 'https://blog.example.com/posts');
  assert.equal(warning().hidden, true);
});

test('no query-string warning for a plain listing URL', () => {
  const t = setup();
  assert.equal(t.picker.root.querySelector('.meta .warn').hidden, true);
});
