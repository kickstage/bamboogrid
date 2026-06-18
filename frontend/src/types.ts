// Mirrors backend/app/schema.py. Kept in sync by hand for iteration 1; later
// these can be generated from the backend OpenAPI schema.

export type ElementKind = "bus" | "generator" | "load" | "switch";

// Object-literal `type` (not `interface`) so these satisfy React Flow's
// `Record<string, unknown>` constraint on node data.
export type BusData = {
  name: string;
  vn_kv: number;
  // Filled in after a load flow.
  vm_pu?: number;
  va_degree?: number;
};

export type GeneratorData = {
  name: string;
  p_mw: number;
  vm_pu: number;
  slack: boolean;
  slack_weight: number;
  // Filled in after a load flow (reactive power is solved).
  res_p_mw?: number;
  res_q_mvar?: number;
};

export type LoadData = {
  name: string;
  p_mw: number;
  q_mvar: number;
};

export type SwitchData = {
  name: string;
  closed: boolean;
};

export type ElementData = BusData | GeneratorData | LoadData | SwitchData;

// --- Backend network document ---------------------------------------------

export interface Bus {
  id: string;
  name: string;
  vn_kv: number;
  x: number;
  y: number;
  width: number;
}

export interface Generator {
  id: string;
  name: string;
  bus_id: string;
  p_mw: number;
  vm_pu: number;
  slack: boolean;
  slack_weight: number;
  port?: string;
  x: number;
  y: number;
  waypoint?: { x: number; y: number } | null;
}

export interface Load {
  id: string;
  name: string;
  bus_id: string;
  p_mw: number;
  q_mvar: number;
  port?: string;
  x: number;
  y: number;
  waypoint?: { x: number; y: number } | null;
}

export interface Switch {
  id: string;
  name: string;
  bus_a: string;
  bus_b: string;
  closed: boolean;
  port_a?: string;
  port_b?: string;
  x: number;
  y: number;
}

export interface Network {
  id: string;
  name: string;
  buses: Bus[];
  generators: Generator[];
  loads: Load[];
  switches: Switch[];
}

export interface LoadFlowResult {
  converged: boolean;
  message: string;
  res_bus: { id: string; vm_pu: number | null; va_degree: number | null }[];
  res_gen: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_load: { id: string; p_mw: number | null; q_mvar: number | null }[];
}
