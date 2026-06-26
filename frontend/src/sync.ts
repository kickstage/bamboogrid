// Bridges optimistic local editor mutations to the authoritative server net.
//
// Every model-changing store action applies its change locally (so the canvas
// stays responsive) and enqueues a command here. Commands are batched and
// flushed shortly after edits settle, or explicitly before a load flow / export
// / import. `serverIds` tracks which elements the server already knows about, so
// a component dropped from the palette only becomes a server element once it is
// wired to a bus (it lives only in the browser until then).

import { sendCommands } from "./api";
import type { Command } from "./types";

export const serverIds = new Set<string>();

let queue: Command[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sessionId: () => string | null = () => null;
let onError: (message: string) => void = () => {};

export function configureSync(opts: {
  sessionId: () => string | null;
  onError: (message: string) => void;
}): void {
  sessionId = opts.sessionId;
  onError = opts.onError;
}

export function enqueue(cmd: Command): void {
  if (!sessionId()) return;
  queue.push(cmd);
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flushPending();
  }, 150);
}

// Send any queued commands now. Awaited before reads that must reflect pending
// edits (load flow, export, import).
export async function flushPending(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const id = sessionId();
  if (!id || queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await sendCommands(id, batch);
  } catch (err) {
    onError(`Sync failed: ${(err as Error).message}`);
  }
}

export function resetServerIds(ids: Iterable<string>): void {
  serverIds.clear();
  for (const id of ids) serverIds.add(id);
}
