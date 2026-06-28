"""Per-user server sessions holding the authoritative pandapower net.

The net (electrical tables, foreign tables we don't model yet, and diagram_*
layout tables) is the source of truth. Browsers receive only a projection (see
``projection.py``) and edit it through commands (see ``commands.py``).

Live nets are cached in-process; the source of truth is a shared PostgreSQL
database (one row per session, holding the pandapower JSON blob). A session
survives eviction or a restart and is rehydrated on demand, and is purged once
it has been idle longer than the TTL.

The cache is per-pod, so multi-pod deployments pin a session to a pod via
ingress session affinity. As a safety net for the brief windows where affinity
breaks (rollouts, scale events), every persisted edit carries an optimistic
``version``: a write whose version no longer matches the row was made against a
stale cache and raises ``ConflictError`` instead of clobbering the other pod.

Sharing is clone-on-open: a share token maps to a source session, and opening it
creates an independent copy so a recipient edits their own net rather than the
owner's.

A per-session re-entrant lock serializes mutation/solve (a pandapower net is not
thread-safe) and is held while FastAPI runs the (sync) handlers in its thread
pool. Database access is served by a connection pool.
"""

from __future__ import annotations

import os
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field

import pandapower as pp
import pandas as pd
import psycopg
from psycopg_pool import ConnectionPool

from .ppjson import SCHEMA_VERSION, ensure_diagram_tables

_DATABASE_URL = os.getenv("DATABASE_URL")
if not _DATABASE_URL:
    raise RuntimeError("DATABASE_URL is required (PostgreSQL connection string).")
_MAX_LIVE = int(os.getenv("BG_MAX_LIVE_SESSIONS", "64"))
_IDLE_TIMEOUT_S = float(os.getenv("BG_SESSION_IDLE_S", "3600"))
# How long a session is kept on disk after its last edit before being purged.
_TTL_S = float(os.getenv("BG_SESSION_TTL_S", str(30 * 24 * 3600)))
# How many net snapshots an in-memory undo/redo stack keeps per live session.
_HISTORY_LIMIT = int(os.getenv("BG_HISTORY_LIMIT", "50"))


class ConflictError(Exception):
    """A persisted edit lost an optimistic-version race: the session was changed
    elsewhere (another pod) since this cache loaded it."""


def _set_meta(net, session_id: str, name: str) -> None:
    net["name"] = name
    net["diagram_meta"] = pd.DataFrame(
        [
            {
                "schema_version": SCHEMA_VERSION,
                "coordinate_space": "screen-px-y-down",
                "network_id": session_id,
                "network_name": name,
            }
        ]
    )


@dataclass
class History:
    """An in-memory undo/redo stack of net JSON snapshots for one live session.

    ``cursor`` indexes the snapshot matching the session's current net. Recording
    an edit drops any redo tail past the cursor; undo/redo only move the cursor.
    Bounded to keep memory in check; lost on eviction/restart (the net itself is
    durable in the database)."""

    entries: list[str] = field(default_factory=list)
    cursor: int = -1

    def reset(self, snapshot: str) -> None:
        self.entries = [snapshot]
        self.cursor = 0

    def record(self, snapshot: str, cap: int) -> None:
        del self.entries[self.cursor + 1 :]
        self.entries.append(snapshot)
        if len(self.entries) > cap:
            self.entries = self.entries[-cap:]
        self.cursor = len(self.entries) - 1

    @property
    def can_undo(self) -> bool:
        return self.cursor > 0

    @property
    def can_redo(self) -> bool:
        return self.cursor < len(self.entries) - 1

    def undo(self) -> str | None:
        if not self.can_undo:
            return None
        self.cursor -= 1
        return self.entries[self.cursor]

    def redo(self) -> str | None:
        if not self.can_redo:
            return None
        self.cursor += 1
        return self.entries[self.cursor]


@dataclass
class Session:
    id: str
    net: object
    version: int = 0
    lock: threading.RLock = field(default_factory=threading.RLock)
    last_access: float = field(default_factory=time.monotonic)
    history: History = field(default_factory=History)


