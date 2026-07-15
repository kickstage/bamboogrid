"""Optional Google sign-in and app session tokens.

A layer on top of the anonymous session model (see ``session.py``): a user signs
in with Google using the client-side Identity Services button, the browser posts
the resulting Google **ID token** to ``/auth/google``, we verify it and mint our
own signed **app token** that the browser sends as ``Authorization: Bearer`` on
later requests. We keep our own token because Google ID tokens expire in ~1 hour;
ours is stateless (a signed JWT), so verifying it costs no database round-trip.

The whole feature is **config-gated**. With ``GOOGLE_CLIENT_ID`` /
``APP_JWT_SECRET`` unset, ``/auth/google`` reports "not configured" and every
request resolves to a guest (``current_user`` returns ``None``), so the server
runs exactly as it did before sign-in existed.
"""

from __future__ import annotations

import os
import time

import jwt
from fastapi import Depends, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from .schema import User

_GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
_APP_JWT_SECRET = os.getenv("APP_JWT_SECRET")
# App-token lifetime. Long-ish because losing it just means signing in again;
# the client refreshes silently via Google One Tap when it lapses.
_APP_JWT_TTL_S = int(os.getenv("APP_JWT_TTL_S", str(30 * 24 * 3600)))
# Restrict sign-in to one email domain (e.g. a company). Unset ⇒ any Google
# account, which is the intended default.
_ALLOWED_EMAIL_DOMAIN = os.getenv("ALLOWED_EMAIL_DOMAIN")

_APP_JWT_ALG = "HS256"
_APP_JWT_ISS = "bamboogrid"


def auth_configured() -> bool:
    """Whether sign-in is switched on (both the Google client id and our signing
    secret are present). Guards the auth endpoints and short-circuits
    ``current_user`` to guest when off."""
    return bool(_GOOGLE_CLIENT_ID and _APP_JWT_SECRET)


def _user_from_claims(claims: dict) -> User:
    return User(
        id=claims["sub"],
        email=claims.get("email", ""),
        name=claims.get("name") or None,
    )


def verify_google_credential(credential: str) -> User:
    """Verify a Google ID token (the GIS ``credential``) and return the user it
    identifies. Raises ``HTTPException(401)`` if it is invalid, expired, has the
    wrong audience, an unverified email, or a disallowed domain.

    ``verify_oauth2_token`` checks the signature against Google's public keys and
    validates ``aud``/``iss``/``exp`` for us. A fresh transport per call keeps
    this thread-safe under FastAPI's sync thread pool."""
    try:
        claims = google_id_token.verify_oauth2_token(
            credential, google_requests.Request(), _GOOGLE_CLIENT_ID
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Google sign-in.") from exc
    if not claims.get("email_verified", False):
        raise HTTPException(
            status_code=401, detail="Your Google account email is not verified."
        )
    email = claims.get("email", "")
    if _ALLOWED_EMAIL_DOMAIN and not email.endswith("@" + _ALLOWED_EMAIL_DOMAIN):
        raise HTTPException(
            status_code=403,
            detail=f"Sign-in is limited to @{_ALLOWED_EMAIL_DOMAIN} accounts.",
        )
    return _user_from_claims(claims)


def mint_app_token(user: User) -> str:
    """Sign a stateless app token carrying the user's identity."""
    now = int(time.time())
    payload = {
        "sub": user.id,
        "email": user.email,
        "name": user.name or "",
        "iss": _APP_JWT_ISS,
        "iat": now,
        "exp": now + _APP_JWT_TTL_S,
    }
    return jwt.encode(payload, _APP_JWT_SECRET, algorithm=_APP_JWT_ALG)


def _decode_app_token(token: str) -> User | None:
    """Return the user a valid app token identifies, or ``None`` if it fails to
    verify (bad signature, expired, wrong issuer)."""
    try:
        payload = jwt.decode(
            token,
            _APP_JWT_SECRET,
            algorithms=[_APP_JWT_ALG],
            issuer=_APP_JWT_ISS,
        )
    except jwt.PyJWTError:
        return None
    return User(
        id=payload["sub"],
        email=payload.get("email", ""),
        name=payload.get("name") or None,
    )


def current_user(authorization: str | None = Header(default=None)) -> User | None:
    """Resolve the signed-in user from a Bearer app token, or ``None`` for a guest.

    This never raises for a missing or invalid token: guest is a valid state, and
    every guest request arrives without one. Routes that *require* a user depend
    on :func:`require_user` instead."""
    if not auth_configured() or not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return _decode_app_token(token)


def require_user(user: User | None = Depends(current_user)) -> User:
    """Like :func:`current_user` but 401s a guest — for routes that need an
    account (listing/claiming owned grids)."""
    if user is None:
        raise HTTPException(status_code=401, detail="Sign-in required.")
    return user
