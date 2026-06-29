import {
  Handle,
  NodeResizer,
  Position,
  type NodeProps,
  useUpdateNodeInternals,
} from "@xyflow/react";
import { useEffect } from "react";
import type { BusData } from "../types";
import { Readout, Value } from "./Readout";
import { fixed } from "../format";
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

// Fault-current heatmap: a sequential cool→hot scale by share of the network's
// peak Ik''. Higher fault current isn't "bad" (unlike voltage), so this avoids
// the green/amber/red good-bad semantics.
const SC_LOW: [number, number, number] = [125, 211, 252]; // sky-300
const SC_HIGH: [number, number, number] = [190, 24, 93]; // pink-700
function faultColor(ikss?: number, max?: number): string {
  if (ikss === undefined || !max || max <= 0) return "currentColor";
  const t = Math.max(0, Math.min(1, ikss / max));
  const c = SC_LOW.map((lo, i) => Math.round(lo + (SC_HIGH[i] - lo) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Vertical center of the busbar within the node (svg rect at y=7, height 6), so
// the port handles sit on the bar rather than floating above the node.
const BAR_CENTER = 10;

export function BusNode({ id, data, selected, width, positionAbsoluteY }: NodeProps) {
  const d = data as BusData;
  const showResults = useEditor((s) => s.showResults);
  const voltageUnit = useEditor((s) => s.voltageUnit);
  const studyMode = useEditor((s) => s.studyMode);
  const scMaxIkss = useEditor((s) => s.scMaxIkss);
  // Node graph, to orient each port toward the element wired to it.
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);
  const isSc = studyMode === "shortcircuit";
  const hasResult = showResults && (isSc ? d.ikss_ka !== undefined : d.vm_pu !== undefined);
  let color = "currentColor";
  if (hasResult) color = isSc ? faultColor(d.ikss_ka, scMaxIkss) : voltageColor(d.vm_pu);
  const ports = portOffsets(width ?? BUS_DEFAULT_WIDTH);

  // The color metric always tracks per-unit deviation; only the readout text
  // switches between actual kV (vm_pu × vn_kv) and per-unit.
  const voltageReadout = () => {
    const angle = `${fixed(d.va_degree ?? 0, 1)}°`;
    if (voltageUnit === "kv") {
      const kv = d.vm_pu! * d.vn_kv;
      return `${fixed(kv, kv >= 100 ? 1 : 3)} kV · ${angle}`;
    }
    return `${fixed(d.vm_pu!, 3)} p.u. · ${angle}`;
  };

  const faultReadout = () => `${fixed(d.ikss_ka!, 2)} kA Ik″`;

  // A port handle faces the element wired to it: Bottom when that element sits
  // below the bus, Top otherwise. This keeps wires from below attaching cleanly
  // to the bar instead of looping over the top. `otherId` is the element at the
  // far end of the port's wire (the source for an attached element, the target
  // for a bus→bus line drawn from here).
  const selfY = positionAbsoluteY ?? 0;
  const sideFor = (otherId?: string): Position => {
    const other = otherId ? nodes.find((n) => n.id === otherId) : undefined;
    return other && other.position.y > selfY ? Position.Bottom : Position.Top;
  };
  // Per-port handle sides (target = attached element, source = a bus→bus line
  // drawn from here), computed once so render and the re-measure effect agree.
  const portSides = ports.map((_, i) => {
    const pid = `p${i}`;
    const attached = edges.find((e) => e.target === id && e.targetHandle === pid);
    const line = edges.find((e) => e.source === id && e.sourceHandle === pid);
    return { target: sideFor(attached?.source), source: sideFor(line?.target) };
  });
  // When a port flips Top↔Bottom (an element dragged across the bar), React Flow
  // must re-measure or wires keep their stale stub direction.
  const updateNodeInternals = useUpdateNodeInternals();
  const sideSig = portSides.map((s) => `${s.target}${s.source}`).join("|");
  useEffect(() => {
    updateNodeInternals(id);
  }, [sideSig, id, updateNodeInternals]);

  // Sit on the bar (fixed top), and normalize the transform so Top and Bottom
  // handles share the same vertical center.
  const onBar = (left: number) => ({
    left: `${left}px`,
    top: BAR_CENTER,
    bottom: "auto",
    transform: "translate(-50%, -50%)",
    background: color,
  });

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
      {/* Fixed-spacing ports; a wire snaps to the nearest one. Each port exposes
          both a target handle (elements attach here) and a source handle (so a
          line can be *drawn from* the bus) at the same spot — without the source
          handle a bus→bus line has no anchor and won't render. */}
      {ports.map((left, i) => (
        <span key={i}>
          <Handle
            id={`p${i}`}
            type="target"
            position={portSides[i].target}
            style={onBar(left)}
          />
          <Handle
            id={`p${i}`}
            type="source"
            position={portSides[i].source}
            style={onBar(left)}
          />
        </span>
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
      <Value>{d.vn_kv} kV</Value>
      {hasResult && (
        <Readout>{isSc ? faultReadout() : voltageReadout()}</Readout>
      )}
    </div>
  );
}
