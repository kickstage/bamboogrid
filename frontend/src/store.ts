import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";

import {
  BUS_DEFAULT_WIDTH,
  PORT_MARGIN,
  PORT_SPACING,
  widthForPorts,
} from "./nodes/BusNode";
import type {
  BusData,
  ElementData,
  ElementKind,
  ExtGridData,
  ForeignData,
  ForeignElement,
  GeneratorData,
  ImpedanceData,
  LineData,
  LoadData,
  LoadFlowResult,
  Network,
  SgenData,
  ShortCircuitResult,
  ShuntData,
  SvcData,
  SwitchData,
  Trafo2WData,
  Trafo2WParams,
  Trafo3WData,
  Trafo3WParams,
  ViewModel,
  VoltageUnit,
  XwardData,
} from "./types";

// Which study the canvas visualizes: load-flow voltage or short-circuit current.
export type StudyMode = "loadflow" | "shortcircuit";

const VOLTAGE_UNIT_KEY = "bamboogrid:voltageUnit";

function initialVoltageUnit(): VoltageUnit {
  try {
    return localStorage.getItem(VOLTAGE_UNIT_KEY) === "pu" ? "pu" : "kv";
  } catch {
    return "kv";
  }
}
import { getView, redo as redoApi, undo as undoApi } from "./api";
import { elkLayout } from "./elkLayout";
import { toast } from "./toast";
import {
  connectedTrafoVoltages,
  defaultTrafo2wParams,
  defaultTrafo3wParams,
  matchingTrafo2wTypes,
  matchingTrafo3wTypes,
} from "./trafo";
import {
  configureSync,
  enqueue,
  flushPending,
  resetServerIds,
  serverIds,
} from "./sync";

// Editor element kinds that attach to a single bus and so can be created on the
// server the moment they're first wired.
const COMPONENT_KINDS = new Set<ElementKind>([
  "generator",
  "sgen",
  "extgrid",
  "load",
  "shunt",
  "xward",
  "svc",
]);

// Source-handle id of an element's wire -> attachment "end" understood by the
// server connect command. Components have a single (null) handle.
function handleToEnd(handle: string | null | undefined): string {
  return handle ?? "";
}

export const DEFAULT_TRAFO_STD = "0.25 MVA 20/0.4 kV";
export const DEFAULT_TRAFO3W_STD = "63/25/38 MVA 110/20/10 kV";

// Placeholder name a scenario carries until the user names it (mirrors the
// backend's DEFAULT_SCENARIO_NAME).
export const DEFAULT_SCENARIO_NAME = "Untitled scenario";

// A freshly drawn line: a 1 km 110 kV overhead line (our default level). Users
// tune it in the inspector; the explicit params (not a std_type) are what the
// solver uses.
export const DEFAULT_LINE = (): LineData => ({
  name: "Line",
  length_km: 1.0,
  r_ohm_per_km: 0.1,
  x_ohm_per_km: 0.4,
  c_nf_per_km: 10.0,
  max_i_ka: 0.6,
  std_type: "",
});

export type ElementNode = Node<ElementData>;

// A detached snapshot of a node used for copy/paste and duplicate: its kind and
// attributes, never its wires. `dx`/`dy` are the node's offset from the copied
// group's anchor, so pasting a multi-element selection preserves its layout.
export interface ClonePayload {
  type: ElementKind;
  data: ElementData;
  width?: number;
  dx: number;
  dy: number;
}

const newId = () => crypto.randomUUID();

// Load-flow result fields written back onto node data. A clone starts unsolved,
// so these are dropped — they aren't user attributes and would be stale on a
// detached copy. (vm_pu is a result on a bus but an input setpoint elsewhere, so
// it's only stripped for buses.)
function withoutResults(type: ElementKind, data: ElementData): ElementData {
  const d = structuredClone(data) as Record<string, unknown>;
  if (type === "bus") {
    delete d.vm_pu;
    delete d.va_degree;
    delete d.ikss_ka;
    delete d.ip_ka;
    delete d.ith_ka;
    delete d.skss_mw;
  } else {
    delete d.res_p_mw;
    delete d.res_q_mvar;
    delete d.res_loading_percent;
  }
  return d as ElementData;
}

function makeCloneNode(
  payload: ClonePayload,
  position: XYPosition,
): ElementNode {
  return {
    id: newId(),
    type: payload.type,
    position,
    data: withoutResults(payload.type, payload.data),
    ...(payload.width !== undefined ? { width: payload.width } : {}),
  };
}

// The selected nodes that can be cloned: foreign (read-only) elements are
// skipped since they aren't modeled and can't be recreated.
function clonableSelection(nodes: ElementNode[]): ElementNode[] {
  return nodes.filter((n) => n.selected && n.type && n.type !== "foreign");
}

function defaultData(kind: ElementKind): ElementData {
  switch (kind) {
    case "bus":
      return { name: "Bus", vn_kv: 110.0 } satisfies BusData;
    case "generator":
      return {
        name: "Generator",
        p_mw: 1.0,
        vm_pu: 1.0,
        slack: false,
        slack_weight: 1.0,
        sn_mva: 1.0,
        xdss_pu: 0.2,
        cos_phi: 0.8,
      } satisfies GeneratorData;
    case "sgen":
      return { name: "Static gen", p_mw: 1.0, q_mvar: 0.0 } satisfies SgenData;
    case "extgrid":
      return {
        name: "External grid",
        vm_pu: 1.0,
        va_degree: 0.0,
        s_sc_max_mva: 1000.0,
        rx_max: 0.1,
      } satisfies ExtGridData;
    case "load":
      return { name: "Load", p_mw: 1.0, q_mvar: 0.0 } satisfies LoadData;
    case "shunt":
      // A new shunt defaults to a 1 Mvar capacitor (negative q_mvar injects
      // reactive power). vn_kv null = use the bus voltage; step 1 = one stage.
      return {
        name: "Shunt",
        p_mw: 0.0,
        q_mvar: -1.0,
        vn_kv: null,
        step: 1,
      } satisfies ShuntData;
    case "xward":
      // A network equivalent: by default a pure voltage source (1 p.u.) behind a
      // small reactance, with no constant-power or constant-Z part. Users tune the
      // injection and impedance in the inspector.
      return {
        name: "xWard",
        ps_mw: 0.0,
        qs_mvar: 0.0,
        pz_mw: 0.0,
        qz_mvar: 0.0,
        r_ohm: 0.0,
        x_ohm: 1.0,
        vm_pu: 1.0,
      } satisfies XwardData;
    case "svc":
      // A shunt voltage regulator: by default controllable, holding 1 p.u. via a
      // thyristor-controlled reactor in parallel with a fixed capacitor. Users
      // tune the setpoint, reactances and firing-angle limits in the inspector.
      return {
        name: "SVC",
        set_vm_pu: 1.0,
        x_l_ohm: 1.0,
        x_cvar_ohm: -10.0,
        thyristor_firing_angle_degree: 145.0,
        min_angle_degree: 90.0,
        max_angle_degree: 180.0,
        controllable: true,
      } satisfies SvcData;
    case "impedance":
      // A per-unit series branch: default to a small reactance on a 100 MVA base
      // (symmetric from→to / to→from). Users tune R/X and the rating in the
      // inspector.
      return {
        name: "Impedance",
        rft_pu: 0.0,
        xft_pu: 0.1,
        rtf_pu: 0.0,
        xtf_pu: 0.1,
        sn_mva: 100.0,
      } satisfies ImpedanceData;
    case "switch":
      return { name: "Switch", closed: true } satisfies SwitchData;
    case "trafo2w":
      return {
        name: "Transformer",
        std_type: DEFAULT_TRAFO_STD,
      } satisfies Trafo2WData;
    case "trafo3w":
      return {
        name: "3W Transformer",
        std_type: DEFAULT_TRAFO3W_STD,
      } satisfies Trafo3WData;
  }
}

