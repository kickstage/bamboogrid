// Mirrors backend/app/schema.py. Kept in sync by hand for iteration 1; later
// these can be generated from the backend OpenAPI schema.

export type ElementKind = "bus" | "generator" | "load";

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
  vm_pu: number;
};

export type LoadData = {
  name: string;
  p_mw: number;
  q_mvar: number;
};

export type ElementData = BusData | GeneratorData | LoadData;

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
  vm_pu: number;
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
  x: number;
  y: number;
  waypoint?: { x: number; y: number } | null;
}

export interface Network {
  id: string;
  name: string;
  buses: Bus[];
  generators: Generator[];
  loads: Load[];
}

export interface NetworkSummary {
  id: string;
  name: string;
}

export interface LoadFlowResult {
  converged: boolean;
  message: string;
  res_bus: { id: string; vm_pu: number; va_degree: number }[];
  res_load: { id: string; p_mw: number; q_mvar: number }[];
}
