"""Apply browser edit commands to the authoritative pandapower net.

Each command mutates the retained net (and its diagram_* layout tables) in
place. Elements are addressed by the stable uuid stored in the diagram_* table,
so an edit never has to re-send the whole document and foreign tables/columns on
the net are preserved untouched.

The editor only sends a creation command once an element is electrically valid
(a component wired to a bus, a switch wired to both buses), so the net stays
materializable — unwired drafts live only in the browser until then.
"""

from __future__ import annotations

import json

import pandapower as pp
import pandas as pd

from .schema import Command

DEFAULT_TRAFO_STD = "0.25 MVA 20/0.4 kV"
DEFAULT_TRAFO3W_STD = "63/25/38 MVA 110/20/10 kV"

# Editor element kind -> pandapower table name.
_KIND_TABLE = {
    "bus": "bus",
    "generator": "gen",
    "sgen": "sgen",
    "extgrid": "ext_grid",
    "load": "load",
    "shunt": "shunt",
    "switch": "switch",
    "trafo2w": "trafo",
    "trafo3w": "trafo3w",
    "line": "line",
}

# Attachment end -> (bus reference column, diagram port column).
_END_COLUMNS = {
    "": ("bus", "port"),
    "from": ("from_bus", "port_from"),
    "to": ("to_bus", "port_to"),
    "hv": ("hv_bus", "port_hv"),
    "mv": ("mv_bus", "port_mv"),
    "lv": ("lv_bus", "port_lv"),
    "a": ("bus", "port_a"),
    "b": ("element", "port_b"),
}


class CommandError(ValueError):
    """A command could not be applied (e.g. it referenced a missing element)."""


def _waypoint_json(point) -> str:
    if not point:
        return ""
    return json.dumps({"x": float(point["x"]), "y": float(point["y"])})


def _index_of(net, table: str, uid: str) -> int:
    d = net.get(f"diagram_{table}")
    if d is not None:
        for i in d.index:
            if str(d.at[i, "uuid"]) == uid:
                return int(i)
    raise CommandError(f"Unknown {table} '{uid}'.")


def _set_diagram(net, table: str, index: int, row: dict) -> None:
    key = f"diagram_{table}"
    d = net.get(key)
    if d is None:
        net[key] = pd.DataFrame([row], index=[index])
        return
    for col, value in row.items():
        d.at[index, col] = value


def _prune_diagrams(net) -> None:
    """Drop diagram rows whose element no longer exists (e.g. after a cascading
    bus delete), keeping the layout tables aligned with the net."""
    for table in _KIND_TABLE.values():
        d = net.get(f"diagram_{table}")
        if d is None:
            continue
        present = set(net[table].index)
        stale = [i for i in d.index if int(i) not in present]
        if stale:
            net[f"diagram_{table}"] = d.drop(stale)


def _trafo_std(net, table: str, requested: str) -> str:
    available = set(pp.available_std_types(net, table).index)
    if requested in available:
        return requested
    return DEFAULT_TRAFO3W_STD if table == "trafo3w" else DEFAULT_TRAFO_STD


# --- handlers --------------------------------------------------------------


def _add_bus(net, p: dict) -> None:
    idx = pp.create_bus(net, vn_kv=p["vn_kv"], name=p.get("name", "Bus"))
    _set_diagram(
        net,
        "bus",
        idx,
        {
            "uuid": p["id"],
            "x": p.get("x", 0.0),
            "y": p.get("y", 0.0),
            "width": p.get("width", 220.0),
        },
    )


