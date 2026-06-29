import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import type { LoadData } from "../types";
import { LoadGlyph } from "./glyphs";
import { Value } from "./Readout";
import { useEditor } from "../store";

export function LoadNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as LoadData;
  // Orient the load away from its bus: when the bus is below, flip so the
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
