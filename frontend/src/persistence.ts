import type { Network } from "./types";
import { useEditor } from "./store";

// The editor autosaves the current scenario here so a refresh or accidental tab
// close doesn't lose work — it's restored on next load. Bump the version suffix
// if the persisted shape ever changes incompatibly.
const KEY = "bamboogrid:autosave:v1";

export function saveNetwork(network: Network): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(network));
  } catch {
    // Storage can be full or disabled (private mode): autosave is best-effort.
  }
}

export function loadSavedNetwork(): Network | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Network) : null;
  } catch {
    return null;
  }
}

export function clearSavedNetwork(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// Subscribe to the store and persist the network shortly after edits settle.
// Debounced so dragging a node (which fires many changes) writes once. Returns
// an unsubscribe function. Only the network-defining slices are watched, so
// transient UI (selection, messages, results toggle) doesn't trigger a save.
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => saveNetwork(useEditor.getState().toNetwork()), 500);
  };
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (
      state.nodes !== prev.nodes ||
      state.edges !== prev.edges ||
      state.networkName !== prev.networkName ||
      state.f_hz !== prev.f_hz ||
      state.sn_mva !== prev.sn_mva
    ) {
      schedule();
    }
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
