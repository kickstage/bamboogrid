import { Handle, Position, type NodeProps, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect, type CSSProperties } from "react";
import type { Trafo3WData } from "../types";
import { Transformer3WGlyph } from "./glyphs";
import { ACCENT } from "../theme";
import { useEditor } from "../store";
import { WINDING_LABEL } from "../trafo";
import { windingFlip } from "./windingFlip";
import { TransformerResult } from "./TransformerResult";
import { TrafoTapBadge } from "./TrafoTapBadge";
import { EstimationBadge } from "./EstimationBadge";
import { useTrafoParams } from "./useTrafoParams";

const W = 48;

type Side = "top" | "bottom";

// A tiny winding tag (HV/MV/LV) beside its handle, aligned to that terminal.
// `anchor` sits the tag just right ("right") or just left ("left") of the port.
function portLabel(
  side: Side,
  left: string,
  anchor: "right" | "left" = "right",
): CSSProperties {
  const x = anchor === "right" ? "6px" : "calc(-100% - 6px)";
  // Centre on the top edge, but drop bottom tags fully below their port so they
  // clear the transformer loops.
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

const POS: Record<Side, Position> = { top: Position.Top, bottom: Position.Bottom };

// Three-port transformer: HV on one side, MV/LV on the other. Defaults to HV-top
// but flips (glyph mirrored to match) so HV faces its bus instead of looping.
export function Transformer3WNode({ id, data, selected, positionAbsoluteY }: NodeProps) {
  const d = data as Trafo3WData;
  const showResults = useEditor((s) => s.showResults);
  const flip = useEditor((s) =>
    windingFlip(s.nodes, s.edges, id, positionAbsoluteY ?? 0, "3w"),
  );
  const params = useTrafoParams(d, "trafo3w");
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [flip, id, updateNodeInternals]);

  const hvSide: Side = flip ? "bottom" : "top";
  const pairSide: Side = flip ? "top" : "bottom";
  const stroke = selected ? ACCENT : "currentColor";
  return (
    <div style={{ position: "relative", width: W, height: W, color: "var(--mantine-color-text)" }}>
      <Handle id="hv" type="source" position={POS[hvSide]} style={{ background: "currentColor" }} />
      <div style={portLabel(hvSide, "50%")}>{WINDING_LABEL.hv}</div>
      <div style={flip ? { transform: "scaleY(-1)" } : undefined}>
        <Transformer3WGlyph size={W} stroke={stroke} />
      </div>
      <Handle id="mv" type="source" position={POS[pairSide]} style={{ left: "35%", background: "currentColor" }} />
      <div style={portLabel(pairSide, "35%", "left")}>{WINDING_LABEL.mv}</div>
      <Handle id="lv" type="source" position={POS[pairSide]} style={{ left: "65%", background: "currentColor" }} />
      <div style={portLabel(pairSide, "65%")}>{WINDING_LABEL.lv}</div>
      {params && (
        <TrafoTapBadge
          nodeId={id}
          params={params}
          right={-9}
          selected={!!selected}
        />
      )}
      <EstimationBadge nodeId={id} left={-9} selected={!!selected} />
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
