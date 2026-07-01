"""Generate canvas coordinates for an imported pandapower net that carries no
editor layout (a foreign file). We build the bus graph from the net's
connectivity and run a networkx layout (no extra native deps), then place
sources above each bus and loads below.

Returns pixel coordinates keyed by pandapower table index, per table.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

import networkx as nx

Coord = tuple[float, float]

# Mirror the bus node's port geometry (BusNode.tsx) so layout reserves each bar's
# real on-canvas width — a bar grows with the number of ports (attachments) it hosts.
PORT_MARGIN = 16.0
PORT_SPACING = 40.0
BUS_DEFAULT_WIDTH = 220.0


@dataclass(frozen=True)
class Transform:
    """Affine map from a source (geo) space to canvas pixels:
    ``canvas = world * s + o`` (with ``sy < 0`` to flip a y-up geo space to the
    canvas' y-down)."""

    sx: float
    sy: float
    ox: float
    oy: float

    def world_to_canvas(self, wx: float, wy: float) -> Coord:
        return (wx * self.sx + self.ox, wy * self.sy + self.oy)


@dataclass
class GeoSeed:
    """A layout seeded from a net's native ``geo`` columns: canvas positions per
    table, plus any line routing waypoints (canvas) recovered from line
    geometries. Used only to seed our diagram tables; geo itself is never written."""

    positions: dict[str, dict[int, Coord]]
    line_waypoints: dict[int, Coord]


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
    # The canvas grows with sqrt(n), not n: a graph layout spreads buses across
    # ~sqrt(n) per axis, so scaling the whole bounding box linearly would make
    # node-to-node spacing balloon on big nets (e.g. IEEE14). Sqrt scaling keeps
    # spacing roughly constant — small nets are unchanged, large ones pull in.
    spread = math.sqrt(max(1, n - 1))
    width = max(500.0, 420.0 * spread)
    height = max(360.0, 300.0 * spread)
    margin = 80.0
    return {
        b: (
            round((x - min_x) / span_x * width) + margin,
            round((y - min_y) / span_y * height) + margin,
        )
        for b, (x, y) in pos.items()
    }


def _bus_widths(net) -> dict[int, float]:
    """On-canvas width of each bus bar, derived from how many elements wire to it
    (matches the frontend's widthForPorts)."""
    count: dict[int, int] = {int(b): 0 for b in net.bus.index}

    def bump(b: int) -> None:
        if b in count:
            count[b] += 1

    for table in ("gen", "sgen", "ext_grid", "load", "shunt", "xward"):
        for i in net[table].index:
            bump(int(net[table].at[i, "bus"]))
    for si in net.switch.index:
        if net.switch.at[si, "et"] == "b":
            bump(int(net.switch.at[si, "bus"]))
            bump(int(net.switch.at[si, "element"]))
    for li in net.line.index:
        bump(int(net.line.at[li, "from_bus"]))
        bump(int(net.line.at[li, "to_bus"]))
    for zi in net.impedance.index:
        bump(int(net.impedance.at[zi, "from_bus"]))
        bump(int(net.impedance.at[zi, "to_bus"]))
    for ti in net.trafo.index:
        bump(int(net.trafo.at[ti, "hv_bus"]))
        bump(int(net.trafo.at[ti, "lv_bus"]))
    for ti in net.trafo3w.index:
        bump(int(net.trafo3w.at[ti, "hv_bus"]))
        bump(int(net.trafo3w.at[ti, "mv_bus"]))
        bump(int(net.trafo3w.at[ti, "lv_bus"]))
    return {
        b: max(BUS_DEFAULT_WIDTH, 2 * PORT_MARGIN + max(0, c - 1) * PORT_SPACING)
        for b, c in count.items()
    }


def _separate_rows(bus_xy: dict[int, Coord], widths: dict[int, float]) -> dict[int, Coord]:
    """Push apart buses sharing a row so their (variable-width) bars don't overlap.
    Only horizontal positions change: the leftmost bar on a row holds its place and
    the rest slide right just enough to clear the previous bar plus a gap. A bus
    position is the bar's left edge, so a bar spans ``[x, x + width]``."""
    GAP = 60.0
    ROW_BAND = 60.0
    rows: dict[int, list[int]] = {}
    for b, (_, y) in bus_xy.items():
        rows.setdefault(round(y / ROW_BAND), []).append(b)
    out = dict(bus_xy)
    for buses in rows.values():
        buses.sort(key=lambda b: bus_xy[b][0])
        cursor = float("-inf")
        for b in buses:
            x, y = bus_xy[b]
            x = max(x, cursor + GAP)
            out[b] = (x, y)
            cursor = x + widths.get(b, BUS_DEFAULT_WIDTH)
    return out


def _place_components(net, bus_xy: dict[int, Coord]) -> dict[str, dict[int, Coord]]:
    """Given bus pixel coordinates, derive positions for everything attached to
    them: sources above each bus, loads below, branches at their bus centroid."""
    # Stack multiple sources/loads on the same bus side by side. STEP must clear
    # a node's width (~64 px) so stacked elements don't overlap; GAP keeps them
    # clear of the bus bar and its labels.
    GAP, STEP = 150.0, 120.0
    widths = _bus_widths(net)
    above: dict[int, int] = {}
    below: dict[int, int] = {}

    def place(bus: int, side: str) -> Coord:
        bx, by = bus_xy.get(bus, (0.0, 0.0))
        counts = above if side == "above" else below
        i = counts.get(bus, 0)
        counts[bus] = i + 1
        return (bx + i * STEP, by - GAP if side == "above" else by + GAP)

    result: dict[str, dict[int, Coord]] = {
        "bus": bus_xy,
        "gen": {},
        "sgen": {},
        "ext_grid": {},
        "load": {},
        "shunt": {},
        "xward": {},
        "switch": {},
        "impedance": {},
        "trafo": {},
        "trafo3w": {},
        "line": {},
    }

    # Centroid of the buses' bar *centers* (not their left edges): two wide bars
    # sitting side by side on a row leave their left-edge midpoint on top of the
    # left bar, so a branch placed there would overlap it.
    def centroid(*buses: int) -> Coord:
        pts = [
            (
                bus_xy.get(b, (0.0, 0.0))[0] + widths.get(b, BUS_DEFAULT_WIDTH) / 2,
                bus_xy.get(b, (0.0, 0.0))[1],
            )
            for b in buses
        ]
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))

    for gi in net.gen.index:
        result["gen"][gi] = place(int(net.gen.at[gi, "bus"]), "above")
    for si in net.sgen.index:
        result["sgen"][si] = place(int(net.sgen.at[si, "bus"]), "above")
    for ei in net.ext_grid.index:
        result["ext_grid"][ei] = place(int(net.ext_grid.at[ei, "bus"]), "above")
    for li in net.load.index:
        result["load"][li] = place(int(net.load.at[li, "bus"]), "below")
    # A shunt hangs below its bus like a load (its connection handle points up).
    for hi in net.shunt.index:
        result["shunt"][hi] = place(int(net.shunt.at[hi, "bus"]), "below")
    # An xward (network equivalent) also hangs below its bus, like a load/shunt.
    for wi in net.xward.index:
        result["xward"][wi] = place(int(net.xward.at[wi, "bus"]), "below")

    # A transformer/switch sits at its bus-pair midpoint, which can land on a
    # source/load already placed above/below a bus. Track those slots and shuffle
    # a colliding body sideways to the nearest free column instead of overlapping.
    CELL = 90.0
    occupied: set[tuple[int, int]] = {
        (round(x / CELL), round(y / CELL))
        for table in ("gen", "sgen", "ext_grid", "load", "shunt", "xward")
        for x, y in result[table].values()
    }

    def free_spot(x: float, y: float) -> Coord:
        if (round(x / CELL), round(y / CELL)) not in occupied:
            return (x, y)
        for k in range(1, 9):
            for dx in (k * STEP, -k * STEP):
                if (round((x + dx) / CELL), round(y / CELL)) not in occupied:
                    return (x + dx, y)
        return (x, y)

    # Branch body widths (mirror the node glyphs) so a body is centered on the
    # centroid rather than hung from its left edge.
    BODY_W = {"trafo": 40.0, "trafo3w": 48.0, "switch": 64.0, "impedance": 64.0}

    def place_body(table: str, idx: int, *buses: int, dy: float = 0.0) -> None:
        cx, cy = centroid(*buses)
        pos = free_spot(cx - BODY_W.get(table, 0.0) / 2, cy + dy)
        occupied.add((round(pos[0] / CELL), round(pos[1] / CELL)))
        result[table][idx] = pos

    for si in net.switch.index:
        if net.switch.at[si, "et"] != "b":
            continue
        a = int(net.switch.at[si, "bus"])
        b = int(net.switch.at[si, "element"])
        # When both buses share a row the midpoint lands on the bus bar; drop the
        # switch below it (like a load) so it reads as a coupler, not part of the bar.
        ay = bus_xy.get(a, (0.0, 0.0))[1]
        by = bus_xy.get(b, (0.0, 0.0))[1]
        dy = GAP if abs(ay - by) < GAP else 0.0
        place_body("switch", si, a, b, dy=dy)
    # An impedance is a series two-terminal branch; drop it below the bus row like
    # a switch when its buses share a row so it reads as a coupler.
    for zi in net.impedance.index:
        a = int(net.impedance.at[zi, "from_bus"])
        b = int(net.impedance.at[zi, "to_bus"])
        ay = bus_xy.get(a, (0.0, 0.0))[1]
        by = bus_xy.get(b, (0.0, 0.0))[1]
        dy = GAP if abs(ay - by) < GAP else 0.0
        place_body("impedance", zi, a, b, dy=dy)
    for ti in net.trafo.index:
        place_body("trafo", ti, int(net.trafo.at[ti, "hv_bus"]), int(net.trafo.at[ti, "lv_bus"]))
    for ti in net.trafo3w.index:
        place_body(
            "trafo3w",
            ti,
            int(net.trafo3w.at[ti, "hv_bus"]),
            int(net.trafo3w.at[ti, "mv_bus"]),
            int(net.trafo3w.at[ti, "lv_bus"]),
        )
    # A line is drawn as an edge (no body); a midpoint is kept only for uniform
    # round-tripping of the layout tables.
    for li in net.line.index:
        result["line"][li] = centroid(
            int(net.line.at[li, "from_bus"]), int(net.line.at[li, "to_bus"])
        )
    return result


