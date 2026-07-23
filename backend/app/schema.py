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

from typing import Literal

from pydantic import BaseModel, Field

# Placeholder name a scenario carries until the user names it (mirrored on the
# frontend as DEFAULT_SCENARIO_NAME).
DEFAULT_SCENARIO_NAME = "Untitled scenario"


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
    # Short-circuit (IEC 60909) machine data: rated power and subtransient
    # reactance/resistance and power factor. Defaulted so a network solves a
    # short circuit out of the box; vn_kv follows the connected bus at build time.
    sn_mva: float = Field(default=1.0, gt=0, description="Rated apparent power [MVA]")
    xdss_pu: float = Field(default=0.2, gt=0, description="Subtransient reactance [p.u.]")
    cos_phi: float = Field(default=0.8, gt=0, le=1, description="Rated power factor")
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
    # Short-circuit (IEC 60909) source data: the grid's maximum short-circuit
    # power and R/X ratio at this connection, used by calc_sc.
    s_sc_max_mva: float = Field(
        default=1000.0, gt=0, description="Max short-circuit power [MVA]"
    )
    rx_max: float = Field(default=0.1, ge=0, description="R/X ratio (max case)")
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


class Xward(BaseModel):
    """An extended Ward equivalent (pandapower ``xward``): a reduced stand-in for
    an external sub-network at one boundary bus. Unlike a shunt it bundles three
    things — a constant power injection (``ps_mw``/``qs_mvar``), a constant
    admittance (``pz_mw``/``qz_mvar`` at 1 p.u.), and a voltage source ``vm_pu``
    behind an internal impedance ``r_ohm + jx_ohm`` — so it can supply power and
    hold the boundary voltage. ``slack_weight`` is carried through unchanged."""

    id: str
    name: str = "xWard"
    bus_id: str = ""
    ps_mw: float = Field(default=0.0, description="Constant active power [MW]")
    qs_mvar: float = Field(default=0.0, description="Constant reactive power [MVar]")
    pz_mw: float = Field(default=0.0, description="Constant-Z active power at 1 p.u. [MW]")
    qz_mvar: float = Field(default=0.0, description="Constant-Z reactive power at 1 p.u. [MVar]")
    # Internal impedance behind the voltage source. ge=0 (not gt) so an imported
    # equivalent with a zero resistance/reactance still round-trips.
    r_ohm: float = Field(default=0.0, ge=0, description="Internal resistance [ohm]")
    x_ohm: float = Field(default=1.0, ge=0, description="Internal reactance [ohm]")
    vm_pu: float = Field(default=1.0, gt=0, description="Internal voltage setpoint [p.u.]")
    slack_weight: float = Field(default=0.0, ge=0)
    port: str = ""
    x: float = 0.0
    y: float = 0.0
    waypoint: Point | None = None


class Svc(BaseModel):
    """A Static Var Compensator (pandapower ``svc``): a shunt-connected FACTS
    device on one bus that dynamically holds a target voltage by varying its
    effective susceptance. A thyristor-controlled reactor (``x_l_ohm``) in
    parallel with a fixed capacitor (``x_cvar_ohm``, negative) spans a
    continuous range from inductive to capacitive; the thyristor firing angle
    sets where in that range it sits.

    When ``controllable`` it regulates the bus to ``set_vm_pu`` by solving for a
    firing angle within ``[min_angle_degree, max_angle_degree]``; otherwise the
    firing angle is fixed and the device acts as a plain susceptance. The
    canonical dynamic counterpart to the fixed :class:`Shunt`."""

    id: str
    name: str = "SVC"
    bus_id: str = ""
    set_vm_pu: float = Field(default=1.0, gt=0, description="Target voltage [p.u.]")
    x_l_ohm: float = Field(default=1.0, description="Reactor reactance [ohm]")
    x_cvar_ohm: float = Field(default=-10.0, description="Capacitor reactance [ohm]")
    thyristor_firing_angle_degree: float = Field(
        default=145.0, description="Thyristor firing angle [deg]"
    )
    min_angle_degree: float = Field(default=90.0, description="Min firing angle [deg]")
    max_angle_degree: float = Field(default=180.0, description="Max firing angle [deg]")
    controllable: bool = True
    port: str = ""
    x: float = 0.0
    y: float = 0.0
    waypoint: Point | None = None


