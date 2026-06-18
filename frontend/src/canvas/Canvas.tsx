import { useCallback, useEffect } from "react";
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
    fitSignal,
  } = useEditor();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const colorScheme = useComputedColorScheme("light");

  // After a network is loaded (import / open), bring it into view.
  useEffect(() => {
    if (!fitSignal) return;
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitSignal, fitView]);

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
      // One wire per source handle (switches have two handles, others one)...
      const sourceTaken = edges.some(
        (e) => e.source === c.source && e.sourceHandle === c.sourceHandle,
      );
      // ...and one wire per bus port (no two elements on the same port).
      const portTaken = edges.some(
        (e) => e.target === c.target && e.targetHandle === c.targetHandle,
      );
      return !sourceTaken && !portTaken;
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
      minZoom={0.05}
      maxZoom={4}
      fitView
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
