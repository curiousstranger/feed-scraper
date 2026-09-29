# Patreon Creator Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `type: patreon` source that publishes a public per-creator RSS feed from Patreon's anonymous web API. Locked posts appear as title, date, cover image and a "patrons only" link. Public posts also carry their sanitized full text.

**Architecture:** `scraper/run.py:process_site` dispatches on an optional `type` config field (default `html`, which is unchanged). `type: patreon` replaces the listing and enrichment steps with `scraper/patreon.py` (API calls, post mapping, summaries) and `scraper/patreon_render.py` (renders a public post's ProseMirror-JSON body to HTML, then sanitizes it with nh3). State merge, feed build and index generation are shared and unchanged.

**Tech Stack:** Python ≥3.12, `requests`, `nh3` (new), `feedgen`, `pytest`, all run through `uv`. There is a temporary GitHub Actions workflow (bash + curl + jq) for the runner smoke test.

**Spec:** `/Users/mcable/src/feed-scraper/.worktrees/patreon-source/docs/superpowers/specs/2026-09-29-patreon-source-design.md`. Read it alongside this plan. Where this plan departs from the spec, the departure was found by probing the live API during planning; see "Departures from the spec" below.

## Working directory (read this first)

- **All work happens in the git worktree `/Users/mcable/src/feed-scraper/.worktrees/patreon-source`**, on branch `feat/patreon-source`. The worktree and branch already exist, and the spec is already committed there (commit `6d6fe9c`). Do not create them again.
- **Never touch the main checkout at `/Users/mcable/src/feed-scraper`.** Several subdirectory names (`scraper/`, `tests/`, `docs/`) exist under both roots, so a write that lands in the wrong root is invisible in a relative path.
- **Every subagent dispatch must state the absolute working directory `/Users/mcable/src/feed-scraper/.worktrees/patreon-source` AND tell the agent to run `cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source` before its first write.** Saying "work from <path>" alone is not enough, because subagents inherit the session's working directory.
- All paths below are relative to that worktree.

## Global Constraints

- Use `uv run` for everything: `uv run pytest`, `uv run python -m scraper.run <id>`. Add the dependency with `uv add nh3`, which updates `pyproject.toml` and `uv.lock`. Never use bare `pip` or `python`.
- TDD per task: write the failing test first and watch it fail, then implement. Tests use fixtures under `tests/fixtures/patreon/` and make no network requests: `requests.get` is monkeypatched by the `patreon_http` fixture in `tests/conftest.py`, which fails the test on any request it wasn't told about.
- No authentication of any kind: no OAuth, session cookie or secret. A locked post's content is never requested or published.
- **Pinning or probing the public-post body endpoint: request body/content fields ONLY for posts where `current_user_can_view` is true. Never request body or content fields for a locked post.** The code enforces this: `enrich_new` only calls `_fetch_body` when `post.public`. Any manual probe must follow the same rule.
- Task 1 pushes the branch. **Pushing requires the user's explicit approval at that moment.** If the runner is served a challenge or non-JSON, stop and go back to the user.
- `type` defaults to `html`. Existing configs (`sites/anthropic-news.yaml`, `sites/diffordsguide.yaml`) must behave exactly as before.
- Every value that reaches a summary from Patreon's API is HTML-escaped by our code. A public post's body passes through our renderer and then `nh3` with the allowlist `p, br, hr, strong, b, em, i, u, s, a, ul, ol, li, blockquote, h2, h3, h4, img, figure, figcaption, code, pre`, attributes `a[href]`, `img[src, alt]`, URL schemes `http`, `https`.
- Do not commit generated scraper output (`data/*.json`, `docs/feeds/*.xml`, `docs/index.html`) from local runs. The `update-feeds` workflow on `main` owns those files.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before claiming done, run the full gauntlet (Task 7) and paste the actual commands and their full output. Treat any pass claimed by a subagent as unverified until its output has been pasted.

## Departures from the spec (found by probing the live API on 2026-09-29)

1. **A public post's body is `content_json_string`, not HTML.** `GET /api/posts/{id}` returns `content: null` even for public posts. The text is in `content_json_string`, a ProseMirror-style JSON document. Node types seen across all 14 public posts: `doc, paragraph, text, heading, image, caption, bulletList, orderedList, listItem, hardBreak, horizontalRule`. Marks seen: `bold, italic, underline, link`. The new module `scraper/patreon_render.py` renders that JSON to HTML, escaping every text value and keeping only http(s) links and images, then runs `nh3` with the spec's allowlist as a second line of defence. Pinned endpoint: `GET https://www.patreon.com/api/posts/{id}?fields[post]=content_json_string,current_user_can_view&json-api-use-default-includes=false&include=`. It was probed only on public posts.
2. **`Post` gains an `id: str` field**, which the body request needs. It is still per-run metadata and never enters state.
3. **An unknown vanity returns a JSON HTTP 404** (`CampaignNotFound`), not an empty list. `_campaign_id` maps that 404 to the spec's `ValueError`, and also treats an empty `data` list as not found.
4. **`_get_json` checks the content type before `raise_for_status()`.** A Cloudflare challenge usually arrives as a 403 HTML page. Checking the status first would raise a bare `HTTPError` and lose the "possibly a Cloudflare challenge" message.
5. **A new URL that `merge_items` has already trimmed is skipped** in the Patreon enrich loop. `merge_items` returns new URLs before trimming to `max_items`. The HTML path has the same latent `KeyError`, but it is out of scope here, since the HTML path must stay unchanged, and it is tracked separately.
6. **The `post_body.json` fixture is a composite:** real nodes trimmed from several public posts and assembled into one document, so that one fixture covers every node and mark type. The other fixtures are trimmed copies of real responses.
7. **Image URLs are signed and expire** (`token-time`, about 2 weeks). The user chose to keep the spec's behavior, which is to embed images once, and to document this as a limitation (Task 6).

## Review Focus

Five failure modes the spec implies but doesn't spell out, most likely first. Each has a pinning test in the task that owns the code.

1. **Cloudflare challenge served as a 403 HTML page:** the run should fail with the clear `PatreonBlockedError` message, not a bare `HTTPError`. Task 3: `test_challenge_page_raises_blocked_error_even_with_an_error_status`.
2. **Listing larger than `max_items`, or a lowered `max_items`:** URLs that `merge_items` reports as new but has already trimmed must not crash enrichment. Task 5: `test_patreon_listing_larger_than_max_items_does_not_crash`.
3. **A post locked again between the list request and the body request:** its body must not be published. Task 4: `test_body_is_not_used_if_post_is_no_longer_viewable`.
4. **Malformed or hostile API values:** a null, `javascript:` or relative post URL, a non-http cover image, a missing `attributes` object, or a non-numeric post id. These should be skipped, defaulted or escaped, and must never be requested or injected. Task 3: `test_posts_without_usable_fields_are_skipped_or_defaulted`. Task 4: `test_non_numeric_post_id_is_never_requested`, `test_summary_escapes_every_api_value`, `test_summary_drops_a_non_http_cover_image`.
5. **Every scheduled run after the first:** existing items must not have their bodies fetched again, and their stored summaries must stay unchanged. Task 5: `test_patreon_second_run_does_not_refetch_bodies`.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `.github/workflows/patreon-smoke.yml` | create (Task 1), delete (Task 7) | Temporary: proves runner IPs get JSON from the vanity, list and public-body endpoints |
| `pyproject.toml`, `uv.lock` | modify (Task 2, via `uv add nh3`) | New `nh3` dependency |
| `scraper/patreon_render.py` | create (Task 2) | ProseMirror JSON → HTML, and `nh3` sanitizing. No network access. |
| `scraper/patreon.py` | create (Task 3), extend (Task 4) | Patreon API access, post → item mapping, summaries, `enrich_new` |
| `scraper/run.py` | modify (Task 5) | `type` dispatch in `process_site` |
| `tests/conftest.py` | create (Task 3) | `FakePatreon` HTTP stub and the `patreon_http` / `kenji_http` fixtures |
| `tests/fixtures/patreon/*.{json,html}` | create (Tasks 2–3) | Trimmed real responses |
| `tests/test_patreon_render.py` | create (Task 2) | Renderer and sanitizer tests |
| `tests/test_patreon.py` | create (Task 3), extend (Task 4) | Listing, summary and enrichment tests |
| `tests/test_run.py` | extend (Task 5) | Dispatch, state shape and re-run tests |
| `sites/kenji-lopez-alt.yaml` | create (Task 6) | The first Patreon config |
| `README.md`, `CLAUDE.md` | modify (Task 6) | Docs |

---

### Task 1: Prove GitHub Actions runners get JSON from Patreon (controller runs this, not a subagent)

This task needs the user's approval in the middle, and a subagent cannot ask for it. **The controlling session runs it itself.** A workflow file has no unit test: the workflow run is the test.

**Files:**
- Create: `.github/workflows/patreon-smoke.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: a go/no-go answer. Every later task assumes "go".

- [ ] **Step 1: Write the workflow**

`cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source`, then create `.github/workflows/patreon-smoke.yml`:

```yaml
name: Patreon smoke test (temporary)

# Proves GitHub Actions runner IPs are served JSON, not a Cloudflare
# challenge, by the Patreon endpoints scraper/patreon.py uses. Temporary:
# delete this file before the branch is merged.

on:
  push:
    branches: [feat/patreon-source]
    paths: [".github/workflows/patreon-smoke.yml"]

permissions:
  contents: read

jobs:
  smoke:
    runs-on: ubuntu-latest
    env:
      UA: "Mozilla/5.0 (compatible; PersonalSiteRSSBot/1.0; run by a single subscriber for personal use)"
      API: https://www.patreon.com/api
    steps:
      - name: Vanity lookup returns JSON
        run: |
          set -euo pipefail
          meta=$(curl -sS -g -A "$UA" -o vanity.json -w '%{http_code} %{content_type}' --get "$API/campaigns" \
            --data-urlencode 'filter[vanity]=kenjilopezalt' \
            --data-urlencode 'fields[campaign]=vanity' \
            --data-urlencode 'json-api-use-default-includes=false' \
            --data-urlencode 'include=')
          echo "vanity endpoint: HTTP $meta"
          case "$meta" in "200 application/"*json*) ;; *) head -c 600 vanity.json; exit 1 ;; esac
          campaign_id=$(jq -er '.data[0].id' vanity.json)
          echo "campaign id: $campaign_id"
          echo "CAMPAIGN_ID=$campaign_id" >> "$GITHUB_ENV"

      - name: Post list returns JSON
        run: |
          set -euo pipefail
          meta=$(curl -sS -g -A "$UA" -o posts.json -w '%{http_code} %{content_type}' --get "$API/posts" \
            --data-urlencode "filter[campaign_id]=$CAMPAIGN_ID" \
            --data-urlencode 'filter[contains_exclusive_posts]=true' \
            --data-urlencode 'sort=-published_at' \
            --data-urlencode 'page[count]=20' \
            --data-urlencode 'fields[post]=title,url,published_at,post_type,image,current_user_can_view' \
            --data-urlencode 'json-api-use-default-includes=false' \
            --data-urlencode 'include=')
          echo "list endpoint: HTTP $meta"
          case "$meta" in "200 application/"*json*) ;; *) head -c 600 posts.json; exit 1 ;; esac
          jq -e '.data | length > 0' posts.json
          jq -r '.data[] | [.id, .attributes.current_user_can_view, .attributes.post_type, .attributes.title] | @tsv' posts.json
          # Only a post the anonymous request can already view is probed for its body.
          public_id=$(jq -r '[.data[] | select(.attributes.current_user_can_view == true)][0].id // empty' posts.json)
          echo "first public post: ${public_id:-none in this page}"
          echo "PUBLIC_ID=$public_id" >> "$GITHUB_ENV"

      - name: Public post body returns JSON (public posts only)
        if: env.PUBLIC_ID != ''
        run: |
          set -euo pipefail
          meta=$(curl -sS -g -A "$UA" -o body.json -w '%{http_code} %{content_type}' --get "$API/posts/$PUBLIC_ID" \
            --data-urlencode 'fields[post]=content_json_string,current_user_can_view' \
            --data-urlencode 'json-api-use-default-includes=false' \
            --data-urlencode 'include=')
          echo "body endpoint: HTTP $meta"
          case "$meta" in "200 application/"*json*) ;; *) head -c 600 body.json; exit 1 ;; esac
          jq -e '.data.attributes.current_user_can_view == true and (.data.attributes.content_json_string | type == "string")' body.json