class Impedance(BaseModel):
    """A per-unit series impedance (pandapower ``impedance``) tying two buses
    together — a branch defined directly by its p.u. R/X on a rating ``sn_mva``
    rather than by length like a :class:`Line`. Used for network equivalents and
    couplings (e.g. the multi-voltage example's 110 kV tie). The from→to and
    to→from impedances are modeled symmetrically (``rtf``/``xtf`` mirror
    ``rft``/``xft``); an imported asymmetric impedance is carried through until
    edited."""

    id: str
    name: str = "Impedance"
    from_bus: str = ""  # bus on handle "from" ("" while unwired)
    to_bus: str = ""  # bus on handle "to"
    # ge=0 (not gt) so an imported ideal/near-ideal impedance still round-trips.
    rft_pu: float = Field(default=0.0, ge=0, description="from→to resistance [p.u.]")
    xft_pu: float = Field(default=0.1, ge=0, description="from→to reactance [p.u.]")
    rtf_pu: float = Field(default=0.0, ge=0, description="to→from resistance [p.u.]")
    xtf_pu: float = Field(default=0.1, ge=0, description="to→from reactance [p.u.]")
    sn_mva: float = Field(default=100.0, gt=0, description="Rating base [MVA]")
    # Which bus port each end attaches to (handle ids, visual only).
    port_from: str = ""
    port_to: str = ""
    waypoint: Point | None = None
    x: float = 0.0
    y: float = 0.0


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


class Measurement(BaseModel):
    """A field measurement feeding state estimation (pandapower ``measurement``).

    Unlike every other element it has no canvas presence: it annotates an
    existing bus, line or transformer rather than being drawn. ``meas_type`` is
    the measured quantity — voltage magnitude ``v`` [p.u.], active/reactive power
    ``p``/``q`` [MW/MVar], current ``i`` [kA] or voltage angle ``va`` [deg] — and
    ``std_dev`` its Gaussian noise in that unit (the WLS weight is 1/σ²).

    ``element_id`` is the editor uuid of the annotated element; ``side`` picks a
    branch end (``from``/``to`` on a line, ``hv``/``mv``/``lv`` on a transformer)
    and is ``None`` for a bus measurement."""

    id: str
    name: str = "Measurement"
    meas_type: Literal["v", "p", "q", "i", "va"] = "v"
    element_type: Literal["bus", "line", "trafo", "trafo3w"] = "bus"
    element_id: str = ""  # editor uuid of the annotated bus/line/trafo
    side: Literal["from", "to", "hv", "mv", "lv"] | None = None
    value: float = 0.0
    std_dev: float = Field(default=0.01, gt=0, description="Std. deviation [meas. unit]")
    # When False the measurement is kept but excluded from the estimation, so it
    # can be toggled off without deleting and re-entering it.
    enabled: bool = True


class Network(BaseModel):
    id: str
    name: str = DEFAULT_SCENARIO_NAME
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
    xwards: list[Xward] = Field(default_factory=list)
    svcs: list[Svc] = Field(default_factory=list)
    impedances: list[Impedance] = Field(default_factory=list)
    measurements: list[Measurement] = Field(default_factory=list)
    # Set when positions are only the coarse graph fallback; the client should
    # recompute a proper layout (ELK) and persist it, which clears the flag.
    needs_layout: bool = False


# --- Load-flow settings ----------------------------------------------------


