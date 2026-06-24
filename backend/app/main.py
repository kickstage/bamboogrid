"""FastAPI app: load-flow + pandapower JSON import/export."""

from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .converter import run_load_flow
from .ppjson import network_to_pp_json, pp_json_to_network
from .schema import LoadFlowResult, Network

app = FastAPI(title="BambooGrid API", version="0.1.0")

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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run-loadflow", response_model=LoadFlowResult)
def run_loadflow(network: Network) -> LoadFlowResult:
    """Run a load flow on the posted network document."""
    return run_load_flow(network)


@app.post("/export/pandapower")
def export_pandapower(network: Network) -> Response:
    """Serialize the posted network to a single pandapower JSON (electrical net
    + diagram_* layout tables)."""
    return Response(
        content=network_to_pp_json(network), media_type="application/json"
    )


@app.post("/import/pandapower", response_model=Network)
async def import_pandapower(request: Request) -> Network:
    """Reconstruct the editor network from an uploaded pandapower JSON.

    The body is the raw pandapower JSON file (arbitrary structure), so it's read
    directly rather than validated as a Network.
    """
    raw = (await request.body()).decode("utf-8")
    try:
        return pp_json_to_network(raw)
    except Exception as exc:  # noqa: BLE001 - report parse/convert failures
        raise HTTPException(
            status_code=400, detail=f"Could not import pandapower JSON: {exc}"
        )


# Serve the built SPA (same origin as the API). Mounted last so the API routes
# above win; skipped in dev when the build dir is absent.
_STATIC_DIR = os.getenv("STATIC_DIR", "/app/static")
if os.path.isdir(_STATIC_DIR):
    app.mount("/", StaticFiles(directory=_STATIC_DIR, html=True), name="static")
