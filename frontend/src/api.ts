import type { Command, LoadFlowResult, ViewModel } from "./types";

const BASE = "";

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

// Fetch the current projection for a session (used to (re)hydrate the editor).
export async function getView(id: string): Promise<ViewModel> {
  return json(await fetch(`${BASE}/session`, { headers: { [SESSION_HEADER]: id } }));
}

// Apply a batch of edits to the session's authoritative net.
export async function sendCommands(id: string, cmds: Command[]): Promise<void> {
  const res = await fetch(`${BASE}/session/commands`, {
    method: "POST",
    headers: { ...JSON_HEADERS, [SESSION_HEADER]: id },
    body: JSON.stringify(cmds),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
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
