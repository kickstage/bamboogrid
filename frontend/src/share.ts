import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import type { Network } from "./types";

// A scenario is shared entirely inside the link: the network JSON is compressed
// and placed in the URL #hash (never sent to a server). The hash keeps the
// payload off the wire and out of server logs, and lets very long links work.
const HASH_KEY = "s";

// Layout coordinates: rounded to whole pixels in the share payload (sub-pixel
// precision is noise that doesn't compress and bloats the link).
const COORD_KEYS = new Set(["x", "y", "width"]);
// Fields holding an element id. They're remapped to short codes for sharing.
const ID_KEYS = new Set([
  "id",
  "bus_id",
  "bus_a",
  "bus_b",
  "hv_bus",
  "mv_bus",
  "lv_bus",
  "from_bus",
  "to_bus",
]);

// Shrink the share payload without changing what loads. The link rides in the
// URL, and its length is dominated by high-entropy data that doesn't compress:
// the random UUID ids (each ~40 chars, repeated across references) and full-
// precision drag coordinates. We remap ids to short sequential codes — rewriting
// every reference consistently — and round coordinates. Ids are opaque to the
// editor, so a freshly-loaded snapshot behaves identically. Empty refs ("") stay
// empty. Together this cuts a typical link by ~60%.
function minifyForShare(network: Network): Network {
  const codes = new Map<string, string>();
  const codeFor = (id: string): string => {
    let code = codes.get(id);
    if (code === undefined) {
      code = codes.size.toString(36);
      codes.set(id, code);
    }
    return code;
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (COORD_KEYS.has(k) && typeof v === "number") out[k] = Math.round(v);
        else if (ID_KEYS.has(k) && typeof v === "string" && v) out[k] = codeFor(v);
        else out[k] = walk(v);
      }
      return out;
    }
    return value;
  };
  return walk(network) as Network;
}

// Build a self-contained share URL for the given network.
export function buildShareUrl(network: Network): string {
  const payload = compressToEncodedURIComponent(
    JSON.stringify(minifyForShare(network)),
  );
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${HASH_KEY}=${payload}`;
}

// If the current URL carries a shared scenario, decode it; otherwise null.
export function readSharedNetwork(): Network | null {
  const hash = window.location.hash.replace(/^#/, "");
  const param = new URLSearchParams(hash).get(HASH_KEY);
  if (!param) return null;
  try {
    const json = decompressFromEncodedURIComponent(param);
    return json ? (JSON.parse(json) as Network) : null;
  } catch {
    return null;
  }
}

// Drop the share payload from the address bar (without reloading) so a later
// refresh restores the user's own autosaved work rather than re-loading the
// shared snapshot, and so their edits aren't mistaken for the original.
export function clearShareHash(): void {
  const { origin, pathname, search } = window.location;
  window.history.replaceState(null, "", `${origin}${pathname}${search}`);
}
