from scraper import state as state_mod


def test_last_updated_is_newest_first_seen():
    state = {
        "items": {
            "a": {"first_seen": "2026-09-17T22:52:06+00:00"},
            "b": {"first_seen": "2026-09-18T10:00:00+00:00"},
            "c": {"first_seen": "2026-09-01T00:00:00+00:00"},
        }
    }

    assert state_mod.last_updated(state) == "2026-09-18T10:00:00+00:00"


def test_last_updated_is_none_without_items():
    assert state_mod.last_updated({"items": {}}) is None
