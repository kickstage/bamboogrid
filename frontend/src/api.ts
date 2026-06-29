import type {
  Command,
  LoadFlowResult,
  NetworkSummary,
  ShortCircuitResult,
  ViewModel,
} from "./types";

const BASE = "";

// A write lost the server's optimistic-version race (HTTP 409): the session was
// edited on another pod. Callers resync from the server rather than show an error.
export class ConflictError extends Error {}

// FastAPI error bodies are `{"detail": "..."}`; surface that human-readable
// message rather than the raw JSON wrapper. Falls back to the status text.
async function errorMessage(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.detail === "string") return parsed.detail;
  } catch {
    // not JSON; use the raw body
  }
  return body || `${res.status} ${res.statusText}`;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<T>;
}

// The session id travels as a bearer-style header, not in the URL.
const SESSION_HEADER = "X-Session-Id";
const JSON_HEADERS = { "Content-Type": "application/json" };

export interface SessionInfo {
  id: string;
  view: ViewModel;
}

// Start a fresh, empty server session and return its id and (empty) projection.
export async function createSession(): Promise<SessionInfo> {
  return json(await fetch(`${BASE}/session`, { method: "POST" }));
}

// Start a session pre-loaded with the IEEE 14-bus network (mobile demo default).
export async function createDemoSession(): Promise<SessionInfo> {
  return json(await fetch(`${BASE}/session/demo`, { method: "POST" }));
}

// A built-in pandapower example network offered under File ▸ Open example.
export interface Scenario {
  id: string;
  label: string;
}

// The curated example-network catalog (built on demand server-side).
export async function fetchScenarios(): Promise<Scenario[]> {
  return json(await fetch(`${BASE}/scenarios`));
}

// Start a session from a built-in example network, generated on demand.
export async function createScenarioSession(id: string): Promise<SessionInfo> {
  return json(await fetch(`${BASE}/session/scenario/${id}`, { method: "POST" }));
}

// Fetch the current projection for a session (used to (re)hydrate the editor).
export async function getView(id: string): Promise<ViewModel> {
  return json(await fetch(`${BASE}/session`, { headers: { [SESSION_HEADER]: id } }));
}

// The library transformer types keyed by name → their editable parameter set.
export type StdTrafoTypes = Record<string, Record<string, number>>;

const stdTypeCache: Partial<Record<"trafo" | "trafo3w", Promise<StdTrafoTypes>>> = {};

// Fetch (once, cached) pandapower's std transformer catalog, so the inspector can
// expand a chosen std_type into editable params. Session-independent static data.
export function fetchStdTypes(table: "trafo" | "trafo3w"): Promise<StdTrafoTypes> {
  if (!stdTypeCache[table]) {
    stdTypeCache[table] = fetch(`${BASE}/std-types/${table}`).then((r) =>
      json<StdTrafoTypes>(r),
    );
  }
  return stdTypeCache[table];
}

// The undo/redo availability a mutating call reports back.
export interface HistoryState {
  can_undo: boolean;
  can_redo: boolean;
}

// Apply a batch of edits to the session's authoritative net; returns the
// resulting undo/redo availability.
export async function sendCommands(
  id: string,
  cmds: Command[],
): Promise<HistoryState> {
  const res = await fetch(`${BASE}/session/commands`, {
    method: "POST",
    headers: { ...JSON_HEADERS, [SESSION_HEADER]: id },
    body: JSON.stringify(cmds),
  });
  if (res.status === 409) throw new ConflictError(await errorMessage(res));
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json() as Promise<HistoryState>;
}

// Restore the previous net state; returns the new projection to re-hydrate from.
export async function undo(id: string): Promise<ViewModel> {
  return json(
    await fetch(`${BASE}/session/undo`, {
      method: "POST",
      headers: { [SESSION_HEADER]: id },
    }),
  );
}

// Re-apply the next net state after an undo.
export async function redo(id: string): Promise<ViewModel> {
  return json(
    await fetch(`${BASE}/session/redo`, {
      method: "POST",
      headers: { [SESSION_HEADER]: id },
    }),
  );
}

// Mint a short share token for a session. Opening it clones the session.
export async function shareSession(id: string): Promise<string> {
  const res = await json<{ token: string }>(
    await fetch(`${BASE}/session/share`, {
      method: "POST",
      headers: { [SESSION_HEADER]: id },
    }),
  );
  return res.token;
}

// Open a share token: clones the shared session and returns the new copy.
export async function openShare(token: string): Promise<SessionInfo> {
  return json(await fetch(`${BASE}/share/${token}`, { method: "POST" }));
}

// Run a load flow on the retained net; results are keyed by editor element id.
export async function runLoadFlow(id: string): Promise<LoadFlowResult> {
  return json(
    await fetch(`${BASE}/session/run-loadflow`, {
      method: "POST",
      headers: { [SESSION_HEADER]: id },
    }),
  );
}

// Run an IEC 60909 3-phase (max) short circuit; results are keyed by bus id.
export async function runShortCircuit(id: string): Promise<ShortCircuitResult> {
  return json(
    await fetch(`${BASE}/session/run-shortcircuit`, {
      method: "POST",
      headers: { [SESSION_HEADER]: id },
    }),
  );
}

// Solve the retained net and return a power-balance / voltage / loading
// overview plus pandapower diagnostic findings.
export async function networkSummary(id: string): Promise<NetworkSummary> {
  return json(
    await fetch(`${BASE}/session/summary`, {
      method: "POST",
      headers: { [SESSION_HEADER]: id },
    }),
  );
}

// Replace the session's net with an uploaded pandapower JSON (ours or a plain
// pandapower net). Returns the new projection.
export async function importPandapower(
  id: string,
  jsonText: string,
): Promise<ViewModel> {
  return json(
    await fetch(`${BASE}/session/import`, {
      method: "POST",
      headers: { ...JSON_HEADERS, [SESSION_HEADER]: id },
      body: jsonText,
    }),
  );
}

// Serialize the retained net to a single pandapower JSON for download.
export async function exportPandapower(id: string): Promise<string> {
  const res = await fetch(`${BASE}/session/export`, {
    headers: { [SESSION_HEADER]: id },
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.text();
}