class LoadFlowSettings(BaseModel):
    """User-configurable pandapower ``runpp`` options for a session.

    Stored on the net as pandapower's native ``user_pf_options`` so they round-trip
    through save/share/import and are picked up automatically by ``runpp`` (see
    ``solve.run_powerflow``). Defaults mirror pandapower's own ``runpp`` defaults.

    ``distributed_slack`` is intentionally not exposed: it's derived automatically
    from the topology (see ``solve._use_distributed_slack``) because the wrong
    value breaks degenerate single-reference nets."""

    # Power-flow algorithm: Newton-Raphson and variants, backward/forward sweep,
    # Gauss-Seidel, and the fast-decoupled methods.
    algorithm: Literal["nr", "iwamoto_nr", "bfsw", "gs", "fdbx", "fdxb"] = "nr"
    # Voltage initialisation strategy ("auto" picks dc for transmission, flat
    # otherwise; "results" warm-starts from the previous solve).
    init: Literal["auto", "flat", "dc", "results"] = "auto"
    # Maximum solver iterations. ``None`` lets pandapower choose per algorithm.
    max_iteration: int | None = Field(default=None, ge=1, le=1000)
    # Convergence tolerance on the power mismatch [MVA].
    tolerance_mva: float = Field(default=1e-8, gt=0)
    # Whether to compute voltage angles (needed for meshed/transmission nets).
    calculate_voltage_angles: bool = True
    # Transformer equivalent circuit and how loading % is referenced.
    trafo_model: Literal["t", "pi"] = "t"
    trafo_loading: Literal["current", "power"] = "current"
    # Respect generator P/Q capability limits (curtails to the limits).
    enforce_q_lims: bool = False
    enforce_p_lims: bool = False
    # Model loads whose power depends on the solved bus voltage (ZIP loads).
    voltage_depend_loads: bool = True
    # Correct line resistance for conductor temperature. When enabled, the
    # ``line_temperature_degree_celsius`` below is applied uniformly to every line
    # (the editor models a single ambient temperature rather than per-line values).
    consider_line_temperature: bool = False
    # Operating temperature [°C] used when ``consider_line_temperature`` is on. The
    # 20 °C default is pandapower's reference, i.e. no correction.
    line_temperature_degree_celsius: float = Field(default=20.0, ge=-50, le=250)
    # Pre-check connectivity and de-energise unsupplied areas before solving.
    check_connectivity: bool = True


# --- Short-circuit settings ------------------------------------------------


class ShortCircuitSettings(BaseModel):
    """User-configurable pandapower ``calc_sc`` options for a session.

    Stored on the net as ``user_sc_options`` (a plain dict key) so they round-trip
    through save/share/import like ``user_pf_options``. Defaults mirror the values
    the short circuit ran with before it was configurable (see ``sc.run_shortcircuit``)."""

    # Fault type. 3-phase is the standard symmetrical fault; 2-phase is the
    # line-to-line unbalanced fault (neither needs zero-sequence data).
    fault: Literal["3ph", "2ph"] = "3ph"
    # IEC 60909 calculation case: maximum (design) or minimum (protection) currents.
    case: Literal["max", "min"] = "max"
    # Also compute the peak short-circuit current i_p.
    ip: bool = True
    # Also compute the thermal-equivalent short-circuit current i_th.
    ith: bool = True
    # Fault duration [s] used for i_th (only relevant when ``ith`` is on).
    tk_s: float = Field(default=1.0, gt=0)


# --- State-estimation settings ---------------------------------------------


class StateEstimationSettings(BaseModel):
    """User-configurable WLS state-estimation options for a session.

    Stored on the net as ``user_est_options`` (a plain dict key) so they round-trip
    like ``user_pf_options``. Defaults mirror the values the estimator ran with
    before it was configurable (see ``estimation._estimate``)."""

    # Estimator: weighted least squares. (WLS is the only algorithm whose solver
    # exposes the residual-covariance matrices our normalized-residual, bad-data
    # and critical-measurement diagnostics rely on.)
    algorithm: Literal["wls"] = "wls"
    # Voltage start: a flat profile, or warm-start from the last load-flow results.
    init: Literal["flat", "results"] = "flat"
    # Convergence tolerance on the state update.
    tolerance: float = Field(default=1e-6, gt=0)
    # Maximum solver iterations.
    maximum_iterations: int = Field(default=50, ge=1, le=1000)


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


class SvcResult(BaseModel):
    id: str
    # Reactive power exchanged with the bus (negative = capacitive/injecting),
    # the regulated voltage, and the firing angle the solver settled on.
    q_mvar: float | None = None
    vm_pu: float | None = None
    thyristor_firing_angle_degree: float | None = None


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
    res_xward: list[LoadResult] = Field(default_factory=list)
    res_svc: list[SvcResult] = Field(default_factory=list)
    res_impedance: list[LoadResult] = Field(default_factory=list)
    res_trafo: list[TrafoResult] = Field(default_factory=list)
    res_trafo3w: list[TrafoResult] = Field(default_factory=list)
    res_line: list[LineResult] = Field(default_factory=list)


# --- Admittance matrix (Y-bus) --------------------------------------------


class YbusBus(BaseModel):
    """One row/column of the admittance matrix. Usually a single bus, but buses
    fused by a closed bus-bus switch collapse into one node, and pandapower's
    internal nodes (e.g. a 3W transformer's star point) appear with no editor
    element behind them (empty ``ids``)."""

    ids: list[str] = Field(default_factory=list)  # editor uuids for highlighting
    label: str  # "Bus 3", "Bus 3 + Bus 4", or "Internal node"
    vn_kv: float | None = None


