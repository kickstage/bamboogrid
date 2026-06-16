import type { LoadFlowResult, Network, NetworkSummary } from "./types";

const BASE = "http://localhost:8000";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  return json(await fetch(`${BASE}/networks`));
}

export async function createNetwork(network: Network): Promise<Network> {
  return json(
    await fetch(`${BASE}/networks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(network),
    }),
  );
}

export async function updateNetwork(network: Network): Promise<Network> {
  return json(
    await fetch(`${BASE}/networks/${network.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(network),
    }),
  );
}

export async function getNetwork(id: string): Promise<Network> {
  return json(await fetch(`${BASE}/networks/${id}`));
}

// Runs a load flow on a posted (possibly unsaved) document.
export async function runLoadFlow(network: Network): Promise<LoadFlowResult> {
  return json(
    await fetch(`${BASE}/run-loadflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(network),
    }),
  );
}
