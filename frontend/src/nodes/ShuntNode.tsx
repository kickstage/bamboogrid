import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ShuntData } from "../types";
import { ShuntGlyph } from "./glyphs";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";

export function ShuntNode({ data, selected }: NodeProps) {
  const d = data as ShuntData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_q_mvar !== undefined;
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <Handle type="source" position={Position.Top} style={{ background: "currentColor" }} />
      <ShuntGlyph size={50} stroke={selected ? "#0ea5e9" : "currentColor"} />
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.q_mvar} Mvar</Value>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw ?? 0, 3)} MW</div>
          <div>{signed(d.res_q_mvar!, 3)} Mvar</div>
        </Readout>
      )}
    </div>
  );
}
