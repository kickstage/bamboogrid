import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { useEditor } from "../store";

type WireData = { waypoint?: { x: number; y: number } };
type Point = { x: number; y: number };

// Build an SVG path through `points` with rounded corners (radius `r`), matching
// the look of React Flow's default smoothstep edges.
function roundedPath(points: Point[], r = 5): string {
  // Drop consecutive duplicates so axis-aligned turns don't create zero-length
  // segments (which would break the corner math).
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
    // Points `rr` before and after the corner, then a quadratic curve through it.
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

// A wire between elements. By default it routes orthogonally from source to
// target. When selected it shows a draggable "dot" the line is computed
// through: drag it to reshape the route, double-click it to reset. Right-click
// it to delete the connection (Backspace/Delete also works).
export function WireEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const setEdgeWaypoint = useEditor((s) => s.setEdgeWaypoint);
  const { screenToFlowPosition } = useReactFlow();

  const waypoint = (data as WireData | undefined)?.waypoint;

  // Build the path. With a waypoint the line is an orthogonal staircase that
  // passes through the dot (all 90° corners); without one, the default
  // orthogonal route.
  let path: string;
  let dotX: number;
  let dotY: number;
  if (waypoint) {
    const { x: wx, y: wy } = waypoint;
    // source → (Sx,Wy) → (Wx,Wy)=dot → (Wx,Ty) → target — axis-aligned segments
    // with rounded corners to match the plain wires.
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

  // Drag the dot: convert pointer position to flow coords and store it. The
  // first move on a wire without a waypoint creates one.
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

  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeWidth: selected ? 2.5 : 1.5 }} />
      <EdgeLabelRenderer>
        {selected && (
          <div
            className="nodrag nopan"
            onPointerDown={onDotPointerDown}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEdgeWaypoint(id, null);
            }}
            title="Drag to route the wire · double-click to reset"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${dotX}px, ${dotY}px)`,
              pointerEvents: "all",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid #0ea5e9",
              background: waypoint ? "#0ea5e9" : "#fff",
              cursor: "grab",
            }}
          />
        )}
      </EdgeLabelRenderer>
    </>
  );
}
