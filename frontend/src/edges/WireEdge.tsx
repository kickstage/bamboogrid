import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { useEditor } from "../store";

// Orthogonal wire (straight segments, 90° corners). When selected it shows a
// small × button to delete the connection; Backspace/Delete also works.
export function WireEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
}: EdgeProps) {
  const removeEdge = useEditor((s) => s.removeEdge);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={{ strokeWidth: selected ? 2.5 : 1.5 }} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan"
            onClick={(e) => {
              e.stopPropagation();
              removeEdge(id);
            }}
            title="Delete connection"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              width: 18,
              height: 18,
              lineHeight: "16px",
              borderRadius: "50%",
              border: "1px solid #dc2626",
              background: "#fff",
              color: "#dc2626",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
