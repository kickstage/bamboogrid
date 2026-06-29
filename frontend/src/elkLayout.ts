import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";

import { BUS_DEFAULT_WIDTH, PORT_MARGIN, widthForPorts } from "./nodes/BusNode";
import type { Network } from "./types";

// Skeleton node footprints. Transformer/switch widths match the body widths the
// canvas uses to center each glyph's handle (see loadNetwork). Bus height is the
// thin bar.
const BUS_H = 26;
const SWITCH = { w: 64, h: 64 };
const TRAFO2W = { w: 40, h: 72 };
const TRAFO3W = { w: 48, h: 84 };
// Feeders (degree-1 elements) are placed by hand off their bus bar.
const FEEDER_W = 64;
const FEEDER_H = 84;
const FEEDER_WIRE = 44; // bar-to-glyph stub length

const elk = new ELK();

type Box = { x: number; y: number; w: number; h: number };

/** Lay a network out with ELK's layered (Sugiyama) algorithm.
 *
 * Only the connective skeleton — buses, transformers and switches — goes through
 * ELK, with buses sized to their real bar width. Single-terminal feeders
 * (generators, sgens, ext grids, loads, shunts) are excluded and instead
 * attached locally to their own bus afterwards, on whichever side faces away
 * from that bus's structural neighbours. This keeps a feeder hugging its bus
 * with a short straight drop rather than floating into an adjacent bus's layer. */
