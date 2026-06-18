import type { LoadFlowResult, Network } from "./types";

const BASE = "http://localhost:8000";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// Runs a load flow on a posted document.
export async function runLoadFlow(network: Network): Promise<LoadFlowResult> {
  return json(
    await fetch(`${BASE}/run-loadflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(network),
    }),
  );
}

// Serialize the current network to a single pandapower JSON (electrical net +
// diagram_* layout tables). Returns the raw JSON text for download.
export async function exportPandapower(network: Network): Promise<string> {
  const res = await fetch(`${BASE}/export/pandapower`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(network),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return res.text();
}

// Reconstruct the editor network from an uploaded pandapower JSON file.
export async function importPandapower(jsonText: string): Promise<Network> {
  return json(
    await fetch(`${BASE}/import/pandapower`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonText,
    }),
  );
}
