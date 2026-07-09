import type {
  AuthResponse,
  Command,
  GridSummary,
  LoadFlowResult,
  LoadFlowSettings,
  NetworkSummary,
  ShortCircuitResult,
  User,
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

// The signed-in user's app token, mirrored here from the auth store so every
// request can carry it (see setAuthToken). null while a guest — the backend then
// treats the request as a guest, which is a valid state.
let authToken: string | null = null;

// Set (or clear) the app token sent as `Authorization: Bearer` on all requests.
// Called by the auth store whenever the token changes so callers don't thread it.
export function setAuthToken(token: string | null): void {
  authToken = token;
}

function authHeader(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

// Headers for a session-scoped request: the session id, the auth token if signed
// in, plus any extras (e.g. JSON content-type).
function sessionHeaders(
  id: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return { [SESSION_HEADER]: id, ...authHeader(), ...extra };
}

export interface SessionInfo {
  id: string;
  view: ViewModel;
}

// Start a fresh, empty server session and return its id and (empty) projection.
// Owned by the signed-in user (via the auth header), or a guest session.
export async function createSession(): Promise<SessionInfo> {
  return json(
    await fetch(`${BASE}/session`, { method: "POST", headers: authHeader() }),
  );
}

// Start a session pre-loaded with the IEEE 14-bus network (mobile demo default).
export async function createDemoSession(): Promise<SessionInfo> {
  return json(
    await fetch(`${BASE}/session/demo`, {
      method: "POST",
      headers: authHeader(),
    }),
  );
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
  return json(
    await fetch(`${BASE}/session/scenario/${id}`, {
      method: "POST",
      headers: authHeader(),
    }),
  );
}

// Fetch the current projection for a session (used to (re)hydrate the editor).
export async function getView(id: string): Promise<ViewModel> {
  return json(await fetch(`${BASE}/session`, { headers: sessionHeaders(id) }));
}

// --- Authentication --------------------------------------------------------

// Exchange a Google Identity Services credential for our app token + user.
export async function googleLogin(credential: string): Promise<AuthResponse> {
  return json(
    await fetch(`${BASE}/auth/google`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ credential }),
    }),
  );
}

// The user for the current app token (used to rehydrate auth state on load).
// Throws if the token is missing/expired — callers fall back to guest.
export async function fetchMe(): Promise<User> {
  return json(await fetch(`${BASE}/me`, { headers: authHeader() }));
}

// The signed-in user's saved grids, newest first
export async function listGrids(): Promise<GridSummary[]> {
  return json(await fetch(`${BASE}/sessions`, { headers: authHeader() }));
}

// Attach a guest session to the signed-in user so it's saved to their account.
export async function claimGrid(id: string): Promise<SessionInfo> {
  return json(
    await fetch(`${BASE}/session/${id}/claim`, {
      method: "POST",
      headers: authHeader(),
    }),
  );
}

// Delete one of the signed-in user's grids.
export async function deleteGrid(id: string): Promise<void> {
  const res = await fetch(`${BASE}/session/${id}`, {
    method: "DELETE",
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

// The library transformer types keyed by name → their editable parameter set.
// Values are mostly numbers; the tap changer adds a couple of string fields
// (tap_side, tap_changer_type).
export type StdTrafoTypes = Record<string, Record<string, number | string>>;

const stdTypeCache: Partial<
  Record<"trafo" | "trafo3w", Promise<StdTrafoTypes>>
> = {};

// Fetch (once, cached) pandapower's std transformer catalog, so the inspector can
// expand a chosen std_type into editable params. Session-independent static data.
export function fetchStdTypes(
  table: "trafo" | "trafo3w",
): Promise<StdTrafoTypes> {
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
    headers: sessionHeaders(id, JSON_HEADERS),
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
      headers: sessionHeaders(id),
    }),
  );
}

// Re-apply the next net state after an undo.
export async function redo(id: string): Promise<ViewModel> {
  return json(
    await fetch(`${BASE}/session/redo`, {
      method: "POST",
      headers: sessionHeaders(id),
    }),
  );
}

// Mint a short share token for a session. Opening it clones the session.
export async function shareSession(id: string): Promise<string> {
  const res = await json<{ token: string }>(
    await fetch(`${BASE}/session/share`, {
      method: "POST",
      headers: sessionHeaders(id),
    }),
  );
  return res.token;
}

// Open a share token: clones the shared session and returns the new copy. The
// copy is owned by the opener if signed in (via the auth header).
export async function openShare(token: string): Promise<SessionInfo> {
  return json(
    await fetch(`${BASE}/share/${token}`, {
      method: "POST",
      headers: authHeader(),
    }),
  );
}

// A load flow that hasn't answered within this budget is abandoned. The solve
// is CPU-bound; under load the server queues requests, and one waiting this long
// is unlikely to return soon. Aborting closes the connection, which lets the
// backend drop the still-queued request instead of spending a core on a result
// no one is waiting for.
const LOAD_FLOW_TIMEOUT_MS = 5000;

// Run a load flow on the retained net; results are keyed by editor element id.
export async function runLoadFlow(id: string): Promise<LoadFlowResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/session/run-loadflow`, {
      method: "POST",
      headers: sessionHeaders(id),
      signal: AbortSignal.timeout(LOAD_FLOW_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new Error(
        `Load flow timed out after ${LOAD_FLOW_TIMEOUT_MS / 1000}s — the server is busy. Try again in a moment.`,
      );
    }
    throw err;
  }
  return json(res);
}

// Run an IEC 60909 3-phase (max) short circuit; results are keyed by bus id.
export async function runShortCircuit(id: string): Promise<ShortCircuitResult> {
  return json(
    await fetch(`${BASE}/session/run-shortcircuit`, {
      method: "POST",
      headers: sessionHeaders(id),
    }),
  );
}

// The session's current load-flow (runpp) settings.
export async function getLoadFlowSettings(
  id: string,
): Promise<LoadFlowSettings> {
  return json(
    await fetch(`${BASE}/session/loadflow-settings`, {
      headers: sessionHeaders(id),
    }),
  );
}

// Persist updated load-flow (runpp) settings; returns the stored settings.
export async function updateLoadFlowSettings(
  id: string,
  settings: LoadFlowSettings,
): Promise<LoadFlowSettings> {
  return json(
    await fetch(`${BASE}/session/loadflow-settings`, {
      method: "PUT",
      headers: sessionHeaders(id, JSON_HEADERS),
      body: JSON.stringify(settings),
    }),
  );
}

// Solve the retained net and return a power-balance / voltage / loading
// overview plus pandapower diagnostic findings.
export async function networkSummary(id: string): Promise<NetworkSummary> {
  return json(
    await fetch(`${BASE}/session/summary`, {
      method: "POST",
      headers: sessionHeaders(id),
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
      headers: sessionHeaders(id, JSON_HEADERS),
      body: jsonText,
    }),
  );
}

// Serialize the retained net to a single pandapower JSON for download.
export async function exportPandapower(id: string): Promise<string> {
  const res = await fetch(`${BASE}/session/export`, {
    headers: sessionHeaders(id),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.text();
}
