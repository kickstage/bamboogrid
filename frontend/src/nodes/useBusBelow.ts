import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

import { useEditor } from "../store";

/** True when the bus this single-terminal element wires to sits below it, so the
 * element should flip to face its bus (handle down, glyph mirrored). Re-measures
 * the node when the side changes, or the moved handle leaves a detached wire. */
export function useBusBelow(id: string, selfY: number | undefined): boolean {
  const busBelow = useEditor((s) => {
    const wire = s.edges.find((e) => e.source === id);
    if (!wire) return false;
    const bus = s.nodes.find((n) => n.id === wire.target);
    return bus ? bus.position.y > (selfY ?? 0) : false;
  });
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [busBelow, id, updateNodeInternals]);
  return busBelow;
}