class SessionStore:
    def __init__(self) -> None:
        self._live: dict[str, Session] = {}
        self._guard = threading.Lock()
        self._pool = ConnectionPool(
            conninfo=_DATABASE_URL, min_size=1, max_size=10, open=True
        )
        self._init_db()

    # --- database ----------------------------------------------------------

    def _init_db(self) -> None:
        with self._pool.connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id          text PRIMARY KEY,
                    name        text NOT NULL,
                    net_json    text NOT NULL,
                    version     integer NOT NULL DEFAULT 0,
                    created_at  double precision NOT NULL,
                    updated_at  double precision NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS shares (
                    token       text PRIMARY KEY,
                    session_id  text NOT NULL,
                    created_at  double precision NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS shares_session ON shares (session_id)"
            )

    def _insert(self, session: Session, net_json: str) -> str:
        now = time.time()
        name = session.net.get("name") or "Untitled network"
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO sessions (id, name, net_json, version, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (session.id, name, net_json, session.version, now, now),
            )
        return net_json

    def _update(self, session: Session, net_json: str) -> str:
        """Persist an edit, guarded by the session's optimistic version. Raises
        ``ConflictError`` if the row was advanced elsewhere since it was loaded."""
        now = time.time()
        name = session.net.get("name") or "Untitled network"
        next_version = session.version + 1
        with self._pool.connection() as conn:
            cur = conn.execute(
                "UPDATE sessions SET name=%s, net_json=%s, version=%s, updated_at=%s "
                "WHERE id=%s AND version=%s",
                (name, net_json, next_version, now, session.id, session.version),
            )
            if cur.rowcount == 0:
                # Our cache is stale; drop it so the next request rehydrates.
                with self._guard:
                    self._live.pop(session.id, None)
                raise ConflictError(session.id)
        session.version = next_version
        return net_json

    def _delete(self, session_id: str) -> None:
        with self._pool.connection() as conn:
            conn.execute("DELETE FROM sessions WHERE id=%s", (session_id,))
            conn.execute("DELETE FROM shares WHERE session_id=%s", (session_id,))
        with self._guard:
            self._live.pop(session_id, None)

    def _purge_expired(self) -> None:
        cutoff = time.time() - _TTL_S
        with self._pool.connection() as conn:
            rows = conn.execute(
                "DELETE FROM sessions WHERE updated_at < %s RETURNING id", (cutoff,)
            ).fetchall()
            ids = [r[0] for r in rows]
            if ids:
                conn.execute(
                    "DELETE FROM shares WHERE session_id NOT IN (SELECT id FROM sessions)"
                )
        if ids:
            with self._guard:
                for i in ids:
                    self._live.pop(i, None)

    # --- lifecycle ---------------------------------------------------------

    def create(self, net=None, name: str = "Untitled network") -> Session:
        self._purge_expired()
        session_id = uuid.uuid4().hex
        if net is None:
            net = pp.create_empty_network(name=name)
        ensure_diagram_tables(net)
        _set_meta(net, session_id, name)
        session = Session(id=session_id, net=net)
        with self._guard:
            self._live[session_id] = session
            self._evict_locked()
        session.history.reset(self._insert(session, pp.to_json(session.net)))
        return session

    def get(self, session_id: str) -> Session:
        """Return a live session, rehydrating from the database on a cache miss."""
        with self._guard:
            session = self._live.get(session_id)
            if session is not None:
                session.last_access = time.monotonic()
                return session
        # Rehydrate outside the guard (DB read + parse can be slow).
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT net_json, updated_at, version FROM sessions WHERE id=%s",
                (session_id,),
            ).fetchone()
        if row is None:
            raise KeyError(session_id)
        net_json, updated_at, version = row
        if time.time() - updated_at > _TTL_S:
            self._delete(session_id)
            raise KeyError(session_id)
        net = pp.from_json_string(net_json)
        session = Session(id=session_id, net=net, version=version)
        session.history.reset(net_json)
        with self._guard:
            existing = self._live.get(session_id)
            if existing is not None:
                existing.last_access = time.monotonic()
                return existing
            self._live[session_id] = session
            self._evict_locked()
        return session

    def replace_net(self, session: Session, net, name: str) -> None:
        """Swap in a freshly imported net as the session's authoritative state.

        An import is a new baseline: it resets the undo history (the prior network
        is not reachable via undo), which also bounds memory."""
        ensure_diagram_tables(net)
        _set_meta(net, session.id, name)
        session.net = net
        session.history.reset(self._update(session, pp.to_json(session.net)))

    def record(self, session: Session) -> None:
        """Persist the session and push the new state onto its undo history."""
        net_json = self._update(session, pp.to_json(session.net))
        session.history.record(net_json, _HISTORY_LIMIT)

    def undo(self, session: Session) -> bool:
        """Restore the previous snapshot as the current net. No-op if at the
        oldest entry."""
        snap = session.history.undo()
        if snap is None:
            return False
        session.net = pp.from_json_string(snap)
        self._update(session, snap)
        return True

    def redo(self, session: Session) -> bool:
        snap = session.history.redo()
        if snap is None:
            return False
        session.net = pp.from_json_string(snap)
        self._update(session, snap)
        return True

    # --- sharing -----------------------------------------------------------

    def create_share(self, session_id: str) -> str:
        """Return a stable short token that others can open to clone this session."""
        self.get(session_id)  # ensure it exists (raises KeyError -> 404)
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT token FROM shares WHERE session_id=%s", (session_id,)
            ).fetchone()
            if row is not None:
                return row[0]
            for _ in range(5):
                token = secrets.token_urlsafe(6)
                try:
                    conn.execute(
                        "INSERT INTO shares (token, session_id, created_at) "
                        "VALUES (%s, %s, %s)",
                        (token, session_id, time.time()),
                    )
                    return token
                except psycopg.errors.UniqueViolation:
                    conn.rollback()
                    continue
        raise RuntimeError("Could not allocate a unique share token.")

    def clone_from_share(self, token: str) -> Session:
        """Clone the session a share token points at into a fresh, independent one."""
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT session_id FROM shares WHERE token=%s", (token,)
            ).fetchone()
        if row is None:
            raise KeyError(token)
        return self.clone(row[0])

    def clone(self, source_id: str) -> Session:
        """Deep-copy a session's net into a new session (element ids preserved, a
        new network identity assigned)."""
        src = self.get(source_id)
        with src.lock:
            net = pp.from_json_string(pp.to_json(src.net))
            name = src.net.get("name") or "Untitled network"
        return self.create(net=net, name=f"{name} (copy)")

    # --- eviction ----------------------------------------------------------

    def _evict_locked(self) -> None:
        """Drop the least-recently-used live sessions past the cap or idle limit.
        The database still holds them, so eviction only frees memory."""
        now = time.monotonic()
        for sid, s in list(self._live.items()):
            if now - s.last_access > _IDLE_TIMEOUT_S:
                del self._live[sid]
        if len(self._live) > _MAX_LIVE:
            ordered = sorted(self._live.items(), key=lambda kv: kv[1].last_access)
            for sid, _ in ordered[: len(self._live) - _MAX_LIVE]:
                del self._live[sid]


store = SessionStore()
