import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { useEditor } from "../store";
import type { LineData } from "../types";
import { Readout } from "../nodes/Readout";
import { EstimationBadge } from "../nodes/EstimationBadge";
import { ACCENT } from "../theme";
import { fixed } from "../format";

type Point = { x: number; y: number };

// Build an SVG path through `points` with rounded corners (radius `r`). Mirrors
// the helper in WireEdge so a routed line matches the look of the plain wires.
function roundedPath(points: Point[], r = 5): string {
  const pts = points.filter(
    (p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
  );
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const len1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const len2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const rr = Math.min(r, len1 / 2, len2 / 2);
    const before = {
      x: curr.x + ((prev.x - curr.x) / len1) * rr,
      y: curr.y + ((prev.y - curr.y) / len1) * rr,
    };
    const after = {
      x: curr.x + ((next.x - curr.x) / len2) * rr,
      y: curr.y + ((next.y - curr.y) / len2) * rr,
    };
    d += ` L ${before.x},${before.y} Q ${curr.x},${curr.y} ${after.x},${after.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

// A transmission/distribution line: a bus-to-bus branch with impedance. It's
// routed like the regular wires but drawn a touch thicker (it carries real
// power, not just a logical attachment) and carries a small name label, plus
// loading % once solved. Like WireEdge it supports a draggable routing dot;
// clicking it opens its parameters in the inspector and right-clicking it offers
// deletion.
export function LineEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
}: EdgeProps) {
  const setEdgeWaypoint = useEditor((s) => s.setEdgeWaypoint);
  const selectEdge = useEditor((s) => s.selectEdge);
  const showResults = useEditor((s) => s.showResults);
  const { screenToFlowPosition } = useReactFlow();

  const d = data as LineData | undefined;
  const waypoint = d?.waypoint;
  const loading = showResults ? d?.res_loading_percent : undefined;
  const resI = showResults ? d?.res_i_ka : undefined;

  let path: string;
  let dotX: number;
  let dotY: number;
  if (waypoint) {
    const { x: wx, y: wy } = waypoint;
    path = roundedPath([
      { x: sourceX, y: sourceY },
      { x: sourceX, y: wy },
      { x: wx, y: wy },
      { x: wx, y: targetY },
      { x: targetX, y: targetY },
    ]);
    dotX = wx;
    dotY = wy;
  } else {
    const [p, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
    });
    path = p;
    dotX = labelX;
    dotY = labelY;
  }

  const onDotPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      setEdgeWaypoint(id, screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // The name rides above the line (dimmed, like before); load-flow results sit
  // below it in blue, matching how the element nodes show their readouts.
  const label = d?.name;
  const hasResult = loading !== undefined;

  return (
    <>
      {/* A line carries real power, so it reads slightly heavier than a plain
          connecting wire (which is 1.5 / 2.5 when selected). */}
      <BaseEdge id={id} path={path} style={{ ...style, strokeWidth: selected ? 3.5 : 2.5 }} />
      <EdgeLabelRenderer>
        {label && (
          <div
            className="nodrag nopan"
            onClick={(e) => {
              e.stopPropagation();
              selectEdge(id);
            }}
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${dotX}px, ${dotY - 14}px)`,
              fontSize: 10,
              fontWeight: 500,
              color: "var(--mantine-color-dimmed)",
              background: "var(--mantine-color-body)",
              padding: "0 3px",
              borderRadius: 3,
              pointerEvents: "all",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        )}
        {hasResult && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${dotX}px, ${dotY + 16}px)`,
              background: "var(--mantine-color-body)",
              padding: "0 3px",
              borderRadius: 3,
              pointerEvents: "none",
            }}
          >
            <Readout color={loading! > 100 ? "#dc2626" : ACCENT}>
              <div>{fixed(loading!, 1)}%</div>
              {resI !== undefined && <div>{fixed(resI * 1000, 1)} A</div>}
            </Readout>
          </div>
        )}
        <EstimationBadge
          nodeId={id}
          edgeX={dotX}
          edgeY={dotY}
          selected={!!selected}
        />
        {selected && (
          <div
            className="nodrag nopan"
            onPointerDown={onDotPointerDown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEdgeWaypoint(id, null);
            }}
            title="Drag to route the line · double-click to reset"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${dotX}px, ${dotY}px)`,
              pointerEvents: "all",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: `2px solid ${ACCENT}`,
              background: waypoint ? ACCENT : "#fff",
              cursor: "grab",
            }}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}
