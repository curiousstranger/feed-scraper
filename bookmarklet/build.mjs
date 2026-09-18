// Bundle src/ into a self-contained javascript: URL and write the install page
// docs/bookmarklet.html. The output is committed; CI rebuilds it and fails on drift.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'docs', 'bookmarklet.html');
const ENTRY = `import { toggle } from './src/main.js';\ntoggle(window, { repo: __GITHUB_REPO__ });\n`;

/** "owner/repo" from an https or ssh GitHub remote URL, else null. */
export function repoFromRemote(remoteUrl) {
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return m ? m[1] : null;
}

export function bookmarkletHref(code) {
  return `javascript:${encodeURIComponent(code.trim())}`;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function installPage(href) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Feed selector picker</title></head>
<body>
<h1>Feed selector picker</h1>
<p>Drag this link to your bookmarks bar:
  <a href="${escapeHtml(href)}">Feed selector picker</a></p>
<ol>
  <li>Open the page on the site that lists its articles (newest first). Run <code>check_feed.py</code>
    on it first: if the site already has a feed, you don't need this.</li>
  <li>Click the bookmark. A panel opens in the top-right corner.</li>
  <li><b>Click one article in the page's main list of articles</b> — not a menu, sidebar or
    "featured" box. An orange box appears around every article it found. If the boxes miss some
    articles or cover the wrong things, click ↑ wider / ↓ narrower, or Re-pick.</li>
  <li>The panel then asks for each part of an article in turn. Click it inside <i>any</i> orange box:
    <ul>
      <li><b>headline</b> — the article's title</li>
      <li><b>date</b> — when it was published</li>
      <li><b>topic/section</b> — a short label saying what kind of article it is</li>
    </ul>
    If the site doesn't show one of these, click <b>Skip</b>. That's fine: the scraper gets
    missing headlines and dates from each article's own page.</li>
  <li>Check the table in the panel shows the right headlines, dates and links. Next to each part the
    panel shows what it found in the first article, so a wrong click is easy to spot (click Pick to redo it).</li>
  <li>Adjust the id/name if you like, then <b>Copy YAML</b> and save it as
    <code>sites/&lt;id&gt;.yaml</code> (or use <b>Open in GitHub</b>).</li>
  <li>Test it: <code>uv run python -m scraper.run &lt;id&gt;</code></li>
</ol>
<p>Panel in the way? Click <b>–</b> to minimise it (it keeps showing the current step), or
<b>⇆</b> to move it to the other side of the window.</p>
<p>Esc, ✕ or clicking the bookmark again closes the tool. The bookmark contains the
whole tool, so after it is updated, drag the new link again.</p>
<p><a href="index.html">All feeds</a></p>
</body>
</html>
`;
}

async function main() {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: HERE, encoding: 'utf8' });
  const repo = repoFromRemote(remote);
  if (!repo) throw new Error(`origin is not a GitHub remote: ${remote.trim()}`);
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: HERE, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    legalComments: 'none',
    write: false,
    define: { __GITHUB_REPO__: JSON.stringify(repo) },
  });
  const href = bookmarkletHref(result.outputFiles[0].text);
  writeFileSync(OUT, installPage(href));
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (bookmarklet: ${href.length} chars, repo: ${repo})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
