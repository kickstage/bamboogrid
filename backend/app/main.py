"""FastAPI app: network CRUD + load-flow endpoint."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import storage
from .converter import run_load_flow
from .schema import LoadFlowResult, Network, NetworkSummary

app = FastAPI(title="BambooGrid API", version="0.1.0")

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


@app.get("/networks", response_model=list[NetworkSummary])
def list_networks() -> list[NetworkSummary]:
    return storage.list_all()


@app.post("/networks", response_model=Network, status_code=201)
def create_network(network: Network) -> Network:
    network.id = uuid.uuid4().hex
    storage.save(network)
    return network


@app.get("/networks/{network_id}", response_model=Network)
def get_network(network_id: str) -> Network:
    network = storage.load(network_id)
    if network is None:
        raise HTTPException(status_code=404, detail="Network not found")
    return network


@app.put("/networks/{network_id}", response_model=Network)
def update_network(network_id: str, network: Network) -> Network:
    if storage.load(network_id) is None:
        raise HTTPException(status_code=404, detail="Network not found")
    network.id = network_id
    storage.save(network)
    return network


@app.delete("/networks/{network_id}", status_code=204)
def delete_network(network_id: str) -> None:
    if not storage.delete(network_id):
        raise HTTPException(status_code=404, detail="Network not found")


@app.post("/networks/{network_id}/run-loadflow", response_model=LoadFlowResult)
def run_loadflow_saved(network_id: str) -> LoadFlowResult:
    network = storage.load(network_id)
    if network is None:
        raise HTTPException(status_code=404, detail="Network not found")
    return run_load_flow(network)


@app.post("/run-loadflow", response_model=LoadFlowResult)
def run_loadflow_adhoc(network: Network) -> LoadFlowResult:
    """Run a load flow on a posted (possibly unsaved) network document."""
    return run_load_flow(network)
