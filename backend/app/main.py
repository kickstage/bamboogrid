"""FastAPI app: per-user sessions holding the authoritative pandapower net.

The browser never holds the full net — it creates a session, receives a
projection (modeled elements + read-only foreign elements + layout), and edits
through commands. Load flow runs on the retained net, so elements/attributes the
editor doesn't model still influence the result.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import anyio
import pandapower as pp
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .auth import (
    auth_configured,
    current_user,
    mint_app_token,
    require_user,
    verify_google_credential,
)
from .commands import CommandError, apply_commands
from .ppjson import MAX_IMPORT_BUSES, MAX_IMPORT_BYTES, std_trafo_types
from .scenarios import build_scenario, list_scenarios
from .projection import net_to_view
from .safe_import import UnsafeImportError, validate_import_json
from .schema import (
    DEFAULT_SCENARIO_NAME,
    AuthResponse,
    Command,
    GoogleAuthRequest,
    GridSummary,
    LoadFlowResult,
    LoadFlowSettings,
    NetworkSummary,
    JacobianResult,
    RenameRequest,
    SessionInfo,
    SessionMeta,
    ShortCircuitResult,
    ShortCircuitSettings,
    StateEstimationResult,
    StateEstimationSettings,
    User,
    ViewModel,
    YbusResult,
)
from .estimation import get_est_settings, run_estimation, set_est_settings
from .jacobian import compute_jacobian
from .sc import get_sc_settings, run_shortcircuit, set_sc_settings
from .session import ConflictError, Session, store
from .solve import get_loadflow_settings, set_loadflow_settings, solve_net
from .summary import network_summary
from .tracing import setup_tracing, tracer
from .ybus import compute_ybus

app = FastAPI(title="BambooGrid API", version="0.2.0")
setup_tracing(app)

# Cap concurrent load-flow solves. Solves are CPU-bound and GIL-serialized while
# the container caps CPU, so admitting more than a few at once just thrashes and
# inflates everyone's latency past the client's timeout. The rest wait in this
# limiter (see ``run_loadflow``), which is a place we can still notice the client
# hanging up. A CapacityLimiter is safe to construct at import (loop-agnostic).
_MAX_CONCURRENT_SOLVES = max(1, int(os.getenv("MAX_CONCURRENT_SOLVES", "4")))
_solve_limiter = anyio.CapacityLimiter(_MAX_CONCURRENT_SOLVES)


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


def current_session(
    x_session_id: str = Header(..., alias="X-Session-Id"),
    user: User | None = Depends(current_user),
) -> Session:
    """Resolve the session from the ``X-Session-Id`` header (its bearer token).

    The id is held by the browser, not embedded in each URL.

    A guest (unowned) session stays open to any holder of its id — the id *is* the
    capability, unchanged from before sign-in. An *owned* session requires the
    matching signed-in user; anyone else is refused (404, not 403, so an owned id
    is indistinguishable from a non-existent one)."""
    try:
        session = store.get(x_session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.owner_id is not None and (user is None or user.id != session.owner_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    return session


def _meta(session: Session) -> SessionMeta:
    """A session's editor state: undo/redo availability and unsaved-changes."""
    return SessionMeta(
        can_undo=session.history.can_undo,
        can_redo=session.history.can_redo,
        dirty=session.dirty,
        saved_at=session.saved_at,
    )


def _view(session: Session) -> ViewModel:
    """The session projection, stamped with its editor state."""
    view = net_to_view(session.net)
    for field, value in _meta(session):
        setattr(view, field, value)
    return view


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/google", response_model=AuthResponse)
def auth_google(body: GoogleAuthRequest) -> AuthResponse:
    """Exchange a Google Identity Services credential for an app token. Verifies
    the Google ID token, records the user, and returns our own signed token for
    subsequent requests. 503 if sign-in isn't configured on this server."""
    if not auth_configured():
        raise HTTPException(
            status_code=503, detail="Sign-in is not configured on this server."
        )
    user = verify_google_credential(body.credential)
    store.upsert_user(user.id, user.email, user.name)
    return AuthResponse(token=mint_app_token(user), user=user)


@app.get("/me", response_model=User)
def me(user: User = Depends(require_user)) -> User:
    """The currently signed-in user (401 for a guest). Lets the client rehydrate
    its auth state on load from a stored app token."""
    return user


@app.get("/std-types/{table}")
def get_std_types(table: str) -> dict[str, dict[str, float | str]]:
    """The library transformer types and their editable parameters. The inspector
    fetches this (once, cached) to expand a chosen std_type into editable params.
    Session-independent — it's pandapower's static catalog."""
    if table not in ("trafo", "trafo3w"):
        raise HTTPException(status_code=404, detail="Unknown std-type table.")
    return std_trafo_types(table)


@app.post("/session", response_model=SessionInfo)
def create_session() -> SessionInfo:
    """Start an empty session and return its id plus the (empty) projection.

    Unowned until saved: saving is what adds a scenario to a library (see
    ``save_session``), so a scratch session you never save never lands there."""
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


