// Decide whether a two-terminal element's terminals should be flipped so each
// faces the bus it connects to, avoiding a wire that loops/crosses. Pure
// (structural types) to stay out of the store import cycle.

type WNode = { id: string; position: { x: number; y: number } };
type WEdge = { source: string; target?: string; sourceHandle?: string | null };

function busCoord(
  nodes: WNode[],
  edges: WEdge[],
  id: string,
  terminal: string,
  axis: "x" | "y",
): number | null {
  const wire = edges.find(
    (e) => e.source === id && (e.sourceHandle ?? "") === terminal && e.target,
  );
  if (!wire?.target) return null;
  const bus = nodes.find((n) => n.id === wire.target);
  return bus ? bus.position[axis] : null;
}

const busY = (nodes: WNode[], edges: WEdge[], id: string, w: string) =>
  busCoord(nodes, edges, id, w, "y");

// `true` means the default HV-top / LV(+MV)-bottom orientation should be flipped.
export function windingFlip(
  nodes: WNode[],
  edges: WEdge[],
  id: string,
  selfY: number,
  kind: "2w" | "3w",
): boolean {
  const hv = busY(nodes, edges, id, "hv");
  if (kind === "2w") {
    const lv = busY(nodes, edges, id, "lv");
    if (hv !== null && lv !== null) return hv > lv;
    if (hv !== null) return hv > selfY;
    if (lv !== null) return lv < selfY;
    return false;
  }
  // 3W: HV sits opposite the MV/LV pair; flip when HV's bus is below their mean.
  const others = [
    busY(nodes, edges, id, "mv"),
    busY(nodes, edges, id, "lv"),
  ].filter((v): v is number => v !== null);
  const other = others.length
    ? others.reduce((a, b) => a + b, 0) / others.length
    : null;
  if (hv !== null && other !== null) return hv > other;
  if (hv !== null) return hv > selfY;
  if (other !== null) return other < selfY;
  return false;
}

// A bus-bus switch has terminal "a" (left) and "b" (right). `true` means swap
// them so "a" sits on the right, keeping the wires from crossing when a's bus is
// to the right of b's.
export function switchFlip(
  nodes: WNode[],
  edges: WEdge[],
  id: string,
  selfX: number,
): boolean {
  const a = busCoord(nodes, edges, id, "a", "x");
  const b = busCoord(nodes, edges, id, "b", "x");
  if (a !== null && b !== null) return a > b;
  if (a !== null) return a > selfX;
  if (b !== null) return b < selfX;
  return false;
}
