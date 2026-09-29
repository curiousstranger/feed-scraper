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
