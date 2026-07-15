"""Sign-in foundation: app-token minting, the ``current_user`` resolution, and
the ``/auth/google`` + ``/me`` endpoints.

Google's own token verification is stubbed out — these tests exercise our layer
(config gating, app-token round-trip, guest fallback), not Google's library.
"""

import os

import psycopg
import pytest
from fastapi.testclient import TestClient

import app.auth as auth
from app.main import app
from app.schema import User


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def configured(monkeypatch):
    """Turn sign-in on with test credentials (patched at the module constants the
    auth helpers read)."""
    monkeypatch.setattr(auth, "_GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(auth, "_APP_JWT_SECRET", "x" * 32)
    return auth


# --- config gating ---------------------------------------------------------


def test_auth_google_503_when_unconfigured(client):
    # With no GOOGLE_CLIENT_ID/APP_JWT_SECRET the feature is off.
    assert auth.auth_configured() is False
    res = client.post("/auth/google", json={"credential": "whatever"})
    assert res.status_code == 503


def test_me_401_for_guest(client):
    assert client.get("/me").status_code == 401


def test_current_user_is_guest_without_config():
    assert auth.current_user("Bearer anything") is None


# --- app-token round-trip --------------------------------------------------


def test_app_token_round_trip(configured):
    user = User(id="sub-1", email="a@example.com", name="Ada")
    token = configured.mint_app_token(user)
    back = configured.current_user(f"Bearer {token}")
    assert back is not None and back.id == "sub-1" and back.email == "a@example.com"


def test_tampered_or_malformed_token_is_guest(configured):
    user = User(id="sub-1", email="a@example.com")
    token = configured.mint_app_token(user)
    assert configured.current_user(f"Bearer {token[:-2]}xx") is None  # bad signature
    assert configured.current_user("Bearer not.a.jwt") is None
    assert configured.current_user(token) is None  # missing "Bearer " scheme
    assert configured.current_user(None) is None


def test_require_user_401s_guest(configured):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        configured.require_user(None)
    assert exc.value.status_code == 401


# --- endpoints (Google verification stubbed) -------------------------------


def test_signin_persists_user_and_me_reflects_token(client, configured, monkeypatch):
    import app.main as main

    fake = User(id="google-sub-42", email="dev@example.com", name="Dev")
    monkeypatch.setattr(main, "verify_google_credential", lambda cred: fake)

    res = client.post("/auth/google", json={"credential": "ignored-by-stub"})
    assert res.status_code == 200
    body = res.json()
    assert body["user"] == {"id": "google-sub-42", "email": "dev@example.com", "name": "Dev"}
    token = body["token"]

    # The token authenticates /me.
    me = client.get("/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["id"] == "google-sub-42"

    # The user was recorded (keyed by Google sub).
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        row = conn.execute(
            "SELECT email, name FROM users WHERE id=%s", ("google-sub-42",)
        ).fetchone()
    assert row == ("dev@example.com", "Dev")


def test_signin_upsert_refreshes_email(client, configured, monkeypatch):
    import app.main as main

    monkeypatch.setattr(
        main, "verify_google_credential", lambda cred: User(id="u9", email="old@x.com", name="Old")
    )
    client.post("/auth/google", json={"credential": "c"})
    monkeypatch.setattr(
        main, "verify_google_credential", lambda cred: User(id="u9", email="new@x.com", name="New")
    )
    client.post("/auth/google", json={"credential": "c"})

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute("SELECT email, name FROM users WHERE id=%s", ("u9",)).fetchall()
    assert rows == [("new@x.com", "New")]  # one row, refreshed