def _add_element(net, p: dict) -> None:
    kind = p["kind"]
    d = p["data"]
    bus = _index_of(net, "bus", p["bus_id"])
    name = d.get("name", kind)
    if kind == "generator":
        idx = pp.create_gen(
            net,
            bus=bus,
            p_mw=d["p_mw"],
            vm_pu=d["vm_pu"],
            name=name,
            slack=d.get("slack", False),
            slack_weight=d.get("slack_weight", 1.0),
        )
    elif kind == "sgen":
        idx = pp.create_sgen(net, bus=bus, p_mw=d["p_mw"], q_mvar=d["q_mvar"], name=name)
    elif kind == "extgrid":
        idx = pp.create_ext_grid(
            net, bus=bus, vm_pu=d["vm_pu"], va_degree=d["va_degree"], name=name
        )
    elif kind == "load":
        idx = pp.create_load(net, bus=bus, p_mw=d["p_mw"], q_mvar=d["q_mvar"], name=name)
    elif kind == "shunt":
        kwargs = dict(q_mvar=d["q_mvar"], p_mw=d["p_mw"], step=d.get("step", 1), name=name)
        if d.get("vn_kv") is not None:
            kwargs["vn_kv"] = d["vn_kv"]
        idx = pp.create_shunt(net, bus=bus, **kwargs)
    else:
        raise CommandError(f"Cannot add element of kind '{kind}'.")

    table = _KIND_TABLE[kind]
    row = {"uuid": p["id"], "x": p.get("x", 0.0), "y": p.get("y", 0.0), "port": p.get("port", "")}
    if table != "shunt":
        row["waypoint_json"] = _waypoint_json(p.get("waypoint"))
    _set_diagram(net, table, idx, row)


def _add_line(net, p: dict) -> None:
    d = p["data"]
    idx = pp.create_line_from_parameters(
        net,
        from_bus=_index_of(net, "bus", p["from_bus"]),
        to_bus=_index_of(net, "bus", p["to_bus"]),
        length_km=d["length_km"],
        r_ohm_per_km=d["r_ohm_per_km"],
        x_ohm_per_km=d["x_ohm_per_km"],
        c_nf_per_km=d["c_nf_per_km"],
        max_i_ka=d["max_i_ka"],
        name=d.get("name", "Line"),
    )
    _set_diagram(
        net,
        "line",
        idx,
        {
            "uuid": p["id"],
            "x": 0.0,
            "y": 0.0,
            "port_from": p.get("port_from", ""),
            "port_to": p.get("port_to", ""),
            "waypoint_json": _waypoint_json(p.get("waypoint")),
        },
    )


def _add_transformer(net, p: dict) -> None:
    hv_bus = _index_of(net, "bus", p["hv_bus"])
    lv_bus = _index_of(net, "bus", p["lv_bus"])
    name = p.get("name", "Transformer")
    params = p.get("params")
    if params:
        # Buses whose voltages match no standard type: build from explicit
        # parameters (rated voltages follow the buses).
        kwargs = {k: v for k, v in params.items() if v is not None}
        idx = pp.create_transformer_from_parameters(
            net, hv_bus=hv_bus, lv_bus=lv_bus, name=name, **kwargs
        )
    else:
        idx = pp.create_transformer(
            net,
            hv_bus=hv_bus,
            lv_bus=lv_bus,
            std_type=_trafo_std(net, "trafo", p.get("std_type", DEFAULT_TRAFO_STD)),
            name=name,
        )
    _set_diagram(
        net,
        "trafo",
        idx,
        {
            "uuid": p["id"],
            "x": p.get("x", 0.0),
            "y": p.get("y", 0.0),
            "port_hv": p.get("port_hv", ""),
            "port_lv": p.get("port_lv", ""),
        },
    )


def _add_transformer3w(net, p: dict) -> None:
    hv_bus = _index_of(net, "bus", p["hv_bus"])
    mv_bus = _index_of(net, "bus", p["mv_bus"])
    lv_bus = _index_of(net, "bus", p["lv_bus"])
    name = p.get("name", "3W Transformer")
    params = p.get("params")
    if params:
        kwargs = {k: v for k, v in params.items() if v is not None}
        idx = pp.create_transformer3w_from_parameters(
            net, hv_bus=hv_bus, mv_bus=mv_bus, lv_bus=lv_bus, name=name, **kwargs
        )
    else:
        idx = pp.create_transformer3w(
            net,
            hv_bus=hv_bus,
            mv_bus=mv_bus,
            lv_bus=lv_bus,
            std_type=_trafo_std(net, "trafo3w", p.get("std_type", DEFAULT_TRAFO3W_STD)),
            name=name,
        )
    _set_diagram(
        net,
        "trafo3w",
        idx,
        {
            "uuid": p["id"],
            "x": p.get("x", 0.0),
            "y": p.get("y", 0.0),
            "port_hv": p.get("port_hv", ""),
            "port_mv": p.get("port_mv", ""),
            "port_lv": p.get("port_lv", ""),
        },
    )


