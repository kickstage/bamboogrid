import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LoadData } from "../types";
import { LoadGlyph } from "./glyphs";
import { Value } from "./Readout";
import { useBusBelow } from "./useBusBelow";

export function LoadNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as LoadData;
  // Orient the load away from its bus: when the bus is below, flip so the
  // connection handle faces down (toward the bus) and the glyph points up.
  const busBelow = useBusBelow(id, positionAbsoluteY);

  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <div style={busBelow ? { transform: "scaleY(-1)" } : undefined}>
      <LoadGlyph size={38} stroke={selected ? "#0ea5e9" : "currentColor"} />
    </div>
  );
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.p_mw} MW</Value>
    </>
  );
  // Keep the handle next to the glyph (and the label on the far side) so the wire
  // exits at the symbol, whichever way the load is flipped.
  return (
    <div style={{ width: 64, textAlign: "center", color: "var(--mantine-color-text)" }}>
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
