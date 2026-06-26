"""Per-user server sessions holding the authoritative pandapower net.

The net (electrical tables, foreign tables we don't model yet, and diagram_*
layout tables) is the source of truth. Browsers receive only a projection (see
``projection.py``) and edit it through commands (see ``commands.py``).

Live nets are cached in-process; the source of truth on disk is an SQLite
database (one row per session, holding the pandapower JSON blob). A session
survives eviction or a restart and is rehydrated on demand, and is purged once
it has been idle longer than the TTL.

Sharing is clone-on-open: a share token maps to a source session, and opening it
creates an independent copy so a recipient edits their own net rather than the
owner's.

A per-session re-entrant lock serializes mutation/solve (a pandapower net is not
thread-safe) and is held while FastAPI runs the (sync) handlers in its thread
pool. A separate lock guards the shared SQLite connection.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field

import pandapower as pp
import pandas as pd

from .ppjson import SCHEMA_VERSION, ensure_diagram_tables

_DATA_DIR = os.getenv("BG_SESSION_DIR", os.path.join(os.getcwd(), ".sessions"))
_DB_PATH = os.getenv("BG_DB_PATH", os.path.join(_DATA_DIR, "sessions.db"))
_MAX_LIVE = int(os.getenv("BG_MAX_LIVE_SESSIONS", "64"))
_IDLE_TIMEOUT_S = float(os.getenv("BG_SESSION_IDLE_S", "3600"))
# How long a session is kept on disk after its last edit before being purged.
_TTL_S = float(os.getenv("BG_SESSION_TTL_S", str(30 * 24 * 3600)))
# How many net snapshots an in-memory undo/redo stack keeps per live session.
_HISTORY_LIMIT = int(os.getenv("BG_HISTORY_LIMIT", "50"))


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
    durable in SQLite)."""

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
    lock: threading.RLock = field(default_factory=threading.RLock)
    last_access: float = field(default_factory=time.monotonic)
    history: History = field(default_factory=History)


class SessionStore:
    def __init__(self) -> None:
        self._live: dict[str, Session] = {}
        self._guard = threading.Lock()
        os.makedirs(os.path.dirname(_DB_PATH) or ".", exist_ok=True)
        # One shared connection; SQLite serializes writes and `_db_lock` keeps
        # access single-threaded from our side.
        self._db = sqlite3.connect(_DB_PATH, check_same_thread=False)
        self._db_lock = threading.Lock()
        self._init_db()

    # --- database ----------------------------------------------------------

    def _init_db(self) -> None:
        with self._db_lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    net_json    TEXT NOT NULL,
                    created_at  REAL NOT NULL,
                    updated_at  REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS shares (
                    token       TEXT PRIMARY KEY,
                    session_id  TEXT NOT NULL,
                    created_at  REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS shares_session ON shares (session_id);
                """
            )
            self._db.commit()

    def _persist(self, session: Session, net_json: str | None = None) -> str:
        now = time.time()
        if net_json is None:
            net_json = pp.to_json(session.net)
        name = session.net.get("name") or "Untitled network"
        with self._db_lock:
            self._db.execute(
                "INSERT INTO sessions (id, name, net_json, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET "
                "name=excluded.name, net_json=excluded.net_json, "
                "updated_at=excluded.updated_at",
                (session.id, name, net_json, now, now),
            )
            self._db.commit()
        return net_json

    def _delete(self, session_id: str) -> None:
        with self._db_lock:
            self._db.execute("DELETE FROM sessions WHERE id=?", (session_id,))
            self._db.execute("DELETE FROM shares WHERE session_id=?", (session_id,))
            self._db.commit()
        with self._guard:
            self._live.pop(session_id, None)

    def _purge_expired(self) -> None:
        cutoff = time.time() - _TTL_S
        with self._db_lock:
            rows = self._db.execute(
                "SELECT id FROM sessions WHERE updated_at < ?", (cutoff,)
            ).fetchall()
            ids = [r[0] for r in rows]
            if ids:
                self._db.executemany(
                    "DELETE FROM sessions WHERE id=?", [(i,) for i in ids]
                )
                self._db.execute(
                    "DELETE FROM shares WHERE session_id NOT IN (SELECT id FROM sessions)"
                )
                self._db.commit()
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
        session.history.reset(self._persist(session))
        return session

    def get(self, session_id: str) -> Session:
        """Return a live session, rehydrating from the database on a cache miss."""
        with self._guard:
            session = self._live.get(session_id)
            if session is not None:
                session.last_access = time.monotonic()
                return session
        # Rehydrate outside the guard (DB read + parse can be slow).
        with self._db_lock:
            row = self._db.execute(
                "SELECT net_json, updated_at FROM sessions WHERE id=?", (session_id,)
            ).fetchone()
        if row is None:
            raise KeyError(session_id)
        net_json, updated_at = row
        if time.time() - updated_at > _TTL_S:
            self._delete(session_id)
            raise KeyError(session_id)
        net = pp.from_json_string(net_json)
        session = Session(id=session_id, net=net)
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
        session.history.reset(self._persist(session))

    def record(self, session: Session) -> None:
        """Persist the session and push the new state onto its undo history."""
        session.history.record(self._persist(session), _HISTORY_LIMIT)

    def undo(self, session: Session) -> bool:
        """Restore the previous snapshot as the current net. No-op if at the
        oldest entry."""
        snap = session.history.undo()
        if snap is None:
            return False
        session.net = pp.from_json_string(snap)
        self._persist(session, snap)
        return True

    def redo(self, session: Session) -> bool:
        snap = session.history.redo()
        if snap is None:
            return False
        session.net = pp.from_json_string(snap)
        self._persist(session, snap)
        return True

    # --- sharing -----------------------------------------------------------

    def create_share(self, session_id: str) -> str:
        """Return a stable short token that others can open to clone this session."""
        self.get(session_id)  # ensure it exists (raises KeyError -> 404)
        with self._db_lock:
            row = self._db.execute(
                "SELECT token FROM shares WHERE session_id=?", (session_id,)
            ).fetchone()
            if row is not None:
                return row[0]
            for _ in range(5):
                token = secrets.token_urlsafe(6)
                try:
                    self._db.execute(
                        "INSERT INTO shares (token, session_id, created_at) "
                        "VALUES (?, ?, ?)",
                        (token, session_id, time.time()),
                    )
                    self._db.commit()
                    return token
                except sqlite3.IntegrityError:
                    continue
        raise RuntimeError("Could not allocate a unique share token.")

    def clone_from_share(self, token: str) -> Session:
        """Clone the session a share token points at into a fresh, independent one."""
        with self._db_lock:
            row = self._db.execute(
                "SELECT session_id FROM shares WHERE token=?", (token,)
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
