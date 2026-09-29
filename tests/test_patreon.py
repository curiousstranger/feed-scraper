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
