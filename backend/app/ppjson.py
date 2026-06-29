"""Project a pandapower net to the editor model, and attach the diagram layout
tables an editor session needs.

A session net is a 100% valid pandapower net (``pp.to_json``): the electrical
model lives in the standard tables (``bus``, ``ext_grid``, ``load``, …), and the
diagram layout lives in separate custom tables with a ``diagram_`` prefix:

  * ``diagram_bus``      — per-bus ``uuid, x, y, width``
  * ``diagram_gen`` etc. — per-component ``uuid, x, y, port, waypoint_json``
  * ``diagram_meta``     — one row of document metadata

These extra tables are isolated from the core frames (so we never touch
pandapower's schemas), are ignored by the solver, and round-trip through
``to_json``/``from_json``. Coordinates are editor canvas pixels (y-down) — not
geographic — and live only here; we never write pandapower's ``geo`` columns.

When a net arrives without our diagram tables, its native ``geo`` columns (if
present) seed the initial layout (``geo_layout``); otherwise a graph auto-layout
is used. Once our diagram tables exist they are the sole source of truth.

``ensure_diagram_tables`` adds these tables (with stable uuids) to any net that
lacks them; ``net_to_network`` projects the modeled subset back to the editor.
"""

from __future__ import annotations

import json
import uuid

import pandapower as pp
import pandas as pd

from .autolayout import auto_layout, geo_layout
from .schema import (
    Bus,
    ExtGrid,
    Generator,
    Line,
    Load,
    Network,
    Point,
    Sgen,
    Shunt,
    Switch,
    Trafo2WParams,
    Trafo3WParams,
    Transformer2W,
    Transformer3W,
)

SCHEMA_VERSION = "bamboogrid/1"


def _parse_waypoint(value) -> Point | None:
    if not value or (isinstance(value, float) and pd.isna(value)):
        return None
    data = json.loads(value)
    return Point(x=float(data["x"]), y=float(data["y"]))


def _opt_f(value) -> float | None:
    """A pandapower cell as an optional float (NaN/missing → None)."""
    return None if value is None or pd.isna(value) else float(value)


def _opt_s(value) -> str | None:
    """A pandapower cell as an optional string (NaN/empty → None)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return str(value) or None


def _tap_fields(row) -> dict:
    """Tap-changer columns common to ``trafo`` and ``trafo3w``, NaN-safe. The
    ``tap_changer_type`` column only exists in newer pandapower versions."""
    return dict(
        tap_side=_opt_s(row["tap_side"]),
        tap_neutral=_opt_f(row["tap_neutral"]),
        tap_min=_opt_f(row["tap_min"]),
        tap_max=_opt_f(row["tap_max"]),
        tap_step_percent=_opt_f(row["tap_step_percent"]),
        tap_step_degree=_opt_f(row["tap_step_degree"]),
        tap_pos=_opt_f(row["tap_pos"]),
        tap_changer_type=(
            _opt_s(row["tap_changer_type"]) if "tap_changer_type" in row else None
        ),
    )


def _trafo2w_params(row) -> Trafo2WParams:
    """Capture a pandapower ``trafo`` row's explicit electrical parameters,
    including its tap changer (used when the transformer has no recognized
    std_type)."""
    return Trafo2WParams(
        sn_mva=float(row["sn_mva"]),
        vn_hv_kv=float(row["vn_hv_kv"]),
        vn_lv_kv=float(row["vn_lv_kv"]),
        vk_percent=float(row["vk_percent"]),
        vkr_percent=float(row["vkr_percent"]),
        pfe_kw=float(row["pfe_kw"]),
        i0_percent=float(row["i0_percent"]),
        shift_degree=float(row["shift_degree"]),
        **_tap_fields(row),
    )


def _trafo3w_params(row) -> Trafo3WParams:
    """Capture a pandapower ``trafo3w`` row's explicit electrical parameters."""
    return Trafo3WParams(
        sn_hv_mva=float(row["sn_hv_mva"]),
        sn_mv_mva=float(row["sn_mv_mva"]),
        sn_lv_mva=float(row["sn_lv_mva"]),
        vn_hv_kv=float(row["vn_hv_kv"]),
        vn_mv_kv=float(row["vn_mv_kv"]),
        vn_lv_kv=float(row["vn_lv_kv"]),
        vk_hv_percent=float(row["vk_hv_percent"]),
        vk_mv_percent=float(row["vk_mv_percent"]),
        vk_lv_percent=float(row["vk_lv_percent"]),
        vkr_hv_percent=float(row["vkr_hv_percent"]),
        vkr_mv_percent=float(row["vkr_mv_percent"]),
        vkr_lv_percent=float(row["vkr_lv_percent"]),
        pfe_kw=float(row["pfe_kw"]),
        i0_percent=float(row["i0_percent"]),
        shift_mv_degree=float(row["shift_mv_degree"]),
        shift_lv_degree=float(row["shift_lv_degree"]),
        **_tap_fields(row),
    )