@app.put("/session/name", response_model=ViewModel)
def rename_session(
    body: RenameRequest, session: Session = Depends(current_session)
) -> ViewModel:
    """Rename the session's network. Ownership is enforced by current_session."""
    name = body.name.strip() or DEFAULT_SCENARIO_NAME
    with session.lock:
        store.rename(session, name)
        return _view(session)


@app.post("/session/commands", response_model=SessionMeta)
def post_commands(
    commands: list[Command], session: Session = Depends(current_session)
) -> SessionMeta:
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
            return _meta(session)


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
    """Clone the shared session into a fresh, independent session. The copy opens
    as an unsaved working copy; saving it is what adds it to the opener's library."""
    with tracer.start_as_current_span("share.open"):
        try:
            session = store.clone_from_share(token)
        except KeyError:
            raise HTTPException(
                status_code=404, detail="Share link not found or expired."
            )
        with session.lock:
            return SessionInfo(id=session.id, view=_view(session))


@app.get("/sessions", response_model=list[GridSummary])
def list_sessions(user: User = Depends(require_user)) -> list[GridSummary]:
    """The signed-in user's saved grids, newest first (401 for a guest)."""
    return [GridSummary(**g) for g in store.list_for_owner(user.id)]


@app.post("/session/save", response_model=SessionMeta)
def save_session(
    session: Session = Depends(current_session), user: User = Depends(require_user)
) -> SessionMeta:
    """Save the scenario: keep the working copy as its saved state and add it to
    the user's library the first time (401 for a guest).

    ``current_session`` has already refused a session owned by somebody else, so
    what's left is either theirs or unowned — both are theirs to save."""
    with session.lock:
        store.save(session, user.id)
        return _meta(session)


@app.post("/session/detach", response_model=SessionInfo)
def detach_session(session: Session = Depends(current_session)) -> SessionInfo:
    """Copy the current scenario into a fresh, unowned "<name> (copy)" session.

    Used on sign-out: a saved scenario is unreachable once its owner's token is
    gone, so the editor keeps a guest copy on the canvas instead of wiping it. The
    copy is taken from the working copy, so unsaved edits come along; the original
    is left untouched (the editor reverts it separately)."""
    copy = store.clone(session.id)
    with copy.lock:
        return SessionInfo(id=copy.id, view=_view(copy))


@app.post("/session/revert", response_model=SessionMeta)
def revert_session(session: Session = Depends(current_session)) -> SessionMeta:
    """Restore the last saved state, discarding unsaved edits. Called when the user
    leaves a saved scenario without saving.

    No ``require_user``: a saved scenario is always owned, and ``current_session``
    has already established the caller owns it. 400 if it was never saved — its
    working copy is then the only copy of that work."""
    with session.lock:
        if not store.revert(session):
            raise HTTPException(
                status_code=400, detail="This scenario has never been saved."
            )
        return _meta(session)


