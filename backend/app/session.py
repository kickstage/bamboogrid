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
from .schema import DEFAULT_SCENARIO_NAME

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


def _apply_name(net, name: str) -> None:
    """Set the display name on the net and on the projection's diagram_meta."""
    net["name"] = name
    meta = net.get("diagram_meta")
    if meta is not None and len(meta):
        meta.at[meta.index[0], "network_name"] = name


def _set_meta(net, session_id: str, name: str, needs_layout: bool = False) -> None:
    net["name"] = name
    net["diagram_meta"] = pd.DataFrame(
        [
            {
                "schema_version": SCHEMA_VERSION,
                "coordinate_space": "screen-px-y-down",
                "network_id": session_id,
                "network_name": name,
                "needs_layout": bool(needs_layout),
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

    def amend(self, snapshot: str) -> None:
        """Replace the current snapshot in place (no new undo step). Used for
        changes that ride along on the net but shouldn't be a discrete undo entry,
        like load-flow settings."""
        if not self.entries:
            self.reset(snapshot)
        else:
            self.entries[self.cursor] = snapshot


@dataclass
class Session:
    id: str
    net: object
    version: int = 0
    # The owning user's id, or None for a guest session (the default). Carried on
    # the live session so authorization needs no extra query per request; kept in
    # sync with the ``sessions.owner_id`` column. Only a save sets it.
    owner_id: str | None = None
    # Mirror the ``dirty``/``saved_at`` columns.
    dirty: bool = False
    saved_at: float | None = None
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
            # Optional sign-in (see app/auth.py). A user owns the sessions whose
            # owner_id matches their id; owner_id NULL is a guest session (the
            # default and the only kind before sign-in existed), so existing rows
            # need no backfill. Both are inert unless the feature is used.
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id          text PRIMARY KEY,
                    email       text NOT NULL,
                    name        text,
                    created_at  double precision NOT NULL
                )
                """
            )
            conn.execute(
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_id text"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS sessions_owner ON sessions (owner_id)"
            )
            # ``net_json`` is the working copy, written on every edit;
            # ``saved_json`` is what a scenario reverts to if the user leaves
            # without saving. ``owner_id`` is set only by a save, so owned and
            # saved-at-least-once mean the same thing.
            conn.execute(
                "ALTER TABLE sessions "
                "ADD COLUMN IF NOT EXISTS saved_json text, "
                "ADD COLUMN IF NOT EXISTS saved_at double precision, "
                "ADD COLUMN IF NOT EXISTS dirty boolean NOT NULL DEFAULT false"
            )

    def _insert(self, session: Session, net_json: str) -> str:
        now = time.time()
        name = session.net.get("name") or DEFAULT_SCENARIO_NAME
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO sessions "
                "(id, name, net_json, owner_id, version, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (session.id, name, net_json, session.owner_id, session.version, now, now),
            )
        return net_json

    def _update(
        self, session: Session, net_json: str, *, mark_dirty: bool = True
    ) -> str:
        """Persist an edit, guarded by the session's optimistic version. Raises
        ``ConflictError`` if the row was advanced elsewhere since it was loaded.

        Writing the net marks the scenario unsaved by default — the rule lives here
        so a new mutator can't forget it. ``mark_dirty=False`` lets changes that
        aren't the user's edits (a rename, load-flow settings) ride along; it never
        *clears* the flag, only declines to set it."""
        if mark_dirty:
            session.dirty = True
        now = time.time()
        name = session.net.get("name") or DEFAULT_SCENARIO_NAME
        next_version = session.version + 1
        with self._pool.connection() as conn:
            cur = conn.execute(
                "UPDATE sessions SET name=%s, net_json=%s, version=%s, updated_at=%s, "
                "dirty=%s WHERE id=%s AND version=%s",
                (
                    name,
                    net_json,
                    next_version,
                    now,
                    session.dirty,
                    session.id,
                    session.version,
                ),
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
            # Only guest (unowned) sessions age out. A signed-in user's grids are
            # kept until they delete them, so idle time never loses saved work.
            rows = conn.execute(
                "DELETE FROM sessions WHERE owner_id IS NULL AND updated_at < %s "
                "RETURNING id",
                (cutoff,),
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

    # --- users -------------------------------------------------------------

    def upsert_user(self, user_id: str, email: str, name: str | None) -> None:
        """Record (or refresh) a signed-in user, keyed by their Google ``sub``.
        Called on every sign-in so the stored email/name stay current."""
        with self._pool.connection() as conn:
            conn.execute(
                "INSERT INTO users (id, email, name, created_at) "
                "VALUES (%s, %s, %s, %s) "
                "ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name",
                (user_id, email, name, time.time()),
            )

    def list_for_owner(self, owner_id: str) -> list[dict]:
        """A user's saved grids, most-recently-saved first. Only saved scenarios
        appear: a session they're merely working in is not in the library until
        they save it."""
        with self._pool.connection() as conn:
            rows = conn.execute(
                "SELECT id, name, saved_at FROM sessions "
                "WHERE owner_id=%s AND saved_at IS NOT NULL "
                "ORDER BY saved_at DESC",
                (owner_id,),
            ).fetchall()
        return [{"id": r[0], "name": r[1], "saved_at": r[2]} for r in rows]

    def save(self, session: Session, owner_id: str) -> None:
        """Snapshot the working copy as the saved state, claiming the session for
        the user (it is unowned until first saved).

        The snapshot is copied from ``net_json`` in SQL rather than re-serialized,
        so it is exactly the state the server already holds."""
        now = time.time()
        with self._pool.connection() as conn:
            conn.execute(
                "UPDATE sessions SET saved_json=net_json, saved_at=%s, dirty=false, "
                "owner_id=COALESCE(owner_id, %s) WHERE id=%s",
                (now, owner_id, session.id),
            )
        session.owner_id = session.owner_id or owner_id
        session.dirty = False
        session.saved_at = now

    def revert(self, session: Session) -> bool:
        """Restore the last saved state as the working copy. False if it was never
        saved — there is nothing to go back to, and its working copy is the only
        copy of that work. Resets the undo history, like an import.

        The current name survives: a rename is metadata (see ``rename``), so it is
        not one of the edits a discard is meant to throw away."""
        with self._pool.connection() as conn:
            row = conn.execute(
                "SELECT saved_json FROM sessions WHERE id=%s", (session.id,)
            ).fetchone()
        if row is None or row[0] is None:
            return False
        snap = row[0]
        name = session.net.get("name")
        session.net = pp.from_json_string(snap)
        if name and session.net.get("name") != name:
            _apply_name(session.net, name)
            snap = pp.to_json(session.net)  # only re-serialize when the name moved
        session.dirty = False
        session.history.reset(self._update(session, snap, mark_dirty=False))
        return True

    def delete(self, session_id: str) -> None:
        """Remove a session and its shares (used by the owner deleting a grid)."""
        self._delete(session_id)

    # --- lifecycle ---------------------------------------------------------

    def create(self, net=None, name: str = DEFAULT_SCENARIO_NAME) -> Session:
        self._purge_expired()
        session_id = uuid.uuid4().hex
        if net is None:
            net = pp.create_empty_network(name=name)
        needs_layout = ensure_diagram_tables(net)
        _set_meta(net, session_id, name, needs_layout)
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
                "SELECT net_json, updated_at, version, owner_id, dirty, saved_at "
                "FROM sessions WHERE id=%s",
                (session_id,),
            ).fetchone()
        if row is None:
            raise KeyError(session_id)
        net_json, updated_at, version, owner_id, dirty, saved_at = row
        # A guest session past its TTL is gone; an owned one never expires (it is
        # excluded from purge), so only unowned sessions are evicted here.
        if owner_id is None and time.time() - updated_at > _TTL_S:
            self._delete(session_id)
            raise KeyError(session_id)
        net = pp.from_json_string(net_json)
        # The working copy comes back, unsaved edits included: an interrupted
        # session resumes where it left off.
        session = Session(
            id=session_id,
            net=net,
            version=version,
            owner_id=owner_id,
            dirty=dirty,
            saved_at=saved_at,
        )
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
        needs_layout = ensure_diagram_tables(net)
        _set_meta(net, session.id, name, needs_layout)
        session.net = net
        session.history.reset(self._update(session, pp.to_json(session.net)))

    def record(self, session: Session) -> None:
        """Persist the session and push the new state onto its undo history."""
        net_json = self._update(session, pp.to_json(session.net))
        session.history.record(net_json, _HISTORY_LIMIT)

    def rename(self, session: Session, name: str) -> None:
        """Set the network's display name, on both ``net.name`` (the source the
        sessions row syncs from) and ``diagram_meta.network_name`` (what the
        projection reports).

        Metadata, not a modeled edit: no undo step, and it does not make the
        scenario unsaved — which is why ``revert`` keeps the current name rather
        than restoring the one inside the snapshot."""
        _apply_name(session.net, name)
        self._amend(session, mark_dirty=False)

    def update_settings(self, session: Session) -> None:
        """Persist a preference change carried on the net (e.g. load-flow
        settings) without adding an undo step or marking the scenario unsaved."""
        self._amend(session, mark_dirty=False)

    def _amend(self, session: Session, *, mark_dirty: bool) -> None:
        """Persist the net in place, replacing the current undo entry rather than
        adding one."""
        net_json = self._update(session, pp.to_json(session.net), mark_dirty=mark_dirty)
        session.history.amend(net_json)

    def undo(self, session: Session) -> bool:
        """Restore the previous snapshot as the current net. No-op if at the
        oldest entry. Counts as an unsaved change even if it lands back on the
        saved state: dirty tracks saves, not the net's contents."""
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
        """Deep-copy a session's net into a new, unowned session (element ids
        preserved, a new network identity assigned). Like any session, the copy
        belongs to nobody until it is saved."""
        src = self.get(source_id)
        with src.lock:
            net = pp.from_json_string(pp.to_json(src.net))
            name = src.net.get("name") or DEFAULT_SCENARIO_NAME
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
