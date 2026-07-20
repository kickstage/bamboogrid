import { useEffect } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import { useComputedColorScheme } from "@mantine/core";
import "@xyflow/react/dist/style.css";
import "../canvas/handles.css";

import { edgeTypes } from "../edges";
import { nodeTypes } from "../nodes";
import { useEditor } from "../store";
import type { ViewModel } from "../types";
import { BambooGridBadge } from "./BambooGridBadge";

interface Props {
  view: ViewModel;
  name: string;
  shareToken: string | null;
  showControls: boolean;
}

export function EmbedViewer({ view, name, shareToken, showControls }: Props) {
  const { fitView } = useReactFlow();
  const colorScheme = useComputedColorScheme("light");
  const { nodes, edges, loadNetwork } = useEditor();

  useEffect(() => {
    loadNetwork(view.network, view.foreign);
  }, [view, loadNetwork]);

  useEffect(() => {
    if (nodes.length === 0) return;
    const t = setTimeout(
      () => fitView({ padding: 0.15, duration: 300, maxZoom: 1.2 }),
      100,
    );
    return () => clearTimeout(t);
  }, [fitView, nodes.length]);

  const editUrl = shareToken
    ? `${window.location.origin}/?s=${shareToken}`
    : window.location.origin;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        colorMode={colorScheme}
        defaultEdgeOptions={{ type: "wire" }}
        minZoom={0.05}
        maxZoom={4}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        {showControls && <Controls showInteractive={false} />}
      </ReactFlow>
      <BambooGridBadge editUrl={editUrl} name={name} />
    </div>
  );
}
