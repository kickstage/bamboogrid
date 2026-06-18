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

import { BUS_DEFAULT_WIDTH } from "./nodes/BusNode";
import type {
  BusData,
  ElementData,
  ElementKind,
  GeneratorData,
  LoadData,
  LoadFlowResult,
  Network,
  SwitchData,
} from "./types";

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
    case "load":
      return { name: "Load", p_mw: 0.01, q_mvar: 0.0 } satisfies LoadData;
    case "switch":
      return { name: "Switch", closed: true } satisfies SwitchData;
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
  setNetworkId: (id: string) => void;
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
    set({ edges: addEdge({ ...connection, type: "wire" }, get().edges) }),

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
  setNetworkId: (id) => set({ networkId: id }),
  setMessage: (message) => set({ message }),
  setShowResults: (show) => set({ showResults: show }),

  applyResults: (result) =>
    set((s) => {
      const byBus = new Map(result.res_bus.map((r) => [r.id, r]));
      const byGen = new Map(result.res_gen.map((r) => [r.id, r]));
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
    return {
      id: networkId ?? "",
      name: networkName,
      buses,
      generators,
      loads,
      switches,
    };
  },

  loadNetwork: (network) => {
    const nodes: ElementNode[] = [];
    const edges: Edge[] = [];
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
          targetHandle: g.port || undefined,
          type: "wire",
          data: g.waypoint ? { waypoint: g.waypoint } : undefined,
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
          targetHandle: l.port || undefined,
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
          targetHandle: s.port_a || undefined,
          type: "wire",
        });
      if (s.bus_b)
        edges.push({
          id: `${s.id}:b->${s.bus_b}`,
          source: s.id,
          sourceHandle: "b",
          target: s.bus_b,
          targetHandle: s.port_b || undefined,
          type: "wire",
        });
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
