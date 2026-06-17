"""Pydantic schema for the editor's network document.

This JSON document is the source of truth. The pandapower ``net`` is built on
demand from it (see ``converter.py``); we never persist pandapower's own format
as the primary representation.

Iteration 1 elements are all single-port: a Bus is a node, and Generators and
Loads each attach to exactly one bus. A "Generator" is mapped to a pandapower
``ext_grid`` (the slack bus) for now, so a single bus with a generator + load
converges. Lines / transformers / PV generators come in iteration 2.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class Point(BaseModel):
    x: float
    y: float


class Bus(BaseModel):
    id: str
    name: str = "Bus"
    vn_kv: float = Field(default=0.4, gt=0, description="Nominal voltage [kV]")
    # Canvas layout, persisted so it survives reloads. ``width`` is the busbar
    # length in px (purely visual; pandapower ignores it).
    x: float = 0.0
    y: float = 0.0
    width: float = 220.0


class Generator(BaseModel):
    id: str
    name: str = "Generator"
    bus_id: str
    vm_pu: float = Field(default=1.0, gt=0, description="Voltage setpoint [p.u.]")
    x: float = 0.0
    y: float = 0.0
    # Optional routing waypoint for this element's wire (visual only).
    waypoint: Point | None = None


class Load(BaseModel):
    id: str
    name: str = "Load"
    bus_id: str
    p_mw: float = Field(default=0.0, description="Active power [MW]")
    q_mvar: float = Field(default=0.0, description="Reactive power [MVar]")
    x: float = 0.0
    y: float = 0.0
    # Optional routing waypoint for this element's wire (visual only).
    waypoint: Point | None = None


class Switch(BaseModel):
    """A bus–bus switch (pandapower ``et='b'``). Closed ties the two buses into
    one electrical node; open separates them. Single type for now (no
    breaker/disconnector distinction)."""

    id: str
    name: str = "Switch"
    bus_a: str = ""  # bus on handle "a" ("" while unwired)
    bus_b: str = ""  # bus on handle "b"
    closed: bool = True
    x: float = 0.0
    y: float = 0.0


class Network(BaseModel):
    id: str
    name: str = "Untitled network"
    buses: list[Bus] = Field(default_factory=list)
    generators: list[Generator] = Field(default_factory=list)
    loads: list[Load] = Field(default_factory=list)
    switches: list[Switch] = Field(default_factory=list)


class NetworkSummary(BaseModel):
    """Lightweight entry for the list endpoint."""

    id: str
    name: str


# --- Load-flow result types ------------------------------------------------


class BusResult(BaseModel):
    id: str
    vm_pu: float
    va_degree: float


class LoadResult(BaseModel):
    id: str
    p_mw: float
    q_mvar: float


class LoadFlowResult(BaseModel):
    converged: bool
    message: str = ""
    res_bus: list[BusResult] = Field(default_factory=list)
    res_load: list[LoadResult] = Field(default_factory=list)