interface EditorState {
  networkName: string;
  // System frequency / per-unit base, preserved from imports and passed back.
  f_hz: number;
  sn_mva: number;
  nodes: ElementNode[];
  edges: Edge[];
  selectedId: string | null;
  // A selected line edge (mutually exclusive with selectedId), for the inspector.
  selectedEdgeId: string | null;
  showResults: boolean;
  // Which study the canvas visualizes (load-flow voltage vs short-circuit current).
  studyMode: StudyMode;
  // Network-wide max initial fault current, for scaling the SC heatmap.
  scMaxIkss: number;
  // Whether bus voltage results show as kV or per-unit. A view-only preference,
  // persisted to localStorage (not part of the server net).
  voltageUnit: VoltageUnit;
  // Bumped whenever a network is loaded, so the canvas can re-fit the view.
  fitSignal: number;
  // A request to pan/zoom the canvas onto specific nodes. `nonce` bumps on every
  // request so the canvas re-fits even when targeting the same ids twice.
  focusRequest: { ids: string[]; nonce: number } | null;
  // Whether the floating "Find" panel is open.
  searchOpen: boolean;
  // The single element (node or line edge) spotlighted by a search reveal; the
  // canvas dims everything else. Cleared on any other selection or on close.
  searchHighlightId: string | null;
  // The server session whose authoritative net this editor mirrors.
  sessionId: string | null;
  // When set, every mutating action is a no-op (the mobile read-only demo).
  // Selection, view preferences, and load-flow results still apply.
  readOnly: boolean;
  // Whether the server session's edit history can undo/redo right now.
  canUndo: boolean;
  canRedo: boolean;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  // Create a bus-to-bus branch from a connection the user drew (chosen explicitly
  // from the canvas "add connection" menu, never inferred).
  addLineBetween: (c: Connection) => void;
  addTransformerBetween: (c: Connection) => void;
  addNode: (kind: ElementKind, position: XYPosition) => void;
  // Clones of the selected nodes' attributes (results stripped), no wires.
  clipboard: ClonePayload[] | null;
  // Copy every currently selected (non-foreign) node to the clipboard.
  copySelection: () => void;
  // Duplicate every selected node by `delta`; returns the new node ids.
  duplicateSelection: (delta: XYPosition) => string[];
  // Clone every selected node in place for a modifier-drag, returning the
  // original→clone id pairs so the canvas can redirect the drag onto the clones.
  duplicateForDrag: () => { originalId: string; cloneId: string }[];
  pasteAt: (position: XYPosition) => void;
  updateNodeData: (id: string, patch: Partial<ElementData>) => void;
  updateEdgeData: (id: string, patch: Partial<LineData>) => void;
  // Set a transformer's tap position. tap_pos is an operating setpoint, not part
  // of the std_type definition, so this writes it as a plain column (keeping the
  // preset label) rather than routing through the params — which would drop the
  // transformer to "custom" like any other electrical edit. `params` is the
  // inspector's effective param set (a preset's local node carries no params of
  // its own — they come from the std_type catalog), so we seed the local params
  // from it to reflect the new position without touching the preset label.
  setTrafoTapPos: (
    id: string,
    pos: number,
    params: Trafo2WParams | Trafo3WParams,
  ) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  removeElements: (nodeIds: string[], edgeIds: string[]) => void;
  // Set (or clear, with null) a wire's routing waypoint — a draggable point the
  // line is computed through. Purely visual; ignored by the load-flow converter.
  setEdgeWaypoint: (id: string, point: { x: number; y: number } | null) => void;
  select: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  // Make `id` the sole selection (clearing any multi-selection). Used when
  // right-clicking a node that isn't part of the current selection.
  selectOnly: (id: string) => void;
  // Spotlight an element (dimming the rest) without moving the viewport or
  // touching the selection — a search "preview". Pass null to clear.
  highlightElement: (id: string | null) => void;
  // Select an element by id (node or line edge) and pan/zoom the canvas onto it.
  // With `highlight`, also spotlight it (dimming the rest). Returns false if no
  // such element exists (e.g. it was since deleted).
  revealElement: (id: string, opts?: { highlight?: boolean }) => boolean;
  // Open/close the Find panel; closing clears any search spotlight.
  setSearchOpen: (open: boolean) => void;
  // Clear the inspector selection and every node/edge highlight on the canvas.
  // Used when clicking outside the canvas (e.g. the palette).
  deselectAll: () => void;
  setShowResults: (show: boolean) => void;
  setStudyMode: (mode: StudyMode) => void;
  setVoltageUnit: (unit: VoltageUnit) => void;
  setReadOnly: (readOnly: boolean) => void;
  applyResults: (result: LoadFlowResult) => void;
  // Write short-circuit currents onto bus nodes (cleared when !ok).
  applyShortCircuit: (result: ShortCircuitResult) => void;
  loadNetwork: (
    network: Network,
    foreign?: ForeignElement[],
    opts?: { fit?: boolean },
  ) => void;
  // Bind this editor to a server session and hydrate it from a projection.
  attachSession: (id: string, view: ViewModel) => Promise<void>;
  // Update the undo/redo availability (driven by server responses).
  setHistory: (canUndo: boolean, canRedo: boolean) => void;
  // Revert/replay one edit step on the server, re-hydrating the projection.
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  // Re-pull the projection from the server (after a server-side cascade, e.g. a
  // bus delete that drops its attached elements).
  resyncFromServer: () => Promise<void>;
  // Clear everything back to an empty, untitled network.
  resetNetwork: () => void;
}

// Midpoint of two nodes' positions — where an inserted switch/transformer body
// sits between the two buses it joins.
function midpoint(a: ElementNode, b: ElementNode): XYPosition {
  return {
    x: (a.position.x + b.position.x) / 2,
    y: (a.position.y + b.position.y) / 2,
  };
}

// A wire from a switch/transformer winding handle to one of its buses.
function branchWire(
  nodeId: string,
  handle: string,
  busId: string,
  port?: string | null,
): Edge {
  return {
    id: `${nodeId}:${handle}->${busId}`,
    source: nodeId,
    sourceHandle: handle,
    target: busId,
    targetHandle: port ?? undefined,
    type: "wire",
  };
}

