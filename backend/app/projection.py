"""Project the authoritative pandapower net to the browser view model.

The modeled subset round-trips through :func:`ppjson.net_to_network`; everything
else (element tables we don't model yet) is surfaced as read-only
:class:`ForeignElement` rows so the user sees they exist and they survive a
round-trip, while the full net stays server-side.
"""

from __future__ import annotations

import pandas as pd

from .ppjson import net_to_network
from .schema import ForeignElement, ViewModel

# Tables the editor models (handled by net_to_network) plus pandapower's own
# bookkeeping frames — none of these are "foreign".
_MODELED = {
    "bus",
    "gen",
    "sgen",
    "ext_grid",
    "load",
    "shunt",
    "switch",
    "trafo",
    "trafo3w",
    "line",
    "xward",
}
_NON_ELEMENT = {"bus_geodata", "line_geodata"}

# Columns on a foreign table that reference a bus (by pandapower index). A
# foreign row is only surfaced when it connects to a bus — this keeps real
# network elements (dcline, impedance, motor, storage, ward, ...) and drops pure
# metadata tables (poly_cost, measurement, ...) that have no place on the canvas.
_BUS_COLUMNS = ("bus", "from_bus", "to_bus", "hv_bus", "mv_bus", "lv_bus")


def _bus_index_to_uuid(net) -> dict[int, str]:
    d = net.get("diagram_bus")
    if d is None:
        return {}
    return {int(i): str(d.at[i, "uuid"]) for i in d.index}


def _bus_xy(net) -> dict[int, tuple[float, float]]:
    d = net.get("diagram_bus")
    if d is None:
        return {}
    return {int(i): (float(d.at[i, "x"]), float(d.at[i, "y"])) for i in d.index}


def foreign_elements(net) -> list[ForeignElement]:
    bus_uuid = _bus_index_to_uuid(net)
    bus_xy = _bus_xy(net)
    out: list[ForeignElement] = []
    for key in list(net.keys()):
        if key in _MODELED or key in _NON_ELEMENT:
            continue
        if key.startswith(("res_", "_", "diagram_")):
            continue
        table = net[key]
        if not isinstance(table, pd.DataFrame) or not len(table):
            continue
        bus_cols = [c for c in _BUS_COLUMNS if c in table.columns]
        if not bus_cols:
            continue
        for idx in table.index:
            referenced: list[int] = []
            for c in bus_cols:
                val = table.at[idx, c]
                if val is not None and not pd.isna(val) and int(val) in bus_uuid:
                    referenced.append(int(val))
            if not referenced:
                continue
            ids = [bus_uuid[b] for b in referenced]
            # Place the placeholder at the centroid of its buses, nudged down so
            # it doesn't sit on top of a bus.
            xs = [bus_xy[b][0] for b in referenced]
            ys = [bus_xy[b][1] for b in referenced]
            x, y = sum(xs) / len(xs), sum(ys) / len(ys) + 90.0
            name = ""
            if "name" in table.columns:
                raw = table.at[idx, "name"]
                if isinstance(raw, str):
                    name = raw
            out.append(
                ForeignElement(
                    id=f"{key}:{idx}",
                    table=key,
                    name=name or key,
                    bus_ids=ids,
                    x=x,
                    y=y,
                )
            )
    return out


def net_to_view(net) -> ViewModel:
    return ViewModel(network=net_to_network(net), foreign=foreign_elements(net))
