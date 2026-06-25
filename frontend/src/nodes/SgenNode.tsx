import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SgenData } from "../types";
import { SgenGlyph } from "./glyphs";
import { Readout, Value } from "./Readout";
import { fixed } from "../format";
import { useEditor } from "../store";

export function SgenNode({ data, selected }: NodeProps) {
  const d = data as SgenData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <SgenGlyph size={52} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.p_mw} MW</Value>
      {hasResult && (
        <Readout>
          <div>{fixed(d.res_p_mw!, 3)} MW</div>
          <div>{fixed(d.res_q_mvar ?? 0, 3)} Mvar</div>
        </Readout>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "currentColor" }} />
    </div>
  );
}
