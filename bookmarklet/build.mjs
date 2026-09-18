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
  <li>Open the listing page of a site with no RSS feed (run <code>check_feed.py</code> first).</li>
  <li>Click the bookmark, then click one article in the list. Use ↑/↓ until every article is highlighted.</li>
  <li>Click the title, date and category inside any highlighted article, or Skip them.</li>
  <li>Check the preview and the raw-HTML check, adjust the id/name, then <b>Copy YAML</b> into
    <code>sites/&lt;id&gt;.yaml</code> (or <b>Open in GitHub</b>).</li>
  <li>Test it: <code>uv run python -m scraper.run &lt;id&gt;</code></li>
</ol>
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
