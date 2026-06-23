import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { Trafo2WData } from "../types";
import { TransformerGlyph } from "./glyphs";
import { useEditor } from "../store";
import { TransformerResult } from "./TransformerResult";

const W = 40;

// A tiny winding tag (HV/LV) sitting beside its handle on the given edge, so
// you can tell which terminal is which. Nudged off-centre to clear the dot.
function portLabel(side: "top" | "bottom"): CSSProperties {
  // Centre on the top edge (HV), but drop the bottom tag (LV) fully below its
  // port so it clears the transformer loop.
  const y = side === "top" ? "-50%" : "50%";
  return {
    position: "absolute",
    [side]: 0,
    left: "50%",
    transform: `translate(6px, ${y})`,
    fontSize: 8,
    fontWeight: 700,
    opacity: 0.6,
    pointerEvents: "none",
  };
}

// Two-port transformer: "hv" handle on top, "lv" on bottom. The name label is
// absolutely positioned so it doesn't shift the node box (keeping handles on
// the glyph terminals).
export function Transformer2WNode({ data, selected }: NodeProps) {
  const d = data as Trafo2WData;
  const showResults = useEditor((s) => s.showResults);
  const stroke = selected ? "#0ea5e9" : "currentColor";
  return (
    <div style={{ position: "relative", width: W, height: (W * 48) / 40, color: "var(--mantine-color-text)" }}>
      <Handle id="hv" type="source" position={Position.Top} style={{ background: "currentColor" }} />
      <div style={portLabel("top")}>HV</div>
      <TransformerGlyph size={W} stroke={stroke} />
      <Handle id="lv" type="source" position={Position.Bottom} style={{ background: "currentColor" }} />
      <div style={portLabel("bottom")}>LV</div>
      <div
        style={{
          position: "absolute",
          top: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 10,
          fontWeight: 600,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        <div>{d.name}</div>
        {showResults && <TransformerResult data={d} />}
      </div>
    </div>
  );
}
