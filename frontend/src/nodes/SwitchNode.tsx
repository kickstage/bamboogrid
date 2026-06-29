import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import type { SwitchData } from "../types";
import { SwitchGlyph } from "./glyphs";
import { useEditor } from "../store";
import { switchLayout } from "./windingFlip";

const GLYPH = 64; // width; the glyph is half as tall, so its terminals sit at GLYPH/4.

// Two-port element: terminal "a" and "b", each wired to a bus. The glyph is
// symmetric, so it orients along the axis between its buses — horizontal (a-left /
// b-right) for side-by-side buses, vertical (a-top / b-bottom) when one bus is
// above the other — and swaps terminals to face their buses without crossing.
// Handles sit on the glyph (not the label below it) so wires meet the symbol.
export function SwitchNode({
  id,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps) {
  const d = data as SwitchData;
  const stroke = selected ? "#0ea5e9" : "currentColor";
  const { vertical, flip } = useEditor((s) =>
    switchLayout(s.nodes, s.edges, id, positionAbsoluteX ?? 0, positionAbsoluteY ?? 0),
  );
  // Moving a handle changes the node's handle layout; React Flow must re-measure
  // or the wire detaches and a ghost handle is left behind.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [vertical, flip, id, updateNodeInternals]);

  const updateNodeData = useEditor((s) => s.updateNodeData);
  const toggle = () => updateNodeData(id, { closed: !d.closed });
  const label = (
    <>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, opacity: 0.7 }}>{d.closed ? "closed" : "open"}</div>
    </>
  );

  if (vertical) {
    return (
      <div
        style={{ width: GLYPH, textAlign: "center", color: "var(--mantine-color-text)" }}
        onDoubleClick={toggle}
      >
        <Handle
          id="a"
          type="source"
          position={flip ? Position.Bottom : Position.Top}
          style={{ top: flip ? GLYPH : 0, bottom: "auto", background: "currentColor" }}
        />
        <Handle
          id="b"
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
            <SwitchGlyph size={GLYPH} closed={d.closed} stroke={stroke} />
          </div>
        </div>
        {label}
      </div>
    );
  }

  return (
    <div
      style={{ width: GLYPH, textAlign: "center", color: "var(--mantine-color-text)" }}
      onDoubleClick={toggle}
    >
      <Handle id="a" type="source" position={flip ? Position.Right : Position.Left} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <Handle id="b" type="source" position={flip ? Position.Left : Position.Right} style={{ top: GLYPH / 4, background: "currentColor" }} />
      <SwitchGlyph size={GLYPH} closed={d.closed} stroke={stroke} />
      {label}
    </div>
  );
}
