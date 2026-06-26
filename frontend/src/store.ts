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

import { BUS_DEFAULT_WIDTH, widthForPorts } from "./nodes/BusNode";
import type {
  BusData,
  ElementData,
  ElementKind,
  ExtGridData,
  ForeignData,
  ForeignElement,
  GeneratorData,
  LineData,
  LoadData,
  LoadFlowResult,
  Network,
  SgenData,
  ShuntData,
  SwitchData,
  Trafo2WData,
  Trafo3WData,
  ViewModel,
  VoltageUnit,
} from "./types";

const VOLTAGE_UNIT_KEY = "bamboogrid:voltageUnit";

function initialVoltageUnit(): VoltageUnit {
  try {
    return localStorage.getItem(VOLTAGE_UNIT_KEY) === "pu" ? "pu" : "kv";
  } catch {
    return "kv";
  }
}
import { getView } from "./api";
import { toast } from "./toast";
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
]);

// Source-handle id of an element's wire -> attachment "end" understood by the
// server connect command. Components have a single (null) handle.
function handleToEnd(handle: string | null | undefined): string {
  return handle ?? "";
}

export const DEFAULT_TRAFO_STD = "0.25 MVA 20/0.4 kV";
export const DEFAULT_TRAFO3W_STD = "63/25/38 MVA 110/20/10 kV";

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
// attributes, never its wires.
export interface ClonePayload {
  type: ElementKind;
  data: ElementData;
  width?: number;
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
  } else {
    delete d.res_p_mw;
    delete d.res_q_mvar;
    delete d.res_loading_percent;
  }
  return d as ElementData;
}