// Translate a freshly-drawn element->bus attachment into a server command.
// A single-attachment component materializes (add_element) on its first wire;
// a switch/transformer materializes only once all its windings are wired; an
// element already on the server just re-points (connect).
function syncAttachment(
  node: ElementNode,
  busId: string,
  port: string,
  handle: string | null,
  edges: Edge[],
  nodes: ElementNode[],
): ElementData | undefined {
  const kind = node.type as ElementKind;
  const known = serverIds.has(node.id);

  if (COMPONENT_KINDS.has(kind)) {
    if (known) {
      enqueue({
        op: "connect",
        payload: { id: node.id, kind, end: "", bus_id: busId, port },
      });
    } else {
      enqueue({
        op: "add_element",
        payload: {
          id: node.id,
          kind,
          bus_id: busId,
          port,
          x: node.position.x,
          y: node.position.y,
          data: node.data,
          waypoint: null,
        },
      });
      serverIds.add(node.id);
    }
    return;
  }

  const wire = (h: string) =>
    edges.find((e) => e.source === node.id && e.sourceHandle === h);
  const d = node.data as { name?: string; closed?: boolean; std_type?: string };

  if (kind === "switch") {
    const a = wire("a");
    const b = wire("b");
    if (a?.target && b?.target) {
      if (known)
        enqueue({
          op: "connect",
          payload: {
            id: node.id,
            kind,
            end: handleToEnd(handle),
            bus_id: busId,
            port,
          },
        });
      else {
        enqueue({
          op: "add_switch",
          payload: {
            id: node.id,
            bus_a: a.target,
            bus_b: b.target,
            closed: d.closed ?? true,
            port_a: a.targetHandle ?? "",
            port_b: b.targetHandle ?? "",
            x: node.position.x,
            y: node.position.y,
            name: d.name,
          },
        });
        serverIds.add(node.id);
      }
    }
    return;
  }

  if (kind === "impedance") {
    const from = wire("from");
    const to = wire("to");
    if (from?.target && to?.target) {
      if (known)
        enqueue({
          op: "connect",
          payload: {
            id: node.id,
            kind,
            end: handleToEnd(handle),
            bus_id: busId,
            port,
          },
        });
      else {
        enqueue({
          op: "add_impedance",
          payload: {
            id: node.id,
            from_bus: from.target,
            to_bus: to.target,
            port_from: from.targetHandle ?? "",
            port_to: to.targetHandle ?? "",
            x: node.position.x,
            y: node.position.y,
            data: node.data,
            waypoint: null,
          },
        });
        serverIds.add(node.id);
      }
    }
    return;
  }

  if (kind === "trafo2w") {
    const hv = wire("hv");
    const lv = wire("lv");
    if (hv?.target && lv?.target) {
      if (known) {
        enqueue({
          op: "connect",
          payload: {
            id: node.id,
            kind,
            end: handleToEnd(handle),
            bus_id: busId,
            port,
          },
        });
        return;
      }
      // Materialize with a voltage-matching std type, or custom parameters when
      // none fits the bus voltages.
      const v = connectedTrafoVoltages(node.id, nodes, edges);
      const matches =
        v.hv != null && v.lv != null ? matchingTrafo2wTypes(v.hv, v.lv) : [];
      const data: Trafo2WData = matches.length
        ? { name: d.name ?? "Transformer", std_type: matches[0] }
        : {
            name: d.name ?? "Transformer",
            std_type: "",
            params: defaultTrafo2wParams(v.hv ?? 0, v.lv ?? 0),
          };
      enqueue({
        op: "add_transformer",
        payload: {
          id: node.id,
          hv_bus: hv.target,
          lv_bus: lv.target,
          std_type: data.std_type,
          ...(data.params ? { params: data.params } : {}),
          port_hv: hv.targetHandle ?? "",
          port_lv: lv.targetHandle ?? "",
          x: node.position.x,
          y: node.position.y,
          name: data.name,
        },
      });
      serverIds.add(node.id);
      return data;
    }
    return;
  }

  if (kind === "trafo3w") {
    if (known) {
      enqueue({
        op: "connect",
        payload: {
          id: node.id,
          kind,
          end: handleToEnd(handle),
          bus_id: busId,
          port,
        },
      });
      return;
    }
    const hv = wire("hv");
    const mv = wire("mv");
    const lv = wire("lv");
    if (hv?.target && mv?.target && lv?.target) {
      // All three windings wired: materialize with a voltage-matching std type,
      // or custom parameters when none fits the bus voltages.
      const v = connectedTrafoVoltages(node.id, nodes, edges);
      const matches =
        v.hv != null && v.mv != null && v.lv != null
          ? matchingTrafo3wTypes(v.hv, v.mv, v.lv)
          : [];
      const data: Trafo3WData = matches.length
        ? { name: d.name ?? "3W Transformer", std_type: matches[0] }
        : {
            name: d.name ?? "3W Transformer",
            std_type: "",
            params: defaultTrafo3wParams(v.hv ?? 0, v.mv ?? 0, v.lv ?? 0),
          };
      enqueue({
        op: "add_transformer3w",
        payload: {
          id: node.id,
          hv_bus: hv.target,
          mv_bus: mv.target,
          lv_bus: lv.target,
          std_type: data.std_type,
          ...(data.params ? { params: data.params } : {}),
          port_hv: hv.targetHandle ?? "",
          port_mv: mv.targetHandle ?? "",
          port_lv: lv.targetHandle ?? "",
          x: node.position.x,
          y: node.position.y,
          name: data.name,
        },
      });
      serverIds.add(node.id);
      return data;
    }
  }
}

// A clone/paste produces a wireless node. A bus stands alone, so it's created
// on the server right away; everything else is a draft until it's wired.
function syncClonedNode(node: ElementNode): void {
  if (node.type !== "bus") return;
  const b = node.data as BusData;
  enqueue({
    op: "add_bus",
    payload: {
      id: node.id,
      name: b.name,
      vn_kv: b.vn_kv,
      x: node.position.x,
      y: node.position.y,
      width: node.width ?? BUS_DEFAULT_WIDTH,
    },
  });
  serverIds.add(node.id);
}

