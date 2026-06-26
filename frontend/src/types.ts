// Mirrors backend/app/schema.py, kept in sync by hand; later these can be
// generated from the backend OpenAPI schema.

export type ElementKind =
  | "bus"
  | "generator"
  | "sgen"
  | "extgrid"
  | "load"
  | "shunt"
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
  // Filled in after a short circuit (initial symmetrical fault current etc.).
  ikss_ka?: number;
  ip_ka?: number;
  ith_ka?: number;
  skss_mw?: number;
};

export type GeneratorData = {
  name: string;
  p_mw: number;
  vm_pu: number;
  slack: boolean;
  slack_weight: number;
  // Short-circuit (IEC 60909) machine data.
  sn_mva: number;
  xdss_pu: number;
  cos_phi: number;
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
  // Short-circuit (IEC 60909) source data.
  s_sc_max_mva: number;
  rx_max: number;
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
  res_q_mvar?: number;
};

export type Trafo3WData = {
  name: string;
  std_type: string;
  params?: Trafo3WParams | null;
  res_loading_percent?: number;
  res_p_mw?: number;
  res_q_mvar?: number;
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
  res_q_mvar?: number;
  res_i_ka?: number;
};

// A shunt (pandapower `shunt`): a fixed device on one bus. p_mw is always ≥ 0;
// q_mvar may be negative — by pandapower's convention negative q_mvar injects
// reactive power (a capacitor) and positive absorbs it (a reactor). vn_kv/step
// aren't user-edited (the minimal UI is p_mw/q_mvar) but are preserved so an
// imported shunt round-trips unchanged.
export type ShuntData = {
  name: string;
  p_mw: number;
  q_mvar: number;
  vn_kv: number | null;
  step: number;
  // Filled in after a load flow.
  res_p_mw?: number;
  res_q_mvar?: number;
};

// How bus voltage results are shown on the canvas: actual kilovolts
// (vm_pu × vn_kv) or per-unit magnitude.
export type VoltageUnit = "kv" | "pu";

// Read-only canvas node for an element the editor doesn't model (see
// ForeignNode / ForeignElement). Part of the node-data union so these render as
// regular React Flow nodes.
export type ForeignData = {
  table: string;
  label: string;
  bus_ids: string[];
};

export type ElementData =
  | BusData
  | GeneratorData
  | SgenData
  | ExtGridData
  | LoadData
  | ShuntData
  | SwitchData
  | Trafo2WData
  | Trafo3WData
  | ForeignData;

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
  sn_mva: number;
  xdss_pu: number;
  cos_phi: number;
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
  s_sc_max_mva: number;
  rx_max: number;
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
  waypoint?: { x: number; y: number } | null;
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

// A pandapower element the editor doesn't model yet, surfaced read-only on the
// canvas. The full element stays on the server net.
export interface ForeignElement {
  id: string;
  table: string;
  name: string;
  bus_ids: string[];
  x: number;
  y: number;
}

// The session projection a browser receives: the editable modeled network plus
// read-only foreign elements. The authoritative pandapower net stays server-side.
export interface ViewModel {
  network: Network;
  foreign: ForeignElement[];
  // Whether the session's in-memory edit history can undo/redo right now.
  can_undo: boolean;
  can_redo: boolean;
}

// A single edit applied to the session's net. `op` selects the server handler;
// `payload` carries op-specific fields (see backend commands.py).
export interface Command {
  op: string;
  payload: Record<string, unknown>;
}

// --- Network summary / diagnostics ----------------------------------------

export interface PowerBalance {
  gen_p_mw: number;
  gen_q_mvar: number;
  load_p_mw: number;
  load_q_mvar: number;
  loss_p_mw: number;
  loss_q_mvar: number;
}

// A worst-case quantity (lowest voltage, peak loading, ...) and the element it
// occurs on.
export interface Extreme {
  value: number;
  label: string;
}

export interface SummaryCounts {
  buses: number;
  lines: number;
  transformers: number;
  loads: number;
  generators: number;
  switches: number;
  shunts: number;
  foreign: number;
  islands: number;
  unsupplied_buses: number;
}

export type DiagnosticSeverity = "error" | "warning" | "info";

// An element a diagnostic refers to, resolved to its editor identity so it can
// be selected. `id` is the element's uuid (or "table:index" for a foreign one);
// `kind` is the editor kind ("line" for a line edge, "foreign" for unmodeled).
export interface DiagnosticElement {
  id: string;
  kind: string;
  label: string;
}

export interface Diagnostic {
  check: string;
  detail: string;
  severity: DiagnosticSeverity;
  elements: DiagnosticElement[];
}

export interface NetworkSummary {
  converged: boolean;
  message: string;
  counts: SummaryCounts;
  diagnostics: Diagnostic[];
  // Present only when the load flow converged.
  balance: PowerBalance | null;
  min_voltage: Extreme | null;
  max_voltage: Extreme | null;
  max_line_loading: Extreme | null;
  max_trafo_loading: Extreme | null;
}

export interface LoadFlowResult {
  converged: boolean;
  message: string;
  res_bus: { id: string; vm_pu: number | null; va_degree: number | null }[];
  res_gen: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_sgen: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_ext_grid: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_load: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_shunt: { id: string; p_mw: number | null; q_mvar: number | null }[];
  res_trafo: {
    id: string;
    loading_percent: number | null;
    p_mw: number | null;
    q_mvar: number | null;
  }[];
  res_trafo3w: {
    id: string;
    loading_percent: number | null;
    p_mw: number | null;
    q_mvar: number | null;
  }[];
  res_line: {
    id: string;
    loading_percent: number | null;
    p_mw: number | null;
    q_mvar: number | null;
    i_ka: number | null;
  }[];
}

export interface BusScResult {
  id: string;
  ikss_ka: number | null;
  skss_mw: number | null;
  ip_ka: number | null;
  ith_ka: number | null;
}

export interface ShortCircuitResult {
  ok: boolean;
  message: string;
  res_bus: BusScResult[];
}
