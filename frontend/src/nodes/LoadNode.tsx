import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LoadData } from "../types";
import { LoadGlyph } from "./glyphs";
import { Value } from "./Readout";

export function LoadNode({ data, selected }: NodeProps) {
  const d = data as LoadData;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <Handle type="source" position={Position.Top} style={{ background: "currentColor" }} />
      <LoadGlyph size={50} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.p_mw} MW</Value>
    </div>
  );
}