// A read-only canvas node for a pandapower element the editor doesn't model.
function foreignNode(f: ForeignElement): ElementNode {
  const data: ForeignData = {
    table: f.table,
    label: f.name,
    bus_ids: f.bus_ids,
  };
  return {
    id: f.id,
    type: "foreign",
    position: { x: f.x, y: f.y },
    data,
    draggable: false,
    selectable: true,
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  networkName: DEFAULT_SCENARIO_NAME,
  f_hz: 50.0,
  sn_mva: 1.0,
  nodes: [],
  edges: [],
  selectedId: null,
  selectedEdgeId: null,
  clipboard: null,
  showResults: true,
  studyMode: "loadflow",
  scMaxIkss: 0,
  voltageUnit: initialVoltageUnit(),
  fitSignal: 0,
  focusRequest: null,
  searchOpen: false,
  searchHighlightId: null,
  sessionId: null,
  readOnly: false,
  canUndo: false,
  canRedo: false,

  onNodesChange: (changes) => {
    // React Flow measures every node on mount and reports it as a `dimensions`
    // change with no `resizing` flag. Mirroring those back into our state would
    // replace the nodes array once per node (~130× for a large import), and React
    // Flow re-renders its whole node tree on each `nodes` reference change — an
    // O(n²) storm that made opening a network take seconds. React Flow keeps
    // measured sizes in its own internal lookup and we never read them back, so we
    // drop measurement-only changes and apply the rest (position, select,
    // add/remove, and user resizes, which carry a `resizing` flag so a dragged bus
    // edge still updates live).
    const applied = changes.filter(
      (ch) => !(ch.type === "dimensions" && ch.resizing === undefined),
    );
    if (applied.length === 0) return;
    const nodes = applyNodeChanges(applied, get().nodes) as ElementNode[];
    set({ nodes });
    if (get().readOnly) return;
    // Sync layout for known elements: positions on drop, bus width on resize.
    // Batched in sync.ts so a drag/resize (many changes) sends once.
    for (const ch of applied) {
      if (ch.type === "position" && ch.dragging === false) {
        const n = nodes.find((x) => x.id === ch.id);
        if (n?.type && serverIds.has(n.id) && n.type !== "foreign")
          enqueue({
            op: "set_layout",
            payload: {
              id: n.id,
              kind: n.type,
              x: n.position.x,
              y: n.position.y,
            },
          });
      } else if (ch.type === "dimensions" && ch.resizing === false) {
        // Only a finished user resize syncs width. React Flow's initial
        // measurement also emits a dimensions change but without the `resizing`
        // flag; enqueuing on that would record a spurious edit on every hydrate
        // (polluting the undo history and clobbering the redo stack after undo).
        const n = nodes.find((x) => x.id === ch.id);
        const width = n?.width ?? ch.dimensions?.width;
        if (n?.type === "bus" && serverIds.has(n.id) && width !== undefined)
          enqueue({
            op: "set_layout",
            payload: { id: n.id, kind: "bus", width },
          });
      }
    }
  },

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) => {
    if (get().readOnly) return;
    // Element → bus attachment. (A bus → bus drag is intercepted by the canvas,
    // which opens the "add connection" menu instead — see addBranch actions.)
    // Each source port carries at most one wire: drop any existing wire from the
    // same source handle before adding, so a load/generator can't fan out to two
    // buses (and a transformer winding stays single).
    const s = get();
    const handle = connection.sourceHandle ?? null;
    const filtered = s.edges.filter(
      (e) =>
        !(
          e.source === connection.source && (e.sourceHandle ?? null) === handle
        ),
    );
    const edges = addEdge({ ...connection, type: "wire" }, filtered);
    set({ edges });
    const node = s.nodes.find((n) => n.id === connection.source);
    if (node?.type && connection.target) {
      const newData = syncAttachment(
        node,
        connection.target,
        connection.targetHandle ?? "",
        handle,
        edges,
        s.nodes,
      );
      // A transformer materializes with a voltage-matched type/params on its
      // final wire; reflect that on the node so the inspector stays accurate.
      if (newData)
        set((st) => ({
          nodes: st.nodes.map((n) =>
            n.id === node.id ? { ...n, data: newData } : n,
          ),
        }));
    }
  },

  addLineBetween: (c) => {
    if (get().readOnly) return;
    const id = `line-${newId()}`;
    const data = DEFAULT_LINE();
    set((s) => ({
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: [
        ...s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
        {
          id,
          source: c.source,
          target: c.target,
          sourceHandle: c.sourceHandle ?? undefined,
          targetHandle: c.targetHandle ?? undefined,
          type: "line",
          data,
          selected: true,
        },
      ],
      selectedEdgeId: id,
      selectedId: null,
    }));
    if (c.source && c.target) {
      enqueue({
        op: "add_line",
        payload: {
          id,
          from_bus: c.source,
          to_bus: c.target,
          port_from: c.sourceHandle ?? "",
          port_to: c.targetHandle ?? "",
          data,
        },
      });
      serverIds.add(id);
    }
  },

  addTransformerBetween: (c) => {
    if (get().readOnly) return;
    set((s) => {
      const a = s.nodes.find((n) => n.id === c.source);
      const b = s.nodes.find((n) => n.id === c.target);
      if (!a || !b) return {};
      // HV winding goes on the higher-voltage bus.
      const vA = (a.data as BusData).vn_kv;
      const vB = (b.data as BusData).vn_kv;
      const [hvBus, lvBus, hvPort, lvPort] =
        vA >= vB
          ? [c.source, c.target, c.sourceHandle, c.targetHandle]
          : [c.target, c.source, c.targetHandle, c.sourceHandle];
      // Pick a standard type whose rated voltages match the two buses; if none
      // fits, fall back to a custom-parameter transformer matched to them.
      const hvVn = Math.max(vA, vB);
      const lvVn = Math.min(vA, vB);
      const matches = matchingTrafo2wTypes(hvVn, lvVn);
      const data: Trafo2WData = matches.length
        ? { name: "Transformer", std_type: matches[0] }
        : {
            name: "Transformer",
            std_type: "",
            params: defaultTrafo2wParams(hvVn, lvVn),
          };
      const id = newId();
      const node: ElementNode = {
        id,
        type: "trafo2w",
        position: midpoint(a, b),
        selected: true,
        data,
      };
      enqueue({
        op: "add_transformer",
        payload: {
          id,
          hv_bus: hvBus,
          lv_bus: lvBus,
          std_type: data.std_type,
          ...(data.params ? { params: data.params } : {}),
          port_hv: hvPort ?? "",
          port_lv: lvPort ?? "",
          x: node.position.x,
          y: node.position.y,
          name: "Transformer",
        },
      });
      serverIds.add(id);
      return {
        nodes: [
          ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          node,
        ],
        edges: [
          ...s.edges,
          branchWire(id, "hv", hvBus, hvPort),
          branchWire(id, "lv", lvBus, lvPort),
        ],
        selectedId: id,
        selectedEdgeId: null,
      };
    });
  },

  addNode: (kind, position) => {
    if (get().readOnly) return;
    const id = newId();
    const data = defaultData(kind);
    set((s) => ({
      nodes: [
        ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        {
          id,
          type: kind,
          position,
          data,
          selected: true,
          // Give buses a resizable initial length.
          ...(kind === "bus" ? { width: BUS_DEFAULT_WIDTH } : {}),
        },
      ],
      selectedId: id,
      selectedEdgeId: null,
    }));
    // A bus stands alone, so it's created on the server immediately. Other
    // elements need a bus first — they sync once wired (see syncAttachment).
    if (kind === "bus") {
      const b = data as BusData;
      enqueue({
        op: "add_bus",
        payload: {
          id,
          name: b.name,
          vn_kv: b.vn_kv,
          x: position.x,
          y: position.y,
          width: BUS_DEFAULT_WIDTH,
        },
      });
      serverIds.add(id);
    }
  },

  copySelection: () => {
    const sel = clonableSelection(get().nodes);
    if (sel.length === 0) return;
    const anchorX = Math.min(...sel.map((n) => n.position.x));
    const anchorY = Math.min(...sel.map((n) => n.position.y));
    set({
      clipboard: sel.map((n) => ({
        type: n.type as ElementKind,
        data: structuredClone(n.data),
        width: n.width,
        dx: n.position.x - anchorX,
        dy: n.position.y - anchorY,
      })),
    });
    toast.info(`Copied ${sel.length} element${sel.length === 1 ? "" : "s"}.`);
  },

  duplicateSelection: (delta) => {
    if (get().readOnly) return [];
    const sel = clonableSelection(get().nodes);
    if (sel.length === 0) return [];
    const created = sel.map((n) =>
      makeCloneNode(
        {
          type: n.type as ElementKind,
          data: n.data,
          width: n.width,
          dx: 0,
          dy: 0,
        },
        { x: n.position.x + delta.x, y: n.position.y + delta.y },
      ),
    );
    set((s) => ({
      nodes: [
        ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...created.map((n) => ({ ...n, selected: true })),
      ],
      selectedId: created.length === 1 ? created[0].id : null,
      selectedEdgeId: null,
    }));
    created.forEach(syncClonedNode);
    return created.map((n) => n.id);
  },

  duplicateForDrag: () => {
    if (get().readOnly) return [];
    const sel = clonableSelection(get().nodes);
    if (sel.length === 0) return [];
    // Clones sit on top of their originals (no offset) and selection is left
    // untouched, so the in-progress drag keeps moving the grabbed nodes while
    // the canvas redirects their position changes onto these clones.
    const pairs = sel.map((n) => ({
      original: n,
      clone: makeCloneNode(
        {
          type: n.type as ElementKind,
          data: n.data,
          width: n.width,
          dx: 0,
          dy: 0,
        },
        { x: n.position.x, y: n.position.y },
      ),
    }));
    set((s) => ({ nodes: [...s.nodes, ...pairs.map((p) => p.clone)] }));
    pairs.forEach((p) => syncClonedNode(p.clone));
    return pairs.map((p) => ({
      originalId: p.original.id,
      cloneId: p.clone.id,
    }));
  },

  pasteAt: (position) => {
    const { clipboard, readOnly } = get();
    if (readOnly || !clipboard || clipboard.length === 0) return;
    const created = clipboard.map((p) =>
      makeCloneNode(p, { x: position.x + p.dx, y: position.y + p.dy }),
    );
    set((s) => ({
      nodes: [
        ...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        ...created.map((n) => ({ ...n, selected: true })),
      ],
      selectedId: created.length === 1 ? created[0].id : null,
      selectedEdgeId: null,
    }));
    created.forEach(syncClonedNode);
  },

  updateNodeData: (id, patch) => {
    if (get().readOnly) return;
    const node = get().nodes.find((n) => n.id === id);
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id
          ? ({ ...n, data: { ...n.data, ...patch } } as ElementNode)
          : n,
      ),
    }));
    if (node?.type && node.type !== "foreign" && serverIds.has(id))
      enqueue({ op: "update", payload: { id, kind: node.type, patch } });
  },

  updateEdgeData: (id, patch) => {
    if (get().readOnly) return;
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === id ? { ...e, data: { ...e.data, ...patch } } : e,
      ),
    }));
    if (serverIds.has(id))
      enqueue({ op: "update", payload: { id, kind: "line", patch } });
  },

  setTrafoTapPos: (id, pos, params) => {
    if (get().readOnly) return;
    const node = get().nodes.find((n) => n.id === id);
    if (!node || (node.type !== "trafo2w" && node.type !== "trafo3w")) return;
    // Reflect the new position locally, leaving the std_type label untouched.
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id) return n;
        const data = n.data as Trafo2WData | Trafo3WData;
        return {
          ...n,
          data: { ...data, params: { ...params, tap_pos: pos } },
        } as ElementNode;
      }),
    }));
    // …and send it as a bare column write, not a params/std_type change, so the
    // preset survives (see the interface note).
    if (serverIds.has(id))
      enqueue({
        op: "update",
        payload: { id, kind: node.type, patch: { tap_pos: pos } },
      });
  },

  removeNode: (id) => {
    if (get().readOnly) return;
    const node = get().nodes.find((n) => n.id === id);
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      // Drop any wires touching the removed node.
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
    if (!node?.type || node.type === "foreign" || !serverIds.has(id)) return;
    enqueue({ op: "delete", payload: { id, kind: node.type } });
    serverIds.delete(id);
    // Deleting a bus cascades on the server (its attached elements go too), so
    // re-pull the projection to stay consistent rather than guess what dropped.
    if (node.type === "bus") void get().resyncFromServer();
  },

  removeEdge: (id) => {
    if (get().readOnly) return;
    const edge = get().edges.find((e) => e.id === id);
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }));
    if (edge?.type === "line" && serverIds.has(id)) {
      enqueue({ op: "delete", payload: { id, kind: "line" } });
      serverIds.delete(id);
    }
  },

  removeElements: (nodeIds, edgeIds) => {
    if (get().readOnly) return;
    const nodesById = new Map(get().nodes.map((n) => [n.id, n]));

    // Buses go last. A bus delete cascades everything attached to it (lines,
    // transformers, switches, loads, gens…) server-side, so we delete those
    // explicitly *first*, while they still exist — the later bus cascade then
    // simply skips rows already gone (drop_buses is idempotent over them). The
    // whole batch flushes in one request (via the single resync below, or the
    // debounce timer), so this ordering holds and nothing races across requests.
    const busIds: string[] = [];
    const elementIds: string[] = [];
    for (const id of nodeIds) {
      if (nodesById.get(id)?.type === "bus") busIds.push(id);
      else elementIds.push(id);
    }

    const removeNodeLocal = (id: string) => {
      const node = nodesById.get(id);
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }));
      if (!node?.type || node.type === "foreign" || !serverIds.has(id)) return;
      enqueue({ op: "delete", payload: { id, kind: node.type } });
      serverIds.delete(id);
    };

    // Lines, then attached elements, then the buses they hang off of.
    for (const id of edgeIds) {
      const edge = get().edges.find((e) => e.id === id);
      set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }));
      if (edge?.type === "line" && serverIds.has(id)) {
        enqueue({ op: "delete", payload: { id, kind: "line" } });
        serverIds.delete(id);
      }
    }
    for (const id of elementIds) removeNodeLocal(id);
    for (const id of busIds) removeNodeLocal(id);

    // Re-pull the projection once for the whole batch (rather than per bus) so
    // the local canvas reflects the server-side cascade without firing
    // overlapping requests.
    if (busIds.length > 0) void get().resyncFromServer();
  },

  setEdgeWaypoint: (id, point) => {
    if (get().readOnly) return;
    const edge = get().edges.find((e) => e.id === id);
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, waypoint: point ?? undefined } }
          : e,
      ),
    }));
    if (!edge) return;
    // A line edge stores its waypoint on the line's own layout row; an element
    // wire stores it on the attached component's layout.
    if (edge.type === "line") {
      if (serverIds.has(edge.id))
        enqueue({
          op: "set_layout",
          payload: { id: edge.id, kind: "line", waypoint: point },
        });
      return;
    }
    if (edge.type !== "wire") return;
    const source = get().nodes.find((n) => n.id === edge.source);
    if (source?.type && source.type !== "foreign" && serverIds.has(source.id))
      enqueue({
        op: "set_layout",
        payload: { id: source.id, kind: source.type, waypoint: point },
      });
  },

  // Any plain selection (a click on the canvas/pane) drops the search spotlight.
  select: (id) =>
    set({ selectedId: id, selectedEdgeId: null, searchHighlightId: null }),
  selectEdge: (id) =>
    set((s) => ({
      selectedEdgeId: id,
      selectedId: null,
      searchHighlightId: null,
      // Mirror the edge's selected flag so selecting via the label (which bypasses
      // React Flow's own edge-click selection) still shows the routing dot.
      edges: s.edges.map((e) =>
        e.selected !== (e.id === id) ? { ...e, selected: e.id === id } : e,
      ),
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
    })),

  selectOnly: (id) =>
    set((s) => ({
      selectedId: id,
      selectedEdgeId: null,
      nodes: s.nodes.map((n) =>
        n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n,
      ),
      edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    })),

  highlightElement: (id) => set({ searchHighlightId: id }),

  revealElement: (id, opts = {}) => {
    const highlight = opts.highlight ? id : null;
    const { nodes, edges } = get();
    if (nodes.some((n) => n.id === id)) {
      get().selectOnly(id);
      set((s) => ({
        focusRequest: {
          ids: [id],
          nonce: s.focusRequest ? s.focusRequest.nonce + 1 : 1,
        },
        searchHighlightId: highlight,
      }));
      return true;
    }
    const edge = edges.find((e) => e.id === id && e.type === "line");
    if (edge) {
      set((s) => ({
        selectedEdgeId: id,
        selectedId: null,
        nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        edges: s.edges.map((e) =>
          e.selected !== (e.id === id) ? { ...e, selected: e.id === id } : e,
        ),
        // A line has no body; frame its two end buses instead.
        focusRequest: {
          ids: [edge.source, edge.target].filter(Boolean) as string[],
          nonce: s.focusRequest ? s.focusRequest.nonce + 1 : 1,
        },
        searchHighlightId: highlight,
      }));
      return true;
    }
    return false;
  },

  setSearchOpen: (open) =>
    set(
      open
        ? { searchOpen: true }
        : { searchOpen: false, searchHighlightId: null },
    ),

  deselectAll: () =>
    set((s) => ({
      selectedId: null,
      selectedEdgeId: null,
      searchHighlightId: null,
      nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
      edges: s.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    })),

  setShowResults: (show) => set({ showResults: show }),
  // Switching study type clears every solved value so a stale load-flow result
  // can't linger under short-circuit figures (or vice versa).
  setStudyMode: (mode) =>
    set((s) => {
      if (mode === s.studyMode) return { studyMode: mode };
      const stripRes = (data: unknown): ElementData => {
        const d = { ...(data as Record<string, unknown>) };
        delete d.res_p_mw;
        delete d.res_q_mvar;
        delete d.res_loading_percent;
        delete d.res_i_ka;
        return d as ElementData;
      };
      return {
        studyMode: mode,
        scMaxIkss: 0,
        nodes: s.nodes.map((n) => {
          if (n.type === "bus") {
            const d = { ...(n.data as BusData) };
            d.vm_pu = undefined;
            d.va_degree = undefined;
            d.ikss_ka = undefined;
            d.ip_ka = undefined;
            d.ith_ka = undefined;
            d.skss_mw = undefined;
            return { ...n, data: d } as ElementNode;
          }
          return { ...n, data: stripRes(n.data) } as ElementNode;
        }),
        edges: s.edges.map((e) =>
          e.type === "line" ? { ...e, data: stripRes(e.data) } : e,
        ),
      };
    }),
  setReadOnly: (readOnly) => set({ readOnly }),

  setVoltageUnit: (unit) => {
    try {
      localStorage.setItem(VOLTAGE_UNIT_KEY, unit);
    } catch {
      // best-effort
    }
    set({ voltageUnit: unit });
  },

  applyResults: (result) => {
    if (!result.converged) toast.error(`Did not converge: ${result.message}`);
    set((s) => {
      const byBus = new Map(result.res_bus.map((r) => [r.id, r]));
      const byGen = new Map(result.res_gen.map((r) => [r.id, r]));
      const bySgen = new Map(result.res_sgen.map((r) => [r.id, r]));
      const byExtGrid = new Map(result.res_ext_grid.map((r) => [r.id, r]));
      const byShunt = new Map(result.res_shunt.map((r) => [r.id, r]));
      const byXward = new Map(result.res_xward.map((r) => [r.id, r]));
      const bySvc = new Map(result.res_svc.map((r) => [r.id, r]));
      const byImpedance = new Map(result.res_impedance.map((r) => [r.id, r]));
      const byTrafo = new Map(
        [...result.res_trafo, ...result.res_trafo3w].map((r) => [r.id, r]),
      );
      const byLine = new Map(result.res_line.map((r) => [r.id, r]));
      // On a failed run, clear stale values instead of showing the last
      // successful result (which would be misleading). Unsupplied buses come
      // back as null — also treated as "no result".
      return {
        edges: s.edges.map((e) => {
          if (e.type !== "line") return e;
          const r = result.converged ? byLine.get(e.id) : undefined;
          return {
            ...e,
            data: {
              ...(e.data as LineData),
              res_loading_percent: r?.loading_percent ?? undefined,
              res_p_mw: r?.p_mw ?? undefined,
              res_q_mvar: r?.q_mvar ?? undefined,
              res_i_ka: r?.i_ka ?? undefined,
            },
          };
        }),
        nodes: s.nodes.map((n) => {
          if (n.type === "bus") {
            const r = result.converged ? byBus.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as BusData),
                vm_pu: r?.vm_pu ?? undefined,
                va_degree: r?.va_degree ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "generator") {
            const r = result.converged ? byGen.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as GeneratorData),
                res_p_mw: r?.p_mw ?? undefined,
                res_q_mvar: r?.q_mvar ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "sgen" || n.type === "extgrid") {
            const r = result.converged
              ? (n.type === "sgen" ? bySgen : byExtGrid).get(n.id)
              : undefined;
            return {
              ...n,
              data: {
                ...(n.data as SgenData | ExtGridData),
                res_p_mw: r?.p_mw ?? undefined,
                res_q_mvar: r?.q_mvar ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "shunt") {
            const r = result.converged ? byShunt.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as ShuntData),
                res_p_mw: r?.p_mw ?? undefined,
                res_q_mvar: r?.q_mvar ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "xward") {
            const r = result.converged ? byXward.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as XwardData),
                res_p_mw: r?.p_mw ?? undefined,
                res_q_mvar: r?.q_mvar ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "svc") {
            const r = result.converged ? bySvc.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as SvcData),
                res_q_mvar: r?.q_mvar ?? undefined,
                res_vm_pu: r?.vm_pu ?? undefined,
                res_firing_angle: r?.thyristor_firing_angle_degree ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "impedance") {
            const r = result.converged ? byImpedance.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as ImpedanceData),
                res_p_mw: r?.p_mw ?? undefined,
                res_q_mvar: r?.q_mvar ?? undefined,
              },
            } as ElementNode;
          }
          if (n.type === "trafo2w" || n.type === "trafo3w") {
            const r = result.converged ? byTrafo.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as Trafo2WData),
                res_loading_percent: r?.loading_percent ?? undefined,
                res_p_mw: r?.p_mw ?? undefined,
                res_q_mvar: r?.q_mvar ?? undefined,
              },
            } as ElementNode;
          }
          return n;
        }),
      };
    });
  },

  applyShortCircuit: (result) => {
    if (!result.ok) {
      toast.error(`Short circuit failed: ${result.message}`);
      set((s) => ({
        scMaxIkss: 0,
        nodes: s.nodes.map((n) =>
          n.type === "bus"
            ? ({
                ...n,
                data: {
                  ...(n.data as BusData),
                  ikss_ka: undefined,
                  ip_ka: undefined,
                  ith_ka: undefined,
                  skss_mw: undefined,
                },
              } as ElementNode)
            : n,
        ),
      }));
      return;
    }
    set((s) => {
      const byBus = new Map(result.res_bus.map((r) => [r.id, r]));
      const maxIkss = result.res_bus.reduce(
        (m, r) => Math.max(m, r.ikss_ka ?? 0),
        0,
      );
      return {
        scMaxIkss: maxIkss,
        nodes: s.nodes.map((n) => {
          if (n.type !== "bus") return n;
          const r = byBus.get(n.id);
          return {
            ...n,
            data: {
              ...(n.data as BusData),
              ikss_ka: r?.ikss_ka ?? undefined,
              ip_ka: r?.ip_ka ?? undefined,
              ith_ka: r?.ith_ka ?? undefined,
              skss_mw: r?.skss_mw ?? undefined,
            },
          } as ElementNode;
        }),
      };
    });
  },

  loadNetwork: (network, foreign = [], opts = {}) => {
    const { fit = true } = opts;
    const nodes: ElementNode[] = [];
    const edges: Edge[] = [];
    // Spread elements that carry no explicit port (e.g. a plain pandapower
    // import) across distinct bus ports so they don't all snap to the first
    // handle. Files we exported keep their stored ports and aren't counted.
    // Bus ports are assigned by geometry, not insertion order: each element claims
    // the bus slot nearest its own position so wires don't cross. We queue requests
    // now (with the connecting terminal's x) and resolve them per bus below; an
    // explicit (stored) port from our own files is honored as-is.
    type PortField = "sourceHandle" | "targetHandle";
    type PortReq = { busId: string; edge: Edge; field: PortField; x: number };
    const portReqs: PortReq[] = [];
    const connect = (
      edge: Edge,
      field: PortField,
      busId: string,
      explicit: string | undefined | null,
      x: number,
    ) => {
      if (explicit) edge[field] = explicit;
      else portReqs.push({ busId, edge, field, x });
    };
    // Stub elements (source/load/shunt) tracked so the lone ones can be straightened
    // onto their assigned port after layout.
    const STUB_HALF = 32; // element nodes are 64 px wide with a centered handle
    const stubEdges: {
      id: string;
      busId: string;
      edge: Edge;
      explicit: boolean;
    }[] = [];
    for (const b of network.buses) {
      nodes.push({
        id: b.id,
        type: "bus",
        position: { x: b.x, y: b.y },
        data: { name: b.name, vn_kv: b.vn_kv },
        width: b.width ?? BUS_DEFAULT_WIDTH,
      });
    }
    const busById = new Map(
      nodes.filter((n) => n.type === "bus").map((n) => [n.id, n]),
    );
    const busCenter = (id: string): number => {
      const b = busById.get(id);
      return b ? b.position.x + (b.width ?? BUS_DEFAULT_WIDTH) / 2 : 0;
    };
    for (const g of network.generators) {
      nodes.push({
        id: g.id,
        type: "generator",
        position: { x: g.x, y: g.y },
        data: {
          name: g.name,
          p_mw: g.p_mw,
          vm_pu: g.vm_pu,
          slack: g.slack,
          slack_weight: g.slack_weight,
          sn_mva: g.sn_mva,
          xdss_pu: g.xdss_pu,
          cos_phi: g.cos_phi,
        },
      });
      if (g.bus_id) {
        const edge: Edge = {
          id: `${g.id}->${g.bus_id}`,
          source: g.id,
          target: g.bus_id,
          type: "wire",
          data: g.waypoint ? { waypoint: g.waypoint } : undefined,
        };
        edges.push(edge);
        connect(edge, "targetHandle", g.bus_id, g.port, g.x + STUB_HALF);
        stubEdges.push({ id: g.id, busId: g.bus_id, edge, explicit: !!g.port });
      }
    }
    for (const sg of network.sgens ?? []) {
      nodes.push({
        id: sg.id,
        type: "sgen",
        position: { x: sg.x, y: sg.y },
        data: { name: sg.name, p_mw: sg.p_mw, q_mvar: sg.q_mvar },
      });
      if (sg.bus_id) {
        const edge: Edge = {
          id: `${sg.id}->${sg.bus_id}`,
          source: sg.id,
          target: sg.bus_id,
          type: "wire",
          data: sg.waypoint ? { waypoint: sg.waypoint } : undefined,
        };
        edges.push(edge);
        connect(edge, "targetHandle", sg.bus_id, sg.port, sg.x + STUB_HALF);
        stubEdges.push({
          id: sg.id,
          busId: sg.bus_id,
          edge,
          explicit: !!sg.port,
        });
      }
    }
    for (const eg of network.ext_grids ?? []) {
      nodes.push({
        id: eg.id,
        type: "extgrid",
        position: { x: eg.x, y: eg.y },
        data: {
          name: eg.name,
          vm_pu: eg.vm_pu,
          va_degree: eg.va_degree,
          s_sc_max_mva: eg.s_sc_max_mva,
          rx_max: eg.rx_max,
        },
      });
      if (eg.bus_id) {
        const edge: Edge = {
          id: `${eg.id}->${eg.bus_id}`,
          source: eg.id,
          target: eg.bus_id,
          type: "wire",
          data: eg.waypoint ? { waypoint: eg.waypoint } : undefined,
        };
        edges.push(edge);
        connect(edge, "targetHandle", eg.bus_id, eg.port, eg.x + STUB_HALF);
        stubEdges.push({
          id: eg.id,
          busId: eg.bus_id,
          edge,
          explicit: !!eg.port,
        });
      }
    }
    for (const l of network.loads) {
      nodes.push({
        id: l.id,
        type: "load",
        position: { x: l.x, y: l.y },
        data: { name: l.name, p_mw: l.p_mw, q_mvar: l.q_mvar },
      });
      if (l.bus_id) {
        const edge: Edge = {
          id: `${l.id}->${l.bus_id}`,
          source: l.id,
          target: l.bus_id,
          type: "wire",
          data: l.waypoint ? { waypoint: l.waypoint } : undefined,
        };
        edges.push(edge);
        connect(edge, "targetHandle", l.bus_id, l.port, l.x + STUB_HALF);
        stubEdges.push({ id: l.id, busId: l.bus_id, edge, explicit: !!l.port });
      }
    }
    for (const sh of network.shunts ?? []) {
      nodes.push({
        id: sh.id,
        type: "shunt",
        position: { x: sh.x, y: sh.y },
        data: {
          name: sh.name,
          p_mw: sh.p_mw,
          q_mvar: sh.q_mvar,
          vn_kv: sh.vn_kv,
          step: sh.step,
        },
      });
      if (sh.bus_id) {
        const edge: Edge = {
          id: `${sh.id}->${sh.bus_id}`,
          source: sh.id,
          target: sh.bus_id,
          type: "wire",
        };
        edges.push(edge);
        connect(edge, "targetHandle", sh.bus_id, sh.port, sh.x + STUB_HALF);
        stubEdges.push({
          id: sh.id,
          busId: sh.bus_id,
          edge,
          explicit: !!sh.port,
        });
      }
    }
    for (const x of network.xwards ?? []) {
      nodes.push({
        id: x.id,
        type: "xward",
        position: { x: x.x, y: x.y },
        data: {
          name: x.name,
          ps_mw: x.ps_mw,
          qs_mvar: x.qs_mvar,
          pz_mw: x.pz_mw,
          qz_mvar: x.qz_mvar,
          r_ohm: x.r_ohm,
          x_ohm: x.x_ohm,
          vm_pu: x.vm_pu,
        },
      });
      if (x.bus_id) {
        const edge: Edge = {
          id: `${x.id}->${x.bus_id}`,
          source: x.id,
          target: x.bus_id,
          type: "wire",
          data: x.waypoint ? { waypoint: x.waypoint } : undefined,
        };
        edges.push(edge);
        connect(edge, "targetHandle", x.bus_id, x.port, x.x + STUB_HALF);
        stubEdges.push({ id: x.id, busId: x.bus_id, edge, explicit: !!x.port });
      }
    }
    for (const v of network.svcs ?? []) {
      nodes.push({
        id: v.id,
        type: "svc",
        position: { x: v.x, y: v.y },
        data: {
          name: v.name,
          set_vm_pu: v.set_vm_pu,
          x_l_ohm: v.x_l_ohm,
          x_cvar_ohm: v.x_cvar_ohm,
          thyristor_firing_angle_degree: v.thyristor_firing_angle_degree,
          min_angle_degree: v.min_angle_degree,
          max_angle_degree: v.max_angle_degree,
          controllable: v.controllable,
        },
      });
      if (v.bus_id) {
        const edge: Edge = {
          id: `${v.id}->${v.bus_id}`,
          source: v.id,
          target: v.bus_id,
          type: "wire",
          data: v.waypoint ? { waypoint: v.waypoint } : undefined,
        };
        edges.push(edge);
        connect(edge, "targetHandle", v.bus_id, v.port, v.x + STUB_HALF);
        stubEdges.push({ id: v.id, busId: v.bus_id, edge, explicit: !!v.port });
      }
    }
    for (const s of network.switches ?? []) {
      nodes.push({
        id: s.id,
        type: "switch",
        position: { x: s.x, y: s.y },
        data: { name: s.name, closed: s.closed },
      });
      if (s.bus_a) {
        const edge: Edge = {
          id: `${s.id}:a->${s.bus_a}`,
          source: s.id,
          sourceHandle: "a",
          target: s.bus_a,
          type: "wire",
        };
        edges.push(edge);
        connect(edge, "targetHandle", s.bus_a, s.port_a, s.x + 32);
      }
      if (s.bus_b) {
        const edge: Edge = {
          id: `${s.id}:b->${s.bus_b}`,
          source: s.id,
          sourceHandle: "b",
          target: s.bus_b,
          type: "wire",
        };
        edges.push(edge);
        connect(edge, "targetHandle", s.bus_b, s.port_b, s.x + 32);
      }
    }
    for (const z of network.impedances ?? []) {
      nodes.push({
        id: z.id,
        type: "impedance",
        position: { x: z.x, y: z.y },
        data: {
          name: z.name,
          rft_pu: z.rft_pu,
          xft_pu: z.xft_pu,
          rtf_pu: z.rtf_pu,
          xtf_pu: z.xtf_pu,
          sn_mva: z.sn_mva,
        },
      });
      if (z.from_bus) {
        const edge: Edge = {
          id: `${z.id}:from->${z.from_bus}`,
          source: z.id,
          sourceHandle: "from",
          target: z.from_bus,
          type: "wire",
        };
        edges.push(edge);
        connect(edge, "targetHandle", z.from_bus, z.port_from, z.x + 32);
      }
      if (z.to_bus) {
        const edge: Edge = {
          id: `${z.id}:to->${z.to_bus}`,
          source: z.id,
          sourceHandle: "to",
          target: z.to_bus,
          type: "wire",
        };
        edges.push(edge);
        connect(edge, "targetHandle", z.to_bus, z.port_to, z.x + 32);
      }
    }
    // Helper: a transformer winding wire (source handle "hv"/"mv"/"lv" → bus). The
    // handles sit at the node's horizontal center, so `centerX` is the terminal x.
    const windingEdge = (
      trafoId: string,
      handle: string,
      busId: string,
      port: string | undefined,
      centerX: number,
    ) => {
      const edge: Edge = {
        id: `${trafoId}:${handle}->${busId}`,
        source: trafoId,
        sourceHandle: handle,
        target: busId,
        type: "wire",
      };
      edges.push(edge);
      connect(edge, "targetHandle", busId, port, centerX);
    };
    for (const t of network.transformers2w ?? []) {
      nodes.push({
        id: t.id,
        type: "trafo2w",
        position: { x: t.x, y: t.y },
        data: { name: t.name, std_type: t.std_type, params: t.params ?? null },
      });
      const cx = t.x + 20; // trafo2w node is 40 px wide
      if (t.hv_bus) windingEdge(t.id, "hv", t.hv_bus, t.port_hv, cx);
      if (t.lv_bus) windingEdge(t.id, "lv", t.lv_bus, t.port_lv, cx);
    }
    for (const t of network.transformers3w ?? []) {
      nodes.push({
        id: t.id,
        type: "trafo3w",
        position: { x: t.x, y: t.y },
        data: { name: t.name, std_type: t.std_type, params: t.params ?? null },
      });
      const cx = t.x + 24; // trafo3w node is 48 px wide
      if (t.hv_bus) windingEdge(t.id, "hv", t.hv_bus, t.port_hv, cx);
      if (t.mv_bus) windingEdge(t.id, "mv", t.mv_bus, t.port_mv, cx);
      if (t.lv_bus) windingEdge(t.id, "lv", t.lv_bus, t.port_lv, cx);
    }
    // Lines are bus → bus edges (no node body); they carry their electrical
    // params as edge data so they round-trip and solve.
    for (const l of network.lines ?? []) {
      if (!l.from_bus || !l.to_bus) continue;
      const edge: Edge = {
        id: l.id,
        source: l.from_bus,
        target: l.to_bus,
        type: "line",
        data: {
          name: l.name,
          length_km: l.length_km,
          r_ohm_per_km: l.r_ohm_per_km,
          x_ohm_per_km: l.x_ohm_per_km,
          c_nf_per_km: l.c_nf_per_km,
          max_i_ka: l.max_i_ka,
          std_type: l.std_type,
          waypoint: l.waypoint ?? undefined,
        } satisfies LineData,
      };
      edges.push(edge);
      // Each end faces the other bus (or the bend waypoint, if any) so the line
      // attaches on the side it leaves toward.
      const fromX = l.waypoint ? l.waypoint.x : busCenter(l.to_bus);
      const toX = l.waypoint ? l.waypoint.x : busCenter(l.from_bus);
      connect(edge, "sourceHandle", l.from_bus, l.port_from, fromX);
      connect(edge, "targetHandle", l.to_bus, l.port_to, toX);
    }
    // Resolve queued bus ports: per bus, sort requests left→right and hand out
    // slots p0..pk in that order. Monotonic assignment keeps same-bus wires in
    // x-order so they never cross, and each element lands on the slot nearest its
    // own position. Each bus is then grown to expose exactly those k ports.
    const portCount = new Map<string, number>();
    const reqsByBus = new Map<string, PortReq[]>();
    for (const r of portReqs) {
      const g = reqsByBus.get(r.busId);
      if (g) g.push(r);
      else reqsByBus.set(r.busId, [r]);
    }
    for (const [busId, reqs] of reqsByBus) {
      reqs.sort((a, b) => a.x - b.x);
      reqs.forEach((r, i) => {
        r.edge[r.field] = `p${i}`;
      });
      portCount.set(busId, reqs.length);
    }
    for (const bus of busById.values()) {
      const count = portCount.get(bus.id);
      if (count)
        bus.width = Math.max(
          bus.width ?? BUS_DEFAULT_WIDTH,
          widthForPorts(count),
        );
    }
    // Straighten lone stubs: when a source/load/shunt is the only element on its
    // side of a bus, snap it directly under/over its assigned port so the wire is a
    // straight drop. Several on one side stay spread (adjacent 40 px ports overlap).
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const sideGroups = new Map<string, typeof stubEdges>();
    for (const se of stubEdges) {
      if (se.explicit) continue;
      const bus = busById.get(se.busId);
      const node = nodeById.get(se.id);
      if (!bus || !node) continue;
      const side = node.position.y < bus.position.y ? "up" : "down";
      const key = `${se.busId}|${side}`;
      const grp = sideGroups.get(key);
      if (grp) grp.push(se);
      else sideGroups.set(key, [se]);
    }
    for (const grp of sideGroups.values()) {
      if (grp.length !== 1) continue;
      const se = grp[0];
      const bus = busById.get(se.busId)!;
      const node = nodeById.get(se.id)!;
      const handle = se.edge.targetHandle;
      if (!handle) continue;
      const i = Number(handle.slice(1));
      if (!Number.isFinite(i)) continue;
      const portX = bus.position.x + PORT_MARGIN + i * PORT_SPACING;
      node.position = { ...node.position, x: portX - STUB_HALF };
    }
    // Everything in the projection already lives on the server.
    resetServerIds([
      ...nodes.map((n) => n.id),
      ...edges.filter((e) => e.type === "line").map((e) => e.id),
    ]);
    // Read-only placeholders for elements the editor doesn't model.
    for (const f of foreign) nodes.push(foreignNode(f));
    set({
      networkName: network.name,
      f_hz: network.f_hz ?? 50.0,
      sn_mva: network.sn_mva ?? 1.0,
      nodes,
      edges,
      selectedId: null,
      selectedEdgeId: null,
      // Undo/redo restore the same diagram in place, so they keep the viewport.
      fitSignal: fit ? get().fitSignal + 1 : get().fitSignal,
    });
  },

  attachSession: async (id, view) => {
    set({ sessionId: id, canUndo: view.can_undo, canRedo: view.can_redo });
    // A foreign import arrives with only the coarse server fallback layout.
    // Recompute a proper one with ELK over the real node sizes, then persist it
    // so the baseline (and any later edit) builds on these coordinates.
    let network = view.network;
    let persist = false;
    if (network.needs_layout && !get().readOnly) {
      try {
        network = await elkLayout(network);
        persist = true;
      } catch (err) {
        console.error("ELK layout failed; keeping server layout", err);
      }
    }
    get().loadNetwork(network, view.foreign);
    if (persist) {
      for (const n of get().nodes) {
        if (!serverIds.has(n.id) || n.type === "foreign") continue;
        const payload: Record<string, unknown> = {
          id: n.id,
          kind: n.type,
          x: n.position.x,
          y: n.position.y,
        };
        if (n.type === "bus" && n.width !== undefined) payload.width = n.width;
        enqueue({ op: "set_layout", payload });
      }
      void flushPending();
    }
  },

  setHistory: (canUndo, canRedo) => set({ canUndo, canRedo }),

  undo: async () => {
    const { sessionId: id, readOnly } = get();
    if (!id || readOnly) return;
    await flushPending();
    try {
      const view = await undoApi(id);
      get().loadNetwork(view.network, view.foreign, { fit: false });
      set({ canUndo: view.can_undo, canRedo: view.can_redo });
    } catch (err) {
      toast.error(`Undo failed: ${(err as Error).message}`);
    }
  },

  redo: async () => {
    const { sessionId: id, readOnly } = get();
    if (!id || readOnly) return;
    await flushPending();
    try {
      const view = await redoApi(id);
      get().loadNetwork(view.network, view.foreign, { fit: false });
      set({ canUndo: view.can_undo, canRedo: view.can_redo });
    } catch (err) {
      toast.error(`Redo failed: ${(err as Error).message}`);
    }
  },

  resyncFromServer: async () => {
    const id = get().sessionId;
    if (!id) return;
    await flushPending();
    try {
      const view = await getView(id);
      get().loadNetwork(view.network, view.foreign);
      set({ canUndo: view.can_undo, canRedo: view.can_redo });
    } catch (err) {
      toast.error(`Sync failed: ${(err as Error).message}`);
    }
  },

  resetNetwork: () => {
    resetServerIds([]);
    set((s) => ({
      networkName: DEFAULT_SCENARIO_NAME,
      f_hz: 50.0,
      sn_mva: 1.0,
      nodes: [],
      edges: [],
      selectedId: null,
      selectedEdgeId: null,
      fitSignal: s.fitSignal + 1,
    }));
  },
}));

// Surface command-sync failures and keep undo/redo availability current (the
// session id is read from this store).
configureSync({
  sessionId: () => useEditor.getState().sessionId,
  onError: (message) => toast.error(message),
  onHistory: (canUndo, canRedo) =>
    useEditor.getState().setHistory(canUndo, canRedo),
  onConflict: () => void useEditor.getState().resyncFromServer(),
});
