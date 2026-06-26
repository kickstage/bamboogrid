import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Modal,
  Paper,
  Stack,
  Text,
  useComputedColorScheme,
} from "@mantine/core";
import {
  Background,
  ConnectionMode,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { edgeTypes } from "../edges";
import { nodeTypes } from "../nodes";
import { useEditor } from "../store";
import { toast } from "../toast";
import { elementInjection, type BusInjection } from "../power";
import { PowerTriangle } from "../diagrams/PowerTriangle";
import { Waveforms } from "../diagrams/Waveforms";
import { NodeContextMenu, type BusGraphKind } from "./NodeContextMenu";
import type { BusData, ElementKind } from "../types";

// The "add connection" menu shown after a bus → bus drag: the user explicitly
// picks the branch type (we never infer it). Same-voltage buses take a line;
// different voltages need a transformer.
type BranchMenu = { conn: Connection; x: number; y: number; sameVoltage: boolean };

// Elements that attach to a bus. Every attachment edge is stored element→bus
// (source = element, target = bus port), but the user may draw it from either
// end, so attachments are normalized to that orientation before use.
const ATTACHABLE = ["generator", "sgen", "extgrid", "load", "shunt", "switch", "trafo2w", "trafo3w"];

// Elements whose own injected/absorbed power is meaningful on its own, so the
// power-triangle / waveform graphs hang off their context menu (a transit bus
// has no net injection of its own).
const GRAPHABLE = new Set(["generator", "sgen", "extgrid", "load"]);

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
    selectOnly,
    fitSignal,
    focusRequest,
    clipboard,
    copySelection,
    duplicateSelection,
    duplicateForDrag,
    pasteAt,
    readOnly,
    undo,
    redo,
  } = useEditor();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const colorScheme = useComputedColorScheme("light");

  // A bus→bus connection in progress: stashed on connect, turned into the menu on
  // connect-end (which carries the drop position).
  const pendingConn = useRef<Connection | null>(null);
  const [menu, setMenu] = useState<BranchMenu | null>(null);
  // Right-click-an-element menu (duplicate/copy, plus the bus graph submenu), the
  // diagram it opens, and the right-click-empty-pane paste menu.
  const [nodeMenu, setNodeMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const [pasteMenu, setPasteMenu] = useState<{ x: number; y: number } | null>(null);
  // Right-click-an-edge menu (delete a line or wire).
  const [edgeMenu, setEdgeMenu] = useState<{
    x: number;
    y: number;
    edgeId: string;
  } | null>(null);
  const [graph, setGraph] = useState<{ kind: BusGraphKind; inj: BusInjection } | null>(
    null,
  );
  // The graphs hang off an injecting element's menu. `nodeMenuGraphable` decides
  // whether to offer them at all; `nodeMenuInj` is null until a load flow has
  // produced the element's power (loads use their input, so are always ready).
  const nodeMenuNode = nodeMenu
    ? nodes.find((n) => n.id === nodeMenu.nodeId)
    : undefined;
  const nodeMenuGraphable = nodeMenuNode
    ? GRAPHABLE.has(nodeMenuNode.type as string)
    : false;
  const nodeMenuInj = nodeMenuNode ? elementInjection(nodeMenuNode) : null;
  // Last cursor position over the pane (screen coords) — where Cmd/Ctrl+V drops.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // An in-progress modifier-drag: each grabbed (selected) node spawned a detached
  // clone, and the drag is redirected onto those clones (originalId → cloneId) so
  // the originals stay put with their wires.
  const cloneDrag = useRef<Map<string, string> | null>(null);

  // After a network is loaded (import / open), bring it into view.
  useEffect(() => {
    if (!fitSignal) return;
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitSignal, fitView]);

  // Pan/zoom onto the elements a reveal requested (e.g. a diagnostic chip).
  useEffect(() => {
    if (!focusRequest || focusRequest.ids.length === 0) return;
    fitView({
      nodes: focusRequest.ids.map((id) => ({ id })),
      padding: 0.6,
      duration: 400,
      maxZoom: 1.5,
    });
  }, [focusRequest, fitView]);

  // Close the open floating menus on Escape.
  useEffect(() => {
    if (!menu && !nodeMenu && !pasteMenu && !edgeMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenu(null);
      setNodeMenu(null);
      setPasteMenu(null);
      setEdgeMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, nodeMenu, pasteMenu, edgeMenu]);

  // Cmd/Ctrl+C copies the selected element; Cmd/Ctrl+V pastes a clone at the
  // cursor (or offset, if the pointer hasn't been over the pane). Skipped while a
  // form field is focused so normal text copy/paste keeps working.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement;
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (inField) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        // Cmd/Ctrl+Z undoes; adding Shift redoes (the platform-standard pairing,
        // alongside Ctrl+Y below).
        e.preventDefault();
        if (e.shiftKey) void redo();
        else void undo();
      } else if (key === "y") {
        e.preventDefault();
        void redo();
      } else if (key === "c") {
        // Don't hijack a real text selection elsewhere on the page — let the
        // browser copy that text rather than the selected canvas element.
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return;
        e.preventDefault();
        copySelection();
      } else if (key === "v" && clipboard) {
        e.preventDefault();
        const at = pointer.current
          ? screenToFlowPosition(pointer.current)
          : screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
        pasteAt(at);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clipboard, copySelection, pasteAt, screenToFlowPosition, undo, redo]);

  // Backspace/Delete removal goes through the store (which enqueues the server
  // command) rather than React Flow's built-in delete, which only mutates local
  // state and would silently drop the edit on reload.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      const el = document.activeElement;
      const inField =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (inField) return;
      const s = useEditor.getState();
      const selEdges = s.edges.filter((ed) => ed.selected).map((ed) => ed.id);
      const selNodes = s.nodes.filter((n) => n.selected).map((n) => n.id);
      if (selEdges.length === 0 && selNodes.length === 0) return;
      e.preventDefault();
      // Edges before nodes, so a line is dropped before a bus it hangs off of
      // cascades on the server (avoids deleting an already-cascaded line).
      for (const id of selEdges) s.removeEdge(id);
      for (const id of selNodes) s.removeNode(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // During a modifier-drag, rewrite the grabbed node's position changes onto its
  // clone so the clone follows the cursor while the original (with its wires)
  // stays where it is.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const cd = cloneDrag.current;
      if (cd) {
        let ended = false;
        changes = changes.map((ch) => {
          if (ch.type === "position" && cd.has(ch.id)) {
            if (ch.dragging === false) ended = true;
            return { ...ch, id: cd.get(ch.id)! };
          }
          return ch;
        });
        // Clear only after redirecting the final (dragging:false) change, so the
        // drop never leaks through to the originals.
        if (ended) cloneDrag.current = null;
      }
      onNodesChange(changes);
    },
    [onNodesChange],
  );

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
          toast.info(
            "Connections must go through a bus — attach to a bus, not directly to another element.",
          );
        }
      }
    },
    [nodes],
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
    <div
      style={{ width: "100%", height: "100%", position: "relative" }}
      // Suppress the native context menu canvas-wide; only our own right-click
      // menus should appear.
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        // Read-only (mobile demo): navigate and select, but no edits.
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_, node: Node) => select(node.id)}
        // Alt/Cmd-drag a node to drag a detached clone of it, leaving the
        // original (and its wires) in place. The clone spawns on top of the
        // original; handleNodesChange redirects the drag onto it.
        onNodeDragStart={(e, node: Node) => {
          if (readOnly || !(e.altKey || e.metaKey)) return;
          // Alt/Cmd-dragging a node outside the current selection grabs just it;
          // dragging one within a multi-selection clones the whole selection.
          if (!node.selected) selectOnly(node.id);
          const pairs = duplicateForDrag();
          if (pairs.length > 0)
            cloneDrag.current = new Map(
              pairs.map((p) => [p.originalId, p.cloneId]),
            );
        }}
        onNodeDragStop={() => {
          // Defer: the final position change may arrive right after this, and it
          // still needs redirecting onto the clone.
          setTimeout(() => {
            cloneDrag.current = null;
          }, 0);
        }}
        onNodeContextMenu={(e, node: Node) => {
          e.preventDefault();
          // Keep an existing multi-selection if right-clicking inside it;
          // otherwise the clicked node becomes the sole selection.
          if (node.selected) select(node.id);
          else selectOnly(node.id);
          if (readOnly) return;
          setMenu(null);
          setPasteMenu(null);
          setNodeMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          if (readOnly) return;
          setMenu(null);
          setNodeMenu(null);
          const me = e as React.MouseEvent;
          setPasteMenu({ x: me.clientX, y: me.clientY });
        }}
        onEdgeClick={(_, edge: Edge) =>
          edge.type === "line" ? selectEdge(edge.id) : select(null)
        }
        onEdgeContextMenu={(e, edge: Edge) => {
          e.preventDefault();
          if (readOnly) return;
          if (edge.type === "line") selectEdge(edge.id);
          setMenu(null);
          setNodeMenu(null);
          setPasteMenu(null);
          setEdgeMenu({ x: e.clientX, y: e.clientY, edgeId: edge.id });
        }}
        onPaneClick={() => select(null)}
        colorMode={colorScheme}
        defaultEdgeOptions={{ type: "wire" }}
        // Cmd is reserved for clone-drag, so don't let it engage multi-selection.
        multiSelectionKeyCode={null}
        // Deletion is handled by our own keydown listener (see above) so it
        // routes through the store and syncs to the server.
        deleteKeyCode={null}
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

      {nodeMenu && (
        <NodeContextMenu
          x={nodeMenu.x}
          y={nodeMenu.y}
          canGraph={nodeMenuGraphable}
          solved={nodeMenuInj !== null}
          onDuplicate={() => {
            duplicateSelection({ x: 24, y: 24 });
            setNodeMenu(null);
          }}
          onCopy={() => {
            copySelection();
            setNodeMenu(null);
          }}
          onDelete={() => {
            const s = useEditor.getState();
            const selEdges = s.edges.filter((ed) => ed.selected).map((ed) => ed.id);
            const selNodes = s.nodes.filter((n) => n.selected).map((n) => n.id);
            for (const id of selEdges) s.removeEdge(id);
            for (const id of selNodes) s.removeNode(id);
            setNodeMenu(null);
          }}
          onGraph={(kind) => {
            if (nodeMenuInj) setGraph({ kind, inj: nodeMenuInj });
            setNodeMenu(null);
          }}
          onClose={() => setNodeMenu(null)}
        />
      )}

      {pasteMenu && (
        <>
          {/* Click-away backdrop. */}
          <div
            onClick={() => setPasteMenu(null)}
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
          />
          <Paper
            shadow="md"
            withBorder
            p={4}
            style={{
              position: "fixed",
              left: pasteMenu.x,
              top: pasteMenu.y,
              zIndex: 11,
              minWidth: 140,
            }}
          >
            <Button
              variant="subtle"
              size="xs"
              fullWidth
              justify="flex-start"
              c="white"
              disabled={!clipboard}
              onClick={() => {
                pasteAt(screenToFlowPosition({ x: pasteMenu.x, y: pasteMenu.y }));
                setPasteMenu(null);
              }}
            >
              Paste
            </Button>
            {!clipboard && (
              <Text size="xs" c="dimmed" px="xs" py={2}>
                Nothing copied yet
              </Text>
            )}
          </Paper>
        </>
      )}

      {edgeMenu && (
        <>
          {/* Click-away backdrop. */}
          <div
            onClick={() => setEdgeMenu(null)}
            style={{ position: "fixed", inset: 0, zIndex: 10 }}
          />
          <Paper
            shadow="md"
            withBorder
            p={4}
            style={{
              position: "fixed",
              left: edgeMenu.x,
              top: edgeMenu.y,
              zIndex: 11,
              minWidth: 140,
            }}
          >
            <Button
              variant="subtle"
              size="xs"
              fullWidth
              justify="space-between"
              c="red"
              rightSection={
                <Text component="span" size="xs" c="dimmed">
                  ⌫
                </Text>
              }
              onClick={() => {
                useEditor.getState().removeEdge(edgeMenu.edgeId);
                setEdgeMenu(null);
              }}
            >
              Delete
            </Button>
          </Paper>
        </>
      )}

      <Modal
        opened={graph !== null}
        onClose={() => setGraph(null)}
        centered
        title={graph?.kind === "waves" ? "Voltage / current waveform" : "Power triangle"}
      >
        {graph?.kind === "triangle" && (
          <PowerTriangle p={graph.inj.p_mw} q={graph.inj.q_mvar} />
        )}
        {graph?.kind === "waves" && (
          <Waveforms p={graph.inj.p_mw} q={graph.inj.q_mvar} />
        )}
      </Modal>
    </div>
  );
}
