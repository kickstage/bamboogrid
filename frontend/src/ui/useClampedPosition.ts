import { useLayoutEffect, useRef, useState } from "react";

// Gap kept between a floating menu and the viewport edge.
const PAD = 8;

// Clamp a `position: fixed` floating element to the viewport given its desired
// top-left anchor (e.g. a right-click point). Measured in a layout effect so the
// correction lands before paint — no visible jump. Returns a ref to attach to
// the element and the resolved coordinates.
export function useClampedPosition(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(PAD, Math.min(x, window.innerWidth - width - PAD)),
      top: Math.max(PAD, Math.min(y, window.innerHeight - height - PAD)),
    });
  }, [x, y]);
  return { ref, left: pos.left, top: pos.top };
}