def _add_switch(net, p: dict) -> None:
    idx = pp.create_switch(
        net,
        bus=_index_of(net, "bus", p["bus_a"]),
        element=_index_of(net, "bus", p["bus_b"]),
        et="b",
        closed=p.get("closed", True),
        name=p.get("name", "Switch"),
    )
    _set_diagram(
        net,
        "switch",
        idx,
        {
            "uuid": p["id"],
            "x": p.get("x", 0.0),
            "y": p.get("y", 0.0),
            "port_a": p.get("port_a", ""),
            "port_b": p.get("port_b", ""),
        },
    )


def _connect(net, p: dict) -> None:
    table = _KIND_TABLE[p["kind"]]
    idx = _index_of(net, table, p["id"])
    end = p.get("end", "")
    bus_col, port_col = _END_COLUMNS[end]
    net[table].at[idx, bus_col] = _index_of(net, "bus", p["bus_id"])
    _set_diagram(net, table, idx, {port_col: p.get("port", "")})


def _update(net, p: dict) -> None:
    kind = p["kind"]
    table = _KIND_TABLE[kind]
    idx = _index_of(net, table, p["id"])
    patch = dict(p.get("patch", {}))

    # Switching a transformer to a (different) named std_type re-derives its
    # electrical columns in place, so the uuid and layout row are kept.
    std_type = patch.pop("std_type", None)
    if std_type is not None and kind in ("trafo2w", "trafo3w"):
        std = _trafo_std(net, table, std_type)
        params = pp.load_std_type(net, std, table)
        for col, value in params.items():
            if col in net[table].columns:
                net[table].at[idx, col] = value
        net[table].at[idx, "std_type"] = std

    columns = set(net[table].columns)
    for key, value in patch.items():
        if key in columns:
            net[table].at[idx, key] = value


def _delete(net, p: dict) -> None:
    table = _KIND_TABLE[p["kind"]]
    idx = _index_of(net, table, p["id"])
    if table == "bus":
        # Cascade: drop the bus and everything attached to it.
        pp.drop_buses(net, [idx])
    else:
        net[table] = net[table].drop(idx)
    _prune_diagrams(net)


def _set_layout(net, p: dict) -> None:
    table = _KIND_TABLE[p["kind"]]
    idx = _index_of(net, table, p["id"])
    row: dict = {}
    for key in ("x", "y", "width", "port", "port_a", "port_b", "port_hv", "port_mv", "port_lv", "port_from", "port_to"):
        if key in p:
            row[key] = p[key]
    if "waypoint" in p:
        row["waypoint_json"] = _waypoint_json(p["waypoint"])
    if row:
        _set_diagram(net, table, idx, row)


_HANDLERS = {
    "add_bus": _add_bus,
    "add_element": _add_element,
    "add_line": _add_line,
    "add_transformer": _add_transformer,
    "add_transformer3w": _add_transformer3w,
    "add_switch": _add_switch,
    "connect": _connect,
    "update": _update,
    "delete": _delete,
    "set_layout": _set_layout,
}


def apply_commands(net, commands: list[Command]) -> None:
    """Apply a batch of commands to ``net`` in order, mutating it in place."""
    for command in commands:
        handler = _HANDLERS.get(command.op)
        if handler is None:
            raise CommandError(f"Unknown command '{command.op}'.")
        handler(net, command.payload)
