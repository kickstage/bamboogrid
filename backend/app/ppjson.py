"""Serialize an editor :class:`Network` to a single pandapower JSON that also
carries the diagram layout, and read it back.

The file is a 100% valid pandapower net (``pp.to_json``): the electrical model
lives in the standard tables (``bus``, ``ext_grid``, ``load``), and the diagram
layout lives in separate custom tables with a ``diagram_`` prefix:

  * ``diagram_bus``      — per-bus ``uuid, x, y, width``
  * ``diagram_ext_grid`` — per-generator ``uuid, x, y, waypoint_json``
  * ``diagram_load``     — per-load ``uuid, x, y, waypoint_json``
  * ``diagram_meta``     — one row of document metadata

These extra tables are isolated from the core frames (so we never touch
pandapower's schemas), are ignored by the solver, and round-trip through
``to_json``/``from_json``. Coordinates are editor canvas pixels (y-down) — not
geographic — so they go here, never in pandapower's ``geo`` column.
"""

from __future__ import annotations

import json
import uuid

import pandapower as pp
import pandas as pd

from .converter import build_net
from .schema import Bus, Generator, Load, Network, Point, Switch

SCHEMA_VERSION = "bamboogrid/1"


def _waypoint_json(point: Point | None) -> str:
    return json.dumps({"x": point.x, "y": point.y}) if point else ""


def _parse_waypoint(value) -> Point | None:
    if not value or (isinstance(value, float) and pd.isna(value)):
        return None
    data = json.loads(value)
    return Point(x=float(data["x"]), y=float(data["y"]))


def network_to_pp_json(network: Network) -> str:
    """Build the pandapower net and attach the diagram_* layout tables."""
    net, id_maps = build_net(network)

    bus_by_id = {b.id: b for b in network.buses}
    gen_by_id = {g.id: g for g in network.generators}
    load_by_id = {load.id: load for load in network.loads}

    def _component_rows(by_id, id_map):
        return pd.DataFrame(
            [
                {
                    "uuid": uid,
                    "x": by_id[uid].x,
                    "y": by_id[uid].y,
                    "port": by_id[uid].port,
                    "waypoint_json": _waypoint_json(by_id[uid].waypoint),
                }
                for uid in id_map
            ],
            index=list(id_map.values()),
        )

    net["diagram_bus"] = pd.DataFrame(
        [
            {"uuid": uid, "x": bus_by_id[uid].x, "y": bus_by_id[uid].y, "width": bus_by_id[uid].width}
            for uid in id_maps["bus"]
        ],
        index=list(id_maps["bus"].values()),
    )
    net["diagram_gen"] = _component_rows(gen_by_id, id_maps["gen"])
    net["diagram_load"] = _component_rows(load_by_id, id_maps["load"])
    switch_by_id = {s.id: s for s in network.switches}
    net["diagram_switch"] = pd.DataFrame(
        [
            {
                "uuid": uid,
                "x": switch_by_id[uid].x,
                "y": switch_by_id[uid].y,
                "port_a": switch_by_id[uid].port_a,
                "port_b": switch_by_id[uid].port_b,
            }
            for uid in id_maps["switch"]
        ],
        index=list(id_maps["switch"].values()),
    )
    net["diagram_meta"] = pd.DataFrame(
        [
            {
                "schema_version": SCHEMA_VERSION,
                "coordinate_space": "screen-px-y-down",
                "network_id": network.id,
                "network_name": network.name,
            }
        ]
    )

    return pp.to_json(net)


def pp_json_to_network(raw: str) -> Network:
    """Reconstruct the editor Network from a pandapower JSON.

    Works on files we exported (rich diagram tables) and, best-effort, on plain
    pandapower nets with no diagram_* tables (positions default, ids generated).
    Only bus / gen / ext_grid / load / bus-bus switch are reconstructed for now;
    other element tables (line, trafo, sgen, …) are ignored until supported.
    """
    net = pp.from_json_string(raw)

    d_bus = net.get("diagram_bus")
    d_gen = net.get("diagram_gen")
    d_load = net.get("diagram_load")
    d_switch = net.get("diagram_switch")
    d_meta = net.get("diagram_meta")

    network_id = uuid.uuid4().hex
    network_name = net.name or "Imported network"
    if d_meta is not None and len(d_meta):
        row = d_meta.iloc[0]
        network_id = str(row.get("network_id") or network_id)
        network_name = str(row.get("network_name") or network_name)

    def _layout(table, idx):
        if table is None or idx not in table.index:
            return None
        return table.loc[idx]

    def _name(value, default: str) -> str:
        return str(value) if isinstance(value, str) and value else default

    def _col(lay, key: str) -> str:
        if lay is None or key not in lay:
            return ""
        value = lay[key]
        return str(value) if isinstance(value, str) else ""

    # Buses, building the pandapower-index -> our-uuid map for the references.
    bus_uuid: dict[int, str] = {}
    buses: list[Bus] = []
    for i in net.bus.index:
        lay = _layout(d_bus, i)
        uid = str(lay["uuid"]) if lay is not None else uuid.uuid4().hex
        bus_uuid[i] = uid
        buses.append(
            Bus(
                id=uid,
                name=_name(net.bus.at[i, "name"], "Bus"),
                vn_kv=float(net.bus.at[i, "vn_kv"]),
                x=float(lay["x"]) if lay is not None else 0.0,
                y=float(lay["y"]) if lay is not None else 0.0,
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
                port=_col(lay, "port"),
                x=float(lay["x"]) if lay is not None else 0.0,
                y=float(lay["y"]) if lay is not None else 0.0,
                waypoint=_parse_waypoint(lay["waypoint_json"]) if lay is not None else None,
            )
        )

    # We no longer have an external-grid element. A foreign net's ext_grid is
    # the slack, so import it as a slack generator to keep the reference.
    for j in net.ext_grid.index:
        generators.append(
            Generator(
                id=uuid.uuid4().hex,
                name=_name(net.ext_grid.at[j, "name"], "Slack"),
                bus_id=bus_uuid[int(net.ext_grid.at[j, "bus"])],
                p_mw=0.0,
                vm_pu=float(net.ext_grid.at[j, "vm_pu"]),
                slack=True,
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
                x=float(lay["x"]) if lay is not None else 0.0,
                y=float(lay["y"]) if lay is not None else 0.0,
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
                x=float(lay["x"]) if lay is not None else 0.0,
                y=float(lay["y"]) if lay is not None else 0.0,
            )
        )

    return Network(
        id=network_id,
        name=network_name,
        buses=buses,
        generators=generators,
        loads=loads,
        switches=switches,
    )
