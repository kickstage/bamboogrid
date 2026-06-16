import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import type { BusData } from "../types";

export const BUS_MIN_WIDTH = 140;
export const BUS_DEFAULT_WIDTH = 220;

// Color the busbar by voltage once a load flow has run: green near 1.0 p.u.,
// amber/red as it drifts. Neutral grey before any result.
function voltageColor(vm_pu?: number): string {
  if (vm_pu === undefined) return "#64748b";
  const dev = Math.abs(vm_pu - 1.0);
  if (dev <= 0.05) return "#16a34a";
  if (dev <= 0.1) return "#d97706";
  return "#dc2626";
}

export function BusNode({ data, selected }: NodeProps) {
  const d = data as BusData;
  const color = voltageColor(d.vm_pu);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minWidth: BUS_MIN_WIDTH,
        textAlign: "center",
      }}
    >
      {/* Horizontal-only resize: drag the left/right edges to lengthen the bus. */}
      <NodeResizer
        isVisible={selected}
        color="#0ea5e9"
        minWidth={BUS_MIN_WIDTH}
        shouldResize={(_e, params) => params.direction[1] === 0}
      />
      {/* Single shared connection point; multiple elements may attach here. */}
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <svg width="100%" height={20} aria-label="busbar" style={{ display: "block" }}>
        <rect
          x={0}
          y={7}
          width="100%"
          height={6}
          rx={3}
          fill={color}
          stroke={selected ? "#0ea5e9" : "transparent"}
          strokeWidth={2}
        />
      </svg>
      <div style={{ fontSize: 11, fontWeight: 600 }}>{d.name}</div>
      <div style={{ fontSize: 10, color: "#475569" }}>
        {d.vn_kv} kV
        {d.vm_pu !== undefined ? ` · ${d.vm_pu.toFixed(3)} p.u.` : ""}
      </div>
    </div>
  );
}
