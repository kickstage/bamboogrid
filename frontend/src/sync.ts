// Bridges optimistic local editor mutations to the authoritative server net.
//
// Every model-changing store action applies its change locally (so the canvas
// stays responsive) and enqueues a command here. Commands are batched and
// flushed shortly after edits settle, or explicitly before a load flow / export
// / import. `serverIds` tracks which elements the server already knows about, so
// a component dropped from the palette only becomes a server element once it is
// wired to a bus (it lives only in the browser until then).

import { ConflictError, sendCommands } from "./api";
import type { Command, SessionMeta } from "./types";

export const serverIds = new Set<string>();

let queue: Command[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sessionId: () => string | null = () => null;
let onError: (message: string) => void = () => {};
let onMeta: (meta: SessionMeta) => void = () => {};
let onConflict: () => void = () => {};
let onDirty: () => void = () => {};

export function configureSync(opts: {
  sessionId: () => string | null;
  onError: (message: string) => void;
  // Called after each flush with the session's resulting editor state.
  onMeta: (meta: SessionMeta) => void;
  // Called when the server rejected a flush as stale (HTTP 409): resync.
  onConflict: () => void;
  // Called as an edit is queued, so the scenario is marked unsaved without
  // waiting for the flush to confirm it.
  onDirty: () => void;
}): void {
  sessionId = opts.sessionId;
  onError = opts.onError;
  onMeta = opts.onMeta;
  onConflict = opts.onConflict;
  onDirty = opts.onDirty;
}

export function enqueue(cmd: Command): void {
  if (!sessionId()) return;
  onDirty();
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
    onMeta(await sendCommands(id, batch));
  } catch (err) {
    if (err instanceof ConflictError) {
      onConflict();
      return;
    }
    onError(`Sync failed: ${(err as Error).message}`);
  }
}

// Throw queued edits away unsent — when they'd be rejected (the session is about
// to become unreachable) or undone (a discard is reverting them anyway).
export function dropPending(): void {
  clearTimeout(timer);
  timer = undefined;
  queue = [];
}

export function resetServerIds(ids: Iterable<string>): void {
  serverIds.clear();
  for (const id of ids) serverIds.add(id);
}
