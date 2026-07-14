import { useRef, useState } from "react";

export interface Draggable {
  // Attach to the element that should move.
  ref: React.RefObject<HTMLDivElement>;
  // Viewport (fixed) top-left once dragged, or null before first drag (so
  // callers can fall back to a default anchor like top-right).
  pos: { x: number; y: number } | null;
  // Wire to the drag handle's onPointerDown.
  onPointerDown: (e: React.PointerEvent) => void;
}

// Pointer-drag for a floating panel. Positions are viewport-relative and clamped
// to the window, so the panel can be moved anywhere (including over sidebars),
// not just within the canvas it's anchored to.
export function useDraggable(): Draggable {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    const panel = ref.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    const { width, height } = rect;
    const onMove = (ev: PointerEvent) => {
      const x = Math.max(
        0,
        Math.min(window.innerWidth - width, ev.clientX - offX),
      );
      const y = Math.max(
        0,
        Math.min(window.innerHeight - height, ev.clientY - offY),
      );
      setPos({ x, y });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return { ref, pos, onPointerDown };
}