class YbusEntry(BaseModel):
    """A non-zero matrix cell ``Y[i, j] = g + jb`` in per-unit."""

    i: int
    j: int
    g: float
    b: float


class YbusResult(BaseModel):
    converged: bool
    message: str = ""
    buses: list[YbusBus] = Field(default_factory=list)  # row/column order
    entries: list[YbusEntry] = Field(default_factory=list)
    sn_mva: float = 1.0
    # In-service buses with no matrix row (isolated) plus out-of-service buses.
    omitted_buses: int = 0


# --- Short-circuit (IEC 60909) result types --------------------------------


class BusScResult(BaseModel):
    id: str
    # Initial symmetrical short-circuit current and its apparent power.
    ikss_ka: float | None = None
    skss_mw: float | None = None
    # Peak and thermal-equivalent short-circuit currents.
    ip_ka: float | None = None
    ith_ka: float | None = None


class ShortCircuitResult(BaseModel):
    ok: bool
    message: str = ""
    res_bus: list[BusScResult] = Field(default_factory=list)


# --- State estimation (WLS) result types -----------------------------------


class BusEstResult(BaseModel):
    id: str
    # Estimated voltage magnitude/angle and the injected power at the bus.
    vm_pu: float | None = None
    va_degree: float | None = None
    p_mw: float | None = None
    q_mvar: float | None = None


class BranchSideEst(BaseModel):
    """Estimated flow into one end of a branch — a line (from/to) or a
    transformer winding (hv/mv/lv). Power in ≠ power out (branch losses), so each
    end is reported separately."""

    side: str
    p_mw: float | None = None
    q_mvar: float | None = None
    i_ka: float | None = None


class LineEstResult(BaseModel):
    id: str
    loading_percent: float | None = None
    # Both ends of the line: "from" and "to".
    sides: list[BranchSideEst] = Field(default_factory=list)


class TrafoEstResult(BaseModel):
    id: str
    loading_percent: float | None = None
    # One entry per winding (hv/lv for a 2W, hv/mv/lv for a 3W transformer).
    sides: list[BranchSideEst] = Field(default_factory=list)


class MeasurementResidual(BaseModel):
    """Per-measurement diagnostics from the solve: the estimated value the model
    settled on, the raw residual (measured − estimated), and the (always
    non-negative) normalized residual rᴺ = |r| / √Ω used by the bad-data test.

    ``is_bad`` marks the single measurement the largest-normalized-residual test
    identified as the most likely bad one. A gross error smears across many
    measurements' residuals, so only the largest is flagged — fix or remove it
    and re-run to check the next.

    ``is_critical`` marks a measurement with no redundancy: removing it would make
    the network unobservable. Its residual is structurally zero and its error is
    undetectable, so it carries no meaningful normalized residual
    (``normalized_residual`` is null)."""

    id: str
    measured: float | None = None
    estimated: float | None = None
    residual: float | None = None
    normalized_residual: float | None = None
    is_bad: bool = False
    is_critical: bool = False


class StateEstimationResult(BaseModel):
    ok: bool
    message: str = ""
    # True when chi² analysis flags the measurement set as containing bad data.
    bad_data: bool = False
    res_bus: list[BusEstResult] = Field(default_factory=list)
    res_line: list[LineEstResult] = Field(default_factory=list)
    res_trafo: list[TrafoEstResult] = Field(default_factory=list)
    residuals: list[MeasurementResidual] = Field(default_factory=list)


# --- Network summary / diagnostics -----------------------------------------


class PowerBalance(BaseModel):
    """System-wide active/reactive totals after a solve. ``loss`` is the network
    loss (generation minus load), i.e. the sum of branch losses."""

    gen_p_mw: float
    gen_q_mvar: float
    load_p_mw: float
    load_q_mvar: float
    loss_p_mw: float
    loss_q_mvar: float


class Extreme(BaseModel):
    """A single worst-case quantity (e.g. lowest bus voltage, most-loaded line)
    with the element it occurs on, resolved to its editor identity so the UI can
    select it (see DiagnosticElement for the ``id``/``kind`` convention)."""

    value: float
    label: str = ""
    id: str = ""
    kind: str = ""


