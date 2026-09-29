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
