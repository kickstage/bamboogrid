import { useCallback, useState } from "react";

export interface Resizable {
  // Current size once resized, or null before first resize (so callers fall back
  // to their default width/height).
  size: { width: number; height: number } | null;
  // Wire to the resize handle's onPointerDown.
  onPointerDown: (e: React.PointerEvent) => void;
  // Return to the default size (e.g. when the panel closes).
  reset: () => void;
}

// Pointer-drag resize for a floating panel, measured from a corner handle. The
// panel element is read through `panelRef`; sizes are clamped to a floor and to
// what fits below/right of the panel's current top-left in the viewport.
export function useResizable(
  panelRef: { readonly current: HTMLElement | null },
  min: { width: number; height: number },
): Resizable {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );

  const onPointerDown = (e: React.PointerEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    // Don't let the press bubble to the canvas (deselect) or start a drag.
    e.preventDefault();
    e.stopPropagation();
    const rect = panel.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;
    const { left, top } = rect;
    const onMove = (ev: PointerEvent) => {
      const width = Math.max(
        min.width,
        Math.min(window.innerWidth - left - 8, startW + (ev.clientX - startX)),
      );
      const height = Math.max(
        min.height,
        Math.min(window.innerHeight - top - 8, startH + (ev.clientY - startY)),
      );
      setSize({ width, height });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return { size, onPointerDown, reset: useCallback(() => setSize(null), []) };
}