class Counts(BaseModel):
    buses: int = 0
    lines: int = 0
    transformers: int = 0
    loads: int = 0
    generators: int = 0
    switches: int = 0
    shunts: int = 0
    foreign: int = 0
    # Connected sub-networks, and in-service buses left without a voltage (an
    # island with no reference, surfaced as NaN by the solver).
    islands: int = 0
    unsupplied_buses: int = 0


class DiagnosticElement(BaseModel):
    """An element a diagnostic refers to, resolved to its editor identity so the
    UI can select it. ``id`` is the modeled element's uuid, or ``"<table>:<index>"``
    for a foreign element; ``kind`` is the editor kind (``"line"`` for a line edge,
    ``"foreign"`` for an unmodeled element)."""

    id: str
    kind: str
    label: str


class Diagnostic(BaseModel):
    check: str
    detail: str
    severity: str = "warning"  # "error" | "warning" | "info"
    elements: list[DiagnosticElement] = Field(default_factory=list)


class NetworkSummary(BaseModel):
    """A post-solve overview of a network: power balance, voltage/loading
    extremes, element counts and pandapower diagnostic findings. ``counts`` and
    ``diagnostics`` are always populated; the solved metrics are present only
    when the load flow converged."""

    converged: bool
    message: str = ""
    counts: Counts
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    balance: PowerBalance | None = None
    min_voltage: Extreme | None = None
    max_voltage: Extreme | None = None
    max_line_loading: Extreme | None = None
    max_trafo_loading: Extreme | None = None


# --- Session view model ----------------------------------------------------


class ForeignElement(BaseModel):
    """A pandapower element the editor doesn't model yet (e.g. dcline, motor,
    storage, ward). Kept on the authoritative server net for full-fidelity
    solves and surfaced read-only so the user can see it's there. ``id`` is
    derived as ``"<table>:<index>"`` and is stable as long as the row exists."""

    id: str
    table: str
    name: str = ""
    bus_ids: list[str] = Field(default_factory=list)
    x: float = 0.0
    y: float = 0.0


class SessionMeta(BaseModel):
    """A session's editor state, without the network itself.

    ``can_undo``/``can_redo`` reflect the in-memory edit history. ``dirty`` is
    whether there are edits since the last save, and ``saved_at`` when that save
    was (None if never saved). The net is persisted on every edit regardless;
    leaving without saving is what discards them (see ``revert_session``).

    Returned on its own by the endpoints that change this state but not the net —
    save, revert, and applying commands the client already has locally."""

    can_undo: bool = False
    can_redo: bool = False
    dirty: bool = False
    saved_at: float | None = None


class ViewModel(SessionMeta):
    """What a browser receives for a session: the editable modeled network plus
    read-only foreign elements, and the session state above. The full pandapower
    net stays on the server."""

    network: Network
    foreign: list[ForeignElement] = Field(default_factory=list)


class SessionInfo(BaseModel):
    id: str
    view: ViewModel


# --- Authentication --------------------------------------------------------


class User(BaseModel):
    """A signed-in account. ``id`` is Google's stable ``sub`` claim (unique per
    Google account, consistent across OAuth clients/projects). A guest has no
    ``User`` at all — see ``auth.current_user``."""

    id: str
    email: str = ""
    name: str | None = None


class GoogleAuthRequest(BaseModel):
    """The Google Identity Services credential (an ID token JWT) the browser gets
    from the sign-in button and posts to ``/auth/google`` to exchange for an app
    token."""

    credential: str


class AuthResponse(BaseModel):
    """The result of a successful sign-in: our own signed app token (sent back as
    ``Authorization: Bearer`` on later requests) and the resolved user."""

    token: str
    user: User


class GridSummary(BaseModel):
    """One entry in a signed-in user's saved-grids list. ``saved_at`` is a Unix
    timestamp (seconds) of the last *save*, for sorting/display — not of the last
    edit, since unsaved edits are deliberately not represented in the library."""

    id: str
    name: str
    saved_at: float


class RenameRequest(BaseModel):
    """A new display name for a session's network."""

    name: str


# --- Commands (browser -> server edits applied to the authoritative net) ----


class Command(BaseModel):
    """A single edit applied to the session's pandapower net. ``op`` selects the
    handler in ``commands.py``; ``payload`` carries op-specific fields. Loosely
    typed on purpose: the editor sends element ``data`` objects whose shape
    depends on ``op``/``kind``, validated inside the handler."""

    op: str
    payload: dict = Field(default_factory=dict)
