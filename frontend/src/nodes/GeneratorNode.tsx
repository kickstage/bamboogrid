import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { GeneratorData } from "../types";

export function GeneratorNode({ data, selected }: NodeProps) {
  const d = data as GeneratorData;
  return (
    <div style={{ width: 64, textAlign: "center" }}>
      <svg width={48} height={48} style={{ display: "block", margin: "0 auto" }}>
        <circle
          cx={24}
          cy={24}
          r={20}
          fill="#fff"
          stroke={selected ? "#0ea5e9" : "#0f172a"}
          strokeWidth={2}
        />
        <text
          x={24}
          y={30}
          textAnchor="middle"
          fontSize={18}
          fontWeight={700}
          fill="#0f172a"
        >
          G
        </text>
      </svg>
      <div style={{ fontSize: 10, fontWeight: 600 }}>{d.name}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: "#0f172a" }} />
    </div>
  );
}
