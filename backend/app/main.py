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
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .commands import CommandError, apply_commands
from .ppjson import MAX_IMPORT_BUSES, MAX_IMPORT_BYTES, std_trafo_types
from .scenarios import build_scenario, list_scenarios
from .projection import net_to_view
from .schema import (
    Command,
    LoadFlowResult,
    LoadFlowSettings,
    NetworkSummary,
    SessionInfo,
    ShortCircuitResult,
    ViewModel,
)
from .sc import run_shortcircuit
from .session import ConflictError, Session, store
from .solve import get_loadflow_settings, set_loadflow_settings, solve_net
from .summary import network_summary
from .tracing import setup_tracing, tracer

app = FastAPI(title="BambooGrid API", version="0.2.0")
setup_tracing(app)


@app.exception_handler(ConflictError)
def _conflict_handler(request: Request, exc: ConflictError) -> JSONResponse:
    """A write lost the optimistic-version race (the session was edited on another
    pod). The client should re-fetch the projection and retry."""
    return JSONResponse(
        status_code=409,
        content={"detail": "Session was modified elsewhere; reload and retry."},
    )

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


@app.get("/std-types/{table}")
def get_std_types(table: str) -> dict[str, dict[str, float]]:
    """The library transformer types and their editable parameters. The inspector
    fetches this (once, cached) to expand a chosen std_type into editable params.
    Session-independent — it's pandapower's static catalog."""
    if table not in ("trafo", "trafo3w"):
        raise HTTPException(status_code=404, detail="Unknown std-type table.")
    return std_trafo_types(table)


@app.post("/session", response_model=SessionInfo)
def create_session() -> SessionInfo:
    """Start an empty session and return its id plus the (empty) projection."""
    session = store.create()
    with session.lock:
        return SessionInfo(id=session.id, view=_view(session))


@app.post("/session/demo", response_model=SessionInfo)
def create_demo_session() -> SessionInfo:
    """Start a session pre-loaded with the IEEE 14-bus network (the mobile
    read-only demo's default when no share link is opened) — the same built-in
    example offered under File ▸ Open example."""
    with tracer.start_as_current_span("session.create_demo"):
        net = build_scenario("case14")
        session = store.create(net=net, name=net.name)
        with session.lock:
            return SessionInfo(id=session.id, view=_view(session))


@app.get("/scenarios")
def get_scenarios() -> list[dict[str, str]]:
    """The curated pandapower example networks for File ▸ Open example."""
    return list_scenarios()


@app.post("/session/scenario/{scenario_id}", response_model=SessionInfo)
def create_scenario_session(scenario_id: str) -> SessionInfo:
    """Start a session from a built-in pandapower example, built on demand."""
    with tracer.start_as_current_span("session.create_scenario") as span:
        span.set_attribute("scenario.id", scenario_id)
        net = build_scenario(scenario_id)
        if net is None:
            raise HTTPException(status_code=404, detail="Unknown scenario.")
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
        with tracer.start_as_current_span("commands.apply") as span:
            span.set_attribute("session.id", session.id)
            span.set_attribute("commands.count", len(commands))
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
    with tracer.start_as_current_span("share.open"):
        try:
            session = store.clone_from_share(token)
        except KeyError:
            raise HTTPException(
                status_code=404, detail="Share link not found or expired."
            )
        with session.lock:
            return SessionInfo(id=session.id, view=_view(session))


@app.post("/session/run-loadflow", response_model=LoadFlowResult)
def run_loadflow(session: Session = Depends(current_session)) -> LoadFlowResult:
    """Run a load flow on the retained net and return results keyed by editor id."""
    with session.lock:
        with tracer.start_as_current_span("loadflow.run") as span:
            span.set_attribute("session.id", session.id)
            span.set_attribute("net.bus_count", int(len(session.net.bus)))
            return solve_net(session.net)


@app.get("/session/loadflow-settings", response_model=LoadFlowSettings)
def get_loadflow_settings_endpoint(
    session: Session = Depends(current_session),
) -> LoadFlowSettings:
    """The session's current load-flow (runpp) settings."""
    with session.lock:
        return get_loadflow_settings(session.net)


