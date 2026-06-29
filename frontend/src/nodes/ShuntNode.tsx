import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import type { ShuntData } from "../types";
import { ShuntGlyph } from "./glyphs";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";

export function ShuntNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as ShuntData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_q_mvar !== undefined;
  // Orient the shunt away from its bus: when the bus is below, flip so the
  // connection handle faces down (toward the bus) and the glyph points up.
  const busBelow = useEditor((s) => {
    const wire = s.edges.find((e) => e.source === id);
    if (!wire) return false;
    const bus = s.nodes.find((n) => n.id === wire.target);
    return bus ? bus.position.y > (positionAbsoluteY ?? 0) : false;
  });
  // Moving the handle (Top↔Bottom) changes the node's handle layout; React Flow
  // must re-measure or the wire detaches from the old spot and a ghost handle is
  // left behind.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [busBelow, id, updateNodeInternals]);

  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <div style={busBelow ? { transform: "scaleY(-1)" } : undefined}>
      <ShuntGlyph size={50} stroke={selected ? "#0ea5e9" : "currentColor"} />
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
