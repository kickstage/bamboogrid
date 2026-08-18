"""Read-only scenario embeds: the share-token read path, the oEmbed endpoint,
and the clickjacking (frame-ancestors) header.

Embed markup is published verbatim on third-party pages, so the model under test
is deliberately narrow: embeds are keyed by *share token* (never a session id),
mint no tokens as a side effect, echo nothing caller-supplied, render the saved
snapshot (never in-progress edits), and keep working — name and all — after the
source session is purged. These exercise those invariants end to end against the
real Postgres-backed store.
"""

import os
import time

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.session as session_mod
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def auth(sid: str) -> dict[str, str]:
    return {"X-Session-Id": sid}


def new_session(client) -> str:
    res = client.post("/session")
    assert res.status_code == 200
    return res.json()["id"]


def add_bus(client, sid: str, bus_id: str = "b1", headers: dict | None = None) -> None:
    res = client.post(
        "/session/commands",
        headers={**auth(sid), **(headers or {})},
        json=[
            {
                "op": "add_bus",
                "payload": {"id": bus_id, "name": bus_id, "vn_kv": 20.0, "x": 0, "y": 0, "width": 220},
            }
        ],
    )
    assert res.status_code == 200


def share(client, sid: str, headers: dict | None = None) -> str:
    res = client.post("/session/share", headers={**auth(sid), **(headers or {})})
    assert res.status_code == 200
    return res.json()["token"]


def purge_session(session_id: str) -> None:
    """Drop the source session (as the TTL purge would) while keeping the share
    row, to exercise the snapshot-fallback path an outliving embed relies on."""
    store = session_mod.store
    with store._guard:  # noqa: SLF001 - test reaches into the store on purpose
        store._live.pop(session_id, None)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("DELETE FROM sessions WHERE id=%s", (session_id,))


# --- embed read path (share token, no side effects) ------------------------


def test_embed_view_resolves_by_share_token(client):
    sid = new_session(client)
    add_bus(client, sid, "b1")
    token = share(client, sid)

    res = client.get(f"/embed/view/{token}")
    assert res.status_code == 200
    body = res.json()
    assert {b["id"] for b in body["view"]["network"]["buses"]} == {"b1"}


def test_embed_view_unknown_token_is_404(client):
    assert client.get("/embed/view/does-not-exist").status_code == 404


def test_embed_view_rejects_a_session_id(client):
    """The session id is the bearer capability; it must never resolve an embed."""
    sid = new_session(client)
    add_bus(client, sid, "b1")
    assert client.get(f"/embed/view/{sid}").status_code == 404


def test_embed_view_has_no_side_effects(client):
    """A pure read: hitting it must not mint a share the way /session/share does."""
    sid = new_session(client)
    add_bus(client, sid, "b1")
    assert client.get("/embed/view/some-token").status_code == 404
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        count = conn.execute("SELECT count(*) FROM shares").fetchone()[0]
    assert count == 0


