import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { XwardData } from "../types";
import { CANVAS_GLYPH_SIZE, XwardGlyph } from "./glyphs";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { useBusBelow } from "./useBusBelow";

// A network equivalent on one bus. Like a shunt it hangs off a single bus by a
// wire; the glyph faces the bus (flips when the bus is below) so the wire exits
// at the symbol.
export function XwardNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as XwardData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  const busBelow = useBusBelow(id, positionAbsoluteY);

  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <div style={busBelow ? { transform: "scaleY(-1)" } : undefined}>
      <XwardGlyph size={CANVAS_GLYPH_SIZE.xward} stroke={selected ? "#0ea5e9" : "currentColor"} />
    </div>
  );
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.vm_pu} p.u.</Value>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw ?? 0, 3)} MW</div>
          <div>{signed(d.res_q_mvar ?? 0, 3)} Mvar</div>
        </Readout>
      )}
    </>
  );
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
