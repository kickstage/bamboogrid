"""Session ownership — enforcement in ``current_session``, owner-stamping on
create, and the ``/sessions`` / claim / delete endpoints.

Tokens are minted directly (Google verification isn't involved once signed in),
so a "user" here is just an ``Authorization: Bearer`` header carrying an app token.
"""

import os
import time

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.auth as auth
import app.session as session_mod
from app.main import app
from app.schema import User


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    """Sign-in on with test credentials for every test in this module."""
    monkeypatch.setattr(auth, "_GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(auth, "_APP_JWT_SECRET", "x" * 32)


def bearer(user_id: str, email: str = "") -> dict[str, str]:
    token = auth.mint_app_token(User(id=user_id, email=email or f"{user_id}@x.com"))
    return {"Authorization": f"Bearer {token}"}


def sid_header(session_id: str) -> dict[str, str]:
    return {"X-Session-Id": session_id}


def make_session(client, headers: dict | None = None) -> str:
    res = client.post("/session", headers=headers or {})
    assert res.status_code == 200
    return res.json()["id"]


# --- enforcement -----------------------------------------------------------


def test_guest_session_stays_open_to_any_holder(client):
    sid = make_session(client)  # no auth → guest
    # Reachable with no auth, and even with an unrelated user's token: the id is
    # the capability for guest sessions (unchanged pre-auth behavior).
    assert client.get("/session", headers=sid_header(sid)).status_code == 200
    assert (
        client.get("/session", headers={**sid_header(sid), **bearer("stranger")}).status_code
        == 200
    )


def test_owned_session_requires_its_owner(client):
    sid = make_session(client, bearer("alice"))
    # Owner: ok.
    assert client.get("/session", headers={**sid_header(sid), **bearer("alice")}).status_code == 200
    # Guest (no token) and a different user: indistinguishable from missing (404).
    assert client.get("/session", headers=sid_header(sid)).status_code == 404
    assert client.get("/session", headers={**sid_header(sid), **bearer("bob")}).status_code == 404


def test_owned_session_blocks_mutations_too(client):
    sid = make_session(client, bearer("alice"))
    # A command from a non-owner is refused at the same chokepoint.
    res = client.post("/session/commands", headers={**sid_header(sid), **bearer("bob")}, json=[])
    assert res.status_code == 404


# --- listing ---------------------------------------------------------------


def test_list_sessions_scoped_to_owner_newest_first(client):
    first = make_session(client, bearer("alice"))
    time.sleep(0.01)
    second = make_session(client, bearer("alice"))
    make_session(client, bearer("bob"))

    res = client.get("/sessions", headers=bearer("alice"))
    assert res.status_code == 200
    ids = [g["id"] for g in res.json()]
    assert ids == [second, first]  # most-recently-updated first

    # Bob sees only his own single grid.
    assert len(client.get("/sessions", headers=bearer("bob")).json()) == 1


def test_list_sessions_401_for_guest(client):
    assert client.get("/sessions").status_code == 401


def test_rename_updates_name_in_view_and_list(client):
    sid = make_session(client, bearer("alice"))
    res = client.put(
        "/session/name",
        headers={**sid_header(sid), **bearer("alice")},
        json={"name": "My feeder"},
    )
    assert res.status_code == 200
    assert res.json()["network"]["name"] == "My feeder"
    # The saved-grids list reflects the new name.
    grids = client.get("/sessions", headers=bearer("alice")).json()
    assert grids[0]["name"] == "My feeder"


def test_rename_blank_falls_back_to_untitled(client):
    sid = make_session(client, bearer("alice"))
    res = client.put(
        "/session/name",
        headers={**sid_header(sid), **bearer("alice")},
        json={"name": "   "},
    )
    assert res.json()["network"]["name"] == "Untitled scenario"


# --- claim -----------------------------------------------------------------


def test_claim_attaches_guest_session_to_user(client):
    sid = make_session(client)  # guest
    assert client.get("/sessions", headers=bearer("alice")).json() == []

    res = client.post(f"/session/{sid}/claim", headers=bearer("alice"))
    assert res.status_code == 200

    listed = [g["id"] for g in client.get("/sessions", headers=bearer("alice")).json()]
    assert sid in listed
    # Now owned: a guest can no longer reach it.
    assert client.get("/session", headers=sid_header(sid)).status_code == 404
    assert client.get("/session", headers={**sid_header(sid), **bearer("alice")}).status_code == 200


def test_claim_is_idempotent_for_owner_but_hides_others(client):
    sid = make_session(client, bearer("alice"))
    # Already Alice's → still ok.
    assert client.post(f"/session/{sid}/claim", headers=bearer("alice")).status_code == 200
    # Bob cannot claim Alice's grid, and it's invisible to him (404, not 403).
    assert client.post(f"/session/{sid}/claim", headers=bearer("bob")).status_code == 404


def test_claim_unknown_session_404_and_guest_401(client):
    assert client.post("/session/does-not-exist/claim", headers=bearer("alice")).status_code == 404
    assert client.post("/session/whatever/claim").status_code == 401


# --- delete ----------------------------------------------------------------


def test_owner_can_delete_grid(client):
    sid = make_session(client, bearer("alice"))
    assert client.delete(f"/session/{sid}", headers=bearer("alice")).status_code == 200
    assert client.get("/sessions", headers=bearer("alice")).json() == []
    # It's really gone.
    assert client.get("/session", headers={**sid_header(sid), **bearer("alice")}).status_code == 404


def test_delete_others_or_guest_grid_is_refused(client):
    owned = make_session(client, bearer("alice"))
    assert client.delete(f"/session/{owned}", headers=bearer("bob")).status_code == 404
    guest = make_session(client)
    assert client.delete(f"/session/{guest}", headers=bearer("alice")).status_code == 404
    assert client.delete(f"/session/{owned}").status_code == 401


# --- shared-copy ownership -------------------------------------------------


def test_opening_a_share_while_signed_in_yields_an_owned_copy(client):
    src = make_session(client, bearer("alice"))
    token = client.post("/session/share", headers={**sid_header(src), **bearer("alice")}).json()[
        "token"
    ]
    opened = client.post(f"/share/{token}", headers=bearer("bob"))
    assert opened.status_code == 200
    copy_id = opened.json()["id"]
    listed = [g["id"] for g in client.get("/sessions", headers=bearer("bob")).json()]
    assert copy_id in listed  # the copy belongs to whoever opened it


# --- purge only guests (store level) ---------------------------------------


def test_purge_expired_keeps_owned_sessions():
    store = session_mod.store
    guest = store.create()
    owned = store.create(owner_id="alice")
    # Age both well past the TTL.
    old = time.time() - session_mod._TTL_S - 1
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("UPDATE sessions SET updated_at=%s", (old,))

    store._purge_expired()

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = {r[0] for r in conn.execute("SELECT id FROM sessions").fetchall()}
    assert owned.id in rows  # owned grid survives its idle TTL
    assert guest.id not in rows  # guest grid is purged
