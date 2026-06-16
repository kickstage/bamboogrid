import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GeneratorData } from "../types";
import { GeneratorGlyph } from "./glyphs";

export function GeneratorNode({ data, selected }: NodeProps) {
  const d = data as GeneratorData;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <GeneratorGlyph size={52} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: "currentColor" }} />
    </div>
  );
}