```

It only fires on pushes to `feat/patreon-source` that touch this file. The `update-feeds` workflow listens only on `main`, and `test.yml` only on `pull_request`, so neither of them runs. The body step requests `content_json_string` only for a post whose `current_user_can_view` is `true`.

- [ ] **Step 2: Commit**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git add .github/workflows/patreon-smoke.yml
git commit -m "$(printf 'Add temporary Patreon smoke-test workflow\n\nChecks that GitHub Actions runner IPs are served JSON (not a Cloudflare\nchallenge) by the Patreon endpoints the scraper will use. To be deleted\nbefore merge.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

- [ ] **Step 3: STOP and ask the user for approval to push**

Ask, in so many words: *"Ready to push `feat/patreon-source` to `origin`. This runs the Patreon smoke-test workflow on a GitHub runner. OK to push?"* Wait for an explicit yes. Do not push on anything less.

- [ ] **Step 4: Push and wait for the run**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git push -u origin feat/patreon-source
gh run list --branch feat/patreon-source --workflow patreon-smoke.yml --limit 1
gh run watch <run-id-from-previous-command> --exit-status
gh run view <run-id> --log | grep -E 'endpoint: HTTP|campaign id|first public post|^true$' 
```

Expected: `vanity endpoint: HTTP 200 application/vnd.api+json`, `list endpoint: HTTP 200 application/vnd.api+json`, `body endpoint: HTTP 200 application/vnd.api+json`, a campaign id of `4148811`, and the job concluding `success`.

- [ ] **Step 5: Decide**

- All three endpoints return JSON → report the log lines to the user, then continue with Task 2.
- Any step fails with non-JSON (HTML, a 403, `text/html`), or anything else that looks like a challenge → **STOP. Do not start Task 2.** Report the failing step's log output to the user. The spec's candidate fallback, running on the QNAP from a residential IP, is the user's decision to make.

---

### Task 2: Render and sanitize a public post's body

**Files:**
- Modify: `pyproject.toml`, `uv.lock` (via `uv add nh3`)
- Create: `scraper/patreon_render.py`
- Create: `tests/fixtures/patreon/post_body.json`
- Test: `tests/test_patreon_render.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `patreon_render.is_http_url(value) -> bool`: true only for a `str` starting with `http://` or `https://` (case-insensitive).
  - `patreon_render.sanitize(fragment: str) -> str`: nh3 with the spec's allowlist. nh3 adds `rel="noopener noreferrer"` to every `<a>`.
  - `patreon_render.render_doc(node) -> str`: a ProseMirror node dict → unsanitized HTML (every text value is escaped).
  - `patreon_render.body_html(content_json_string: str | None) -> str`: `""` for None or empty, otherwise `sanitize(render_doc(json.loads(...)))`. Raises `ValueError` (a `json.JSONDecodeError`) on invalid JSON.

- [ ] **Step 1: Add the dependency**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
uv add nh3
```

Expected: `pyproject.toml` gains `"nh3>=…"` in `dependencies`, and `uv.lock` is updated.

- [ ] **Step 2: Create the body fixture**

Create `tests/fixtures/patreon/post_body.json`. This is the shape of `GET /api/posts/168800580?fields[post]=content_json_string,current_user_can_view` (a public post). Its document is a composite of real nodes from several public posts:

```json
{
  "data": {
    "id": "168800580",
    "type": "post",
    "attributes": {
      "content_json_string": "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Hi everyone,\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"I wanted to take a quick moment to correct something I said in my \"},{\"type\":\"text\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://frienji.kenjilopezalt.com/posts/how-to-sharpen-167690015\",\"target\":\"_blank\"}},{\"type\":\"bold\"},{\"type\":\"underline\"}],\"text\":\"latest knife-sharpening video\"},{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\".\"}]},{\"type\":\"heading\",\"content\":[{\"type\":\"text\",\"text\":\"Recipe: Pizza Dough English Muffins\"}],\"attrs\":{\"level\":1}},{\"type\":\"image\",\"attrs\":{\"alignment\":\"center\",\"alt\":\"\",\"caption\":\"\",\"height\":null,\"link\":null,\"media_height\":1350,\"media_id\":\"743350572\",\"media_width\":2400,\"node_type\":\"block\",\"src\":\"https://c10.patreonusercontent.com/4/patreon-media/p/post/169276035/dcb3182f8997470ba98212e6ded78e3e/eyJhIjoxLCJ3Ijo4MjB9/1.jpeg?token-hash=eo6Uf2y9g7YuXnZY9VSEciKDLOcAOBBDGbOJAbKWgOE%3D&token-time=1791936000\",\"width\":null}},{\"type\":\"caption\",\"content\":[{\"type\":\"text\",\"text\":\"A mushroom-shaped dull apex. \"},{\"type\":\"text\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://scienceofsharp.com/2018/08/22/what-does-steeling-do-part-1/\",\"target\":\"_blank\"}},{\"type\":\"underline\"}],\"text\":\"Photo via \"},{\"type\":\"text\",\"marks\":[{\"type\":\"link\",\"attrs\":{\"href\":\"https://scienceofsharp.com/2018/08/22/what-does-steeling-do-part-1/\",\"target\":\"_blank\"}},{\"type\":\"italic\"},{\"type\":\"underline\"}],\"text\":\"Science of Sharp.\"}],\"attrs\":{\"fallback_strategy\":\"fallback\"}},{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Using pre-made or leftover pizza dough makes making craggy, tender English muffins easy.\"}]}]},{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"An overnight rest lets you griddle the English muffins for breakfast.\"}]}]}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\": 6 English muffins\"},{\"type\":\"hardBreak\"},{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Active Time\"}]},{\"type\":\"horizontalRule\",\"attrs\":{\"fallback_strategy\":\"ignore\"}}]}",
      "current_user_can_view": true
    }
  }
}
```

- [ ] **Step 3: Write the failing tests**

Create `tests/test_patreon_render.py`:

```python
import json
from pathlib import Path