export async function elkLayout(network: Network): Promise<Network> {
  const count = new Map<string, number>();
  const bump = (id?: string | null) => {
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  };
  for (const g of network.generators) bump(g.bus_id);
  for (const s of network.sgens) bump(s.bus_id);
  for (const e of network.ext_grids) bump(e.bus_id);
  for (const l of network.loads) bump(l.bus_id);
  for (const sh of network.shunts) bump(sh.bus_id);
  for (const s of network.switches) {
    bump(s.bus_a);
    bump(s.bus_b);
  }
  for (const t of network.transformers2w) {
    bump(t.hv_bus);
    bump(t.lv_bus);
  }
  for (const t of network.transformers3w) {
    bump(t.hv_bus);
    bump(t.mv_bus);
    bump(t.lv_bus);
  }
  for (const ln of network.lines) {
    bump(ln.from_bus);
    bump(ln.to_bus);
  }

  const children: ElkNode[] = [];
  const busW = new Map<string, number>();
  for (const b of network.buses) {
    const w = widthForPorts(count.get(b.id) ?? 0);
    busW.set(b.id, w);
    children.push({ id: b.id, width: w, height: BUS_H });
  }
  for (const s of network.switches)
    children.push({ id: s.id, width: SWITCH.w, height: SWITCH.h });
  for (const t of network.transformers2w)
    children.push({ id: t.id, width: TRAFO2W.w, height: TRAFO2W.h });
  for (const t of network.transformers3w)
    children.push({ id: t.id, width: TRAFO3W.w, height: TRAFO3W.h });

  const edges: { id: string; sources: string[]; targets: string[] }[] = [];
  const link = (src?: string | null, tgt?: string | null) => {
    if (src && tgt)
      edges.push({ id: `e${edges.length}`, sources: [src], targets: [tgt] });
  };
  // Direction encodes the conventional vertical order: a transformer drops from
  // its HV bus to its MV/LV buses; a switch sits between its two buses.
  for (const s of network.switches) {
    link(s.bus_a, s.id);
    link(s.id, s.bus_b);
  }
  for (const t of network.transformers2w) {
    link(t.hv_bus, t.id);
    link(t.id, t.lv_bus);
  }
  for (const t of network.transformers3w) {
    link(t.hv_bus, t.id);
    link(t.id, t.mv_bus);
    link(t.id, t.lv_bus);
  }
  for (const ln of network.lines) link(ln.from_bus, ln.to_bus);

  const laid = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      // Layers spaced wide enough that a feeder hung off a bar never reaches the
      // next layer; generous in-layer spacing keeps glyphs/labels uncramped.
      "elk.layered.spacing.nodeNodeBetweenLayers": "200",
      "elk.spacing.nodeNode": "100",
      "elk.spacing.edgeNode": "40",
      "elk.spacing.edgeEdge": "25",
      "elk.spacing.componentComponent": "160",
      "elk.padding": "[top=60,left=60,bottom=60,right=60]",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children,
    edges,
  });

  const box = new Map<string, Box>();
  for (const c of laid.children ?? [])
    box.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });

  // Each bus feeds onto the side facing away from its structural neighbours.
  const neighbourYs = new Map<string, number[]>();
  const addNeighbour = (busId?: string | null, otherId?: string | null) => {
    if (!busId || !otherId) return;
    const o = box.get(otherId);
    if (!o) return;
    const ys = neighbourYs.get(busId);
    const cy = o.y + o.h / 2;
    if (ys) ys.push(cy);
    else neighbourYs.set(busId, [cy]);
  };
  for (const ln of network.lines) {
    addNeighbour(ln.from_bus, ln.to_bus);
    addNeighbour(ln.to_bus, ln.from_bus);
  }
  for (const s of network.switches) {
    addNeighbour(s.bus_a, s.id);
    addNeighbour(s.bus_b, s.id);
  }
  for (const t of network.transformers2w) {
    addNeighbour(t.hv_bus, t.id);
    addNeighbour(t.lv_bus, t.id);
  }
  for (const t of network.transformers3w) {
    addNeighbour(t.hv_bus, t.id);
    addNeighbour(t.mv_bus, t.id);
    addNeighbour(t.lv_bus, t.id);
  }
  const feedsDown = (busId: string): boolean => {
    const b = box.get(busId);
    if (!b) return true;
    const ys = neighbourYs.get(busId);
    if (!ys || !ys.length) return true;
    const mean = ys.reduce((a, c) => a + c, 0) / ys.length;
    return mean < b.y + b.h / 2; // neighbours above ⇒ feed below
  };

  const feedersByBus = new Map<string, string[]>();
  const addFeeder = (busId?: string | null, id?: string) => {
    if (!busId || !id) return;
    const a = feedersByBus.get(busId);
    if (a) a.push(id);
    else feedersByBus.set(busId, [id]);
  };
  for (const g of network.generators) addFeeder(g.bus_id, g.id);
  for (const s of network.sgens) addFeeder(s.bus_id, s.id);
  for (const e of network.ext_grids) addFeeder(e.bus_id, e.id);
  for (const l of network.loads) addFeeder(l.bus_id, l.id);
  for (const sh of network.shunts) addFeeder(sh.bus_id, sh.id);

  const feederPos = new Map<string, { x: number; y: number }>();
  for (const [busId, ids] of feedersByBus) {
    const b = box.get(busId);
    if (!b) continue;
    const down = feedsDown(busId);
    const y = down ? b.y + b.h + FEEDER_WIRE : b.y - FEEDER_WIRE - FEEDER_H;
    const span = b.w - 2 * PORT_MARGIN;
    ids.forEach((id, i) => {
      const frac = ids.length === 1 ? 0.5 : i / (ids.length - 1);
      const cx = b.x + PORT_MARGIN + frac * span;
      feederPos.set(id, { x: cx - FEEDER_W / 2, y });
    });
  }

  const at = (id: string, x: number, y: number) => box.get(id) ?? { x, y };
  const feeder = (id: string, x: number, y: number) =>
    feederPos.get(id) ?? { x, y };

  return {
    ...network,
    needs_layout: false,
    buses: network.buses.map((b) => {
      const p = at(b.id, b.x, b.y);
      return { ...b, x: p.x, y: p.y, width: busW.get(b.id) ?? b.width ?? BUS_DEFAULT_WIDTH };
    }),
    generators: network.generators.map((g) => ({ ...g, ...feeder(g.id, g.x, g.y) })),
    sgens: network.sgens.map((s) => ({ ...s, ...feeder(s.id, s.x, s.y) })),
    ext_grids: network.ext_grids.map((e) => ({ ...e, ...feeder(e.id, e.x, e.y) })),
    loads: network.loads.map((l) => ({ ...l, ...feeder(l.id, l.x, l.y) })),
    shunts: network.shunts.map((sh) => ({ ...sh, ...feeder(sh.id, sh.x, sh.y) })),
    switches: network.switches.map((s) => {
      const p = at(s.id, s.x, s.y);
      return { ...s, x: p.x, y: p.y };
    }),
    transformers2w: network.transformers2w.map((t) => {
      const p = at(t.id, t.x, t.y);
      return { ...t, x: p.x, y: p.y };
    }),
    transformers3w: network.transformers3w.map((t) => {
      const p = at(t.id, t.x, t.y);
      return { ...t, x: p.x, y: p.y };
    }),
  };
}
