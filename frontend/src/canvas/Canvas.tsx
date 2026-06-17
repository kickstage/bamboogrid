import { useCallback } from "react";
import { useComputedColorScheme } from "@mantine/core";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { edgeTypes } from "../edges";
import { nodeTypes } from "../nodes";
import { useEditor } from "../store";
import type { ElementKind } from "../types";

export function Canvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    select,
  } = useEditor();
  const { screenToFlowPosition } = useReactFlow();
  const colorScheme = useComputedColorScheme("light");

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/bamboogrid") as ElementKind;
      if (!kind) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(kind, position);
    },
    [screenToFlowPosition, addNode],
  );

  // Only generators/loads may connect, only into a bus, and a component may
  // attach to a single bus.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = nodes.find((n) => n.id === c.source);
      const target = nodes.find((n) => n.id === c.target);
      if (!source || !target) return false;
      if (target.type !== "bus") return false;
      const connectable = ["generator", "load", "switch"];
      if (!connectable.includes(source.type ?? "")) return false;
      // One wire per handle (switches have two handles, others one).
      const handleTaken = edges.some(
        (e) => e.source === c.source && e.sourceHandle === c.sourceHandle,
      );
      return !handleTaken;
    },
    [nodes, edges],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onNodeClick={(_, node: Node) => select(node.id)}
      onPaneClick={() => select(null)}
      colorMode={colorScheme}
      defaultEdgeOptions={{ type: "wire" }}
      deleteKeyCode={["Backspace", "Delete"]}
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
