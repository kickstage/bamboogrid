import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import type { SwitchData } from "../types";
import { SwitchGlyph } from "./glyphs";
import { useEditor } from "../store";
import { switchFlip } from "./windingFlip";

const GLYPH = 64; // width; the glyph is half as tall, so its terminals sit at GLYPH/4.

// Two-port element: terminal "a" and "b", each wired to a bus. The glyph is
// horizontally symmetric, so terminals default to a-left / b-right but swap to
// face their buses (keeping the wires from crossing). Handles sit at the glyph's
// vertical centre so wires meet the symbol, not the label area below it.
export function SwitchNode({ id, data, selected, positionAbsoluteX }: NodeProps) {
  const d = data as SwitchData;
  const stroke = selected ? "#0ea5e9" : "currentColor";
  const flip = useEditor((s) =>
    switchFlip(s.nodes, s.edges, id, positionAbsoluteX ?? 0),
  );
  // Moving a handle (Left↔Right) changes the node's handle layout; React Flow
  // must re-measure or the wire detaches and a ghost handle is left behind.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [flip, id, updateNodeInternals]);

  const updateNodeData = useEditor((s) => s.updateNodeData);

  return (
    <div
      style={{ width: GLYPH, textAlign: "center", color: "var(--mantine-color-text)" }}
      onDoubleClick={() => updateNodeData(id, { closed: !d.closed })}
    >
      <Handle id="a" type="source" position={flip ? Position.Right : Position.Left} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <Handle id="b" type="source" position={flip ? Position.Left : Position.Right} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <SwitchGlyph size={GLYPH} closed={d.closed} stroke={stroke} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>{d.closed ? "closed" : "open"}</div>
    </div>
  );
}
