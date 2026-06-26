"""FastAPI app: per-user sessions holding the authoritative pandapower net.

The browser never holds the full net — it creates a session, receives a
projection (modeled elements + read-only foreign elements + layout), and edits
through commands. Load flow runs on the retained net, so elements/attributes the
editor doesn't model still influence the result.
"""

from __future__ import annotations

import os

import pandapower as pp
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .commands import CommandError, apply_commands
from .ppjson import MAX_IMPORT_BUSES
from .projection import net_to_view
from .schema import Command, LoadFlowResult, SessionInfo, ViewModel
from .session import Session, store
from .solve import solve_net

app = FastAPI(title="BambooGrid API", version="0.2.0")

# Vite dev server origins.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


def current_session(x_session_id: str = Header(..., alias="X-Session-Id")) -> Session:
    """Resolve the session from the ``X-Session-Id`` header (its bearer token).

    The id is held by the browser, not embedded in each URL."""
    try:
        return store.get(x_session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")


def _view(session: Session) -> ViewModel:
    """The session projection stamped with its current undo/redo availability."""
    view = net_to_view(session.net)
    view.can_undo = session.history.can_undo
    view.can_redo = session.history.can_redo
    return view


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/session", response_model=SessionInfo)
def create_session() -> SessionInfo:
    """Start an empty session and return its id plus the (empty) projection."""
    session = store.create()
    with session.lock:
        return SessionInfo(id=session.id, view=_view(session))


@app.post("/session/demo", response_model=SessionInfo)
def create_demo_session() -> SessionInfo:
    """Start a session pre-loaded with the IEEE 14-bus network (the mobile
    read-only demo's default when no share link is opened)."""
    import pandapower.networks as nw

    net = nw.case14()
    net.name = "IEEE 14-bus system"
    session = store.create(net=net, name=net.name)
    with session.lock:
        return SessionInfo(id=session.id, view=_view(session))


@app.get("/session", response_model=ViewModel)
def get_session(session: Session = Depends(current_session)) -> ViewModel:
    """The current projection — used to (re)hydrate the editor on load/refresh."""
    with session.lock:
        return _view(session)


@app.post("/session/commands")
def post_commands(
    commands: list[Command], session: Session = Depends(current_session)
) -> dict[str, bool]:
    """Apply a batch of edits to the session's authoritative net, recording the
    new state as one undo step."""
    with session.lock:
        try:
            apply_commands(session.net, commands)
        except CommandError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        store.record(session)
        return {
            "ok": True,
            "can_undo": session.history.can_undo,
            "can_redo": session.history.can_redo,
        }


@app.post("/session/undo", response_model=ViewModel)
def undo(session: Session = Depends(current_session)) -> ViewModel:
    """Restore the previous net state. No-op (returns the current view) when
    there is nothing to undo."""
    with session.lock:
        store.undo(session)
        return _view(session)


@app.post("/session/redo", response_model=ViewModel)
def redo(session: Session = Depends(current_session)) -> ViewModel:
    """Re-apply the next net state after an undo. No-op when there is nothing to
    redo."""
    with session.lock:
        store.redo(session)
        return _view(session)


@app.post("/session/share")
def share_session(session: Session = Depends(current_session)) -> dict[str, str]:
    """Mint (or reuse) a short token for this session. Opening it clones the
    session, so a recipient edits their own copy rather than this one."""
    return {"token": store.create_share(session.id)}


@app.post("/share/{token}", response_model=SessionInfo)
def open_share(token: str) -> SessionInfo:
    """Clone the shared session into a fresh, independent session."""
    try:
        session = store.clone_from_share(token)
    except KeyError:
        raise HTTPException(status_code=404, detail="Share link not found or expired.")
    with session.lock:
        return SessionInfo(id=session.id, view=_view(session))


@app.post("/session/run-loadflow", response_model=LoadFlowResult)
def run_loadflow(session: Session = Depends(current_session)) -> LoadFlowResult:
    """Run a load flow on the retained net and return results keyed by editor id."""
    with session.lock:
        return solve_net(session.net)


@app.post("/session/import", response_model=ViewModel)
async def import_pandapower(
    request: Request, session: Session = Depends(current_session)
) -> ViewModel:
    """Replace the session's net with an uploaded pandapower JSON (ours or a plain
    pandapower net). The full net — including elements/columns we don't model — is
    retained server-side; the browser gets only the projection."""
    raw = (await request.body()).decode("utf-8")
    try:
        net = pp.from_json_string(raw)
    except Exception as exc:  # noqa: BLE001 - report parse failures
        raise HTTPException(
            status_code=400, detail=f"Could not import pandapower JSON: {exc}"
        )
    if len(net.bus) > MAX_IMPORT_BUSES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"This network has {len(net.bus)} buses, but the import limit is "
                f"{MAX_IMPORT_BUSES}. Larger networks are disabled for now to keep "
                "the editor responsive."
            ),
        )
    with session.lock:
        store.replace_net(session, net, net.name or "Imported network")
        return _view(session)


@app.get("/session/export")
def export_pandapower(session: Session = Depends(current_session)) -> Response:
    """Serialize the retained net to pandapower JSON (a valid net plus diagram_*
    layout tables) for download — lossless, since it is the authoritative net."""
    with session.lock:
        return Response(content=pp.to_json(session.net), media_type="application/json")


# Serve the built SPA (same origin as the API). Mounted last so the API routes
# above win; skipped in dev when the build dir is absent.
_STATIC_DIR = os.getenv("STATIC_DIR", "/app/static")
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
