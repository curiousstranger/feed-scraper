import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoFromRemote, bookmarkletHref, installPage } from '../build.mjs';

test('repoFromRemote handles https and ssh GitHub remotes', () => {
  assert.equal(repoFromRemote('https://github.com/curiousstranger/feed-scraper.git\n'), 'curiousstranger/feed-scraper');
  assert.equal(repoFromRemote('https://github.com/curiousstranger/feed-scraper'), 'curiousstranger/feed-scraper');
  assert.equal(repoFromRemote('git@github.com:curiousstranger/feed-scraper.git'), 'curiousstranger/feed-scraper');
  assert.equal(repoFromRemote('https://gitlab.com/a/b.git'), null);
});

test('bookmarkletHref encodes the code into a javascript: URL', () => {
  assert.equal(bookmarkletHref('(()=>{alert("a b")})();\n'), 'javascript:(()%3D%3E%7Balert(%22a%20b%22)%7D)()%3B');
});

test('installPage embeds the href HTML-escaped in a draggable link', () => {
  const page = installPage('javascript:a&b"c');
  assert.match(page, /<a href="javascript:a&amp;b&quot;c">Feed selector picker<\/a>/);
});
