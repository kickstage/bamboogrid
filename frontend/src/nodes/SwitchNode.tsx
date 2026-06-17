import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SwitchData } from "../types";
import { SwitchGlyph } from "./glyphs";

// Two-port element: handle "a" (left) and "b" (right), each wired to a bus.
export function SwitchNode({ data, selected }: NodeProps) {
  const d = data as SwitchData;
  return (
    <div style={{ width: 72, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <Handle id="a" type="source" position={Position.Left} style={{ background: "currentColor" }} />
      <SwitchGlyph size={64} closed={d.closed} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <Handle id="b" type="source" position={Position.Right} style={{ background: "currentColor" }} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>{d.closed ? "closed" : "open"}</div>
    </div>
  );
}