function makeCloneNode(payload: ClonePayload, position: XYPosition): ElementNode {
  return {
    id: newId(),
    type: payload.type,
    position,
    data: withoutResults(payload.type, payload.data),
    ...(payload.width !== undefined ? { width: payload.width } : {}),
  };
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
      } satisfies GeneratorData;
    case "sgen":
      return { name: "Static gen", p_mw: 1.0, q_mvar: 0.0 } satisfies SgenData;
    case "extgrid":
      return {
        name: "External grid",
        vm_pu: 1.0,
        va_degree: 0.0,
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
  // Whether bus voltage results show as kV or per-unit. A view-only preference,
  // persisted to localStorage (not part of the server net).
  voltageUnit: VoltageUnit;
  // Bumped whenever a network is loaded, so the canvas can re-fit the view.
  fitSignal: number;
  // The server session whose authoritative net this editor mirrors.
  sessionId: string | null;
  // When set, every mutating action is a no-op (the mobile read-only demo).
  // Selection, view preferences, and load-flow results still apply.
  readOnly: boolean;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  // Create a bus-to-bus branch from a connection the user drew (chosen explicitly
  // from the canvas "add connection" menu, never inferred).
  addLineBetween: (c: Connection) => void;
  addTransformerBetween: (c: Connection) => void;
  addNode: (kind: ElementKind, position: XYPosition) => void;
  // Clone a node's attributes (results stripped) with none of its wires.
  clipboard: ClonePayload | null;
  copyNode: (id: string) => void;
  // Returns the new node's id (or null if the source is gone).
  duplicateNode: (id: string, delta: XYPosition) => string | null;
  pasteAt: (position: XYPosition) => void;
  updateNodeData: (id: string, patch: Partial<ElementData>) => void;
  updateEdgeData: (id: string, patch: Partial<LineData>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  // Set (or clear, with null) a wire's routing waypoint — a draggable point the
  // line is computed through. Purely visual; ignored by the load-flow converter.
  setEdgeWaypoint: (id: string, point: { x: number; y: number } | null) => void;
  select: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setShowResults: (show: boolean) => void;
  setVoltageUnit: (unit: VoltageUnit) => void;
  setReadOnly: (readOnly: boolean) => void;
  applyResults: (result: LoadFlowResult) => void;
  loadNetwork: (network: Network, foreign?: ForeignElement[]) => void;
  // Bind this editor to a server session and hydrate it from a projection.
  attachSession: (id: string, view: ViewModel) => void;
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
): void {
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
          payload: { id: node.id, kind, end: handleToEnd(handle), bus_id: busId, port },
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

  if (kind === "trafo2w") {
    const hv = wire("hv");
    const lv = wire("lv");
    if (hv?.target && lv?.target) {
      if (known)
        enqueue({
          op: "connect",
          payload: { id: node.id, kind, end: handleToEnd(handle), bus_id: busId, port },
        });
      else {
        enqueue({
          op: "add_transformer",
          payload: {
            id: node.id,
            hv_bus: hv.target,
            lv_bus: lv.target,
            std_type: d.std_type ?? DEFAULT_TRAFO_STD,
            port_hv: hv.targetHandle ?? "",
            port_lv: lv.targetHandle ?? "",
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

  // trafo3w only ever exists via import (already on the server): re-point only.
  if (kind === "trafo3w" && known)
    enqueue({
      op: "connect",
      payload: { id: node.id, kind, end: handleToEnd(handle), bus_id: busId, port },
    });
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
  networkName: "Untitled network",
  f_hz: 50.0,
  sn_mva: 1.0,
  nodes: [],
  edges: [],
  selectedId: null,
  selectedEdgeId: null,
  clipboard: null,
  showResults: true,
  voltageUnit: initialVoltageUnit(),
  fitSignal: 0,
  sessionId: null,
  readOnly: false,

  onNodesChange: (changes) => {
    const nodes = applyNodeChanges(changes, get().nodes) as ElementNode[];
    set({ nodes });
    if (get().readOnly) return;
    // Sync layout for known elements: positions on drop, bus width on resize.
    // Batched in sync.ts so a drag/resize (many changes) sends once.
    for (const ch of changes) {
      if (ch.type === "position" && ch.dragging === false) {
        const n = nodes.find((x) => x.id === ch.id);
        if (n?.type && serverIds.has(n.id) && n.type !== "foreign")
          enqueue({
            op: "set_layout",
            payload: { id: n.id, kind: n.type, x: n.position.x, y: n.position.y },
          });
      } else if (ch.type === "dimensions" && ch.dimensions) {
        const n = nodes.find((x) => x.id === ch.id);
        if (n?.type === "bus" && serverIds.has(n.id))
          enqueue({
            op: "set_layout",
            payload: { id: n.id, kind: "bus", width: n.width ?? ch.dimensions.width },
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
        !(e.source === connection.source && (e.sourceHandle ?? null) === handle),
    );
    const edges = addEdge({ ...connection, type: "wire" }, filtered);
    set({ edges });
    const node = s.nodes.find((n) => n.id === connection.source);
    if (node?.type && connection.target)
      syncAttachment(node, connection.target, connection.targetHandle ?? "", handle, edges);
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
      const id = newId();
      const node: ElementNode = {
        id,
        type: "trafo2w",
        position: midpoint(a, b),
        selected: true,
        data: {
          name: "Transformer",
          std_type: DEFAULT_TRAFO_STD,
        } satisfies Trafo2WData,
      };
      enqueue({
        op: "add_transformer",
        payload: {
          id,
          hv_bus: hvBus,
          lv_bus: lvBus,
          std_type: DEFAULT_TRAFO_STD,
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

  copyNode: (id) =>
    set((s) => {
      const n = s.nodes.find((x) => x.id === id);
      if (!n) return {};
      const name = (n.data as { name?: string }).name ?? n.type;
      toast.info(`Copied ${name}.`);
      return {
        clipboard: {
          type: n.type as ElementKind,
          data: structuredClone(n.data),
          width: n.width,
        },
      };
    }),

  duplicateNode: (id, delta) => {
    if (get().readOnly) return null;
    const n = get().nodes.find((x) => x.id === id);
    if (!n) return null;
    const node = makeCloneNode(
      { type: n.type as ElementKind, data: n.data, width: n.width },
      { x: n.position.x + delta.x, y: n.position.y + delta.y },
    );
    set((s) => ({
      nodes: [...s.nodes, node],
      selectedId: node.id,
      selectedEdgeId: null,
    }));
    syncClonedNode(node);
    return node.id;
  },

  pasteAt: (position) => {
    const { clipboard, readOnly } = get();
    if (readOnly || !clipboard) return;
    const node = makeCloneNode(clipboard, position);
    set((s) => ({
      nodes: [...s.nodes, node],
      selectedId: node.id,
      selectedEdgeId: null,
    }));
    syncClonedNode(node);
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

  select: (id) => set({ selectedId: id, selectedEdgeId: null }),
  selectEdge: (id) => set({ selectedEdgeId: id, selectedId: null }),
  setShowResults: (show) => set({ showResults: show }),
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

  loadNetwork: (network, foreign = []) => {
    const nodes: ElementNode[] = [];
    const edges: Edge[] = [];
    // Spread elements that carry no explicit port (e.g. a plain pandapower
    // import) across distinct bus ports so they don't all snap to the first
    // handle. Files we exported keep their stored ports and aren't counted.
    const portCount = new Map<string, number>();
    const busPort = (busId: string, explicit?: string): string | undefined => {
      if (explicit) return explicit;
      const i = portCount.get(busId) ?? 0;
      portCount.set(busId, i + 1);
      return `p${i}`;
    };
    for (const b of network.buses) {
      nodes.push({
        id: b.id,
        type: "bus",
        position: { x: b.x, y: b.y },
        data: { name: b.name, vn_kv: b.vn_kv },
        width: b.width ?? BUS_DEFAULT_WIDTH,
      });
    }
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
        },
      });
      if (g.bus_id)
        edges.push({
          id: `${g.id}->${g.bus_id}`,
          source: g.id,
          target: g.bus_id,
          targetHandle: busPort(g.bus_id, g.port),
          type: "wire",
          data: g.waypoint ? { waypoint: g.waypoint } : undefined,
        });
    }
    for (const sg of network.sgens ?? []) {
      nodes.push({
        id: sg.id,
        type: "sgen",
        position: { x: sg.x, y: sg.y },
        data: { name: sg.name, p_mw: sg.p_mw, q_mvar: sg.q_mvar },
      });
      if (sg.bus_id)
        edges.push({
          id: `${sg.id}->${sg.bus_id}`,
          source: sg.id,
          target: sg.bus_id,
          targetHandle: busPort(sg.bus_id, sg.port),
          type: "wire",
          data: sg.waypoint ? { waypoint: sg.waypoint } : undefined,
        });
    }
    for (const eg of network.ext_grids ?? []) {
      nodes.push({
        id: eg.id,
        type: "extgrid",
        position: { x: eg.x, y: eg.y },
        data: { name: eg.name, vm_pu: eg.vm_pu, va_degree: eg.va_degree },
      });
      if (eg.bus_id)
        edges.push({
          id: `${eg.id}->${eg.bus_id}`,
          source: eg.id,
          target: eg.bus_id,
          targetHandle: busPort(eg.bus_id, eg.port),
          type: "wire",
          data: eg.waypoint ? { waypoint: eg.waypoint } : undefined,
        });
    }
    for (const l of network.loads) {
      nodes.push({
        id: l.id,
        type: "load",
        position: { x: l.x, y: l.y },
        data: { name: l.name, p_mw: l.p_mw, q_mvar: l.q_mvar },
      });
      if (l.bus_id)
        edges.push({
          id: `${l.id}->${l.bus_id}`,
          source: l.id,
          target: l.bus_id,
          targetHandle: busPort(l.bus_id, l.port),
          type: "wire",
          data: l.waypoint ? { waypoint: l.waypoint } : undefined,
        });
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
      if (sh.bus_id)
        edges.push({
          id: `${sh.id}->${sh.bus_id}`,
          source: sh.id,
          target: sh.bus_id,
          targetHandle: busPort(sh.bus_id, sh.port),
          type: "wire",
        });
    }
    for (const s of network.switches ?? []) {
      nodes.push({
        id: s.id,
        type: "switch",
        position: { x: s.x, y: s.y },
        data: { name: s.name, closed: s.closed },
      });
      if (s.bus_a)
        edges.push({
          id: `${s.id}:a->${s.bus_a}`,
          source: s.id,
          sourceHandle: "a",
          target: s.bus_a,
          targetHandle: busPort(s.bus_a, s.port_a),
          type: "wire",
        });
      if (s.bus_b)
        edges.push({
          id: `${s.id}:b->${s.bus_b}`,
          source: s.id,
          sourceHandle: "b",
          target: s.bus_b,
          targetHandle: busPort(s.bus_b, s.port_b),
          type: "wire",
        });
    }
    // Helper: a transformer winding wire (source handle "hv"/"mv"/"lv" → bus).
    const windingEdge = (
      trafoId: string,
      handle: string,
      busId: string,
      port?: string,
    ) => ({
      id: `${trafoId}:${handle}->${busId}`,
      source: trafoId,
      sourceHandle: handle,
      target: busId,
      targetHandle: busPort(busId, port),
      type: "wire" as const,
    });
    for (const t of network.transformers2w ?? []) {
      nodes.push({
        id: t.id,
        type: "trafo2w",
        position: { x: t.x, y: t.y },
        data: { name: t.name, std_type: t.std_type, params: t.params ?? null },
      });
      if (t.hv_bus) edges.push(windingEdge(t.id, "hv", t.hv_bus, t.port_hv));
      if (t.lv_bus) edges.push(windingEdge(t.id, "lv", t.lv_bus, t.port_lv));
    }
    for (const t of network.transformers3w ?? []) {
      nodes.push({
        id: t.id,
        type: "trafo3w",
        position: { x: t.x, y: t.y },
        data: { name: t.name, std_type: t.std_type, params: t.params ?? null },
      });
      if (t.hv_bus) edges.push(windingEdge(t.id, "hv", t.hv_bus, t.port_hv));
      if (t.mv_bus) edges.push(windingEdge(t.id, "mv", t.mv_bus, t.port_mv));
      if (t.lv_bus) edges.push(windingEdge(t.id, "lv", t.lv_bus, t.port_lv));
    }
    // Lines are bus → bus edges (no node body); they carry their electrical
    // params as edge data so they round-trip and solve.
    for (const l of network.lines ?? []) {
      if (!l.from_bus || !l.to_bus) continue;
      edges.push({
        id: l.id,
        source: l.from_bus,
        sourceHandle: busPort(l.from_bus, l.port_from),
        target: l.to_bus,
        targetHandle: busPort(l.to_bus, l.port_to),
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
      });
    }
    // Grow each bus to actually expose the ports we auto-assigned above.
    for (const n of nodes) {
      if (n.type === "bus") {
        const count = portCount.get(n.id);
        if (count)
          n.width = Math.max(
            n.width ?? BUS_DEFAULT_WIDTH,
            widthForPorts(count),
          );
      }
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
      fitSignal: get().fitSignal + 1,
    });
  },

  attachSession: (id, view) => {
    set({ sessionId: id });
    get().loadNetwork(view.network, view.foreign);
  },

  resyncFromServer: async () => {
    const id = get().sessionId;
    if (!id) return;
    await flushPending();
    try {
      const view = await getView(id);
      get().loadNetwork(view.network, view.foreign);
    } catch (err) {
      toast.error(`Sync failed: ${(err as Error).message}`);
    }
  },

  resetNetwork: () => {
    resetServerIds([]);
    set((s) => ({
      networkName: "Untitled network",
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

// Surface command-sync failures (the session id is read from this store).
configureSync({
  sessionId: () => useEditor.getState().sessionId,
  onError: (message) => toast.error(message),
});
