// Mirrors backend/app/schema.py, kept in sync by hand; later these can be
// generated from the backend OpenAPI schema.

export type ElementKind =
  | "bus"
  | "generator"
  | "sgen"
  | "extgrid"
  | "load"
  | "switch"
  | "trafo2w"
  | "trafo3w";

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

export type SgenData = {
  name: string;
  p_mw: number;
  q_mvar: number;
  // Filled in after a load flow.
  res_p_mw?: number;
  res_q_mvar?: number;
};

export type ExtGridData = {
  name: string;
  vm_pu: number;
  va_degree: number;
  // Filled in after a load flow (the slack's balancing P/Q is solved).
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

// Explicit pandapower transformer parameters, present on imports whose
// transformer has no recognized std_type (e.g. case14). The editor treats them
// as opaque pass-through data: when set they drive the solve and take precedence
// over std_type; picking a std_type in the inspector clears them.
export type Trafo2WParams = {
  sn_mva: number;
  vn_hv_kv: number;
  vn_lv_kv: number;
  vk_percent: number;
  vkr_percent: number;
  pfe_kw: number;
  i0_percent: number;
  shift_degree: number;
};

export type Trafo3WParams = {
  sn_hv_mva: number;
  sn_mv_mva: number;
  sn_lv_mva: number;
  vn_hv_kv: number;
  vn_mv_kv: number;
  vn_lv_kv: number;
  vk_hv_percent: number;
  vk_mv_percent: number;
  vk_lv_percent: number;
  vkr_hv_percent: number;
  vkr_mv_percent: number;
  vkr_lv_percent: number;
  pfe_kw: number;
  i0_percent: number;
  shift_mv_degree: number;
  shift_lv_degree: number;
};

export type Trafo2WData = {
  name: string;
  std_type: string;
  params?: Trafo2WParams | null;
  // Filled in after a load flow.
  res_loading_percent?: number;
  res_p_mw?: number;
};

export type Trafo3WData = {
  name: string;
  std_type: string;
  params?: Trafo3WParams | null;
  res_loading_percent?: number;
  res_p_mw?: number;
};

// Line data lives on a React Flow *edge* (drawn bus → bus), not a node.
export type LineData = {
  name: string;
  length_km: number;
  r_ohm_per_km: number;
  x_ohm_per_km: number;
  c_nf_per_km: number;
  max_i_ka: number;
  std_type: string;
  // A draggable routing point, like the plain wire edges.
  waypoint?: { x: number; y: number };
  // Filled in after a load flow.
  res_loading_percent?: number;
  res_p_mw?: number;
};

export type ElementData =
  | BusData
  | GeneratorData
  | SgenData
  | ExtGridData
  | LoadData
  | SwitchData
  | Trafo2WData
  | Trafo3WData;

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

export interface Sgen {
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

export interface ExtGrid {
  id: string;
  name: string;
  bus_id: string;
  vm_pu: number;
  va_degree: number;
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

export interface Transformer2W {
  id: string;
  name: string;
  hv_bus: string;
  lv_bus: string;
  std_type: string;
  params?: Trafo2WParams | null;
  port_hv?: string;
  port_lv?: string;
  x: number;
  y: number;
}

export interface Transformer3W {
  id: string;
  name: string;
  hv_bus: string;
  mv_bus: string;
  lv_bus: string;
  std_type: string;
  params?: Trafo3WParams | null;
  port_hv?: string;
  port_mv?: string;
  port_lv?: string;
  x: number;
  y: number;
}

export interface Line {
  id: string;
  name: string;
  from_bus: string;
  to_bus: string;
  length_km: number;
  r_ohm_per_km: number;
  x_ohm_per_km: number;
  c_nf_per_km: number;
  max_i_ka: number;
  std_type: string;
  port_from?: string;
  port_to?: string;
  x: number;
  y: number;
}

// A shunt (capacitor/reactor on one bus). Imported and solved for fidelity but
// not drawn on the canvas yet — the editor carries it through unchanged.
export interface Shunt {
  id: string;
  name: string;
  bus_id: string;
  p_mw: number;
  q_mvar: number;
  vn_kv: number | null;
  step: number;
  x: number;
  y: number;
  port?: string;
}

export interface Network {
  id: string;
  name: string;
  f_hz: number;
  sn_mva: number;
  buses: Bus[];
  generators: Generator[];
  sgens: Sgen[];
  ext_grids: ExtGrid[];
  loads: Load[];
  switches: Switch[];
  transformers2w: Transformer2W[];
  transformers3w: Transformer3W[];
  lines: Line[];
  shunts: Shunt[];
}

export interface LoadFlowResult {
  converged: boolean;
  message: string;
  res_bus: { id: string; vm_pu: number | null; va_degree: number | null }[];
  res_gen: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_sgen: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_ext_grid: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_load: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_trafo: { id: string; loading_percent: number | null; p_mw: number | null }[];
  res_trafo3w: { id: string; loading_percent: number | null; p_mw: number | null }[];
  res_line: { id: string; loading_percent: number | null; p_mw: number | null }[];
}