@app.put("/session/loadflow-settings", response_model=LoadFlowSettings)
def put_loadflow_settings(
    settings: LoadFlowSettings, session: Session = Depends(current_session)
) -> LoadFlowSettings:
    """Update the session's load-flow (runpp) settings. They're stored on the net,
    so the next load flow / summary uses them and they round-trip with export and
    sharing."""
    with session.lock:
        with tracer.start_as_current_span("loadflow.settings.update") as span:
            span.set_attribute("session.id", session.id)
            set_loadflow_settings(session.net, settings)
            store.update_settings(session)
            return get_loadflow_settings(session.net)


@app.post("/session/run-shortcircuit", response_model=ShortCircuitResult)
def run_short_circuit(
    session: Session = Depends(current_session),
) -> ShortCircuitResult:
    """Run an IEC 60909 3-phase (max) short circuit, results keyed by editor id."""
    with session.lock:
        with tracer.start_as_current_span("shortcircuit.run") as span:
            span.set_attribute("session.id", session.id)
            span.set_attribute("net.bus_count", int(len(session.net.bus)))
            return run_shortcircuit(session.net)


@app.post("/session/summary", response_model=NetworkSummary)
def session_summary(session: Session = Depends(current_session)) -> NetworkSummary:
    """Solve the retained net and return a power-balance / voltage / loading
    overview plus pandapower diagnostic findings."""
    with session.lock:
        with tracer.start_as_current_span("summary.compute") as span:
            span.set_attribute("session.id", session.id)
            span.set_attribute("net.bus_count", int(len(session.net.bus)))
            return network_summary(session.net)


def _too_large_detail() -> str:
    mb = MAX_IMPORT_BYTES // (1024 * 1024)
    return f"Import is too large; the limit is {mb} MB."


@app.post("/session/import", response_model=ViewModel)
async def import_pandapower(
    request: Request, session: Session = Depends(current_session)
) -> ViewModel:
    """Replace the session's net with an uploaded pandapower JSON (ours or a plain
    pandapower net). The full net — including elements/columns we don't model — is
    retained server-side; the browser gets only the projection."""
    with tracer.start_as_current_span("session.import") as span:
        span.set_attribute("session.id", session.id)
        # Reject oversized uploads before buffering them. A declared Content-Length
        # over the cap is refused outright; otherwise the body is read in chunks and
        # aborted the moment it exceeds the cap, so a lying/absent header (or a
        # chunked upload) still can't balloon memory in the pod.
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_IMPORT_BYTES:
            raise HTTPException(status_code=413, detail=_too_large_detail())
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > MAX_IMPORT_BYTES:
                raise HTTPException(status_code=413, detail=_too_large_detail())
        span.set_attribute("import.bytes", len(chunks))
        try:
            net = pp.from_json_string(bytes(chunks).decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - report parse/decode failures
            raise HTTPException(
                status_code=400, detail=f"Could not import pandapower JSON: {exc}"
            )
        if not isinstance(net, pp.pandapowerNet):
            raise HTTPException(
                status_code=400,
                detail="File is valid JSON but not a pandapower network.",
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
        span.set_attribute("net.bus_count", int(len(net.bus)))
        with session.lock:
            store.replace_net(session, net, net.name or "Imported network")
            return _view(session)


@app.get("/session/export")
def export_pandapower(session: Session = Depends(current_session)) -> Response:
    """Serialize the retained net to pandapower JSON (a valid net plus diagram_*
    layout tables) for download — lossless, since it is the authoritative net."""
    with session.lock:
        with tracer.start_as_current_span("session.export") as span:
            span.set_attribute("session.id", session.id)
            span.set_attribute("net.bus_count", int(len(session.net.bus)))
            return Response(
                content=pp.to_json(session.net), media_type="application/json"
            )


# Serve the built SPA (same origin as the API). Mounted last so the API routes
# above win; skipped in dev when the build dir is absent.
_STATIC_DIR = os.getenv("STATIC_DIR", "/app/static")
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