# The editable electrical fields of each transformer kind — the ones the
# inspector's "Advanced" expander exposes (and the subset of a std_type a picked
# preset fills). Tap-changer columns are intentionally excluded: they're carried
# through unchanged rather than edited here.
_STD_FIELDS_2W = [
    "sn_mva", "vn_hv_kv", "vn_lv_kv",
    "vk_percent", "vkr_percent", "pfe_kw", "i0_percent", "shift_degree",
]
_STD_FIELDS_3W = [
    "sn_hv_mva", "sn_mv_mva", "sn_lv_mva",
    "vn_hv_kv", "vn_mv_kv", "vn_lv_kv",
    "vk_hv_percent", "vk_mv_percent", "vk_lv_percent",
    "vkr_hv_percent", "vkr_mv_percent", "vkr_lv_percent",
    "pfe_kw", "i0_percent", "shift_mv_degree", "shift_lv_degree",
]


def std_trafo_types(table: str) -> dict[str, dict[str, float]]:
    """Each library ``trafo``/``trafo3w`` std_type mapped to its editable
    parameter set, so the inspector can expand a chosen preset into editable
    values. Built from a throwaway empty net (pandapower's default catalog);
    independent of any session."""
    net = pp.create_empty_network()
    df = pp.available_std_types(net, table)
    fields = _STD_FIELDS_3W if table == "trafo3w" else _STD_FIELDS_2W
    out: dict[str, dict[str, float]] = {}
    for name in df.index:
        row = df.loc[name]
        out[str(name)] = {
            f: float(row[f])
            for f in fields
            if f in df.columns and pd.notna(row[f])
        }
    return out


# Cap imported networks for now: beyond this, both the solver round-trip and
# the React Flow canvas start to crawl. Lifted once rendering/perf is addressed.
MAX_IMPORT_BUSES = 100


_COMPONENT_DIAGRAMS = ("gen", "sgen", "ext_grid", "load")


