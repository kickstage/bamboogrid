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
} from "./types";

export type ElementNode = Node<ElementData>;

const newId = () => crypto.randomUUID();

function defaultData(kind: ElementKind): ElementData {
  switch (kind) {
    case "bus":
      return { name: "Bus", vn_kv: 0.4 } satisfies BusData;
    case "generator":
      return { name: "Generator", vm_pu: 1.0 } satisfies GeneratorData;
    case "load":
      return { name: "Load", p_mw: 0.01, q_mvar: 0.0 } satisfies LoadData;
  }
}

interface EditorState {
  networkId: string | null;
  networkName: string;
  nodes: ElementNode[];
  edges: Edge[];
  selectedId: string | null;
  message: string;

  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: ElementKind, position: XYPosition) => void;
  updateNodeData: (id: string, patch: Partial<ElementData>) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  select: (id: string | null) => void;
  setNetworkName: (name: string) => void;
  setNetworkId: (id: string) => void;
  setMessage: (message: string) => void;
  applyResults: (result: LoadFlowResult) => void;
  clearResults: () => void;
  toNetwork: () => Network;
  loadNetwork: (network: Network) => void;
}

// Only generators/loads may connect, and only into a bus.
function busIdForComponent(componentId: string, edges: Edge[]): string {
  const edge = edges.find((e) => e.source === componentId);
  return edge ? edge.target : "";
}

export const useEditor = create<EditorState>((set, get) => ({
  networkId: null,
  networkName: "Untitled network",
  nodes: [],
  edges: [],
  selectedId: null,
  message: "",

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

  select: (id) => set({ selectedId: id }),
  setNetworkName: (name) => set({ networkName: name }),
  setNetworkId: (id) => set({ networkId: id }),
  setMessage: (message) => set({ message }),

  applyResults: (result) =>
    set((s) => {
      const byBus = new Map(result.res_bus.map((r) => [r.id, r]));
      return {
        message: result.converged
          ? "Load flow converged."
          : `Did not converge: ${result.message}`,
        nodes: s.nodes.map((n) => {
          if (n.type !== "bus") return n;
          // On a failed run, clear stale values instead of showing the last
          // successful result, which would be misleading.
          const r = result.converged ? byBus.get(n.id) : undefined;
          return {
            ...n,
            data: {
              ...(n.data as BusData),
              vm_pu: r?.vm_pu,
              va_degree: r?.va_degree,
            },
          } as ElementNode;
        }),
      };
    }),

  clearResults: () =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.type === "bus"
          ? ({
              ...n,
              data: { ...(n.data as BusData), vm_pu: undefined, va_degree: undefined },
            } as ElementNode)
          : n,
      ),
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
        return {
          id: n.id,
          name: d.name,
          bus_id: busIdForComponent(n.id, edges),
          vm_pu: d.vm_pu,
          x: n.position.x,
          y: n.position.y,
        };
      });
    const loads = nodes
      .filter((n) => n.type === "load")
      .map((n) => {
        const d = n.data as LoadData;
        return {
          id: n.id,
          name: d.name,
          bus_id: busIdForComponent(n.id, edges),
          p_mw: d.p_mw,
          q_mvar: d.q_mvar,
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
        data: { name: g.name, vm_pu: g.vm_pu },
      });
      if (g.bus_id)
        edges.push({ id: `${g.id}->${g.bus_id}`, source: g.id, target: g.bus_id, type: "wire" });
    }
    for (const l of network.loads) {
      nodes.push({
        id: l.id,
        type: "load",
        position: { x: l.x, y: l.y },
        data: { name: l.name, p_mw: l.p_mw, q_mvar: l.q_mvar },
      });
      if (l.bus_id)
        edges.push({ id: `${l.id}->${l.bus_id}`, source: l.id, target: l.bus_id, type: "wire" });
    }
    set({
      networkId: network.id,
      networkName: network.name,
      nodes,
      edges,
      selectedId: null,
      message: "",
    });
  },
}));
