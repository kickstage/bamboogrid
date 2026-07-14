import { useEffect, useRef } from "react";

import { useEditor } from "../store";

// Keeps a network-derived study panel (Y-bus, summary) in sync with the server
// net while it's open: an immediate fetch on open, then a debounced "quiet"
// re-fetch on every net change (so a burst of edits triggers a single re-solve).
// `load(false)` shows the loader; `load(true)` swaps data in place.
export function useLiveRefresh(
  open: boolean,
  load: (quiet?: boolean) => void | Promise<void>,
): void {
  const netRevision = useEditor((s) => s.netRevision);

  useEffect(() => {
    if (open) void load(false);
  }, [open, load]);

  // Skip the tick right after opening; the effect above already fetched.
  const skip = useRef(true);
  useEffect(() => {
    if (!open) {
      skip.current = true;
      return;
    }
    if (skip.current) {
      skip.current = false;
      return;
    }
    const t = setTimeout(() => void load(true), 400);
    return () => clearTimeout(t);
  }, [open, netRevision, load]);
}