def ensure_diagram_tables(net) -> bool:
    """Attach diagram_* layout tables (carrying a stable ``uuid`` per row) for
    every modeled element that lacks one, mutating ``net`` in place.

    Run once when a net becomes session state: commands address elements by their
    stable uuid, so every modeled row needs one. A foreign net with no layout
    gets one seeded from its ``geo`` columns when present (else a coarse graph
    layout); our own exports already carry these tables and are left untouched.

    Returns ``True`` when the seed was the coarse graph fallback (no geo, no
    existing layout) — the signal for the client to recompute a proper layout
    (ELK) over the real node sizes. A geo seed carries real coordinates and is
    left alone.
    """
    seed: dict[str, dict[int, tuple[float, float]]] | None = None
    line_waypoints: dict[int, tuple[float, float]] = {}
    needs_layout = False
    if net.get("diagram_bus") is None:
        geo = geo_layout(net)
        if geo is not None:
            seed = geo.positions
            line_waypoints = geo.line_waypoints
        else:
            seed = auto_layout(net)
            needs_layout = True

    def _xy(table: str, idx: int) -> tuple[float, float]:
        return seed.get(table, {}).get(idx, (0.0, 0.0)) if seed else (0.0, 0.0)

    if net.get("diagram_bus") is None and len(net.bus):
        net["diagram_bus"] = pd.DataFrame(
            [
                {
                    "uuid": uuid.uuid4().hex,
                    "x": _xy("bus", i)[0],
                    "y": _xy("bus", i)[1],
                    "width": 220.0,
                }
                for i in net.bus.index
            ],
            index=list(net.bus.index),
        )
    for table in _COMPONENT_DIAGRAMS:
        if net.get(f"diagram_{table}") is None and len(net[table]):
            net[f"diagram_{table}"] = pd.DataFrame(
                [
                    {
                        "uuid": uuid.uuid4().hex,
                        "x": _xy(table, i)[0],
                        "y": _xy(table, i)[1],
                        "port": "",
                        "waypoint_json": "",
                    }
                    for i in net[table].index
                ],
                index=list(net[table].index),
            )
    if net.get("diagram_shunt") is None and len(net.shunt):
        net["diagram_shunt"] = pd.DataFrame(
            [
                {
                    "uuid": uuid.uuid4().hex,
                    "x": _xy("shunt", i)[0],
                    "y": _xy("shunt", i)[1],
                    "port": "",
                }
                for i in net.shunt.index
            ],
            index=list(net.shunt.index),
        )
    if net.get("diagram_switch") is None and len(net.switch):
        # Only bus-bus switches are modeled by the editor; other switch types
        # stay on the net for the solve but get no layout row.
        rows = [i for i in net.switch.index if net.switch.at[i, "et"] == "b"]
        if rows:
            net["diagram_switch"] = pd.DataFrame(
                [
                    {
                        "uuid": uuid.uuid4().hex,
                        "x": _xy("switch", i)[0],
                        "y": _xy("switch", i)[1],
                        "port_a": "",
                        "port_b": "",
                    }
                    for i in rows
                ],
                index=rows,
            )
    if net.get("diagram_trafo") is None and len(net.trafo):
        net["diagram_trafo"] = pd.DataFrame(
            [
                {
                    "uuid": uuid.uuid4().hex,
                    "x": _xy("trafo", i)[0],
                    "y": _xy("trafo", i)[1],
                    "port_hv": "",
                    "port_lv": "",
                }
                for i in net.trafo.index
            ],
            index=list(net.trafo.index),
        )
    if net.get("diagram_trafo3w") is None and len(net.trafo3w):
        net["diagram_trafo3w"] = pd.DataFrame(
            [
                {
                    "uuid": uuid.uuid4().hex,
                    "x": _xy("trafo3w", i)[0],
                    "y": _xy("trafo3w", i)[1],
                    "port_hv": "",
                    "port_mv": "",
                    "port_lv": "",
                }
                for i in net.trafo3w.index
            ],
            index=list(net.trafo3w.index),
        )
    if net.get("diagram_line") is None and len(net.line):
        net["diagram_line"] = pd.DataFrame(
            [
                {
                    "uuid": uuid.uuid4().hex,
                    "x": _xy("line", i)[0],
                    "y": _xy("line", i)[1],
                    "port_from": "",
                    "port_to": "",
                    "waypoint_json": (
                        json.dumps(
                            {"x": line_waypoints[i][0], "y": line_waypoints[i][1]}
                        )
                        if i in line_waypoints
                        else ""
                    ),
                }
                for i in net.line.index
            ],
            index=list(net.line.index),
        )
    return needs_layout


