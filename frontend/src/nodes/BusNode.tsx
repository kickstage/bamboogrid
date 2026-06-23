import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import type { BusData } from "../types";
import { useEditor } from "../store";

export const BUS_MIN_WIDTH = 140;
export const BUS_DEFAULT_WIDTH = 220;

// Connection ports at a fixed pixel spacing, anchored from the left so existing
// ports keep their ids (and attached wires) as the bar is lengthened — a longer
// bar just gains more ports rather than spreading the same few apart.
export const PORT_SPACING = 40;
export const PORT_MARGIN = 16;
function portOffsets(width: number): number[] {
  const count = Math.max(2, Math.floor((width - 2 * PORT_MARGIN) / PORT_SPACING) + 1);
  return Array.from({ length: count }, (_, i) => PORT_MARGIN + i * PORT_SPACING);
}

// Smallest bus width whose ports (see portOffsets) can host `count` wires —
// the inverse of portOffsets. Used to widen an imported bus so its connected
// elements land on distinct ports instead of stacking on the first one.
export function widthForPorts(count: number): number {
  return Math.max(BUS_DEFAULT_WIDTH, 2 * PORT_MARGIN + Math.max(0, count - 1) * PORT_SPACING);
}

// Color the busbar by voltage once a load flow has run: green near 1.0 p.u.,
// amber/red as it drifts. Follows the theme (currentColor) before any result.
function voltageColor(vm_pu?: number): string {
  if (vm_pu === undefined) return "currentColor";
  const dev = Math.abs(vm_pu - 1.0);
  if (dev <= 0.05) return "#16a34a";
  if (dev <= 0.1) return "#d97706";
  return "#dc2626";
}

export function BusNode({ data, selected, width }: NodeProps) {
  const d = data as BusData;
  const showResults = useEditor((s) => s.showResults);
  const hasResult = showResults && d.vm_pu !== undefined;
  const color = hasResult ? voltageColor(d.vm_pu) : "currentColor";
  const ports = portOffsets(width ?? BUS_DEFAULT_WIDTH);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        minWidth: BUS_MIN_WIDTH,
        textAlign: "center",
        color: "var(--mantine-color-text)",
      }}
    >
      {/* Horizontal-only resize: drag the left/right edges to lengthen the bus. */}
      <NodeResizer
        isVisible={selected}
        color="#0ea5e9"
        minWidth={BUS_MIN_WIDTH}
        shouldResize={(_e, params) => params.direction[1] === 0}
      />
      {/* Fixed-spacing ports; a wire snaps to the nearest one. */}
      {ports.map((left, i) => (
        <Handle
          key={i}
          id={`p${i}`}
          type="target"
          position={Position.Top}
          style={{ left: `${left}px`, background: color }}
        />
      ))}
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
      <div style={{ fontSize: 10, opacity: 0.65 }}>{d.vn_kv} kV</div>
      {hasResult && (
        <div style={{ fontSize: 10, fontWeight: 600, color: "#0ea5e9" }}>
          {d.vm_pu!.toFixed(3)} p.u. · {(d.va_degree ?? 0).toFixed(1)}°
        </div>
      )}
    </div>
  );
}
