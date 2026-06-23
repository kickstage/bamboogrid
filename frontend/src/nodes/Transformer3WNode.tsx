import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import type { Trafo3WData } from "../types";
import { Transformer3WGlyph } from "./glyphs";
import { useEditor } from "../store";
import { TransformerResult } from "./TransformerResult";

const W = 48;

// A tiny winding tag (HV/MV/LV) beside its handle, aligned to that terminal.
// `anchor` sits the tag just right ("right") or just left ("left") of the port.
function portLabel(
  side: "top" | "bottom",
  left: string,
  anchor: "right" | "left" = "right",
): CSSProperties {
  const x = anchor === "right" ? "6px" : "calc(-100% - 6px)";
  // Centre on the top edge (HV), but drop bottom tags fully below their port so
  // they clear the transformer loops.
  const y = side === "top" ? "-50%" : "50%";
  return {
    position: "absolute",
    [side]: 0,
    left,
    transform: `translate(${x}, ${y})`,
    fontSize: 8,
    fontWeight: 700,
    opacity: 0.6,
    pointerEvents: "none",
  };
}

// Three-port transformer: "hv" on top, "mv"/"lv" at the bottom (left/right),
// aligned to the glyph's three terminals.
export function Transformer3WNode({ data, selected }: NodeProps) {
  const d = data as Trafo3WData;
  const showResults = useEditor((s) => s.showResults);
  const stroke = selected ? "#0ea5e9" : "currentColor";
  return (
    <div style={{ position: "relative", width: W, height: W, color: "var(--mantine-color-text)" }}>
      <Handle id="hv" type="source" position={Position.Top} style={{ background: "currentColor" }} />
      <div style={portLabel("top", "50%")}>HV</div>
      <Transformer3WGlyph size={W} stroke={stroke} />
      <Handle id="mv" type="source" position={Position.Bottom} style={{ left: "35%", background: "currentColor" }} />
      <div style={portLabel("bottom", "35%", "left")}>MV</div>
      <Handle id="lv" type="source" position={Position.Bottom} style={{ left: "65%", background: "currentColor" }} />
      <div style={portLabel("bottom", "65%")}>LV</div>
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
