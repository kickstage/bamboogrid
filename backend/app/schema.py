"""Pydantic schema for the editor's network model.

This is the projection the browser edits: the server-side pandapower ``net`` is
the source of truth (see ``session.py``), and ``ppjson.net_to_network`` projects
its modeled subset into these types.

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


class Shunt(BaseModel):
    """A shunt element (pandapower ``shunt``): a fixed reactive (or active)
    device attached to one bus — a capacitor bank or reactor used for voltage
    support. ``q_mvar``/``p_mw`` are the values at the rated voltage ``vn_kv``
    (defaults to the bus voltage), scaled by ``step``.

    Imported and solved for fidelity (e.g. IEEE14's −19 MVar shunt) but not yet
    drawn on the canvas; the editor carries it through unchanged."""

    id: str
    name: str = "Shunt"
    bus_id: str = ""
    p_mw: float = Field(default=0.0, description="Active power at vn_kv [MW]")
    q_mvar: float = Field(default=0.0, description="Reactive power at vn_kv [MVar]")
    vn_kv: float | None = Field(default=None, description="Rated voltage [kV]")
    step: int = 1
    # Layout, kept for round-trip; unused until a canvas element exists.
    x: float = 0.0
    y: float = 0.0
    port: str = ""


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


class Trafo2WParams(BaseModel):
    """Explicit pandapower ``trafo`` parameters. Captured on import when a
    transformer has no recognized ``std_type`` (e.g. case14, whose trafos store
    raw parameters with a null std_type). When present these are used verbatim
    via ``create_transformer_from_parameters`` so the net solves and round-trips;
    otherwise the editor builds the transformer from ``std_type``.

    The ``tap_*`` fields describe an off-nominal-ratio tap changer; they are
    ``None`` when the transformer has no tap changer."""

    sn_mva: float = Field(gt=0)
    vn_hv_kv: float = Field(gt=0)
    vn_lv_kv: float = Field(gt=0)
    vk_percent: float = Field(gt=0)
    vkr_percent: float = Field(ge=0)
    pfe_kw: float = Field(ge=0)
    i0_percent: float = Field(ge=0)
    shift_degree: float = 0.0
    # Tap changer (off-nominal ratio). None ⇒ no tap changer.
    tap_side: str | None = None
    tap_neutral: float | None = None
    tap_min: float | None = None
    tap_max: float | None = None
    tap_step_percent: float | None = None
    tap_step_degree: float | None = None
    tap_pos: float | None = None
    tap_changer_type: str | None = None


class Trafo3WParams(BaseModel):
    """Explicit pandapower ``trafo3w`` parameters — the 3-winding analogue of
    :class:`Trafo2WParams`, captured on import for transformers with no
    recognized ``std_type``."""

    sn_hv_mva: float = Field(gt=0)
    sn_mv_mva: float = Field(gt=0)
    sn_lv_mva: float = Field(gt=0)
    vn_hv_kv: float = Field(gt=0)
    vn_mv_kv: float = Field(gt=0)
    vn_lv_kv: float = Field(gt=0)
    vk_hv_percent: float = Field(gt=0)
    vk_mv_percent: float = Field(gt=0)
    vk_lv_percent: float = Field(gt=0)
    vkr_hv_percent: float = Field(ge=0)
    vkr_mv_percent: float = Field(ge=0)
    vkr_lv_percent: float = Field(ge=0)
    pfe_kw: float = Field(ge=0)
    i0_percent: float = Field(ge=0)
    shift_mv_degree: float = 0.0
    shift_lv_degree: float = 0.0
    # Tap changer (off-nominal ratio). None ⇒ no tap changer.
    tap_side: str | None = None
    tap_neutral: float | None = None
    tap_min: float | None = None
    tap_max: float | None = None
    tap_step_percent: float | None = None
    tap_step_degree: float | None = None
    tap_pos: float | None = None
    tap_changer_type: str | None = None


class Transformer2W(BaseModel):
    """A 2-winding transformer (pandapower ``trafo``) connecting an HV and an LV
    bus. Electrical parameters normally come from a named ``std_type``; an
    imported net whose transformer has no recognized std_type instead carries
    explicit ``params`` (used verbatim by the solver)."""

    id: str
    name: str = "Transformer"
    hv_bus: str = ""
    lv_bus: str = ""
    std_type: str = "0.25 MVA 20/0.4 kV"
    # When set, these explicit parameters take precedence over ``std_type``.
    params: Trafo2WParams | None = None
    port_hv: str = ""
    port_lv: str = ""
    x: float = 0.0
    y: float = 0.0


class Transformer3W(BaseModel):
    """A 3-winding transformer (pandapower ``trafo3w``) connecting HV, MV and LV
    buses. Like :class:`Transformer2W`, it builds from ``std_type`` unless
    explicit ``params`` are present (captured on import)."""

    id: str
    name: str = "3W Transformer"
    hv_bus: str = ""
    mv_bus: str = ""
    lv_bus: str = ""
    std_type: str = "63/25/38 MVA 110/20/10 kV"
    params: Trafo3WParams | None = None
    port_hv: str = ""
    port_mv: str = ""
    port_lv: str = ""
    x: float = 0.0
    y: float = 0.0


class Line(BaseModel):
    """A line (pandapower ``line``) connecting two buses at the same voltage. It
    carries power across distance and has impedance, so unlike a closed switch it
    introduces losses, a voltage drop and a thermal limit. Electrical parameters
    are stored explicitly (per length) so any imported net round-trips faithfully;
    ``std_type`` is an optional convenience that the editor uses to fill them."""

    id: str
    name: str = "Line"
    from_bus: str = ""  # bus on handle "from" ("" while unwired)
    to_bus: str = ""  # bus on handle "to"
    # No gt=0 here on purpose: a user can draw an invalid (e.g. zero) length; it
    # surfaces at load-flow time rather than as an opaque 422 at the API boundary.
    length_km: float = Field(default=1.0, description="Line length [km]")
    r_ohm_per_km: float = Field(default=0.1, ge=0, description="Resistance [ohm/km]")
    x_ohm_per_km: float = Field(default=0.4, ge=0, description="Reactance [ohm/km]")
    c_nf_per_km: float = Field(default=10.0, ge=0, description="Capacitance [nF/km]")
    max_i_ka: float = Field(default=0.6, gt=0, description="Thermal limit [kA]")
    std_type: str = ""  # optional named type the editor offers; not required
    # Which bus port each end attaches to (handle ids, visual only).
    port_from: str = ""
    port_to: str = ""
    # Optional routing waypoint for the edge (visual only).
    waypoint: Point | None = None
    # An edge has no body; x/y are kept only so the layout round-trips uniformly.
    x: float = 0.0
    y: float = 0.0


class Network(BaseModel):
    id: str
    name: str = "Untitled network"
    # System frequency and per-unit base — preserved from an imported net so line
    # charging (∝ f) and reported per-unit values match the source exactly.
    f_hz: float = Field(default=50.0, gt=0, description="System frequency [Hz]")
    sn_mva: float = Field(default=1.0, gt=0, description="Per-unit base [MVA]")
    buses: list[Bus] = Field(default_factory=list)
    generators: list[Generator] = Field(default_factory=list)
    sgens: list[Sgen] = Field(default_factory=list)
    ext_grids: list[ExtGrid] = Field(default_factory=list)
    loads: list[Load] = Field(default_factory=list)
    switches: list[Switch] = Field(default_factory=list)
    transformers2w: list[Transformer2W] = Field(default_factory=list)
    transformers3w: list[Transformer3W] = Field(default_factory=list)
    lines: list[Line] = Field(default_factory=list)
    shunts: list[Shunt] = Field(default_factory=list)


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
    q_mvar: float | None = None  # reactive power entering the HV side


class LineResult(BaseModel):
    id: str
    loading_percent: float | None = None
    p_mw: float | None = None  # active power entering the from-bus side
    q_mvar: float | None = None  # reactive power entering the from-bus side
    i_ka: float | None = None  # line current [kA] (max of the two ends)


class LoadFlowResult(BaseModel):
    converged: bool
    message: str = ""
    res_bus: list[BusResult] = Field(default_factory=list)
    res_gen: list[GenResult] = Field(default_factory=list)
    res_sgen: list[GenResult] = Field(default_factory=list)
    res_ext_grid: list[GenResult] = Field(default_factory=list)
    res_load: list[LoadResult] = Field(default_factory=list)
    res_shunt: list[LoadResult] = Field(default_factory=list)
    res_trafo: list[TrafoResult] = Field(default_factory=list)
    res_trafo3w: list[TrafoResult] = Field(default_factory=list)
    res_line: list[LineResult] = Field(default_factory=list)


# --- Session view model ----------------------------------------------------


class ForeignElement(BaseModel):
    """A pandapower element the editor doesn't model yet (e.g. dcline, impedance,
    motor, storage). Kept on the authoritative server net for full-fidelity
    solves and surfaced read-only so the user can see it's there. ``id`` is
    derived as ``"<table>:<index>"`` and is stable as long as the row exists."""

    id: str
    table: str
    name: str = ""
    bus_ids: list[str] = Field(default_factory=list)
    x: float = 0.0
    y: float = 0.0


class ViewModel(BaseModel):
    """What a browser receives for a session: the editable modeled network plus
    read-only foreign elements. The full pandapower net stays on the server."""

    network: Network
    foreign: list[ForeignElement] = Field(default_factory=list)


class SessionInfo(BaseModel):
    id: str
    view: ViewModel


# --- Commands (browser -> server edits applied to the authoritative net) ----


class Command(BaseModel):
    """A single edit applied to the session's pandapower net. ``op`` selects the
    handler in ``commands.py``; ``payload`` carries op-specific fields. Loosely
    typed on purpose: the editor sends element ``data`` objects whose shape
    depends on ``op``/``kind``, validated inside the handler."""

    op: str
    payload: dict = Field(default_factory=dict)
