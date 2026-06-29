import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { SgenData } from "../types";
import { SgenGlyph } from "./glyphs";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { useBusBelow } from "./useBusBelow";

export function SgenNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as SgenData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  // Face the bus: handle toward it, label on the far side. The circle-with-"S"
  // glyph reads the same either way, so it isn't mirrored.
  const busBelow = useBusBelow(id, positionAbsoluteY);
  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <SgenGlyph size={52} stroke={selected ? "#0ea5e9" : "currentColor"} />
  );
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Value>{d.p_mw} MW</Value>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw!, 3)} MW</div>
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
