import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Paper, Stack, Text, useComputedColorScheme } from "@mantine/core";
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { edgeTypes } from "../edges";
import { nodeTypes } from "../nodes";
import { useEditor } from "../store";
import type { BusData, ElementKind } from "../types";

// The "add connection" menu shown after a bus → bus drag: the user explicitly
// picks the branch type (we never infer it). Same-voltage buses take a line;
// different voltages need a transformer.
type BranchMenu = { conn: Connection; x: number; y: number; sameVoltage: boolean };

// Elements that attach to a bus. Every attachment edge is stored element→bus
// (source = element, target = bus port), but the user may draw it from either
// end, so attachments are normalized to that orientation before use.
const ATTACHABLE = ["generator", "sgen", "extgrid", "load", "shunt", "switch", "trafo2w", "trafo3w"];

// Given a connection and the node lookup, return it oriented element→bus, or
// null if it isn't a valid element↔bus attachment. Handles both drag directions.
function asAttachment(
  c: Connection | Edge,
  nodeType: (id: string) => string | undefined,
): Connection | null {
  const s = nodeType(c.source);
  const t = nodeType(c.target);
  if (t === "bus" && ATTACHABLE.includes(s ?? ""))
    return {
      source: c.source,
      sourceHandle: c.sourceHandle ?? null,
      target: c.target,
      targetHandle: c.targetHandle ?? null,
    };
  if (s === "bus" && ATTACHABLE.includes(t ?? ""))
    return {
      source: c.target,
      sourceHandle: c.targetHandle ?? null,
      target: c.source,
      targetHandle: c.sourceHandle ?? null,
    };
  return null;
}

export function Canvas() {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addLineBetween,
    addTransformerBetween,
    addNode,
    select,
    selectEdge,
    setMessage,
    fitSignal,
  } = useEditor();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const colorScheme = useComputedColorScheme("light");

  // A bus→bus connection in progress: stashed on connect, turned into the menu on
  // connect-end (which carries the drop position).
  const pendingConn = useRef<Connection | null>(null);
  const [menu, setMenu] = useState<BranchMenu | null>(null);

  // After a network is loaded (import / open), bring it into view.
  useEffect(() => {
    if (!fitSignal) return;
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitSignal, fitView]);

  // Close the menu on Escape.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

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

  // An element → bus attachment connects immediately. A bus → bus connection is
  // held back so connect-end can open the explicit branch-type menu.
  const handleConnect = useCallback(
    (c: Connection) => {
      const nodeType = (id: string) => nodes.find((n) => n.id === id)?.type;
      if (nodeType(c.source) === "bus" && nodeType(c.target) === "bus") {
        pendingConn.current = c;
        return;
      }
      // Attachments may be drawn bus → element; store them element → bus.
      const attachment = asAttachment(c, nodeType);
      if (attachment) onConnect(attachment);
    },
    [nodes, onConnect],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      const c = pendingConn.current;
      pendingConn.current = null;
      // Bus → bus: open the explicit branch-type menu at the drop point.
      if (c) {
        const source = nodes.find((n) => n.id === c.source);
        const target = nodes.find((n) => n.id === c.target);
        if (!source || !target) return;
        const vS = (source.data as BusData).vn_kv;
        const vT = (target.data as BusData).vn_kv;
        const pt = "clientX" in event ? event : event.changedTouches[0];
        setMenu({
          conn: c,
          x: pt.clientX,
          y: pt.clientY,
          sameVoltage: Math.abs(vS - vT) < 1e-9,
        });
        return;
      }
      // Dropped on another node that's neither a bus → bus branch nor a valid
      // element ↔ bus attachment (e.g. a switch onto a load): everything connects
      // through a bus, so explain why it was rejected.
      if (conn.fromNode && conn.toNode) {
        const nodeType = (id: string) =>
          nodes.find((n) => n.id === id)?.type;
        const bothBus =
          conn.fromNode.type === "bus" && conn.toNode.type === "bus";
        const isAttachment = asAttachment(
          {
            source: conn.fromNode.id,
            sourceHandle: conn.fromHandle?.id ?? null,
            target: conn.toNode.id,
            targetHandle: conn.toHandle?.id ?? null,
          },
          nodeType,
        );
        if (!bothBus && !isAttachment) {
          setMessage(
            "Connections must go through a bus — attach to a bus, not directly to another element.",
          );
        }
      }
    },
    [nodes, setMessage],
  );

  const choose = (make: (c: Connection) => void) => {
    if (menu) make(menu.conn);
    setMenu(null);
  };

  // Two valid gestures: an element handle → a bus (attachment), or a bus → a bus
  // (a branch the user then picks from the menu). Every bus port holds one wire.
  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const source = nodes.find((n) => n.id === c.source);
      const target = nodes.find((n) => n.id === c.target);
      if (!source || !target || source.id === target.id) return false;
      const portTaken = (nodeId: string, handle?: string | null) =>
        edges.some(
          (e) =>
            (e.source === nodeId && e.sourceHandle === handle) ||
            (e.target === nodeId && e.targetHandle === handle),
        );
      // Bus → bus branch: each end takes a free bus port.
      if (source.type === "bus" && target.type === "bus") {
        return (
          !portTaken(source.id, c.sourceHandle) &&
          !portTaken(target.id, c.targetHandle)
        );
      }
      // Element ↔ bus attachment, drawn from either end. Normalize to element →
      // bus, then check the element's wire port and the bus port are both free.
      const a = asAttachment(c, (id) => nodes.find((n) => n.id === id)?.type);
      if (!a) return false;
      const sourceTaken = edges.some(
        (e) => e.source === a.source && e.sourceHandle === a.sourceHandle,
      );
      const targetPortTaken = edges.some(
        (e) => e.target === a.target && e.targetHandle === a.targetHandle,
      );
      return !sourceTaken && !targetPortTaken;
    },
    [nodes, edges],
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_, node: Node) => select(node.id)}
        onEdgeClick={(_, edge: Edge) =>
          edge.type === "line" ? selectEdge(edge.id) : select(null)
        }
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

      {menu && (
        <>
          {/* Click-away backdrop. */}
          <div
            onClick={() => setMenu(null)}
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
          />
          <Paper
            shadow="md"
            withBorder
            p={4}
            style={{
              position: "fixed",
              left: menu.x,
              top: menu.y,
              zIndex: 11,
              minWidth: 180,
            }}
          >
            <Text size="xs" c="dimmed" px="xs" pt={4} pb={2}>
              Connect buses with…
            </Text>
            <Stack gap={2}>
              {menu.sameVoltage ? (
                <Button variant="subtle" size="xs" justify="flex-start" onClick={() => choose(addLineBetween)}>
                  Line — carries power (impedance)
                </Button>
              ) : (
                <Button variant="subtle" size="xs" justify="flex-start" onClick={() => choose(addTransformerBetween)}>
                  Transformer — across voltage levels
                </Button>
              )}
            </Stack>
          </Paper>
        </>
      )}
    </div>
  );
}
