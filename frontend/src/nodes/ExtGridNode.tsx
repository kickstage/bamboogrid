import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ExtGridData } from "../types";
import { ExtGridGlyph } from "./glyphs";
import { useEditor } from "../store";

export function ExtGridNode({ data, selected }: NodeProps) {
  const d = data as ExtGridData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <ExtGridGlyph size={52} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>{d.vm_pu} p.u. · slack</div>
      {hasResult && (
        <div style={{ fontSize: 9, fontWeight: 600, color: "#0ea5e9", lineHeight: 1.2 }}>
          <div>P {d.res_p_mw!.toFixed(3)} MW</div>
          <div>Q {(d.res_q_mvar ?? 0).toFixed(3)} Mvar</div>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "currentColor" }} />
    </div>
  );
}
