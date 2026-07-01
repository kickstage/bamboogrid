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

// Orientation for a two-terminal bus-bus element (switch or impedance). The glyph
// rotates to lie along the axis separating its two buses: horizontal when the
// buses sit side by side, vertical when one is above the other. `flip` swaps the
// two terminals so each faces its own bus (terminal a on the right when
// horizontal, or on the bottom when vertical), keeping the wires from crossing.
// Unknown ends fall back to the body. The terminal handle ids default to
// "a"/"b" (switch) but can be overridden (e.g. "from"/"to" for an impedance).
export function switchLayout(
  nodes: WNode[],
  edges: WEdge[],
  id: string,
  selfX: number,
  selfY: number,
  terminals: [string, string] = ["a", "b"],
): { vertical: boolean; flip: boolean } {
  const [ta, tb] = terminals;
  const ax = busCoord(nodes, edges, id, ta, "x");
  const ay = busCoord(nodes, edges, id, ta, "y");
  const bx = busCoord(nodes, edges, id, tb, "x");
  const by = busCoord(nodes, edges, id, tb, "y");
  if (ax === null && ay === null && bx === null && by === null)
    return { vertical: false, flip: false };
  const aX = ax ?? selfX;
  const aY = ay ?? selfY;
  const bX = bx ?? selfX;
  const bY = by ?? selfY;
  const vertical = Math.abs(aY - bY) > Math.abs(aX - bX);
  return { vertical, flip: vertical ? aY > bY : aX > bX };
}
