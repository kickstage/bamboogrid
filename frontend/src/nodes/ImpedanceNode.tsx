import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import type { ImpedanceData } from "../types";
import { ImpedanceGlyph } from "./glyphs";
import { Readout } from "./Readout";
import { signed } from "../format";
import { useEditor } from "../store";
import { switchLayout } from "./windingFlip";

const GLYPH = 64; // width; the glyph is half as tall, so its terminals sit at GLYPH/4.

// Two-port series-impedance element: terminals "from" and "to", each wired to a
// bus. Like the switch, the glyph is symmetric, so it orients along the axis
// between its buses — horizontal for side-by-side buses, vertical when one is
// above the other — and swaps terminals to face their buses without crossing.
export function ImpedanceNode({
  id,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps) {
  const d = data as ImpedanceData;
  const stroke = selected ? "#0ea5e9" : "currentColor";
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.res_p_mw !== undefined;
  const { vertical, flip } = useEditor((s) =>
    switchLayout(s.nodes, s.edges, id, positionAbsoluteX ?? 0, positionAbsoluteY ?? 0, [
      "from",
      "to",
    ]),
  );
  // Moving a handle changes the node's handle layout; React Flow must re-measure
  // or the wire detaches and a ghost handle is left behind.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [vertical, flip, id, updateNodeInternals]);

  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      {hasResult && (
        <Readout>
          <div>{signed(d.res_p_mw ?? 0, 3)} MW</div>
          <div>{signed(d.res_q_mvar ?? 0, 3)} Mvar</div>
        </Readout>
      )}
    </>
  );

  if (vertical) {
    return (
      <div style={{ width: GLYPH, textAlign: "center", color: "var(--mantine-color-text)" }}>
        <Handle
          id="from"
          type="source"
          position={flip ? Position.Bottom : Position.Top}
          style={{ top: flip ? GLYPH : 0, bottom: "auto", background: "currentColor" }}
        />
        <Handle
          id="to"
          type="source"
          position={flip ? Position.Top : Position.Bottom}
          style={{ top: flip ? 0 : GLYPH, bottom: "auto", background: "currentColor" }}
        />
        <div style={{ width: GLYPH / 2, height: GLYPH, position: "relative", margin: "0 auto" }}>
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%) rotate(90deg)",
            }}
          >
            <ImpedanceGlyph size={GLYPH} stroke={stroke} />
          </div>
        </div>
        {label}
      </div>
    );
  }

  return (
    <div style={{ width: GLYPH, textAlign: "center", color: "var(--mantine-color-text)" }}>
      <Handle id="from" type="source" position={flip ? Position.Right : Position.Left} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <Handle id="to" type="source" position={flip ? Position.Left : Position.Right} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <ImpedanceGlyph size={GLYPH} stroke={stroke} />
      {label}
    </div>
  );
}