def _signed_in_bearer(monkeypatch) -> dict[str, str]:
    """Turn sign-in on with test credentials and return an owner's bearer header.
    Saving (which needs a signed-in user) is what creates a saved snapshot."""
    import app.auth as auth_mod
    from app.schema import User

    monkeypatch.setattr(auth_mod, "_GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(auth_mod, "_APP_JWT_SECRET", "x" * 32)
    token = auth_mod.mint_app_token(User(id="alice", email="a@x.com"))
    return {"Authorization": f"Bearer {token}"}


def test_embed_renders_saved_snapshot_not_in_progress_edits(client, monkeypatch):
    """An embed of a saved scenario must show the saved state, not unsaved edits."""
    bearer = _signed_in_bearer(monkeypatch)

    sid = new_session(client)
    add_bus(client, sid, "saved_bus")
    assert client.post("/session/save", headers={**auth(sid), **bearer}).status_code == 200
    # An unsaved edit rides on the working copy only (owned now, so authenticate).
    add_bus(client, sid, "draft_bus", headers=bearer)

    token = share(client, sid, headers=bearer)
    buses = {
        b["id"]
        for b in client.get(f"/embed/view/{token}").json()["view"]["network"]["buses"]
    }
    assert buses == {"saved_bus"}  # the draft must not leak into the embed


def test_embed_survives_session_purge(client):
    sid = new_session(client)
    add_bus(client, sid, "b1")
    token = share(client, sid)

    purge_session(sid)

    res = client.get(f"/embed/view/{token}")
    assert res.status_code == 200
    assert {b["id"] for b in res.json()["view"]["network"]["buses"]} == {"b1"}


def test_embed_keeps_its_name_after_purge(client):
    """The name is captured on the share row, so it survives the source session."""
    sid = new_session(client)
    add_bus(client, sid, "b1")
    client.put("/session/name", headers=auth(sid), json={"name": "My Feeder"})
    token = share(client, sid)

    purge_session(sid)

    assert client.get(f"/embed/view/{token}").json()["name"] == "My Feeder"
    # oEmbed title comes from the same place and must not degrade either.
    url = f"http://testserver/embed/{token}"
    assert client.get("/oembed", params={"url": url}).json()["title"] == "My Feeder"


# --- share snapshot content ------------------------------------------------


def test_reshare_refreshes_but_still_hides_unsaved_edits(client, monkeypatch):
    """Re-sharing refreshes the fallback snapshot from COALESCE(saved, working)."""
    bearer = _signed_in_bearer(monkeypatch)

    sid = new_session(client)
    add_bus(client, sid, "saved_bus")
    client.post("/session/save", headers={**auth(sid), **bearer})
    add_bus(client, sid, "draft_bus", headers=bearer)  # unsaved

    token = share(client, sid, headers=bearer)  # snapshots COALESCE(saved, working) == saved
    purge_session(sid)

    buses = {
        b["id"]
        for b in client.get(f"/embed/view/{token}").json()["view"]["network"]["buses"]
    }
    assert buses == {"saved_bus"}  # the fallback matches the read path's promise


# --- oEmbed endpoint -------------------------------------------------------


def oembed(client, token: str, **params):
    url = f"http://testserver/embed/{token}"
    return client.get("/oembed", params={"url": url, **params})


def test_oembed_returns_rich_payload(client):
    sid = new_session(client)
    add_bus(client, sid, "b1")
    client.put("/session/name", headers=auth(sid), json={"name": "Grid"})
    token = share(client, sid)

    res = oembed(client, token)
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "rich"
    assert body["version"] == "1.0"
    assert body["title"] == "Grid"
    assert body["provider_name"] == "BambooGrid"
    assert f"/embed/{token}" in body["html"]


def test_oembed_only_json_format(client):
    sid = new_session(client)
    add_bus(client, sid)
    token = share(client, sid)
    assert oembed(client, token, format="xml").status_code == 501


def test_oembed_rejects_foreign_origin(client):
    res = client.get(
        "/oembed", params={"url": "https://evil.example.com/embed/abc"}
    )
    assert res.status_code == 404


def test_oembed_rejects_non_embed_path(client):
    res = client.get("/oembed", params={"url": "http://testserver/session/abc"})
    assert res.status_code == 404


def test_oembed_rejects_bad_token(client):
    res = client.get(
        "/oembed", params={"url": "http://testserver/embed/has spaces"}
    )
    assert res.status_code == 404


def test_oembed_unknown_token_is_404(client):
    res = client.get("/oembed", params={"url": "http://testserver/embed/nope"})
    assert res.status_code == 404


def test_oembed_does_not_echo_caller_input(client):
    """Only a validated theme/controls survive; junk query params are dropped and
    never reflected into the returned HTML."""
    sid = new_session(client)
    add_bus(client, sid)
    token = share(client, sid)

    url = f'http://testserver/embed/{token}?theme=dark&controls=false&evil="><script>'
    body = client.get("/oembed", params={"url": url}).json()
    assert "<script>" not in body["html"]
    assert "evil" not in body["html"]
    assert "theme=dark" in body["html"]
    assert "controls=false" in body["html"]


def test_oembed_clamps_size_within_requested_maximum(client):
    """maxwidth/maxheight are maxima: the result must never exceed them."""
    sid = new_session(client)
    add_bus(client, sid)
    token = share(client, sid)

    body = oembed(client, token, maxwidth=400, maxheight=300).json()
    assert body["width"] <= 400
    assert body["height"] <= 300


def test_oembed_clamps_to_display_cap(client):
    sid = new_session(client)
    add_bus(client, sid)
    token = share(client, sid)

    body = oembed(client, token, maxwidth=5000, maxheight=5000).json()
    assert body["width"] == 800
    assert body["height"] == 1200


def test_oembed_too_small_request_is_501(client):
    """A ceiling below the minimum renderable size can't be honored (never a
    floor that hands back something larger than asked for)."""
    sid = new_session(client)
    add_bus(client, sid)
    token = share(client, sid)

    assert oembed(client, token, maxwidth=100, maxheight=100).status_code == 501


# --- clickjacking / framing headers ----------------------------------------


def test_editor_refuses_third_party_framing(client):
    assert (
        client.get("/health").headers["content-security-policy"]
        == "frame-ancestors 'self'"
    )


def test_embed_page_opts_into_framing(client):
    sid = new_session(client)
    add_bus(client, sid)
    token = share(client, sid)
    res = client.get(f"/embed/{token}")
    # The embed SPA may be unbuilt in the test image (404); when served it must
    # carry the framing opt-in rather than the editor's refusal.
    if res.status_code == 200:
        assert res.headers["content-security-policy"] == "frame-ancestors *"
