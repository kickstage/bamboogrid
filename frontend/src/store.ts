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
  GeneratorData,
  LoadData,
  LoadFlowResult,
  Network,
  SgenData,
  SwitchData,
  Trafo2WData,
  Trafo3WData,
} from "./types";

export const DEFAULT_TRAFO_STD = "0.25 MVA 20/0.4 kV";
export const DEFAULT_TRAFO3W_STD = "63/25/38 MVA 110/20/10 kV";

export type ElementNode = Node<ElementData>;

const newId = () => crypto.randomUUID();

function defaultData(kind: ElementKind): ElementData {
  switch (kind) {
    case "bus":
      return { name: "Bus bar", vn_kv: 0.4 } satisfies BusData;
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
      return { name: "External grid", vm_pu: 1.0, va_degree: 0.0 } satisfies ExtGridData;
    case "load":
      return { name: "Load", p_mw: 0.01, q_mvar: 0.0 } satisfies LoadData;
    case "switch":
      return { name: "Switch", closed: true } satisfies SwitchData;
    case "trafo2w":
      return { name: "Transformer", std_type: DEFAULT_TRAFO_STD } satisfies Trafo2WData;
    case "trafo3w":
      return {
        name: "3W Transformer",
        std_type: DEFAULT_TRAFO3W_STD,
      } satisfies Trafo3WData;
  }
}

interface EditorState {
  networkId: string | null;
  networkName: string;
  nodes: ElementNode[];
  edges: Edge[];
  selectedId: string | null;
  message: string;
  showResults: boolean;
  // Bumped whenever a network is loaded, so the canvas can re-fit the view.
  fitSignal: number;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: ElementKind, position: XYPosition) => void;
  updateNodeData: (id: string, patch: Partial<ElementData>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  // Set (or clear, with null) a wire's routing waypoint — a draggable point the
  // line is computed through. Purely visual; ignored by the load-flow converter.
  setEdgeWaypoint: (id: string, point: { x: number; y: number } | null) => void;
  select: (id: string | null) => void;
  setNetworkName: (name: string) => void;
  setMessage: (message: string) => void;
  setShowResults: (show: boolean) => void;
  applyResults: (result: LoadFlowResult) => void;
  clearResults: () => void;
  toNetwork: () => Network;
  loadNetwork: (network: Network) => void;
}

// A component (generator/load) has at most one wire, to its bus.
function edgeForComponent(componentId: string, edges: Edge[]): Edge | undefined {
  return edges.find((e) => e.source === componentId);
}

function waypointOf(edge: Edge | undefined): { x: number; y: number } | null {
  const wp = (edge?.data as { waypoint?: { x: number; y: number } } | undefined)
    ?.waypoint;
  return wp ?? null;
}

