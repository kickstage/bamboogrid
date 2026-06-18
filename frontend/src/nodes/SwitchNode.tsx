import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SwitchData } from "../types";
import { SwitchGlyph } from "./glyphs";

const GLYPH = 64; // width; the glyph is half as tall, so its terminals sit at GLYPH/4.

// Two-port element: handle "a" (left) and "b" (right), each wired to a bus.
// Handles are pinned to the glyph's terminal points (its vertical centre and
// left/right edges) so wires meet the symbol, not the label area below it.
export function SwitchNode({ data, selected }: NodeProps) {
  const d = data as SwitchData;
  const stroke = selected ? "#0ea5e9" : "currentColor";
  return (
    <div style={{ width: GLYPH, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <Handle id="a" type="source" position={Position.Left} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <Handle id="b" type="source" position={Position.Right} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <SwitchGlyph size={GLYPH} closed={d.closed} stroke={stroke} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>{d.closed ? "closed" : "open"}</div>
    </div>
  );
}
