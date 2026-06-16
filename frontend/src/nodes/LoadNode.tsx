import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LoadData } from "../types";

export function LoadNode({ data, selected }: NodeProps) {
  const d = data as LoadData;
  return (
    <div style={{ width: 64, textAlign: "center" }}>
      <Handle type="source" position={Position.Top} style={{ background: "#0f172a" }} />
      <svg width={48} height={44} style={{ display: "block", margin: "0 auto" }}>
        {/* Downward triangle: the standard one-line load symbol. */}
        <polygon
          points="24,42 6,8 42,8"
          fill="#fff"
          stroke={selected ? "#0ea5e9" : "#0f172a"}
          strokeWidth={2}
        />
      </svg>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 9, color: "#475569" }}>{d.p_mw} MW</div>
    </div>
  );
}
