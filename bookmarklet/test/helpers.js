import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** A jsdom document for test/fixtures/<name>. */
export function loadFixture(name, url = 'https://example.com/') {
  return new JSDOM(readFileSync(new URL(name, FIXTURES), 'utf8'), { url }).window.document;
}

/** A jsdom document from an HTML string. */
export function htmlDoc(html, url = 'https://example.com/') {
  return new JSDOM(html, { url }).window.document;
}

export function loadCases() {
  return JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
}
