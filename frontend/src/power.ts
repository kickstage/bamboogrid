import type { Edge } from "@xyflow/react";
import type { ElementNode } from "./store";
import type {
  ExtGridData,
  GeneratorData,
  LoadData,
  SgenData,
  ShuntData,
} from "./types";

export interface BusInjection {
  p_mw: number;
  q_mvar: number;
}

// Net complex power injected into a bus by the elements wired directly to it —
// generation counts positive, load and shunt consumption negative — i.e. the
// power that flows out of the bus through its branches. Elements connect with
// the element as the wire's source and the bus as its target.
//
// Returns null when the bus has no attached injecting element (a pure transit
// bus, whose net injection is trivially zero and whose power factor is
// undefined). Generator/sgen/ext-grid/shunt contributions come from the solved
// result; loads have no result written back, so their input p/q (which equals
// the solved consumption in this model) is used.
export function busInjection(
  busId: string,
  nodes: ElementNode[],
  edges: Edge[],
): BusInjection | null {
  const attached = new Set(
    edges.filter((e) => e.target === busId).map((e) => e.source),
  );
  let p = 0;
  let q = 0;
  let seen = false;
  for (const n of nodes) {
    if (!attached.has(n.id)) continue;
    switch (n.type) {
      case "generator": {
        const d = n.data as GeneratorData;
        p += d.res_p_mw ?? 0;
        q += d.res_q_mvar ?? 0;
        seen = true;
        break;
      }
      case "sgen": {
        const d = n.data as SgenData;
        p += d.res_p_mw ?? 0;
        q += d.res_q_mvar ?? 0;
        seen = true;
        break;
      }
      case "extgrid": {
        const d = n.data as ExtGridData;
        p += d.res_p_mw ?? 0;
        q += d.res_q_mvar ?? 0;
        seen = true;
        break;
      }
      case "load": {
        const d = n.data as LoadData;
        p -= d.p_mw;
        q -= d.q_mvar;
        seen = true;
        break;
      }
      case "shunt": {
        const d = n.data as ShuntData;
        p -= d.res_p_mw ?? 0;
        q -= d.res_q_mvar ?? 0;
        seen = true;
        break;
      }
    }
  }
  return seen ? { p_mw: p, q_mvar: q } : null;
}

// Apparent power |S| = √(P² + Q²) [MVA].
export function apparentPower(p: number, q: number): number {
  return Math.hypot(p, q);
}

export type PfSense = "leading" | "lagging" | "unity";

export interface PowerFactor {
  // |cos φ|, in [0, 1].
  value: number;
  sense: PfSense;
}

// Power factor cos φ with its sense. Negative reactive power is leading
// (capacitive), positive is lagging (inductive).
export function powerFactor(p: number, q: number): PowerFactor {
  const s = Math.hypot(p, q);
  if (s === 0) return { value: 1, sense: "unity" };
  return {
    value: Math.abs(p) / s,
    sense: q > 0 ? "lagging" : q < 0 ? "leading" : "unity",
  };
}

// Power-factor angle φ = atan2(Q, P) [degrees] — the angle of the apparent-power
// vector, distinct from the bus voltage angle.
export function phaseAngleDeg(p: number, q: number): number {
  return (Math.atan2(q, p) * 180) / Math.PI;
}