export const useEditor = create<EditorState>((set, get) => ({
  networkId: null,
  networkName: "Untitled network",
  nodes: [],
  edges: [],
  selectedId: null,
  message: "",
  showResults: true,
  fitSignal: 0,

  onNodesChange: (changes) =>
    set({ nodes: applyNodeChanges(changes, get().nodes) as ElementNode[] }),

  onEdgesChange: (changes) =>
    set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (connection) =>
    set((s) => {
      // Each source port carries at most one wire: drop any existing wire from
      // the same source handle before adding, so a load/generator can't fan
      // out to two buses (and a transformer winding stays single).
      const handle = connection.sourceHandle ?? null;
      const filtered = s.edges.filter(
        (e) => !(e.source === connection.source && (e.sourceHandle ?? null) === handle),
      );
      return { edges: addEdge({ ...connection, type: "wire" }, filtered) };
    }),

  addNode: (kind, position) =>
    set((s) => ({
      nodes: [
        ...s.nodes,
        {
          id: newId(),
          type: kind,
          position,
          data: defaultData(kind),
          // Give buses a resizable initial length.
          ...(kind === "bus" ? { width: BUS_DEFAULT_WIDTH } : {}),
        },
      ],
    })),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    })),

  removeNode: (id) =>
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      // Drop any wires touching the removed node.
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  removeEdge: (id) =>
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id) })),

  setEdgeWaypoint: (id, point) =>
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === id
          ? { ...e, data: { ...e.data, waypoint: point ?? undefined } }
          : e,
      ),
    })),

  select: (id) => set({ selectedId: id }),
  setNetworkName: (name) => set({ networkName: name }),
  setMessage: (message) => set({ message }),
  setShowResults: (show) => set({ showResults: show }),

  applyResults: (result) =>
    set((s) => {
      const byBus = new Map(result.res_bus.map((r) => [r.id, r]));
      const byGen = new Map(result.res_gen.map((r) => [r.id, r]));
      const bySgen = new Map(result.res_sgen.map((r) => [r.id, r]));
      const byExtGrid = new Map(result.res_ext_grid.map((r) => [r.id, r]));
      const byTrafo = new Map(
        [...result.res_trafo, ...result.res_trafo3w].map((r) => [r.id, r]),
      );
      // On a failed run, clear stale values instead of showing the last
      // successful result (which would be misleading). Unsupplied buses come
      // back as null — also treated as "no result".
      return {
        message: result.converged
          ? "Load flow converged."
          : `Did not converge: ${result.message}`,
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
          if (n.type === "trafo2w" || n.type === "trafo3w") {
            const r = result.converged ? byTrafo.get(n.id) : undefined;
            return {
              ...n,
              data: {
                ...(n.data as Trafo2WData),
                res_loading_percent: r?.loading_percent ?? undefined,
                res_p_mw: r?.p_mw ?? undefined,
              },
            } as ElementNode;
          }
          return n;
        }),
      };
    }),

  clearResults: () =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.type === "bus")
          return {
            ...n,
            data: { ...(n.data as BusData), vm_pu: undefined, va_degree: undefined },
          } as ElementNode;
        if (n.type === "generator")
          return {
            ...n,
            data: { ...(n.data as GeneratorData), res_p_mw: undefined, res_q_mvar: undefined },
          } as ElementNode;
        if (n.type === "sgen" || n.type === "extgrid")
          return {
            ...n,
            data: { ...(n.data as SgenData | ExtGridData), res_p_mw: undefined, res_q_mvar: undefined },
          } as ElementNode;
        if (n.type === "trafo2w" || n.type === "trafo3w")
          return {
            ...n,
            data: {
              ...(n.data as Trafo2WData),
              res_loading_percent: undefined,
              res_p_mw: undefined,
            },
          } as ElementNode;
        return n;
      }),
    })),

  toNetwork: () => {
    const { nodes, edges, networkId, networkName } = get();
    const buses = nodes
      .filter((n) => n.type === "bus")
      .map((n) => {
        const d = n.data as BusData;
        return {
          id: n.id,
          name: d.name,
          vn_kv: d.vn_kv,
          x: n.position.x,
          y: n.position.y,
          width: n.width ?? BUS_DEFAULT_WIDTH,
        };
      });
    const generators = nodes
      .filter((n) => n.type === "generator")
      .map((n) => {
        const d = n.data as GeneratorData;
        const edge = edgeForComponent(n.id, edges);
        return {
          id: n.id,
          name: d.name,
          bus_id: edge?.target ?? "",
          p_mw: d.p_mw,
          vm_pu: d.vm_pu,
          slack: d.slack,
          slack_weight: d.slack_weight,
          port: edge?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
          waypoint: waypointOf(edge),
        };
      });
    const sgens = nodes
      .filter((n) => n.type === "sgen")
      .map((n) => {
        const d = n.data as SgenData;
        const edge = edgeForComponent(n.id, edges);
        return {
          id: n.id,
          name: d.name,
          bus_id: edge?.target ?? "",
          p_mw: d.p_mw,
          q_mvar: d.q_mvar,
          port: edge?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
          waypoint: waypointOf(edge),
        };
      });
    const extGrids = nodes
      .filter((n) => n.type === "extgrid")
      .map((n) => {
        const d = n.data as ExtGridData;
        const edge = edgeForComponent(n.id, edges);
        return {
          id: n.id,
          name: d.name,
          bus_id: edge?.target ?? "",
          vm_pu: d.vm_pu,
          va_degree: d.va_degree,
          port: edge?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
          waypoint: waypointOf(edge),
        };
      });
    const loads = nodes
      .filter((n) => n.type === "load")
      .map((n) => {
        const d = n.data as LoadData;
        const edge = edgeForComponent(n.id, edges);
        return {
          id: n.id,
          name: d.name,
          bus_id: edge?.target ?? "",
          p_mw: d.p_mw,
          q_mvar: d.q_mvar,
          port: edge?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
          waypoint: waypointOf(edge),
        };
      });
    const switches = nodes
      .filter((n) => n.type === "switch")
      .map((n) => {
        const d = n.data as SwitchData;
        // The two wires are distinguished by their source handle id ("a"/"b").
        const edgeA = edges.find((e) => e.source === n.id && e.sourceHandle === "a");
        const edgeB = edges.find((e) => e.source === n.id && e.sourceHandle === "b");
        return {
          id: n.id,
          name: d.name,
          bus_a: edgeA?.target ?? "",
          bus_b: edgeB?.target ?? "",
          closed: d.closed,
          port_a: edgeA?.targetHandle ?? "",
          port_b: edgeB?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
        };
      });
    const edgeBy = (nodeId: string, handle: string) =>
      edges.find((e) => e.source === nodeId && e.sourceHandle === handle);
    const transformers2w = nodes
      .filter((n) => n.type === "trafo2w")
      .map((n) => {
        const d = n.data as Trafo2WData;
        const hv = edgeBy(n.id, "hv");
        const lv = edgeBy(n.id, "lv");
        return {
          id: n.id,
          name: d.name,
          hv_bus: hv?.target ?? "",
          lv_bus: lv?.target ?? "",
          std_type: d.std_type,
          port_hv: hv?.targetHandle ?? "",
          port_lv: lv?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
        };
      });
    const transformers3w = nodes
      .filter((n) => n.type === "trafo3w")
      .map((n) => {
        const d = n.data as Trafo3WData;
        const hv = edgeBy(n.id, "hv");
        const mv = edgeBy(n.id, "mv");
        const lv = edgeBy(n.id, "lv");
        return {
          id: n.id,
          name: d.name,
          hv_bus: hv?.target ?? "",
          mv_bus: mv?.target ?? "",
          lv_bus: lv?.target ?? "",
          std_type: d.std_type,
          port_hv: hv?.targetHandle ?? "",
          port_mv: mv?.targetHandle ?? "",
          port_lv: lv?.targetHandle ?? "",
          x: n.position.x,
          y: n.position.y,
        };
      });
    return {
      id: networkId ?? "",
      name: networkName,
      buses,
      generators,
      sgens,
      ext_grids: extGrids,
      loads,
      switches,
      transformers2w,
      transformers3w,
    };
  },

  loadNetwork: (network) => {
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
        data: { name: t.name, std_type: t.std_type },
      });
      if (t.hv_bus) edges.push(windingEdge(t.id, "hv", t.hv_bus, t.port_hv));
      if (t.lv_bus) edges.push(windingEdge(t.id, "lv", t.lv_bus, t.port_lv));
    }
    for (const t of network.transformers3w ?? []) {
      nodes.push({
        id: t.id,
        type: "trafo3w",
        position: { x: t.x, y: t.y },
        data: { name: t.name, std_type: t.std_type },
      });
      if (t.hv_bus) edges.push(windingEdge(t.id, "hv", t.hv_bus, t.port_hv));
      if (t.mv_bus) edges.push(windingEdge(t.id, "mv", t.mv_bus, t.port_mv));
      if (t.lv_bus) edges.push(windingEdge(t.id, "lv", t.lv_bus, t.port_lv));
    }
    // Grow each bus to actually expose the ports we auto-assigned above.
    for (const n of nodes) {
      if (n.type === "bus") {
        const count = portCount.get(n.id);
        if (count) n.width = Math.max(n.width ?? BUS_DEFAULT_WIDTH, widthForPorts(count));
      }
    }
    set({
      networkId: network.id,
      networkName: network.name,
      nodes,
      edges,
      selectedId: null,
      message: "",
      fitSignal: get().fitSignal + 1,
    });
  },
}));
