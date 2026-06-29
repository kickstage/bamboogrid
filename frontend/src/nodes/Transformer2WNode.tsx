import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, type CSSProperties } from "react";
import type { Trafo2WData } from "../types";
import { TransformerGlyph } from "./glyphs";
import { useEditor } from "../store";
import { WINDING_LABEL } from "../trafo";
import { windingFlip } from "./windingFlip";
import { TransformerResult } from "./TransformerResult";

const W = 40;

type Side = "top" | "bottom";

// A tiny winding tag (HV/LV) sitting beside its handle on the given edge, so
// you can tell which terminal is which. Nudged off-centre to clear the dot.
function portLabel(side: Side): CSSProperties {
  // Centre on the top edge, but drop a bottom tag fully below its port so it
  // clears the transformer loop.
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

const POS: Record<Side, Position> = { top: Position.Top, bottom: Position.Bottom };

// Two-port transformer. Terminals default to HV-top / LV-bottom but flip so each
// winding faces the bus it connects to (the glyph is vertically symmetric, so it
// needs no mirroring). The name label is absolutely positioned so it doesn't
// shift the node box (keeping handles on the glyph terminals).
export function Transformer2WNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as Trafo2WData;
  const showResults = useEditor((s) => s.showResults);
  const flip = useEditor((s) =>
    windingFlip(s.nodes, s.edges, id, positionAbsoluteY ?? 0, "2w"),
  );
  // Moving a handle (Top↔Bottom) changes the node's handle layout; React Flow
  // must re-measure or the wire detaches and a ghost handle is left behind.
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [flip, id, updateNodeInternals]);

  const hvSide: Side = flip ? "bottom" : "top";
  const lvSide: Side = flip ? "top" : "bottom";
  const stroke = selected ? "#0ea5e9" : "currentColor";
  return (
    <div style={{ position: "relative", width: W, height: (W * 48) / 40, color: "var(--mantine-color-text)" }}>
      <Handle id="hv" type="source" position={POS[hvSide]} style={{ background: "currentColor" }} />
      <div style={portLabel(hvSide)}>{WINDING_LABEL.hv}</div>
      <TransformerGlyph size={W} stroke={stroke} />
      <Handle id="lv" type="source" position={POS[lvSide]} style={{ background: "currentColor" }} />
      <div style={portLabel(lvSide)}>{WINDING_LABEL.lv}</div>
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