def net_to_network(net) -> Network:
    """Project a pandapower net to the editor Network (modeled subset + layout).

    Works on nets we prepared (rich diagram tables) and, best-effort, on plain
    pandapower nets with no diagram_* tables (positions default, ids generated).
    Buses, gens, sgens, ext_grids, loads, lines, bus-bus switches and
    transformers are reconstructed; element tables we don't model are surfaced
    separately as read-only foreign elements (see ``projection.py``).
    """
    d_bus = net.get("diagram_bus")
    d_gen = net.get("diagram_gen")
    d_sgen = net.get("diagram_sgen")
    d_ext_grid = net.get("diagram_ext_grid")
    d_load = net.get("diagram_load")
    d_switch = net.get("diagram_switch")
    d_trafo = net.get("diagram_trafo")
    d_trafo3w = net.get("diagram_trafo3w")
    d_line = net.get("diagram_line")
    d_shunt = net.get("diagram_shunt")
    d_meta = net.get("diagram_meta")

    network_id = uuid.uuid4().hex
    network_name = net.name or "Imported network"
    needs_layout = False
    if d_meta is not None and len(d_meta):
        row = d_meta.iloc[0]
        network_id = str(row.get("network_id") or network_id)
        network_name = str(row.get("network_name") or network_name)
        needs_layout = bool(row.get("needs_layout") or False)

    # A foreign net (no editor diagram tables) gets an auto-generated layout so
    # everything doesn't pile at the origin.
    auto = auto_layout(net) if d_bus is None else None

    def _layout(table, idx):
        if table is None or idx not in table.index:
            return None
        return table.loc[idx]

    def _pos(lay, table: str, idx: int) -> tuple[float, float]:
        if lay is not None:
            return float(lay["x"]), float(lay["y"])
        if auto is not None:
            return auto[table].get(idx, (0.0, 0.0))
        return 0.0, 0.0

    def _name(value, default: str) -> str:
        return str(value) if isinstance(value, str) and value else default

    def _col(lay, key: str) -> str:
        if lay is None or key not in lay:
            return ""
        value = lay[key]
        return str(value) if isinstance(value, str) else ""

    def _num(table, idx, key: str, default: float) -> float:
        """An optional numeric column, defaulted when absent or NaN (e.g. the SC
        machine data a plain pandapower import doesn't carry)."""
        if key not in table.columns:
            return default
        value = table.at[idx, key]
        if value is None or pd.isna(value):
            return default
        return float(value)

    # Buses, building the pandapower-index -> our-uuid map for the references.
    bus_uuid: dict[int, str] = {}
    buses: list[Bus] = []
    for i in net.bus.index:
        lay = _layout(d_bus, i)
        uid = str(lay["uuid"]) if lay is not None else uuid.uuid4().hex
        bus_uuid[i] = uid
        bx, by = _pos(lay, "bus", i)
        buses.append(
            Bus(
                id=uid,
                name=_name(net.bus.at[i, "name"], "Bus"),
                vn_kv=float(net.bus.at[i, "vn_kv"]),
                x=bx,
                y=by,
                width=float(lay["width"]) if lay is not None else 220.0,
            )
        )

    generators: list[Generator] = []
    for j in net.gen.index:
        lay = _layout(d_gen, j)
        generators.append(
            Generator(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.gen.at[j, "name"], "Generator"),
                bus_id=bus_uuid[int(net.gen.at[j, "bus"])],
                p_mw=float(net.gen.at[j, "p_mw"]),
                vm_pu=float(net.gen.at[j, "vm_pu"]),
                slack=bool(net.gen.at[j, "slack"]),
                slack_weight=float(net.gen.at[j, "slack_weight"]),
                sn_mva=_num(net.gen, j, "sn_mva", 1.0),
                xdss_pu=_num(net.gen, j, "xdss_pu", 0.2),
                cos_phi=_num(net.gen, j, "cos_phi", 0.8),
                port=_col(lay, "port"),
                x=_pos(lay, "gen", j)[0],
                y=_pos(lay, "gen", j)[1],
                waypoint=_parse_waypoint(lay["waypoint_json"]) if lay is not None else None,
            )
        )

    sgens: list[Sgen] = []
    for j in net.sgen.index:
        lay = _layout(d_sgen, j)
        sgens.append(
            Sgen(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.sgen.at[j, "name"], "Static gen"),
                bus_id=bus_uuid[int(net.sgen.at[j, "bus"])],
                p_mw=float(net.sgen.at[j, "p_mw"]),
                q_mvar=float(net.sgen.at[j, "q_mvar"]),
                port=_col(lay, "port"),
                x=_pos(lay, "sgen", j)[0],
                y=_pos(lay, "sgen", j)[1],
                waypoint=_parse_waypoint(lay["waypoint_json"]) if lay is not None else None,
            )
        )

    ext_grids: list[ExtGrid] = []
    for j in net.ext_grid.index:
        lay = _layout(d_ext_grid, j)
        va = net.ext_grid.at[j, "va_degree"] if "va_degree" in net.ext_grid else 0.0
        ext_grids.append(
            ExtGrid(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.ext_grid.at[j, "name"], "External grid"),
                bus_id=bus_uuid[int(net.ext_grid.at[j, "bus"])],
                vm_pu=float(net.ext_grid.at[j, "vm_pu"]),
                va_degree=float(va) if va is not None else 0.0,
                s_sc_max_mva=_num(net.ext_grid, j, "s_sc_max_mva", 1000.0),
                rx_max=_num(net.ext_grid, j, "rx_max", 0.1),
                port=_col(lay, "port"),
                x=_pos(lay, "ext_grid", j)[0],
                y=_pos(lay, "ext_grid", j)[1],
                waypoint=_parse_waypoint(lay["waypoint_json"]) if lay is not None else None,
            )
        )

    loads: list[Load] = []
    for k in net.load.index:
        lay = _layout(d_load, k)
        loads.append(
            Load(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.load.at[k, "name"], "Load"),
                bus_id=bus_uuid[int(net.load.at[k, "bus"])],
                p_mw=float(net.load.at[k, "p_mw"]),
                q_mvar=float(net.load.at[k, "q_mvar"]),
                port=_col(lay, "port"),
                x=_pos(lay, "load", k)[0],
                y=_pos(lay, "load", k)[1],
                waypoint=_parse_waypoint(lay["waypoint_json"]) if lay is not None else None,
            )
        )

    switches: list[Switch] = []
    for s in net.switch.index:
        if net.switch.at[s, "et"] != "b":
            continue  # only bus-bus switches map to our editor for now
        lay = _layout(d_switch, s)
        switches.append(
            Switch(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.switch.at[s, "name"], "Switch"),
                bus_a=bus_uuid[int(net.switch.at[s, "bus"])],
                bus_b=bus_uuid[int(net.switch.at[s, "element"])],
                closed=bool(net.switch.at[s, "closed"]),
                port_a=_col(lay, "port_a"),
                port_b=_col(lay, "port_b"),
                x=_pos(lay, "switch", s)[0],
                y=_pos(lay, "switch", s)[1],
            )
        )

    # Every transformer is projected with its explicit electrical ``params`` (read
    # straight from the net columns), so they're always visible and editable in
    # the inspector's "Advanced" expander. ``std_type`` is just the preset label:
    # kept when it names a type we carry, blanked otherwise (a custom/imported
    # transformer, e.g. case14's raw-parameter trafos). Either way ``params`` is
    # the source of truth the solver builds from.
    trafo_std = set(pp.available_std_types(net, "trafo").index)
    trafo3w_std = set(pp.available_std_types(net, "trafo3w").index)

    transformers2w: list[Transformer2W] = []
    for t in net.trafo.index:
        lay = _layout(d_trafo, t)
        std_raw = net.trafo.at[t, "std_type"]
        std_name = std_raw if isinstance(std_raw, str) and std_raw in trafo_std else ""
        transformers2w.append(
            Transformer2W(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.trafo.at[t, "name"], "Transformer"),
                hv_bus=bus_uuid[int(net.trafo.at[t, "hv_bus"])],
                lv_bus=bus_uuid[int(net.trafo.at[t, "lv_bus"])],
                std_type=std_name,
                params=_trafo2w_params(net.trafo.loc[t]),
                port_hv=_col(lay, "port_hv"),
                port_lv=_col(lay, "port_lv"),
                x=_pos(lay, "trafo", t)[0],
                y=_pos(lay, "trafo", t)[1],
            )
        )

    transformers3w: list[Transformer3W] = []
    for t in net.trafo3w.index:
        lay = _layout(d_trafo3w, t)
        std_raw = net.trafo3w.at[t, "std_type"]
        std_name = std_raw if isinstance(std_raw, str) and std_raw in trafo3w_std else ""
        transformers3w.append(
            Transformer3W(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.trafo3w.at[t, "name"], "3W Transformer"),
                hv_bus=bus_uuid[int(net.trafo3w.at[t, "hv_bus"])],
                mv_bus=bus_uuid[int(net.trafo3w.at[t, "mv_bus"])],
                lv_bus=bus_uuid[int(net.trafo3w.at[t, "lv_bus"])],
                std_type=std_name,
                params=_trafo3w_params(net.trafo3w.loc[t]),
                port_hv=_col(lay, "port_hv"),
                port_mv=_col(lay, "port_mv"),
                port_lv=_col(lay, "port_lv"),
                x=_pos(lay, "trafo3w", t)[0],
                y=_pos(lay, "trafo3w", t)[1],
            )
        )

    lines: list[Line] = []
    for k in net.line.index:
        lay = _layout(d_line, k)
        lines.append(
            Line(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.line.at[k, "name"], "Line"),
                from_bus=bus_uuid[int(net.line.at[k, "from_bus"])],
                to_bus=bus_uuid[int(net.line.at[k, "to_bus"])],
                length_km=float(net.line.at[k, "length_km"]),
                r_ohm_per_km=float(net.line.at[k, "r_ohm_per_km"]),
                x_ohm_per_km=float(net.line.at[k, "x_ohm_per_km"]),
                c_nf_per_km=float(net.line.at[k, "c_nf_per_km"]),
                max_i_ka=float(net.line.at[k, "max_i_ka"]),
                port_from=_col(lay, "port_from"),
                port_to=_col(lay, "port_to"),
                waypoint=_parse_waypoint(lay.get("waypoint_json")) if lay is not None else None,
                x=_pos(lay, "line", k)[0],
                y=_pos(lay, "line", k)[1],
            )
        )

    shunts: list[Shunt] = []
    for s in net.shunt.index:
        lay = _layout(d_shunt, s)
        step = net.shunt.at[s, "step"]
        shunts.append(
            Shunt(
                id=str(lay["uuid"]) if lay is not None else uuid.uuid4().hex,
                name=_name(net.shunt.at[s, "name"], "Shunt"),
                bus_id=bus_uuid[int(net.shunt.at[s, "bus"])],
                p_mw=float(net.shunt.at[s, "p_mw"]),
                q_mvar=float(net.shunt.at[s, "q_mvar"]),
                vn_kv=_opt_f(net.shunt.at[s, "vn_kv"]),
                step=int(step) if not pd.isna(step) else 1,
                port=_col(lay, "port"),
                x=float(lay["x"]) if lay is not None else 0.0,
                y=float(lay["y"]) if lay is not None else 0.0,
            )
        )

    return Network(
        id=network_id,
        name=network_name,
        f_hz=float(net.f_hz) if net.f_hz else 50.0,
        sn_mva=float(net.sn_mva) if net.sn_mva else 1.0,
        buses=buses,
        generators=generators,
        sgens=sgens,
        ext_grids=ext_grids,
        loads=loads,
        switches=switches,
        transformers2w=transformers2w,
        transformers3w=transformers3w,
        lines=lines,
        shunts=shunts,
        needs_layout=needs_layout,
    )
