import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ExtGridData } from "../types";
import { CANVAS_GLYPH_SIZE, ExtGridGlyph } from "./glyphs";
import { ACCENT, NODE_WIDTH } from "../theme";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { useBusBelow } from "./useBusBelow";

export function ExtGridNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as ExtGridData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  // Face the bus: handle toward it, label on the far side.
  const busBelow = useBusBelow(id, positionAbsoluteY);
  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <ExtGridGlyph size={CANVAS_GLYPH_SIZE.extgrid} stroke={selected ? ACCENT : "currentColor"} />
  );
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.vm_pu} p.u. · slack</Value>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw!, 3)} MW</div>
          <div>{signed(d.res_q_mvar ?? 0, 3)} Mvar</div>
        </Readout>
      )}
    </>
  );
  return (
    <div style={{ width: NODE_WIDTH, textAlign: "center", color: "var(--mantine-color-text)" }}>
      {busBelow ? (
        <>
          {label}
          {glyph}
          {handle(Position.Bottom)}
        </>
      ) : (
        <>
          {handle(Position.Top)}
          {glyph}
          {label}
        </>
      )}
    </div>
  );
}