import pytest

from scraper import patreon_render as pr

BODY_FIXTURE = Path(__file__).parent / "fixtures" / "patreon" / "post_body.json"


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def _p(*content):
    return {"type": "paragraph", "content": list(content)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = list(marks)
    return node


def _link(href):
    return {"type": "link", "attrs": {"href": href, "target": "_blank"}}


def test_renders_paragraphs_and_marks_in_a_fixed_order():
    html = pr.render_doc(
        _doc(_p(_t("plain "), _t("bold", {"type": "bold"}), _t("both", {"type": "underline"}, {"type": "italic"})))
    )

    assert html == "<p>plain <strong>bold</strong><u><em>both</em></u></p>"


def test_link_mark_wraps_the_other_marks():
    html = pr.render_doc(_p(_t("site", {"type": "bold"}, _link("https://e.com/?a=1&b=2"))))

    assert html == '<p><a href="https://e.com/?a=1&amp;b=2"><strong>site</strong></a></p>'


@pytest.mark.parametrize("href", ["javascript:alert(1)", "data:text/html,x", "/relative", None])
def test_link_with_non_http_href_keeps_text_and_drops_link(href):
    assert pr.render_doc(_p(_t("x", _link(href)))) == "<p>x</p>"


def test_text_is_escaped():
    html = pr.render_doc(_p(_t('<script>alert("x")</script> & co')))

    assert html == '<p>&lt;script&gt;alert("x")&lt;/script&gt; &amp; co</p>'


@pytest.mark.parametrize(
    "level, tag",
    [(1, "h2"), (2, "h2"), (3, "h3"), (4, "h4"), (6, "h4"), (None, "h2"), ("big", "h2")],
)
def test_headings_are_clamped_to_h2_through_h4(level, tag):
    node = {"type": "heading", "attrs": {"level": level}, "content": [_t("T")]}

    assert pr.render_doc(node) == f"<{tag}>T</{tag}>"


def test_image_is_escaped_and_needs_an_http_src():
    ok = pr.render_doc({"type": "image", "attrs": {"src": "https://img.example/a.jpg?x=1&y=2", "alt": 'a "b"'}})

    assert ok == '<figure><img src="https://img.example/a.jpg?x=1&amp;y=2" alt="a &quot;b&quot;"></figure>'
    assert pr.render_doc({"type": "image", "attrs": {"src": "javascript:alert(1)"}}) == ""
    assert pr.render_doc({"type": "image", "attrs": {}}) == ""


def test_lists_breaks_and_rules():
    doc = _doc(
        {"type": "bulletList", "content": [{"type": "listItem", "content": [_p(_t("a"))]}]},
        {"type": "orderedList", "attrs": {"order": 1}, "content": [{"type": "listItem", "content": [_p(_t("b"))]}]},
        _p(_t("x"), {"type": "hardBreak"}, _t("y")),
        {"type": "horizontalRule", "attrs": {"fallback_strategy": "ignore"}},
    )

    assert pr.render_doc(doc) == "<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><p>x<br>y</p><hr>"


def test_unknown_node_types_keep_their_text():
    doc = _doc({"type": "mysteryWidget", "attrs": {"x": 1}, "content": [_p(_t("kept"))]}, {"type": "embedThing"})

    assert pr.render_doc(doc) == "<p>kept</p>"


def test_malformed_nodes_are_ignored():
    assert pr.render_doc(_doc("not a node", None, _p(_t("ok")))) == "<p>ok</p>"


@pytest.mark.parametrize(
    "dirty, forbidden",
    [
        ("<p>hi<script>alert(1)</script></p>", "<script"),
        ('<iframe src="https://evil.example/"></iframe><p>ok</p>', "<iframe"),
        ('<img src="https://img.example/a.jpg" onerror="alert(1)" alt="">', "onerror"),
        ('<a href="javascript:alert(1)">x</a>', "javascript:"),
        ('<p style="color:red">s</p>', "style"),
    ],
)
def test_sanitize_strips_dangerous_markup(dirty, forbidden):
    assert forbidden not in pr.sanitize(dirty)


def test_sanitize_keeps_allowed_tags():
    clean = pr.sanitize(
        "<h2>T</h2><p><strong>b</strong> <em>i</em> <u>u</u></p><ul><li>x</li></ul>"
        '<figure><img src="https://img.example/a.jpg" alt="d"></figure><a href="https://e.com/">l</a>'
    )

    for fragment in [
        "<h2>T</h2>",
        "<strong>b</strong>",
        "<em>i</em>",
        "<u>u</u>",
        "<ul><li>x</li></ul>",
        '<figure><img src="https://img.example/a.jpg" alt="d"></figure>',
        'href="https://e.com/"',
    ]:
        assert fragment in clean


def test_body_html_renders_the_real_post_fixture():
    raw = json.loads(BODY_FIXTURE.read_text(encoding="utf-8"))["data"]["attributes"]["content_json_string"]

    html = pr.body_html(raw)

    assert html.startswith("<p>Hi everyone,</p>")
    assert (
        '<a href="https://frienji.kenjilopezalt.com/posts/how-to-sharpen-167690015" rel="noopener noreferrer">'
        "<u><strong>latest knife-sharpening video</strong></u></a>"
    ) in html
    assert "<h2>Recipe: Pizza Dough English Muffins</h2>" in html
    assert '<figure><img src="https://c10.patreonusercontent.com/4/patreon-media/p/post/169276035/' in html
    assert "<li><p>An overnight rest lets you griddle the English muffins for breakfast.</p></li>" in html
    assert "<p>: 6 English muffins<br><strong>Active Time</strong></p>" in html
    assert html.endswith("<hr>")


@pytest.mark.parametrize("raw", [None, ""])
def test_body_html_of_an_empty_body_is_empty(raw):
    assert pr.body_html(raw) == ""


def test_body_html_rejects_invalid_json():
    with pytest.raises(ValueError):
        pr.body_html("{not json")
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `uv run pytest tests/test_patreon_render.py -v`
Expected: collection ERROR `ImportError: cannot import name 'patreon_render' from 'scraper'`.

- [ ] **Step 5: Write the implementation**

Create `scraper/patreon_render.py`:

```python
"""Turn a Patreon post body into HTML that is safe to publish in a feed.

Patreon's web API returns a public post's body as `content_json_string`: a
ProseMirror-style document (nodes such as paragraph, heading, image; text
nodes carrying marks such as bold or link). We render it to HTML ourselves,
escaping every text value and keeping only http(s) links and images, then pass
the result through nh3 as a second line of defence.
"""
from __future__ import annotations

import html
import json
import logging

import nh3

log = logging.getLogger(__name__)

ALLOWED_TAGS = {
    "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
    "blockquote", "h2", "h3", "h4", "img", "figure", "figcaption", "code", "pre",
}
ALLOWED_ATTRIBUTES = {"a": {"href"}, "img": {"src", "alt"}}
URL_SCHEMES = {"http", "https"}

# Node types that become one wrapping element around their children.
_BLOCKS = {
    "paragraph": "p",
    "caption": "p",
    "bulletList": "ul",
    "orderedList": "ol",
    "listItem": "li",
    "blockquote": "blockquote",
}
_VOID = {"hardBreak": "<br>", "horizontalRule": "<hr>"}
# Applied innermost-first in this order, so output doesn't depend on the order
# Patreon happens to list a text node's marks in.
_MARKS = {"bold": "strong", "italic": "em", "underline": "u", "strike": "s", "code": "code"}


def is_http_url(value) -> bool:
    return isinstance(value, str) and value.lower().startswith(("http://", "https://"))


def sanitize(fragment: str) -> str:
    return nh3.clean(fragment, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRIBUTES, url_schemes=URL_SCHEMES)


def body_html(content_json_string: str | None) -> str:
    """Render a post's content_json_string to sanitized HTML ("" if there is
    none). Raises ValueError if the string isn't valid JSON."""
    if not content_json_string:
        return ""
    return sanitize(render_doc(json.loads(content_json_string)))


def render_doc(node) -> str:
    if not isinstance(node, dict):
        return ""
    kind = node.get("type")
    if kind == "text":
        return _render_text(node)
    if kind in _VOID:
        return _VOID[kind]
    if kind == "image":
        return _render_image(node.get("attrs") or {})

    inner = "".join(render_doc(child) for child in node.get("content") or [])
    if kind == "doc":
        return inner
    if kind == "heading":
        level = (node.get("attrs") or {}).get("level")
        level = min(max(level, 2), 4) if isinstance(level, int) else 2
        return f"<h{level}>{inner}</h{level}>"
    if kind == "codeBlock":
        return f"<pre><code>{inner}</code></pre>"
    if kind in _BLOCKS:
        tag = _BLOCKS[kind]
        return f"<{tag}>{inner}</{tag}>"
    # A node type we don't know (Patreon adds them over time): keep the text
    # inside it, drop the wrapper.
    log.debug("Unknown Patreon body node type %r", kind)
    return inner


def _render_text(node: dict) -> str:
    text = html.escape(str(node.get("text") or ""), quote=False)
    marks = [m for m in node.get("marks") or [] if isinstance(m, dict)]
    kinds = {m.get("type") for m in marks}
    for kind, tag in _MARKS.items():
        if kind in kinds:
            text = f"<{tag}>{text}</{tag}>"
    for mark in marks:
        if mark.get("type") == "link":
            href = (mark.get("attrs") or {}).get("href")
            if is_http_url(href):
                text = f'<a href="{html.escape(href)}">{text}</a>'
            break
    return text


def _render_image(attrs: dict) -> str:
    src = attrs.get("src")
    if not is_http_url(src):
        return ""
    alt = attrs.get("alt") if isinstance(attrs.get("alt"), str) else ""
    return f'<figure><img src="{html.escape(src)}" alt="{html.escape(alt)}"></figure>'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_patreon_render.py -v`
Expected: 28 passed.

Run: `uv run pytest`
Expected: the whole suite passes. Earlier tests are unaffected.

- [ ] **Step 7: Commit**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git add pyproject.toml uv.lock scraper/patreon_render.py tests/test_patreon_render.py tests/fixtures/patreon/post_body.json
git commit -m "$(printf 'Render and sanitize Patreon post bodies\n\nPatreon returns a public post body as content_json_string, a\nProseMirror-style document. Render it to HTML with every text value\nescaped and only http(s) links/images kept, then pass it through nh3.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 3: List a creator's posts from the anonymous API

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/fixtures/patreon/vanity.json`, `vanity_not_found.json`, `posts.json`, `challenge.html`
- Create: `scraper/patreon.py`
- Test: `tests/test_patreon.py`

**Interfaces:**
- Consumes: `patreon_render.is_http_url` (Task 2). `extract.parse_date`, `extract.DEFAULT_UA` and `extract.TIMEOUT` (these already exist).
- Produces:
  - `patreon.Post`: a dataclass `Post(id: str, item: dict, public: bool, image: str | None)`. `item` is exactly `{"url", "title", "category", "published"}`.
  - `patreon.fetch_posts(cfg: dict) -> list[Post]`, newest first as Patreon returns them.
  - `patreon.category_label(post_type) -> str | None`
  - `patreon.PatreonBlockedError(RuntimeError)`
  - `patreon.API = "https://www.patreon.com/api"`, `patreon.NO_INCLUDES`, and `patreon._get_json(url, cfg, params) -> dict`. Task 4 uses the last two.
  - Test fixtures in `tests/conftest.py`: `patreon_http` (a `FakePatreon` with `.route(path, fixture=None, *, body=None, status=200, content_type=...)`, `.calls`, `.paths()`), and `kenji_http`, which routes the campaign, the post list, and both public posts' bodies. A request for a locked post's body therefore fails the test.

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/patreon/vanity.json` (trimmed `GET /api/campaigns?filter[vanity]=kenjilopezalt`):

```json
{
  "data": [
    {
      "id": "4148811",
      "type": "campaign",
      "attributes": {
        "name": "J. Kenji López-Alt",
        "vanity": "kenjilopezalt"
      }
    }
  ]
}
```

`tests/fixtures/patreon/vanity_not_found.json` (the real body served with HTTP 404 for an unknown vanity):

```json
{
  "errors": [
    {
      "id": "a5fb42b7-7f70-4de6-b801-3a60f9e0cd4c",
      "code_name": "CampaignNotFound",
      "code": 302,
      "title": "Campaign was not found.",
      "detail": "Campaign with id zz_no_such_creator_xq9 was not found.",
      "status": "404"
    }
  ]
}
```

`tests/fixtures/patreon/posts.json` (trimmed `GET /api/posts?filter[campaign_id]=4148811&…`: two public posts, two locked, one with no cover image):

```json
{
  "data": [
    {
      "id": "169276035",
      "type": "post",
      "attributes": {
        "current_user_can_view": true,
        "image": {
          "url": "https://c10.patreonusercontent.com/4/patreon-media/p/post/169276035/f8255c54ae9c47dfb9724b978cac0bf3/eyJ3Ijo2MjB9/1.jpg?token-hash=v3VbVuq6YnIgeLTQIzo0R6__1KoN6t26hBSAD2rHLOE%3D&token-time=1791936000",
          "large_url": "https://c10.patreonusercontent.com/4/patreon-media/p/post/169276035/f8255c54ae9c47dfb9724b978cac0bf3/eyJ3IjoxMDgwfQ%3D%3D/1.jpg?token-hash=JGy2zuLT0QGDan3i1OR4_F1fndL8GUU8dOvCIHTD1aE%3D&token-time=1791936000"
        },
        "post_type": "video_external_file",
        "published_at": "2026-09-23T18:18:03.000+00:00",
        "title": "Easy Weeknight Pasta with Mushrooms",
        "url": "https://frienji.kenjilopezalt.com/posts/easy-weeknight-169276035"
      }
    },
    {
      "id": "169276041",
      "type": "post",
      "attributes": {
        "current_user_can_view": false,
        "image": {
          "url": "https://c10.patreonusercontent.com/4/patreon-media/p/post/169276041/83dfeeb070bf4fc5826f0c2ed2988eea/eyJ3Ijo2MjB9/1.jpeg?token-hash=alnGBsCCJQNisE8WE4K1hfg0ZWo_ROi8dVGQ32k7tKo%3D&token-time=1791936000",
          "large_url": "https://c10.patreonusercontent.com/4/patreon-media/p/post/169276041/83dfeeb070bf4fc5826f0c2ed2988eea/eyJ3IjoxMDgwfQ%3D%3D/1.jpeg?token-hash=qkkoWjR1QH2zXABmROSFCOg22wpt01ayVcWsPnqJKWc%3D&token-time=1791936000"
        },
        "post_type": "image_file",
        "published_at": "2026-09-28T16:00:19.000+00:00",
        "title": "Grilled Chicken, Pepper, and Chickpea Salad With Tahini",
        "url": "https://frienji.kenjilopezalt.com/posts/grilled-chicken-169276041"
      }
    },
    {
      "id": "169260984",
      "type": "post",
      "attributes": {
        "current_user_can_view": false,
        "image": null,
        "post_type": "text_only",
        "published_at": "2026-09-11T17:13:42.000+00:00",
        "title": "Recipe: Grilled Vegetable Flatbread Wraps With Yogurt, Sumac, and Mint",
        "url": "https://frienji.kenjilopezalt.com/posts/recipe-grilled-169260984"
      }
    },
    {
      "id": "168800580",
      "type": "post",
      "attributes": {
        "current_user_can_view": true,
        "image": null,
        "post_type": "text_only",
        "published_at": "2026-09-08T17:14:33.000+00:00",
        "title": "How Honing Really Fixes Knives (A Correction)",
        "url": "https://frienji.kenjilopezalt.com/posts/how-honing-fixes-168800580"
      }
    }
  ],
  "links": {
    "next": "https://www.patreon.com/api/posts?page%5Bcursor%5D=trimmed"
  },
  "meta": {
    "pagination": {
      "total": 454
    }
  }
}
```

`tests/fixtures/patreon/challenge.html` (a trimmed Cloudflare interstitial):

```html
<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title></head><body><noscript>Enable JavaScript and cookies to continue</noscript></body></html>
```

- [ ] **Step 2: Create the HTTP stub fixtures**

Create `tests/conftest.py`:

```python
import json
from pathlib import Path
from urllib.parse import urlsplit

import pytest
import requests

PATREON_FIXTURES = Path(__file__).parent / "fixtures" / "patreon"


def make_response(url, body, status=200, content_type="application/vnd.api+json"):
    resp = requests.Response()
    resp.status_code = status
    resp._content = body.encode("utf-8")
    resp.encoding = "utf-8"
    resp.url = url
    if content_type:
        resp.headers["Content-Type"] = content_type
    return resp


class FakePatreon:
    """Stands in for requests.get: answers by URL path, records every call,
    and fails the test on any request it wasn't told about."""

    def __init__(self):
        self.routes = {}
        self.calls = []

    def route(self, path, fixture=None, *, body=None, status=200, content_type="application/vnd.api+json"):
        if fixture is not None:
            body = (PATREON_FIXTURES / fixture).read_text(encoding="utf-8")
        self.routes[path] = (body, status, content_type)

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": dict(params or {}), "headers": dict(headers or {})})
        path = urlsplit(url).path
        if path not in self.routes:
            raise AssertionError(f"unexpected request: {url} {params}")
        body, status, content_type = self.routes[path]
        if isinstance(body, Exception):
            raise body
        return make_response(url, body, status, content_type)

    def paths(self):
        return [urlsplit(c["url"]).path for c in self.calls]


@pytest.fixture
def patreon_http(monkeypatch):
    fake = FakePatreon()
    monkeypatch.setattr(requests, "get", fake.get)
    return fake


@pytest.fixture
def kenji_http(patreon_http):
    """Kenji's campaign as the fixtures captured it: two public posts
    (169276035, 168800580) and two locked ones. Only the public posts have a
    body route; a request for a locked post's body fails the test."""
    patreon_http.route("/api/campaigns", "vanity.json")
    patreon_http.route("/api/posts", "posts.json")
    patreon_http.route("/api/posts/168800580", "post_body.json")
    patreon_http.route(
        "/api/posts/169276035",
        body=json.dumps(
            {
                "data": {
                    "id": "169276035",
                    "type": "post",
                    "attributes": {"content_json_string": None, "current_user_can_view": True},
                }
            }
        ),
    )
    return patreon_http
```

- [ ] **Step 3: Write the failing tests**

Create `tests/test_patreon.py`:

```python
import json

import pytest
import requests

from scraper import patreon

CFG = {
    "id": "kenji-lopez-alt",
    "type": "patreon",
    "vanity": "kenjilopezalt",
    "listing_url": "https://www.patreon.com/kenjilopezalt",
    "max_items": 100,
    "user_agent": "TestUA/1.0",
    "_path": "sites/kenji-lopez-alt.yaml",
}


# --- fetch_posts -------------------------------------------------------------


def test_fetch_posts_maps_public_and_locked_posts(kenji_http):
    posts = patreon.fetch_posts(CFG)

    by_id = {p.id: p for p in posts}
    assert list(by_id) == ["169276035", "169276041", "169260984", "168800580"]

    pasta = by_id["169276035"]
    assert pasta.item == {
        "url": "https://frienji.kenjilopezalt.com/posts/easy-weeknight-169276035",
        "title": "Easy Weeknight Pasta with Mushrooms",
        "category": "Video",
        "published": "2026-09-23T18:18:03+00:00",
    }
    assert pasta.public is True
    # large_url is preferred over url
    assert pasta.image.startswith(
        "https://c10.patreonusercontent.com/4/patreon-media/p/post/169276035/"
        "f8255c54ae9c47dfb9724b978cac0bf3/eyJ3IjoxMDgwfQ"
    )

    locked_text = by_id["169260984"]
    assert locked_text.public is False
    assert locked_text.image is None
    assert locked_text.item["category"] == "Text"
    assert by_id["169276041"].item["category"] == "Images"


def test_fetch_posts_requests_only_metadata_fields(kenji_http):
    patreon.fetch_posts(CFG)

    assert kenji_http.paths() == ["/api/campaigns", "/api/posts"]
    vanity_call, list_call = kenji_http.calls
    assert vanity_call["params"]["filter[vanity]"] == "kenjilopezalt"
    assert list_call["params"]["filter[campaign_id]"] == "4148811"
    assert list_call["params"]["fields[post]"] == "title,url,published_at,post_type,image,current_user_can_view"
    assert list_call["params"]["sort"] == "-published_at"
    assert all(c["headers"]["User-Agent"] == "TestUA/1.0" for c in kenji_http.calls)


@pytest.mark.parametrize("max_items, expected", [(10, "10"), (100, "100"), (500, "100")])
def test_page_count_follows_max_items_capped_at_100(kenji_http, max_items, expected):
    patreon.fetch_posts(dict(CFG, max_items=max_items))

    assert kenji_http.calls[1]["params"]["page[count]"] == expected


@pytest.mark.parametrize(
    "post_type, label",
    [
        ("video_external_file", "Video"),
        ("video_embed", "Video"),
        ("image_file", "Images"),
        ("text_only", "Text"),
        ("link", "Link"),
        ("audio_file", "Audio"),
        ("audio_embed", "Audio"),
        ("poll", "Poll"),
        ("livestream_youtube", "Livestream Youtube"),
        (None, None),
        ("", None),
    ],
)
def test_category_label(post_type, label):
    assert patreon.category_label(post_type) == label


def test_unknown_vanity_raises_value_error_naming_vanity_and_config(patreon_http):
    # Patreon answers an unknown vanity with a JSON 404, not an empty list.
    patreon_http.route("/api/campaigns", "vanity_not_found.json", status=404)

    with pytest.raises(ValueError, match=r"sites/kenji-lopez-alt\.yaml.*'kenjilopezalt'"):
        patreon.fetch_posts(CFG)


def test_empty_vanity_result_raises_value_error(patreon_http):
    patreon_http.route("/api/campaigns", body='{"data": []}')

    with pytest.raises(ValueError, match="kenjilopezalt"):
        patreon.fetch_posts(CFG)


def test_missing_vanity_raises_value_error_without_any_request(patreon_http):
    cfg = {k: v for k, v in CFG.items() if k != "vanity"}

    with pytest.raises(ValueError, match=r"sites/kenji-lopez-alt\.yaml.*vanity"):
        patreon.fetch_posts(cfg)
    assert patreon_http.calls == []


def test_challenge_page_raises_blocked_error_even_with_an_error_status(patreon_http):
    patreon_http.route("/api/campaigns", "challenge.html", status=403, content_type="text/html; charset=UTF-8")

    with pytest.raises(patreon.PatreonBlockedError, match=r"HTTP 403, text/html.*Cloudflare"):
        patreon.fetch_posts(CFG)


def test_challenge_on_the_list_endpoint_raises_blocked_error(patreon_http):
    patreon_http.route("/api/campaigns", "vanity.json")
    patreon_http.route("/api/posts", "challenge.html", content_type="text/html")

    with pytest.raises(patreon.PatreonBlockedError):
        patreon.fetch_posts(CFG)


def test_http_error_on_the_list_endpoint_propagates(patreon_http):
    patreon_http.route("/api/campaigns", "vanity.json")
    patreon_http.route("/api/posts", body='{"errors": [{"status": "500"}]}', status=500)

    with pytest.raises(requests.HTTPError):
        patreon.fetch_posts(CFG)


def test_posts_without_usable_fields_are_skipped_or_defaulted(patreon_http):
    patreon_http.route("/api/campaigns", "vanity.json")
    patreon_http.route(
        "/api/posts",
        body=json.dumps(
            {
                "data": [
                    {"id": "1", "type": "post", "attributes": {"url": None, "title": "no url"}},
                    {"id": "2", "type": "post", "attributes": {"url": "javascript:alert(1)", "title": "bad url"}},
                    {
                        "id": "3",
                        "type": "post",
                        "attributes": {
                            "url": "/posts/relative-3",
                            "title": None,
                            "published_at": None,
                            "post_type": None,
                            "image": {"url": "javascript:alert(1)"},
                            "current_user_can_view": None,
                        },
                    },
                    {"id": "4", "type": "post"},
                ]
            }
        ),
    )

    posts = patreon.fetch_posts(CFG)

    assert [p.id for p in posts] == ["3"]
    assert posts[0].item == {
        "url": "https://www.patreon.com/posts/relative-3",
        "title": None,
        "category": None,
        "published": None,
    }
    assert posts[0].public is False
    assert posts[0].image is None
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `uv run pytest tests/test_patreon.py -v`
Expected: collection ERROR `ImportError: cannot import name 'patreon' from 'scraper'`.

- [ ] **Step 5: Write the implementation**

Create `scraper/patreon.py`:

```python
"""Posts from a Patreon creator, read from Patreon's anonymous (logged-out) web API.

This is the undocumented JSON:API that patreon.com's own pages call, not the
official API, so it can change without notice. We request only what a
logged-out visitor can already see: metadata for every post, and the body only
of posts where `current_user_can_view` is true. A locked post's content is
never requested.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from urllib.parse import urljoin

import requests

from . import extract
from .patreon_render import is_http_url

log = logging.getLogger(__name__)

API = "https://www.patreon.com/api"
LIST_FIELDS = "title,url,published_at,post_type,image,current_user_can_view"
# Without these, every response also embeds the campaign, creator, rewards...
NO_INCLUDES = {"json-api-use-default-includes": "false", "include": ""}

CATEGORY_LABELS = {
    "video_external_file": "Video",
    "video_embed": "Video",
    "image_file": "Images",
    "text_only": "Text",
    "link": "Link",
    "audio_file": "Audio",
    "audio_embed": "Audio",
    "poll": "Poll",
}


class PatreonBlockedError(RuntimeError):
    """Patreon answered with something other than JSON, e.g. a Cloudflare challenge."""


@dataclass
class Post:
    id: str
    # {url, title, published, category}: the same shape every source produces,
    # and the only part of a Post that is merged into state.
    item: dict
    # Per-run metadata used to build the summary; never persisted.
    public: bool
    image: str | None


def category_label(post_type) -> str | None:
    if not isinstance(post_type, str) or not post_type:
        return None
    return CATEGORY_LABELS.get(post_type) or post_type.replace("_", " ").strip().title()


def fetch_posts(cfg: dict) -> list[Post]:
    campaign_id = _campaign_id(cfg)
    count = max(1, min(int(cfg.get("max_items", 100)), 100))
    data = _get_json(
        f"{API}/posts",
        cfg,
        {
            "filter[campaign_id]": campaign_id,
            "filter[contains_exclusive_posts]": "true",
            "sort": "-published_at",
            "page[count]": str(count),
            "fields[post]": LIST_FIELDS,
            **NO_INCLUDES,
        },
    )
    posts = []
    for raw in data.get("data") or []:
        post = _to_post(raw)
        if post:
            posts.append(post)
    return posts


def _campaign_id(cfg: dict) -> str:
    path = cfg.get("_path", cfg.get("id"))
    vanity = cfg.get("vanity")
    if not vanity:
        raise ValueError(f"{path}: type: patreon requires 'vanity' (the name in patreon.com/<vanity>)")
    not_found = f"{path}: no Patreon campaign found for vanity {vanity!r}"
    try:
        data = _get_json(
            f"{API}/campaigns",
            cfg,
            {"filter[vanity]": vanity, "fields[campaign]": "vanity", **NO_INCLUDES},
        )
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            raise ValueError(not_found) from exc
        raise
    campaigns = data.get("data") or []
    if not campaigns:
        raise ValueError(not_found)
    return str(campaigns[0]["id"])


def _get_json(url: str, cfg: dict, params: dict) -> dict:
    headers = {"User-Agent": cfg.get("user_agent") or extract.DEFAULT_UA}
    resp = requests.get(url, params=params, headers=headers, timeout=extract.TIMEOUT)
    content_type = resp.headers.get("Content-Type", "")
    # Checked before the status: a Cloudflare challenge usually arrives as a
    # 403 HTML page, and "non-JSON" is the message that explains it.
    if "json" not in content_type.split(";")[0].lower():
        raise PatreonBlockedError(
            f"Patreon returned non-JSON (HTTP {resp.status_code}, {content_type or 'no content-type'})"
            " — possibly a Cloudflare challenge"
        )
    resp.raise_for_status()
    return resp.json()


def _to_post(raw) -> Post | None:
    attrs = (raw.get("attributes") if isinstance(raw, dict) else None) or {}
    url = attrs.get("url")
    url = urljoin("https://www.patreon.com/", url) if isinstance(url, str) and url else None
    if not is_http_url(url):
        log.warning("Skipping Patreon post %s with no usable url (%r)", raw.get("id"), attrs.get("url"))
        return None
    published_at = attrs.get("published_at")
    published = extract.parse_date(published_at) if isinstance(published_at, str) else None
    title = attrs.get("title")
    item = {
        "url": url,
        "title": title.strip() if isinstance(title, str) and title.strip() else None,
        "category": category_label(attrs.get("post_type")),
        "published": published.isoformat() if published else None,
    }
    return Post(
        id=str(raw.get("id") or ""),
        item=item,
        public=attrs.get("current_user_can_view") is True,
        image=_cover_image(attrs.get("image")),
    )


def _cover_image(image) -> str | None:
    if not isinstance(image, dict):
        return None
    for key in ("large_url", "url", "thumb_url"):
        if is_http_url(image.get(key)):
            return image[key]
    return None
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_patreon.py -v`
Expected: all PASS.

Run: `uv run pytest`
Expected: the whole suite passes (71 tests at this point).

- [ ] **Step 7: Commit**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git add scraper/patreon.py tests/conftest.py tests/test_patreon.py tests/fixtures/patreon/vanity.json tests/fixtures/patreon/vanity_not_found.json tests/fixtures/patreon/posts.json tests/fixtures/patreon/challenge.html
git commit -m "$(printf 'List Patreon posts from the anonymous web API\n\nResolve a creator vanity to a campaign and fetch the newest posts,\nrequesting only metadata fields. Non-JSON answers (e.g. a Cloudflare\nchallenge) raise PatreonBlockedError; an unknown vanity raises ValueError.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 4: Summaries, and fetching bodies for public posts only

**Files:**
- Modify: `scraper/patreon.py`
- Test: `tests/test_patreon.py` (append)

**Interfaces:**
- Consumes: `Post`, `API`, `NO_INCLUDES` and `_get_json` (Task 3). `body_html` and `is_http_url` (Task 2). The `patreon_http` and `kenji_http` fixtures (Task 3).
- Produces:
  - `patreon.enrich_new(item: dict, post: Post, cfg: dict) -> dict`: sets `item["summary"]` and returns `item`. It makes exactly one request for a public post and none for a locked post. It never raises on a body failure.
  - `patreon.build_summary(item: dict, *, public: bool, image: str | None, body: str = "") -> str`
  - `patreon.BODY_FIELDS = "content_json_string,current_user_can_view"`

- [ ] **Step 1: Write the failing tests**

Append this to the end of `tests/test_patreon.py`:

```python


# --- summaries and enrich_new -----------------------------------------------

HONING_URL = "https://frienji.kenjilopezalt.com/posts/how-honing-fixes-168800580"
LOCKED_URL = "https://frienji.kenjilopezalt.com/posts/recipe-grilled-169260984"


def _item(url, category):
    return {"url": url, "title": "T", "category": category, "published": "2026-09-08T17:14:33+00:00"}


def _post(post_id, url, category, public, image=None):
    return patreon.Post(id=post_id, item=_item(url, category), public=public, image=image)


def test_locked_post_gets_label_summary_and_no_request(patreon_http):
    post = _post("169260984", LOCKED_URL, "Text", public=False)

    item = patreon.enrich_new(_item(LOCKED_URL, "Text"), post, CFG)

    assert item["summary"] == (
        f'<p>🔒 Patrons only · Text · <a href="{LOCKED_URL}">Read on Patreon →</a></p>'
    )
    assert patreon_http.calls == []


def test_locked_post_with_cover_image_shows_it_first(patreon_http):
    post = _post("169260984", LOCKED_URL, "Images", public=False, image="https://img.example/c.jpg")

    item = patreon.enrich_new(_item(LOCKED_URL, "Images"), post, CFG)

    assert item["summary"].startswith('<p><img src="https://img.example/c.jpg" alt=""></p>\n<p>🔒 Patrons only')
    assert patreon_http.calls == []


def test_public_post_summary_includes_sanitized_body(kenji_http):
    post = _post("168800580", HONING_URL, "Text", public=True)

    item = patreon.enrich_new(_item(HONING_URL, "Text"), post, CFG)

    assert kenji_http.paths() == ["/api/posts/168800580"]
    assert kenji_http.calls[0]["params"]["fields[post]"] == "content_json_string,current_user_can_view"
    assert item["summary"].startswith("<p>Hi everyone,</p>")
    assert "latest knife-sharpening video" in item["summary"]
    assert item["summary"].endswith("<hr>\n<p>Public · Text</p>")


@pytest.mark.parametrize(
    "route",
    [
        {"body": '{"errors": []}', "status": 500},
        {"body": requests.ConnectionError("boom")},
        {"fixture": "challenge.html", "content_type": "text/html"},
        {"body": '{"data": {"attributes": {"content_json_string": "{not json", "current_user_can_view": true}}}'},
    ],
)
def test_body_fetch_failure_falls_back_to_label_summary(patreon_http, caplog, route):
    patreon_http.route("/api/posts/168800580", **route)
    post = _post("168800580", HONING_URL, "Text", public=True)

    item = patreon.enrich_new(_item(HONING_URL, "Text"), post, CFG)

    assert item["summary"] == "<p>Public · Text</p>"
    assert "Could not fetch body" in caplog.text


def test_body_is_not_used_if_post_is_no_longer_viewable(patreon_http):
    secret = json.dumps({"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "SECRET"}]}]})
    patreon_http.route(
        "/api/posts/168800580",
        body=json.dumps({"data": {"attributes": {"content_json_string": secret, "current_user_can_view": False}}}),
    )
    post = _post("168800580", HONING_URL, "Text", public=True)

    item = patreon.enrich_new(_item(HONING_URL, "Text"), post, CFG)

    assert "SECRET" not in item["summary"]
    assert item["summary"] == "<p>Public · Text</p>"


def test_non_numeric_post_id_is_never_requested(patreon_http):
    post = _post("../campaigns/1", HONING_URL, "Text", public=True)

    item = patreon.enrich_new(_item(HONING_URL, "Text"), post, CFG)

    assert patreon_http.calls == []
    assert item["summary"] == "<p>Public · Text</p>"


def test_summary_escapes_every_api_value():
    item = {"url": 'https://e.com/p?a=1&b="2"<x>', "title": "t", "category": 'Vid<eo> & "co"', "published": None}

    summary = patreon.build_summary(item, public=False, image='https://img.example/a.jpg?x=1&y="2"<z>')

    assert summary == (
        '<p><img src="https://img.example/a.jpg?x=1&amp;y=&quot;2&quot;&lt;z&gt;" alt=""></p>\n'
        "<p>🔒 Patrons only · Vid&lt;eo&gt; &amp; &quot;co&quot; · "
        '<a href="https://e.com/p?a=1&amp;b=&quot;2&quot;&lt;x&gt;">Read on Patreon →</a></p>'
    )


def test_summary_drops_a_non_http_cover_image():
    summary = patreon.build_summary(_item(LOCKED_URL, "Text"), public=False, image="javascript:alert(1)")

    assert "<img" not in summary


def test_summary_without_a_category_says_post():
    summary = patreon.build_summary(_item(HONING_URL, None), public=True, image=None)

    assert summary == "<p>Public · Post</p>"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_patreon.py -v`
Expected: the new tests FAIL with `AttributeError: module 'scraper.patreon' has no attribute 'enrich_new'` (or `build_summary`). The Task 3 tests still PASS.

- [ ] **Step 3: Write the implementation**

Make these edits to `scraper/patreon.py`:

(a) Imports: change `import logging` to

```python
import html
import logging
```

and change `from .patreon_render import is_http_url` to

```python
from .patreon_render import body_html, is_http_url
```

(b) Directly below the `LIST_FIELDS = …` line, add

```python
BODY_FIELDS = "content_json_string,current_user_can_view"
```

(c) Insert these two functions between `fetch_posts` and `_campaign_id`:

```python
def enrich_new(item: dict, post: Post, cfg: dict) -> dict:
    """Set item["summary"]. For a public post, first fetch and sanitize its body
    (best-effort: on any failure, log and fall back to the label-only summary).
    A locked post gets the label-only summary and no request at all."""
    body = ""
    if post.public:
        try:
            body = _fetch_body(post, cfg)
        except Exception as exc:  # one bad post must not fail the whole site
            log.warning("Could not fetch body of public Patreon post %s: %s", item["url"], exc)
    item["summary"] = build_summary(item, public=post.public, image=post.image, body=body)
    return item


def build_summary(item: dict, *, public: bool, image: str | None, body: str = "") -> str:
    esc = html.escape  # every value here came from Patreon's API
    category = esc(item.get("category") or "Post")
    parts = []
    if is_http_url(image):
        parts.append(f'<p><img src="{esc(image)}" alt=""></p>')
    if public:
        if body:
            parts.append(body)
        parts.append(f"<p>Public · {category}</p>")
    else:
        parts.append(
            f'<p>🔒 Patrons only · {category} · <a href="{esc(item["url"])}">Read on Patreon →</a></p>'
        )
    return "\n".join(parts)
```

(d) Insert this function between `_campaign_id` and `_get_json`:

```python
def _fetch_body(post: Post, cfg: dict) -> str:
    if not post.id.isdigit():
        raise ValueError(f"unexpected post id {post.id!r}")
    data = _get_json(f"{API}/posts/{post.id}", cfg, {"fields[post]": BODY_FIELDS, **NO_INCLUDES})
    attrs = (data.get("data") or {}).get("attributes") or {}
    if attrs.get("current_user_can_view") is not True:
        # Locked between the list request and this one: publish nothing from it.
        log.warning("Patreon post %s is no longer public; not using its body", post.id)
        return ""
    return body_html(attrs.get("content_json_string"))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_patreon.py -v`
Expected: all PASS.

Run: `uv run pytest`
Expected: the whole suite passes.

- [ ] **Step 5: Commit**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git add scraper/patreon.py tests/test_patreon.py
git commit -m "$(printf 'Build Patreon summaries; fetch bodies of public posts only\n\nLocked posts get a patrons-only label linking to the post and trigger no\nrequest. Public posts get their sanitized body; any failure to fetch it\nfalls back to the label-only summary.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 5: Dispatch on `type` in `process_site`

**Files:**
- Modify: `scraper/run.py` (the imports, and `process_site` from `def process_site` up to the `state_mod.save_state` line)
- Test: `tests/test_run.py` (add `import json` at the top, and append the tests below)

**Interfaces:**
- Consumes: `patreon.fetch_posts`, `patreon.enrich_new` and `patreon.Post` (Tasks 3–4). The `kenji_http` fixture (Task 3).
- Produces: `run.SOURCE_TYPES = ("html", "patreon")`. `process_site(cfg)` raises `ValueError("<_path>: unknown type 'x' (expected one of: html, patreon)")` for an unknown `type`.

- [ ] **Step 1: Write the failing tests**

Add `import json` as the first line of `tests/test_run.py`, followed by a blank line, so that the file starts:

```python
import json

import pytest

from scraper import run
```

Then append this to the end of `tests/test_run.py`:

```python


# --- source-type dispatch ---------------------------------------------------

PATREON_SITE = {
    "id": "kenji-lopez-alt",
    "type": "patreon",
    "name": "Kenji (Patreon)",
    "vanity": "kenjilopezalt",
    "listing_url": "https://www.patreon.com/kenjilopezalt",
    "max_items": 100,
    "user_agent": "TestUA/1.0",
    "_path": "sites/kenji-lopez-alt.yaml",
}
HONING_URL = "https://frienji.kenjilopezalt.com/posts/how-honing-fixes-168800580"


@pytest.fixture
def out_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(run, "DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(run, "DOCS_FEEDS_DIR", str(tmp_path / "feeds"))
    return tmp_path


def _state(out_dirs, site_id="kenji-lopez-alt"):
    return json.loads((out_dirs / "data" / f"{site_id}.json").read_text(encoding="utf-8"))


def _no_html_fetch(*args, **kwargs):
    raise AssertionError("HTML path used for a Patreon site")


def test_patreon_site_uses_the_patreon_source(out_dirs, kenji_http, monkeypatch):
    monkeypatch.setattr(run.extract, "fetch", _no_html_fetch)

    result = run.process_site(dict(PATREON_SITE))

    assert (result["count"], result["new"]) == (4, 4)
    feed = (out_dirs / "feeds" / "kenji-lopez-alt.xml").read_text(encoding="utf-8")
    assert "Easy Weeknight Pasta with Mushrooms" in feed
    assert "Patrons only" in feed


def test_patreon_state_holds_only_item_fields(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))

    items = _state(out_dirs)["items"]
    for item in items.values():
        assert set(item) == {"url", "title", "published", "category", "summary", "first_seen"}
    assert "latest knife-sharpening video" in items[HONING_URL]["summary"]


def test_patreon_never_requests_locked_post_bodies(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))

    body_requests = sorted(p for p in kenji_http.paths() if p.startswith("/api/posts/"))
    assert body_requests == ["/api/posts/168800580", "/api/posts/169276035"]


def test_patreon_second_run_does_not_refetch_bodies(out_dirs, kenji_http):
    run.process_site(dict(PATREON_SITE))
    first = _state(out_dirs)["items"]
    kenji_http.calls.clear()

    result = run.process_site(dict(PATREON_SITE))

    assert result["new"] == 0
    assert kenji_http.paths() == ["/api/campaigns", "/api/posts"]
    assert {u: i["summary"] for u, i in _state(out_dirs)["items"].items()} == {
        u: i["summary"] for u, i in first.items()
    }


def test_patreon_listing_larger_than_max_items_does_not_crash(out_dirs, kenji_http):
    # The fake answers with all 4 fixture posts whatever page[count] says, so
    # merge_items reports 4 new URLs but keeps only the 2 newest.
    result = run.process_site(dict(PATREON_SITE, max_items=2))

    assert result["count"] == 2
    assert all(i.get("summary") for i in _state(out_dirs)["items"].values())


@pytest.mark.parametrize("type_field", [{}, {"type": "html"}])
def test_site_without_patreon_type_uses_the_html_path(out_dirs, monkeypatch, type_field):
    monkeypatch.setattr(run.patreon, "fetch_posts", lambda cfg: pytest.fail("Patreon path used for an HTML site"))
    monkeypatch.setattr(run.extract, "fetch", lambda url, user_agent=None: '<a href="/p/1">One</a>')
    cfg = {
        "id": "plain",
        "name": "Plain",
        "listing_url": "https://e.com/",
        "base_url": "https://e.com",
        "item_selector": "a",
        "fetch_detail": False,
        "_path": "sites/plain.yaml",
        **type_field,
    }

    result = run.process_site(cfg)

    assert result["count"] == 1
    assert list(_state(out_dirs, "plain")["items"]) == ["https://e.com/p/1"]


def test_unknown_type_raises_naming_the_config_file(out_dirs):
    cfg = {"id": "weird", "type": "rss", "name": "W", "listing_url": "https://e.com/", "_path": "sites/weird.yaml"}

    with pytest.raises(ValueError, match=r"sites/weird\.yaml.*'rss'"):
        run.process_site(cfg)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_run.py -v`
Expected: `8 failed, 6 passed`. The Patreon tests fail with an `AssertionError` from the HTML path (`requests.get` is stubbed, and the HTML path makes a request nobody routed). The HTML-path tests fail with `AttributeError: module 'scraper.run' has no attribute 'patreon'`. The unknown-type test fails because nothing raises `ValueError`. The 6 existing tests still PASS.

- [ ] **Step 3: Write the implementation**

In `scraper/run.py`, add `from . import patreon` between the `feedgen_util` and `state` imports:

```python
from . import extract
from . import feedgen_util
from . import patreon
from . import state as state_mod
```

Replace everything from `def process_site(cfg: dict) -> dict:` (inclusive) down to (but not including) the line `    state_mod.save_state(state_path, state)` with:

```python
SOURCE_TYPES = ("html", "patreon")


def process_site(cfg: dict) -> dict:
    site_id = cfg["id"]
    source_type = cfg.get("type", "html")
    if source_type not in SOURCE_TYPES:
        raise ValueError(
            f"{cfg['_path']}: unknown type {source_type!r} (expected one of: {', '.join(SOURCE_TYPES)})"
        )
    log.info("Scraping %s (%s)", site_id, cfg["listing_url"])

    posts_by_url: dict[str, patreon.Post] = {}
    if source_type == "patreon":
        posts = patreon.fetch_posts(cfg)
        posts_by_url = {p.item["url"]: p for p in posts}
        scraped = [p.item for p in posts]
        log.info("  found %d post(s) on Patreon", len(scraped))
        if not scraped:
            log.warning("  0 posts returned for Patreon vanity %r (%s)", cfg.get("vanity"), cfg["_path"])
    else:
        html = extract.fetch(cfg["listing_url"], cfg.get("user_agent"))
        scraped = extract.extract_items(html, cfg)
        log.info("  found %d item(s) on the listing page", len(scraped))
        if not scraped:
            log.warning(
                "  0 items matched item_selector %r — the site's markup likely changed; "
                "re-check the selectors in %s",
                cfg["item_selector"],
                cfg["_path"],
            )

    state_path = os.path.join(DATA_DIR, f"{site_id}.json")
    state = state_mod.load_state(state_path)
    new_urls = state_mod.merge_items(state, scraped, max_items=cfg.get("max_items", 100))
    log.info("  %d new item(s) since last run", len(new_urls))

    if source_type == "patreon":
        for url in new_urls:
            if url not in state["items"]:  # new, but already trimmed by max_items
                continue
            state["items"][url] = patreon.enrich_new(state["items"][url], posts_by_url[url], cfg)
    elif cfg.get("fetch_detail", True):
        for url in new_urls:
            log.info("  fetching detail page for new item: %s", url)
            state["items"][url] = extract.enrich_with_detail(state["items"][url], cfg)
```

The rest of `process_site` (save state, build and write the feed, return the result dict) is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_run.py -v`
Expected: all PASS.

Run: `uv run pytest`
Expected: the whole suite passes (91 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git add scraper/run.py tests/test_run.py
git commit -m "$(printf 'Dispatch process_site on the config type field\n\ntype defaults to html (unchanged). type: patreon lists and enriches via\nscraper/patreon.py; state, feed and index steps are shared. Unknown types\nraise ValueError naming the config file.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 6: Kenji's config, docs, and a live local run

**Files:**
- Create: `sites/kenji-lopez-alt.yaml`
- Modify: `README.md` (a new section after "Adding another site", and bullets under "Limitations")
- Modify: `CLAUDE.md` (one paragraph in "Architecture")

**Interfaces:**
- Consumes: everything from Tasks 2–5.
- Produces: the first Patreon feed config. `update-feeds` will pick it up after merge.

The test for this task is the live run in Step 4. The config and docs have no unit test.

- [ ] **Step 1: Create the site config**

Create `sites/kenji-lopez-alt.yaml`:

```yaml
# Patreon creator feed, built from what a logged-out visitor can see.
# Locked posts appear as title + cover image + a "patrons only" link;
# public posts also carry their full text. See README "Adding a Patreon creator".

id: kenji-lopez-alt
type: patreon
name: "J. Kenji López-Alt (Patreon, unofficial)"
description: "Post titles and public posts from Kenji's Patreon; locked posts link through."
vanity: kenjilopezalt
listing_url: "https://www.patreon.com/kenjilopezalt"

max_items: 100

user_agent: "Mozilla/5.0 (compatible; PersonalSiteRSSBot/1.0; run by a single subscriber for personal use)"
```

- [ ] **Step 2: Document it in README.md**

Insert this section immediately before the `## Limitations` heading:

````markdown
## Adding a Patreon creator

A `type: patreon` config builds a feed from what a logged-out visitor can see
on a creator's Patreon, using the JSON API that patreon.com's own pages call
(not Patreon's official API). Every post appears with its title, date, post
type and cover image. Public posts also carry their full text. Locked posts
get a "🔒 Patrons only · Read on Patreon →" link, so you click through and
read them on Patreon while logged in. Nothing locked is ever requested or
published, and no Patreon login, cookie or token is involved.

1. Find the creator's vanity name, the `<vanity>` in `patreon.com/<vanity>`.
   It works even if the creator's page lives on a custom domain.
2. Copy `sites/kenji-lopez-alt.yaml` to `sites/<id>.yaml` and change `id`,
   `name`, `description`, `vanity` and `listing_url`:

   | Field | Meaning |
   |---|---|
   | `type` | `patreon` (leave it out, or use `html`, for a scraped site) |
   | `vanity` | The creator's name in `patreon.com/<vanity>` |
   | `listing_url` | The creator's Patreon page, used as the feed's link |
   | `max_items` | How many posts to keep. Each run asks for the newest `min(max_items, 100)` |
   | `user_agent` | As for scraped sites |

   Selector fields and `fetch_detail` don't apply to Patreon configs and are ignored.

3. Test locally with `uv run python -m scraper.run <id>`, then check
   `docs/feeds/<id>.xml`.
````

Append these bullets to the end of the `## Limitations` list:

```markdown
- Patreon feeds use an undocumented API that can change without notice. If
  Patreon starts serving GitHub's runners a Cloudflare challenge, the run
  fails with "Patreon returned non-JSON … possibly a Cloudflare challenge".
- Patreon image URLs are signed and expire after about two weeks. Readers
  that cache images when they fetch an item keep them. Others show broken
  images on older posts.
- A Patreon post's summary is built once, when the post first appears. A
  post that is unlocked or locked later keeps its original summary, and edits
  to a public post's text aren't picked up.
```

- [ ] **Step 3: Note the dispatch in CLAUDE.md**

In `CLAUDE.md`, under `## Architecture`, add this paragraph directly after the numbered pipeline list and before the paragraph that begins `` `.github/workflows/update-feeds.yml` runs``:

```markdown
Each config may set `type` (default `html`, the pipeline above). `type: patreon`
swaps step 2 (listing and detail enrichment) for `scraper/patreon.py` (Patreon's
anonymous web API; public post bodies are rendered and nh3-sanitized by
`scraper/patreon_render.py`); state, feed and index steps are shared.
```

- [ ] **Step 4: Live run (this is the network test)**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
uv run python -m scraper.run kenji-lopez-alt
uv run python -c "import json; d=json.load(open('data/kenji-lopez-alt.json'))['items']; pub=[i for i in d.values() if 'Public ·' in i['summary']]; print(len(d), 'items,', len(pub), 'public,', sum('Patrons only' in i['summary'] for i in d.values()), 'locked')"
grep -c '<item>' docs/feeds/kenji-lopez-alt.xml
```

Expected: log lines `found 100 post(s) on Patreon` and `100 new item(s) since last run`, no traceback, exit code 0. The item count is 100, the public and locked counts add up to 100 (the planning probe saw 14 public), and `grep` prints `100`. The code only requests bodies of public posts. Paste the output.

- [ ] **Step 5: Discard the generated output**

The scheduled workflow on `main` owns these files, so don't commit them:

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git status --short
rm -f data/kenji-lopez-alt.json docs/feeds/kenji-lopez-alt.xml
git restore docs/index.html
git status --short
```

Expected: after cleanup, `git status --short` lists only `sites/kenji-lopez-alt.yaml`, `README.md` and `CLAUDE.md`.

- [ ] **Step 6: Commit**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git add sites/kenji-lopez-alt.yaml README.md CLAUDE.md
git commit -m "$(printf 'Add a Patreon feed for J. Kenji López-Alt, and document type: patreon\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

---

### Task 7: Remove the smoke workflow and run the full gauntlet

**Files:**
- Delete: `.github/workflows/patreon-smoke.yml`

**Interfaces:**
- Consumes: everything.
- Produces: a branch ready for `superpowers:finishing-a-development-branch`.

- [ ] **Step 1: Delete the temporary workflow**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git rm .github/workflows/patreon-smoke.yml
git commit -m "$(printf 'Remove temporary Patreon smoke-test workflow\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')"
```

- [ ] **Step 2: Run the full test suite**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
uv run pytest
```

Expected: `91 passed` and no failures or errors. **Paste the command and its full output.**

- [ ] **Step 3: Prove the HTML path is unchanged**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
uv run python -m scraper.run anthropic-news
```

Expected: `Scraping anthropic-news (…)`, `found N item(s) on the listing page` with N > 0, `wrote …/docs/feeds/anthropic-news.xml`, no traceback, exit code 0. **Paste the command and its full output.**

- [ ] **Step 4: Discard the generated output**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git status --short
git restore data/anthropic-news.json docs/feeds/anthropic-news.xml docs/index.html
git status --short
```

Expected: the final `git status --short` prints nothing. If `git restore` complains that a file doesn't exist or is unchanged, drop that path and rerun it for the rest.

- [ ] **Step 5: Confirm the branch contents**

```bash
cd /Users/mcable/src/feed-scraper/.worktrees/patreon-source
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: the spec commit plus one commit per task. The diffstat shows no `.github/workflows/patreon-smoke.yml`, and no `data/` or `docs/feeds/` files.
