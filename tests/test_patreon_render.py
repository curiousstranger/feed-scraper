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
