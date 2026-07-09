import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GeneratorData } from "../types";
import { CANVAS_GLYPH_SIZE, GeneratorGlyph } from "./glyphs";
import { ACCENT, NODE_WIDTH } from "../theme";
import { Readout, Value } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { useBusBelow } from "./useBusBelow";

export function GeneratorNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as GeneratorData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  // Face the bus: handle toward it, label on the far side. The circle-with-"G"
  // glyph reads the same either way, so it isn't mirrored.
  const busBelow = useBusBelow(id, positionAbsoluteY);
  const handle = (position: Position) => (
    <Handle type="source" position={position} style={{ background: "currentColor" }} />
  );
  const glyph = (
    <GeneratorGlyph size={CANVAS_GLYPH_SIZE.generator} stroke={selected ? ACCENT : "currentColor"} />
  );
  const label = (
    <>
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
