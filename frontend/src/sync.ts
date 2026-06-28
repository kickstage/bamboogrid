// Bridges optimistic local editor mutations to the authoritative server net.
//
// Every model-changing store action applies its change locally (so the canvas
// stays responsive) and enqueues a command here. Commands are batched and
// flushed shortly after edits settle, or explicitly before a load flow / export
// / import. `serverIds` tracks which elements the server already knows about, so
// a component dropped from the palette only becomes a server element once it is
// wired to a bus (it lives only in the browser until then).

import { ConflictError, sendCommands } from "./api";
import type { Command } from "./types";

export const serverIds = new Set<string>();

let queue: Command[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sessionId: () => string | null = () => null;
let onError: (message: string) => void = () => {};
let onHistory: (canUndo: boolean, canRedo: boolean) => void = () => {};
let onConflict: () => void = () => {};

export function configureSync(opts: {
  sessionId: () => string | null;
  onError: (message: string) => void;
  // Called after each flush with the session's resulting undo/redo availability.
  onHistory: (canUndo: boolean, canRedo: boolean) => void;
  // Called when the server rejected a flush as stale (HTTP 409): resync.
  onConflict: () => void;
}): void {
  sessionId = opts.sessionId;
  onError = opts.onError;
  onHistory = opts.onHistory;
  onConflict = opts.onConflict;
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
    const { can_undo, can_redo } = await sendCommands(id, batch);
    onHistory(can_undo, can_redo);
  } catch (err) {
    if (err instanceof ConflictError) {
      onConflict();
      return;
    }
    onError(`Sync failed: ${(err as Error).message}`);
  }
}

export function resetServerIds(ids: Iterable<string>): void {
  serverIds.clear();
  for (const id of ids) serverIds.add(id);
}
