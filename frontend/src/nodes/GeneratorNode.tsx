import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GeneratorData } from "../types";
import { GeneratorGlyph } from "./glyphs";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";

export function GeneratorNode({ data, selected }: NodeProps) {
  const d = data as GeneratorData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <GeneratorGlyph size={39} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>
        {d.p_mw} MW{d.slack ? ` · slack ${d.slack_weight}` : ""}
      </Value>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw!, 3)} MW</div>
          <div>{signed(d.res_q_mvar ?? 0, 3)} Mvar</div>
        </Readout>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: "currentColor" }} />
    </div>
  );
}