def _empty_positions() -> dict[str, dict[int, Coord]]:
    return {
        k: {}
        for k in (
            "bus", "gen", "sgen", "ext_grid", "load", "shunt", "switch", "trafo", "trafo3w", "line"
        )
    }


def auto_layout(net) -> dict[str, dict[int, Coord]]:
    bus_ids = list(net.bus.index)
    if not bus_ids:
        return _empty_positions()
    bus_xy = _to_pixels(_normalized_positions(net, bus_ids), len(bus_ids))
    bus_xy = _separate_rows(bus_xy, _bus_widths(net))
    return _place_components(net, bus_xy)


def _parse_point(value) -> Coord | None:
    """A pandapower ``geo`` cell (GeoJSON Point string) as ``(x, y)``, or None."""
    if not isinstance(value, str) or not value:
        return None
    try:
        coords = json.loads(value).get("coordinates")
        return (float(coords[0]), float(coords[1]))
    except (ValueError, TypeError, KeyError, IndexError):
        return None


def _parse_linestring(value) -> list[Coord] | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        data = json.loads(value)
        if data.get("type") != "LineString":
            return None
        return [(float(x), float(y)) for x, y in data["coordinates"]]
    except (ValueError, TypeError, KeyError):
        return None


def _geo_transform(world: dict[int, Coord], n: int) -> Transform:
    """A uniform-scale, y-flipped map from a geo bounding box to a pixel box.
    Uniform (not per-axis like ``_to_pixels``) so a geographic layout keeps its
    aspect ratio instead of being stretched to fill the canvas."""
    xs = [p[0] for p in world.values()]
    ys = [p[1] for p in world.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = (max_x - min_x) or 1.0
    span_y = (max_y - min_y) or 1.0
    spread = math.sqrt(max(1, n - 1))
    width = max(500.0, 420.0 * spread)
    height = max(360.0, 300.0 * spread)
    margin = 80.0
    scale = min(width / span_x, height / span_y)
    # Flip y (geo is y-up, canvas y-down) and anchor the box at the margin.
    return Transform(
        sx=scale,
        sy=-scale,
        ox=margin - min_x * scale,
        oy=margin + max_y * scale,
    )


def geo_layout(net) -> GeoSeed | None:
    """Seed a layout from the net's native ``geo`` columns instead of the graph
    layout. Returns None unless every bus carries a usable Point (a partial geo
    is treated as no geo, falling back to ``auto_layout``)."""
    bus_ids = list(net.bus.index)
    if not bus_ids or "geo" not in net.bus.columns:
        return None
    world: dict[int, Coord] = {}
    for i in bus_ids:
        pt = _parse_point(net.bus.at[i, "geo"])
        if pt is None:
            return None
        world[i] = pt

    transform = _geo_transform(world, len(bus_ids))
    bus_xy = {i: transform.world_to_canvas(*world[i]) for i in bus_ids}
    positions = _place_components(net, bus_xy)

    # Recover line routing: an interior LineString vertex becomes the edge's
    # single waypoint (the editor models one bend per line).
    line_waypoints: dict[int, Coord] = {}
    if "geo" in net.line.columns:
        for li in net.line.index:
            pts = _parse_linestring(net.line.at[li, "geo"])
            if pts and len(pts) > 2:
                mid = pts[len(pts) // 2]
                line_waypoints[li] = transform.world_to_canvas(*mid)

    return GeoSeed(positions=positions, line_waypoints=line_waypoints)
