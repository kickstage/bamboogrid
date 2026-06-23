"""Pydantic schema for the editor's network document.

This JSON document is the source of truth. The pandapower ``net`` is built on
demand from it (see ``converter.py``); we never persist pandapower's own format
as the primary representation.

Buses are nodes; generators, static generators, external grids and loads each
attach to one bus; switches and transformers tie buses together. A Generator is
a pandapower ``gen`` (PV, optionally slack); an ExtGrid is the ``ext_grid`` slack
reference; an Sgen is a PQ ``sgen`` injection.
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
    """A dispatched generating unit — pandapower ``gen`` (a PV bus): you set its
    active power output and voltage setpoint; reactive power is solved. It is
    NOT a voltage reference on its own; the network still needs an ExtGrid."""

    id: str
    name: str = "Generator"
    bus_id: str = ""
    p_mw: float = Field(default=1.0, description="Active power output [MW]")
    vm_pu: float = Field(default=1.0, gt=0, description="Voltage setpoint [p.u.]")
    # When slack=True this generator is a voltage reference. slack_weight is the
    # priority used to share the balancing power across multiple slacks
    # (distributed slack).
    slack: bool = False
    slack_weight: float = Field(default=1.0, ge=0)
    # Which bus port (handle id, e.g. "p2") the wire attaches to (visual only).
    port: str = ""
    x: float = 0.0
    y: float = 0.0
    # Optional routing waypoint for this element's wire (visual only).
    waypoint: Point | None = None


class Sgen(BaseModel):
    """A static generator — pandapower ``sgen`` (a PQ injection used for PV /
    wind / storage feed-in). You set its active and reactive power; it never
    controls voltage and is never a reference."""

    id: str
    name: str = "Static gen"
    bus_id: str = ""
    p_mw: float = Field(default=1.0, description="Active power output [MW]")
    q_mvar: float = Field(default=0.0, description="Reactive power output [MVar]")
    port: str = ""
    x: float = 0.0
    y: float = 0.0
    waypoint: Point | None = None


class ExtGrid(BaseModel):
    """An external-grid connection — pandapower ``ext_grid`` (the slack/reference
    bus). It pins its bus to a fixed voltage magnitude and angle and balances
    the network, so it is always a slack."""

    id: str
    name: str = "External grid"
    bus_id: str = ""
    vm_pu: float = Field(default=1.0, gt=0, description="Voltage setpoint [p.u.]")
    va_degree: float = Field(default=0.0, description="Voltage angle [deg]")
    port: str = ""
    x: float = 0.0
    y: float = 0.0
    waypoint: Point | None = None


class Load(BaseModel):
    id: str
    name: str = "Load"
    bus_id: str = ""
    p_mw: float = Field(default=0.0, description="Active power [MW]")
    q_mvar: float = Field(default=0.0, description="Reactive power [MVar]")
    port: str = ""
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
    # Which bus port each end attaches to (handle ids, visual only).
    port_a: str = ""
    port_b: str = ""
    x: float = 0.0
    y: float = 0.0


class Transformer2W(BaseModel):
    """A 2-winding transformer (pandapower ``trafo``) connecting an HV and an LV
    bus. Electrical parameters come from a named ``std_type``."""

    id: str
    name: str = "Transformer"
    hv_bus: str = ""
    lv_bus: str = ""
    std_type: str = "0.25 MVA 20/0.4 kV"
    port_hv: str = ""
    port_lv: str = ""
    x: float = 0.0
    y: float = 0.0


class Transformer3W(BaseModel):
    """A 3-winding transformer (pandapower ``trafo3w``) connecting HV, MV and LV
    buses."""

    id: str
    name: str = "3W Transformer"
    hv_bus: str = ""
    mv_bus: str = ""
    lv_bus: str = ""
    std_type: str = "63/25/38 MVA 110/20/10 kV"
    port_hv: str = ""
    port_mv: str = ""
    port_lv: str = ""
    x: float = 0.0
    y: float = 0.0


class Network(BaseModel):
    id: str
    name: str = "Untitled network"
    buses: list[Bus] = Field(default_factory=list)
    generators: list[Generator] = Field(default_factory=list)
    sgens: list[Sgen] = Field(default_factory=list)
    ext_grids: list[ExtGrid] = Field(default_factory=list)
    loads: list[Load] = Field(default_factory=list)
    switches: list[Switch] = Field(default_factory=list)
    transformers2w: list[Transformer2W] = Field(default_factory=list)
    transformers3w: list[Transformer3W] = Field(default_factory=list)


# --- Load-flow result types ------------------------------------------------


class BusResult(BaseModel):
    id: str
    # None when the bus is unsupplied (e.g. an island with no slack → NaN).
    vm_pu: float | None = None
    va_degree: float | None = None


class LoadResult(BaseModel):
    id: str
    p_mw: float | None = None
    q_mvar: float | None = None


class GenResult(BaseModel):
    id: str
    # Active power is the setpoint for a PV gen, solved for a slack; reactive
    # power is always solved.
    p_mw: float | None = None
    q_mvar: float | None = None


class TrafoResult(BaseModel):
    id: str
    loading_percent: float | None = None
    p_mw: float | None = None  # active power entering the HV side


class LoadFlowResult(BaseModel):
    converged: bool
    message: str = ""
    res_bus: list[BusResult] = Field(default_factory=list)
    res_gen: list[GenResult] = Field(default_factory=list)
    res_sgen: list[GenResult] = Field(default_factory=list)
    res_ext_grid: list[GenResult] = Field(default_factory=list)
    res_load: list[LoadResult] = Field(default_factory=list)
    res_trafo: list[TrafoResult] = Field(default_factory=list)
    res_trafo3w: list[TrafoResult] = Field(default_factory=list)
