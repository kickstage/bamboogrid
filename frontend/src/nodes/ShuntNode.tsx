import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ShuntData } from "../types";
import { CANVAS_GLYPH_SIZE, ShuntGlyph } from "./glyphs";
import { ACCENT, NODE_WIDTH } from "../theme";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { useBusBelow } from "./useBusBelow";

export function ShuntNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as ShuntData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_q_mvar !== undefined;
  // Orient the shunt away from its bus: when the bus is below, flip so the
  // connection handle faces down (toward the bus) and the glyph points up.
  const busBelow = useBusBelow(id, positionAbsoluteY);

  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <div style={busBelow ? { transform: "scaleY(-1)" } : undefined}>
      <ShuntGlyph size={CANVAS_GLYPH_SIZE.shunt} stroke={selected ? ACCENT : "currentColor"} />
    </div>
  );
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.q_mvar} Mvar</Value>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw ?? 0, 3)} MW</div>
          <div>{signed(d.res_q_mvar!, 3)} Mvar</div>
        </Readout>
      )}
    </>
  );
  // Keep the handle next to the glyph (and the label on the far side) so the wire
  // exits at the symbol, whichever way the shunt is flipped.
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
