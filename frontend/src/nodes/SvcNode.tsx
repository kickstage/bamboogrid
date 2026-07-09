import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SvcData } from "../types";
import { CANVAS_GLYPH_SIZE, SvcGlyph } from "./glyphs";
import { ACCENT, NODE_WIDTH } from "../theme";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { useBusBelow } from "./useBusBelow";

// A shunt FACTS voltage regulator on one bus. Like a shunt it hangs off a single
// bus by a wire; the glyph faces the bus (flips when the bus is below) so the
// wire exits at the symbol. Shows its target voltage, and after a solve the
// reactive power it exchanged.
export function SvcNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as SvcData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_q_mvar !== undefined;
  const busBelow = useBusBelow(id, positionAbsoluteY);

  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <div style={busBelow ? { transform: "scaleY(-1)" } : undefined}>
      <SvcGlyph size={CANVAS_GLYPH_SIZE.svc} stroke={selected ? ACCENT : "currentColor"} />
    </div>
  );
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.set_vm_pu} p.u.</Value>
      {hasResult && (
        <Readout>
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
