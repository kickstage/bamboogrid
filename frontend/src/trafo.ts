import type { Edge } from "@xyflow/react";
import type { BusData, Trafo2WParams, Trafo3WParams } from "./types";

// Standard transformer types, the single source of truth for the inspector
// dropdowns and for voltage matching. Each name encodes its rated voltages; we
// keep them parsed here so a transformer can be matched to the buses it joins.
// Ordered largest-MVA-first within each voltage class, so the first match is a
// sensible default.

export interface Trafo2WType {
  name: string;
  sn_mva: number;
  vn_hv_kv: number;
  vn_lv_kv: number;
}

export interface Trafo3WType {
  name: string;
  vn_hv_kv: number;
  vn_mv_kv: number;
  vn_lv_kv: number;
}

export const TRAFO2W_CATALOG: Trafo2WType[] = [
  { name: "160 MVA 380/110 kV", sn_mva: 160, vn_hv_kv: 380, vn_lv_kv: 110 },
  { name: "100 MVA 220/110 kV", sn_mva: 100, vn_hv_kv: 220, vn_lv_kv: 110 },
  { name: "63 MVA 110/20 kV", sn_mva: 63, vn_hv_kv: 110, vn_lv_kv: 20 },
  { name: "40 MVA 110/20 kV", sn_mva: 40, vn_hv_kv: 110, vn_lv_kv: 20 },
  { name: "25 MVA 110/20 kV", sn_mva: 25, vn_hv_kv: 110, vn_lv_kv: 20 },
  { name: "63 MVA 110/10 kV", sn_mva: 63, vn_hv_kv: 110, vn_lv_kv: 10 },
  { name: "40 MVA 110/10 kV", sn_mva: 40, vn_hv_kv: 110, vn_lv_kv: 10 },
  { name: "25 MVA 110/10 kV", sn_mva: 25, vn_hv_kv: 110, vn_lv_kv: 10 },
  { name: "0.25 MVA 20/0.4 kV", sn_mva: 0.25, vn_hv_kv: 20, vn_lv_kv: 0.4 },
  { name: "0.4 MVA 20/0.4 kV", sn_mva: 0.4, vn_hv_kv: 20, vn_lv_kv: 0.4 },
  { name: "0.63 MVA 20/0.4 kV", sn_mva: 0.63, vn_hv_kv: 20, vn_lv_kv: 0.4 },
  { name: "0.25 MVA 10/0.4 kV", sn_mva: 0.25, vn_hv_kv: 10, vn_lv_kv: 0.4 },
  { name: "0.4 MVA 10/0.4 kV", sn_mva: 0.4, vn_hv_kv: 10, vn_lv_kv: 0.4 },
  { name: "0.63 MVA 10/0.4 kV", sn_mva: 0.63, vn_hv_kv: 10, vn_lv_kv: 0.4 },
];

export const TRAFO3W_CATALOG: Trafo3WType[] = [
  { name: "63/25/38 MVA 110/20/10 kV", vn_hv_kv: 110, vn_mv_kv: 20, vn_lv_kv: 10 },
  { name: "63/25/38 MVA 110/10/10 kV", vn_hv_kv: 110, vn_mv_kv: 10, vn_lv_kv: 10 },
];

// Compare two nominal voltages with a small relative tolerance (exact for the
// curated catalog values, forgiving of float noise).
export function kvEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1e-6, 1e-3 * Math.max(Math.abs(a), Math.abs(b)));
}

export function trafo2wNames(): string[] {
  return TRAFO2W_CATALOG.map((t) => t.name);
}

export function trafo3wNames(): string[] {
  return TRAFO3W_CATALOG.map((t) => t.name);
}

export function matchingTrafo2wTypes(hvKv: number, lvKv: number): string[] {
  return TRAFO2W_CATALOG.filter(
    (t) => kvEqual(t.vn_hv_kv, hvKv) && kvEqual(t.vn_lv_kv, lvKv),
  ).map((t) => t.name);
}

export function matchingTrafo3wTypes(
  hvKv: number,
  mvKv: number,
  lvKv: number,
): string[] {
  return TRAFO3W_CATALOG.filter(
    (t) =>
      kvEqual(t.vn_hv_kv, hvKv) &&
      kvEqual(t.vn_mv_kv, mvKv) &&
      kvEqual(t.vn_lv_kv, lvKv),
  ).map((t) => t.name);
}

// Explicit parameters for a transformer between two buses whose voltages don't
// match any standard type. Rated voltages follow the buses; the electrical
// values are generic placeholders the user can refine.
export function defaultTrafo2wParams(hvKv: number, lvKv: number): Trafo2WParams {
  return {
    sn_mva: 40,
    vn_hv_kv: hvKv,
    vn_lv_kv: lvKv,
    vk_percent: 12,
    vkr_percent: 0.5,
    pfe_kw: 0,
    i0_percent: 0,
    shift_degree: 0,
  };
}

// Explicit parameters for a 3W transformer whose winding voltages match no
// standard type. Rated voltages follow the buses; electricals are generic
// placeholders the user can refine.
export function defaultTrafo3wParams(
  hvKv: number,
  mvKv: number,
  lvKv: number,
): Trafo3WParams {
  return {
    sn_hv_mva: 40,
    sn_mv_mva: 40,
    sn_lv_mva: 40,
    vn_hv_kv: hvKv,
    vn_mv_kv: mvKv,
    vn_lv_kv: lvKv,
    vk_hv_percent: 12,
    vk_mv_percent: 12,
    vk_lv_percent: 12,
    vkr_hv_percent: 0.5,
    vkr_mv_percent: 0.5,
    vkr_lv_percent: 0.5,
    pfe_kw: 0,
    i0_percent: 0,
    shift_mv_degree: 0,
    shift_lv_degree: 0,
  };
}

// A transformer winding: the single source of truth for both the canvas port
// tags and the inspector readouts, so the displayed label always tracks the
// handle id it belongs to.
export type Winding = "hv" | "mv" | "lv";

export const WINDING_LABEL: Record<Winding, string> = {
  hv: "HV",
  mv: "MV",
  lv: "LV",
};

type NodeLike = { id: string; type?: string; data: unknown };

// Nominal voltages of the buses wired to a transformer node, by winding. Wires
// run transformer (source) -> bus (target), keyed by the winding handle id.
export function connectedTrafoVoltages(
  nodeId: string,
  nodes: NodeLike[],
  edges: Edge[],
): { hv?: number; mv?: number; lv?: number } {
  const out: { hv?: number; mv?: number; lv?: number } = {};
  for (const e of edges) {
    if (e.source !== nodeId) continue;
    const handle = e.sourceHandle;
    if (handle !== "hv" && handle !== "mv" && handle !== "lv") continue;
    const bus = nodes.find((n) => n.id === e.target && n.type === "bus");
    if (bus) out[handle] = (bus.data as BusData).vn_kv;
  }
  return out;
}

// Render the connected-bus voltages as "HV 110 kV / LV 20 kV" for the given
// windings, falling back to "?" for any side that isn't wired yet.
export function formatTrafoVoltages(
  volts: { hv?: number; mv?: number; lv?: number },
  windings: Winding[],
): string {
  return windings
    .map((w) => `${WINDING_LABEL[w]} ${volts[w] ?? "?"} kV`)
    .join(" / ");
}