@app.delete("/session/{session_id}")
def delete_session(
    session_id: str, user: User = Depends(require_user)
) -> dict[str, bool]:
    """Delete one of the signed-in user's grids. 404 if it isn't theirs (an owned
    id is not distinguishable from a missing one)."""
    try:
        session = store.get(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found.")
    if session.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found.")
    store.delete(session_id)
    return {"ok": True}


@app.post("/session/run-loadflow", response_model=LoadFlowResult)
async def run_loadflow(
    request: Request, session: Session = Depends(current_session)
) -> LoadFlowResult:
    """Run a load flow on the retained net and return results keyed by editor id.

    The solve is CPU-bound and single-threaded under the GIL, and the container
    caps CPU, so running many at once only thrashes. We cap concurrent solves and
    let the rest queue here, in async-land, where a client disconnect is still
    visible: a request whose browser gave up (the editor aborts the fetch after a
    few seconds) is dropped before we spend a core on a result no one will read."""
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Client closed request.")

    async with _solve_limiter:
        # Re-check after (possibly) waiting for a free solve slot: the browser
        # may have timed out and aborted while this request sat in the queue.
        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Client closed request.")

        def _solve() -> LoadFlowResult:
            with session.lock:
                with tracer.start_as_current_span("loadflow.run") as span:
                    span.set_attribute("session.id", session.id)
                    span.set_attribute("net.bus_count", int(len(session.net.bus)))
                    return solve_net(session.net)

        return await run_in_threadpool(_solve)


@app.post("/session/ybus", response_model=YbusResult)
async def session_ybus(
    request: Request, session: Session = Depends(current_session)
) -> YbusResult:
    """Build the admittance matrix (Y-bus) of the retained net. Shares the solve
    limiter with the load flow since it runs a power flow to populate pandapower's
    internal ppc before reading the matrix back."""
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Client closed request.")

    async with _solve_limiter:
        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Client closed request.")

        def _compute() -> YbusResult:
            with session.lock:
                with tracer.start_as_current_span("ybus.compute") as span:
                    span.set_attribute("session.id", session.id)
                    span.set_attribute("net.bus_count", int(len(session.net.bus)))
                    return compute_ybus(session.net)

        return await run_in_threadpool(_compute)


@app.post("/session/jacobian", response_model=JacobianResult)
async def session_jacobian(
    request: Request, session: Session = Depends(current_session)
) -> JacobianResult:
    """Build the measurement Jacobian H of the retained net. Shares the solve
    limiter with the load flow since it runs a state estimation to populate the
    solver matrices before reading H back."""
    if await request.is_disconnected():
        raise HTTPException(status_code=499, detail="Client closed request.")

    async with _solve_limiter:
        if await request.is_disconnected():
            raise HTTPException(status_code=499, detail="Client closed request.")

        def _compute() -> JacobianResult:
            with session.lock:
                with tracer.start_as_current_span("jacobian.compute") as span:
                    span.set_attribute("session.id", session.id)
                    return compute_jacobian(session.net)

        return await run_in_threadpool(_compute)


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


@app.get("/session/shortcircuit-settings", response_model=ShortCircuitSettings)
def get_shortcircuit_settings_endpoint(
    session: Session = Depends(current_session),
) -> ShortCircuitSettings:
    """The session's current short-circuit (calc_sc) settings."""
    with session.lock:
        return get_sc_settings(session.net)


@app.put("/session/shortcircuit-settings", response_model=ShortCircuitSettings)
def put_shortcircuit_settings(
    settings: ShortCircuitSettings, session: Session = Depends(current_session)
) -> ShortCircuitSettings:
    """Update the session's short-circuit settings. Stored on the net, so the next
    short circuit uses them and they round-trip with export and sharing."""
    with session.lock:
        with tracer.start_as_current_span("shortcircuit.settings.update") as span:
            span.set_attribute("session.id", session.id)
            set_sc_settings(session.net, settings)
            store.update_settings(session)
            return get_sc_settings(session.net)


@app.get("/session/estimation-settings", response_model=StateEstimationSettings)
def get_estimation_settings_endpoint(
    session: Session = Depends(current_session),
) -> StateEstimationSettings:
    """The session's current state-estimation settings."""
    with session.lock:
        return get_est_settings(session.net)


@app.put("/session/estimation-settings", response_model=StateEstimationSettings)
def put_estimation_settings(
    settings: StateEstimationSettings, session: Session = Depends(current_session)
) -> StateEstimationSettings:
    """Update the session's state-estimation settings. Stored on the net, so the
    next estimation uses them and they round-trip with export and sharing."""
    with session.lock:
        with tracer.start_as_current_span("estimation.settings.update") as span:
            span.set_attribute("session.id", session.id)
            set_est_settings(session.net, settings)
            store.update_settings(session)
            return get_est_settings(session.net)


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


@app.post("/session/run-estimation", response_model=StateEstimationResult)
async def run_state_estimation(
    session: Session = Depends(current_session),
) -> StateEstimationResult:
    """Run a WLS state estimation over the session's measurements, results keyed
    by editor id. CPU-bound like the load flow, so it shares the solve limiter."""
    async with _solve_limiter:
        def _estimate() -> StateEstimationResult:
            with session.lock:
                with tracer.start_as_current_span("estimation.run") as span:
                    span.set_attribute("session.id", session.id)
                    span.set_attribute("net.bus_count", int(len(session.net.bus)))
                    return run_estimation(session.net)

        return await run_in_threadpool(_estimate)


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
            text = bytes(chunks).decode("utf-8")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400, detail=f"Could not import pandapower JSON: {exc}"
            )
        # SECURITY: pp.from_json_string is a deserializer — a crafted object can
        # execute arbitrary code during parsing (see safe_import). Screen the raw
        # JSON against an allowlist before it ever touches the loader.
        try:
            validate_import_json(text)
        except UnsafeImportError as exc:
            span.set_attribute("import.rejected", "unsafe")
            raise HTTPException(status_code=400, detail=str(exc))
        try:
            net = pp.from_json_string(text)
        except Exception as exc:  # noqa: BLE001 - report parse failures
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
    # Cache the index.html contents once at startup — it never changes between
    # requests, and we inject a small runtime config block into it so the
    # frontend can read GOOGLE_CLIENT_ID without it being baked into the bundle.
    _index_html_path = Path(_STATIC_DIR) / "index.html"
    _index_html_template: str = _index_html_path.read_text(encoding="utf-8")

    @app.get("/", include_in_schema=False)
    def serve_index() -> HTMLResponse:
        """Serve index.html with a runtime config block injected before </head>.

        This lets the frontend read GOOGLE_CLIENT_ID at runtime instead of
        requiring it to be baked in at Docker build time, so the published image
        is config-neutral and self-hosters supply their own credentials."""
        config_json = json.dumps(
            {"googleClientId": os.getenv("GOOGLE_CLIENT_ID") or None}
        )
        script = f"<script>window.__BAMBOOGRID_CONFIG__={config_json};</script>"
        html = _index_html_template.replace("</head>", f"{script}\n</head>", 1)
        return HTMLResponse(content=html)

    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
