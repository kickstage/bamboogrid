"""Session ownership and explicit save.

A session belongs to nobody until it is *saved*: saving is what claims it and puts
it in the owner's library. So these cover ``current_session`` enforcement, the
``/sessions`` list, save / revert / detach, and delete.

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


def make_session(client) -> str:
    """A fresh session. Unowned — that is now the only way a session is born."""
    res = client.post("/session")
    assert res.status_code == 200
    return res.json()["id"]


def add_bus(client, sid: str, bus_id: str, headers: dict | None = None) -> None:
    res = client.post(
        "/session/commands",
        headers={**sid_header(sid), **(headers or {})},
        json=[
            {
                "op": "add_bus",
                "payload": {"id": bus_id, "name": bus_id, "vn_kv": 20.0, "x": 0, "y": 0},
            }
        ],
    )
    assert res.status_code == 200


def save(client, sid: str, user: str) -> dict:
    res = client.post("/session/save", headers={**sid_header(sid), **bearer(user)})
    assert res.status_code == 200
    return res.json()


def make_owned(client, user: str) -> str:
    """A saved scenario belonging to ``user`` — create, then save (which claims it)."""
    sid = make_session(client)
    save(client, sid, user)
    return sid


# --- enforcement -----------------------------------------------------------


def test_guest_session_stays_open_to_any_holder(client):
    sid = make_session(client)
    # Reachable with no auth, and even with an unrelated user's token: the id is
    # the capability for unowned sessions (unchanged pre-auth behavior).
    assert client.get("/session", headers=sid_header(sid)).status_code == 200
    assert (
        client.get("/session", headers={**sid_header(sid), **bearer("stranger")}).status_code
        == 200
    )


def test_a_session_is_unowned_until_saved(client):
    """The heart of explicit save: signing in doesn't claim what you're editing."""
    sid = make_session(client)
    add_bus(client, sid, "b1", bearer("alice"))
    # Alice has edited it while signed in, yet it is in nobody's library...
    assert client.get("/sessions", headers=bearer("alice")).json() == []
    # ...and it is still reachable as a guest, because it is still unowned.
    assert client.get("/session", headers=sid_header(sid)).status_code == 200

    save(client, sid, "alice")

    listed = [g["id"] for g in client.get("/sessions", headers=bearer("alice")).json()]
    assert sid in listed
    # Saving claimed it: a guest can no longer reach it.
    assert client.get("/session", headers=sid_header(sid)).status_code == 404


def test_owned_session_requires_its_owner(client):
    sid = make_owned(client, "alice")
    assert client.get("/session", headers={**sid_header(sid), **bearer("alice")}).status_code == 200
    # Guest (no token) and a different user: indistinguishable from missing (404).
    assert client.get("/session", headers=sid_header(sid)).status_code == 404
    assert client.get("/session", headers={**sid_header(sid), **bearer("bob")}).status_code == 404


def test_owned_session_blocks_mutations_too(client):
    sid = make_owned(client, "alice")
    res = client.post("/session/commands", headers={**sid_header(sid), **bearer("bob")}, json=[])
    assert res.status_code == 404


# --- unsaved-changes tracking ----------------------------------------------


def test_editing_marks_dirty_and_saving_clears_it(client):
    sid = make_session(client)
    view = client.get("/session", headers=sid_header(sid)).json()
    assert view["dirty"] is False and view["saved_at"] is None

    add_bus(client, sid, "b1")
    assert client.get("/session", headers=sid_header(sid)).json()["dirty"] is True

    meta = save(client, sid, "alice")
    assert meta["dirty"] is False and meta["saved_at"] is not None

    add_bus(client, sid, "b2", bearer("alice"))
    assert client.get("/session", headers={**sid_header(sid), **bearer("alice")}).json()["dirty"]


def test_save_requires_sign_in(client):
    sid = make_session(client)
    assert client.post("/session/save", headers=sid_header(sid)).status_code == 401


# --- revert (discard unsaved changes) --------------------------------------


def test_revert_restores_the_saved_state(client):
    sid = make_session(client)
    add_bus(client, sid, "b1")
    save(client, sid, "alice")

    add_bus(client, sid, "b2", bearer("alice"))
    view = client.get("/session", headers={**sid_header(sid), **bearer("alice")}).json()
    assert {b["id"] for b in view["network"]["buses"]} == {"b1", "b2"}

    res = client.post("/session/revert", headers={**sid_header(sid), **bearer("alice")})
    assert res.status_code == 200
    assert res.json()["dirty"] is False

    view = client.get("/session", headers={**sid_header(sid), **bearer("alice")}).json()
    assert {b["id"] for b in view["network"]["buses"]} == {"b1"}  # b2 discarded


def test_revert_refuses_when_never_saved(client):
    """Its working copy is the only copy of that work, so it must not be wiped."""
    sid = make_session(client)
    add_bus(client, sid, "b1")
    res = client.post("/session/revert", headers=sid_header(sid))
    assert res.status_code == 400
    # Still there.
    view = client.get("/session", headers=sid_header(sid)).json()
    assert {b["id"] for b in view["network"]["buses"]} == {"b1"}


def test_revert_keeps_a_rename(client):
    """A rename is metadata, not one of the edits a discard throws away."""
    sid = make_session(client)
    add_bus(client, sid, "b1")
    save(client, sid, "alice")
    owner = {**sid_header(sid), **bearer("alice")}

    client.put("/session/name", headers=owner, json={"name": "My feeder"})
    add_bus(client, sid, "b2", bearer("alice"))
    client.post("/session/revert", headers=owner)

    view = client.get("/session", headers=owner).json()
    assert {b["id"] for b in view["network"]["buses"]} == {"b1"}  # the edit went
    assert view["network"]["name"] == "My feeder"  # the rename stayed
    assert client.get("/sessions", headers=bearer("alice")).json()[0]["name"] == "My feeder"


def test_rename_does_not_mark_the_scenario_unsaved(client):
    sid = make_owned(client, "alice")
    owner = {**sid_header(sid), **bearer("alice")}
    res = client.put("/session/name", headers=owner, json={"name": "My feeder"})
    assert res.status_code == 200
    assert res.json()["dirty"] is False


# --- detach (sign-out keeps the scenario on the canvas) ---------------------


def test_detach_copies_into_an_unowned_session(client):
    sid = make_session(client)
    add_bus(client, sid, "b1")
    save(client, sid, "alice")
    owner = {**sid_header(sid), **bearer("alice")}

    res = client.post("/session/detach", headers=owner)
    assert res.status_code == 200
    copy_id = res.json()["id"]
    assert copy_id != sid

    # The copy is a guest scratch scenario: reachable without a token, unsaved,
    # and in nobody's library.
    copy = client.get("/session", headers=sid_header(copy_id)).json()
    assert copy["saved_at"] is None
    assert {b["id"] for b in copy["network"]["buses"]} == {"b1"}
    assert [g["id"] for g in client.get("/sessions", headers=bearer("alice")).json()] == [sid]

    # The original is untouched and still Alice's.
    assert client.get("/session", headers=owner).status_code == 200


def test_detach_carries_unsaved_edits_into_the_copy(client):
    sid = make_session(client)
    add_bus(client, sid, "b1")
    save(client, sid, "alice")
    owner = {**sid_header(sid), **bearer("alice")}
    add_bus(client, sid, "b2", bearer("alice"))  # unsaved

    copy_id = client.post("/session/detach", headers=owner).json()["id"]
    copy = client.get("/session", headers=sid_header(copy_id)).json()
    assert {b["id"] for b in copy["network"]["buses"]} == {"b1", "b2"}


# --- listing ---------------------------------------------------------------


def test_list_sessions_scoped_to_owner_newest_saved_first(client):
    first = make_owned(client, "alice")
    time.sleep(0.01)
    second = make_owned(client, "alice")
    make_owned(client, "bob")

    res = client.get("/sessions", headers=bearer("alice"))
    assert res.status_code == 200
    assert [g["id"] for g in res.json()] == [second, first]  # most-recently-saved first
    assert len(client.get("/sessions", headers=bearer("bob")).json()) == 1


def test_list_sessions_401_for_guest(client):
    assert client.get("/sessions").status_code == 401


def test_rename_updates_name_in_view_and_list(client):
    sid = make_owned(client, "alice")
    res = client.put(
        "/session/name",
        headers={**sid_header(sid), **bearer("alice")},
        json={"name": "My feeder"},
    )
    assert res.status_code == 200
    assert res.json()["network"]["name"] == "My feeder"
    grids = client.get("/sessions", headers=bearer("alice")).json()
    assert grids[0]["name"] == "My feeder"


def test_rename_blank_falls_back_to_untitled(client):
    sid = make_owned(client, "alice")
    res = client.put(
        "/session/name",
        headers={**sid_header(sid), **bearer("alice")},
        json={"name": "   "},
    )
    assert res.json()["network"]["name"] == "Untitled scenario"


# --- delete ----------------------------------------------------------------


def test_owner_can_delete_grid(client):
    sid = make_owned(client, "alice")
    assert client.delete(f"/session/{sid}", headers=bearer("alice")).status_code == 200
    assert client.get("/sessions", headers=bearer("alice")).json() == []
    assert client.get("/session", headers={**sid_header(sid), **bearer("alice")}).status_code == 404


def test_delete_others_or_guest_grid_is_refused(client):
    owned = make_owned(client, "alice")
    assert client.delete(f"/session/{owned}", headers=bearer("bob")).status_code == 404
    guest = make_session(client)
    assert client.delete(f"/session/{guest}", headers=bearer("alice")).status_code == 404
    assert client.delete(f"/session/{owned}").status_code == 401


# --- shared-copy ownership -------------------------------------------------


def test_opening_a_share_yields_an_unsaved_copy(client):
    src = make_owned(client, "alice")
    token = client.post("/session/share", headers={**sid_header(src), **bearer("alice")}).json()[
        "token"
    ]
    opened = client.post(f"/share/{token}", headers=bearer("bob"))
    assert opened.status_code == 200
    copy_id = opened.json()["id"]

    # Like every session, the copy is unowned until Bob saves it.
    assert client.get("/sessions", headers=bearer("bob")).json() == []
    save(client, copy_id, "bob")
    assert [g["id"] for g in client.get("/sessions", headers=bearer("bob")).json()] == [copy_id]


# --- purge only guests (store level) ---------------------------------------


def test_purge_expired_keeps_saved_sessions():
    store = session_mod.store
    guest = store.create()
    owned = store.create()
    store.save(owned, "alice")  # saving is the only way a session becomes owned
    # Age both well past the TTL.
    old = time.time() - session_mod._TTL_S - 1
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("UPDATE sessions SET updated_at=%s", (old,))

    store._purge_expired()

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = {r[0] for r in conn.execute("SELECT id FROM sessions").fetchall()}
    assert owned.id in rows  # a saved grid survives its idle TTL
    assert guest.id not in rows  # an unsaved one is purged
