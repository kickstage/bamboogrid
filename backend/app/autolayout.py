"""Generate canvas coordinates for an imported pandapower net that carries no
editor layout (a foreign file). We build the bus graph from the net's
connectivity and run a networkx layout (no extra native deps), then place
sources above each bus and loads below.

Returns pixel coordinates keyed by pandapower table index, per table.
"""

from __future__ import annotations

import math

import networkx as nx

Coord = tuple[float, float]


def _root_bus(net, bus_ids: list[int]) -> int:
    """Prefer an ext_grid bus, then a slack generator's bus, as the hierarchy
    root; otherwise the first bus."""
    if len(net.ext_grid):
        return int(net.ext_grid.at[net.ext_grid.index[0], "bus"])
    if len(net.gen):
        slack = net.gen[net.gen["slack"]] if "slack" in net.gen else net.gen.iloc[0:0]
        if len(slack):
            return int(slack.at[slack.index[0], "bus"])
    return bus_ids[0]


def _normalized_positions(net, bus_ids: list[int]) -> dict[int, Coord]:
    try:
        from pandapower.topology import create_nxgraph

        g = create_nxgraph(net, respect_switches=False)
    except Exception:  # noqa: BLE001 - any failure → empty graph, grid fallback
        g = nx.MultiGraph()
    g.add_nodes_from(bus_ids)

    if g.number_of_edges() > 0:
        try:
            if nx.is_connected(g):
                return nx.bfs_layout(g, _root_bus(net, bus_ids))
            return nx.spring_layout(g, seed=1)
        except Exception:  # noqa: BLE001
            return nx.spring_layout(g, seed=1)

    # No branches: a simple grid so buses don't stack.
    cols = max(1, math.ceil(math.sqrt(len(bus_ids))))
    return {b: (i % cols, i // cols) for i, b in enumerate(bus_ids)}


def _to_pixels(pos: dict[int, Coord], n: int) -> dict[int, Coord]:
    xs = [p[0] for p in pos.values()]
    ys = [p[1] for p in pos.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = (max_x - min_x) or 1.0
    span_y = (max_y - min_y) or 1.0
    width = max(400.0, 180.0 * (n - 1))
    height = max(300.0, 150.0 * (n - 1))
    margin = 80.0
    return {
        b: (
            round((x - min_x) / span_x * width) + margin,
            round((y - min_y) / span_y * height) + margin,
        )
        for b, (x, y) in pos.items()
    }


def auto_layout(net) -> dict[str, dict[int, Coord]]:
    bus_ids = list(net.bus.index)
    empty = {k: {} for k in ("bus", "gen", "ext_grid", "load", "switch")}
    if not bus_ids:
        return empty

    bus_xy = _to_pixels(_normalized_positions(net, bus_ids), len(bus_ids))

    # Stack multiple sources/loads on the same bus side by side.
    GAP, STEP = 100.0, 70.0
    above: dict[int, int] = {}
    below: dict[int, int] = {}

    def place(bus: int, side: str) -> Coord:
        bx, by = bus_xy.get(bus, (0.0, 0.0))
        counts = above if side == "above" else below
        i = counts.get(bus, 0)
        counts[bus] = i + 1
        return (bx + i * STEP, by - GAP if side == "above" else by + GAP)

    result: dict[str, dict[int, Coord]] = {"bus": bus_xy, "gen": {}, "ext_grid": {}, "load": {}, "switch": {}}
    for gi in net.gen.index:
        result["gen"][gi] = place(int(net.gen.at[gi, "bus"]), "above")
    for ei in net.ext_grid.index:
        result["ext_grid"][ei] = place(int(net.ext_grid.at[ei, "bus"]), "above")
    for li in net.load.index:
        result["load"][li] = place(int(net.load.at[li, "bus"]), "below")
    for si in net.switch.index:
        if net.switch.at[si, "et"] != "b":
            continue
        ax, ay = bus_xy.get(int(net.switch.at[si, "bus"]), (0.0, 0.0))
        bx, by = bus_xy.get(int(net.switch.at[si, "element"]), (0.0, 0.0))
        result["switch"][si] = ((ax + bx) / 2, (ay + by) / 2)
    return result
