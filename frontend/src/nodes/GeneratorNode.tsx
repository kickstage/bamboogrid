import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GeneratorData } from "../types";
import { GeneratorGlyph } from "./glyphs";
import { useEditor } from "../store";

export function GeneratorNode({ data, selected }: NodeProps) {
  const d = data as GeneratorData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <GeneratorGlyph size={52} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>
        {d.p_mw} MW{d.slack ? ` · slack ${d.slack_weight}` : ""}
      </div>
      {hasResult && (
        <div style={{ fontSize: 9, fontWeight: 600, color: "#0ea5e9" }}>
          P {d.res_p_mw!.toFixed(3)} · Q {(d.res_q_mvar ?? 0).toFixed(3)}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "currentColor" }} />
    </div>
  );
}
