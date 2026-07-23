import type { BusGraphKind } from "../canvas/NodeContextMenu";
import type { BusInjection } from "../power";
import { ToolWindow } from "../ui/ToolWindow";
import { PowerTriangle } from "./PowerTriangle";
import { Waveforms } from "./Waveforms";

export interface BusGraph {
  kind: BusGraphKind;
  inj: BusInjection;
  // Element name, shown in the title so a docked/detached window stays identifiable.
  label?: string;
}

// One element's power triangle / U-I waveform, shown in the same dockable,
// pop-out ToolWindow chrome as the other study panels.
export function BusGraphWindow({
  graph,
  onClose,
}: {
  graph: BusGraph | null;
  onClose: () => void;
}) {
  const waves = graph?.kind === "waves";
  const base = waves ? "Voltage / current waveform" : "Power triangle";
  return (
    <ToolWindow
      title={graph?.label ? `${base} — ${graph.label}` : base}
      opened={graph !== null}
      onClose={onClose}
      width={waves ? 420 : 440}
      height={waves ? 320 : 380}
      // Cascade the waveform off the triangle so both are visible when opened
      // together (both otherwise anchor to the same top-right corner).
      offset={waves ? 48 : 0}
    >
      {graph?.kind === "triangle" && (
        <PowerTriangle p={graph.inj.p_mw} q={graph.inj.q_mvar} />
      )}
      {graph?.kind === "waves" && (
        <Waveforms p={graph.inj.p_mw} q={graph.inj.q_mvar} />
      )}
    </ToolWindow>
  );
}
