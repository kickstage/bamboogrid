import { updateLoadFlowSettings } from "../api";
import type { LoadFlowSettings } from "../types";

// Load-flow settings are a browser-level preference: they're stored on each
// session's net (so a load flow / summary / export uses them), but also mirrored
// here so they survive opening a brand-new network or example.
const KEY = "bamboogrid:loadFlowSettings";

export function readSavedLoadFlowSettings(): LoadFlowSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LoadFlowSettings) : null;
  } catch {
    return null;
  }
}

export function saveLoadFlowSettingsLocal(settings: LoadFlowSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // best-effort; the server copy is still authoritative for the session
  }
}

// Push the browser's saved settings onto a freshly created session so the user's
// preferences carry over to a new network/example. No-op when nothing is saved.
export async function applySavedLoadFlowSettings(
  sessionId: string,
): Promise<void> {
  const saved = readSavedLoadFlowSettings();
  if (!saved) return;
  try {
    await updateLoadFlowSettings(sessionId, saved);
  } catch {
    // non-critical: the new session just keeps its defaults
  }
}
