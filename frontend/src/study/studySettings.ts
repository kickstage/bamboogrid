import {
  updateEstimationSettings,
  updateLoadFlowSettings,
  updateShortCircuitSettings,
} from "../api";
import type {
  LoadFlowSettings,
  ShortCircuitSettings,
  StateEstimationSettings,
} from "../types";

// Study settings are a browser-level preference: they're stored on each session's
// net (so a solve / summary / export uses them), but also mirrored here so they
// survive opening a brand-new network or example.
const LOAD_FLOW_KEY = "bamboogrid:loadFlowSettings";
const SHORT_CIRCUIT_KEY = "bamboogrid:shortCircuitSettings";
const ESTIMATION_KEY = "bamboogrid:estimationSettings";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort; the server copy is still authoritative for the session
  }
}

export const readSavedLoadFlowSettings = () =>
  read<LoadFlowSettings>(LOAD_FLOW_KEY);
export const saveLoadFlowSettingsLocal = (s: LoadFlowSettings) =>
  save(LOAD_FLOW_KEY, s);

export const readSavedShortCircuitSettings = () =>
  read<ShortCircuitSettings>(SHORT_CIRCUIT_KEY);
export const saveShortCircuitSettingsLocal = (s: ShortCircuitSettings) =>
  save(SHORT_CIRCUIT_KEY, s);

export const readSavedEstimationSettings = () =>
  read<StateEstimationSettings>(ESTIMATION_KEY);
export const saveEstimationSettingsLocal = (s: StateEstimationSettings) =>
  save(ESTIMATION_KEY, s);

// Push the browser's saved study settings onto a freshly created session so the
// user's preferences carry over to a new network/example. Each is best-effort and
// a no-op when nothing is saved: a new session just keeps its defaults.
export async function applySavedStudySettings(sessionId: string): Promise<void> {
  const lf = readSavedLoadFlowSettings();
  const sc = readSavedShortCircuitSettings();
  const est = readSavedEstimationSettings();
  await Promise.all([
    lf ? updateLoadFlowSettings(sessionId, lf).catch(() => {}) : null,
    sc ? updateShortCircuitSettings(sessionId, sc).catch(() => {}) : null,
    est ? updateEstimationSettings(sessionId, est).catch(() => {}) : null,
  ]);
}
