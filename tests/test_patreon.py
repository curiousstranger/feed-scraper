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
