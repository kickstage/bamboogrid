import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Paper } from "@mantine/core";

// Gap kept between the flyout and the viewport edge.
const PAD = 8;

// A hover-activated flyout that opens a floating panel to the right of its
// trigger — the desktop submenu pattern shared by the menu bar and the canvas
// context menu. Mantine 7.17 has no public Menu.Sub, so this is hand-rolled.
//
// The panel is a DOM descendant of the trigger wrapper, so moving the cursor
// into it counts as re-entering (cancelling the pending close); the short close
// delay covers the gap between the trigger and the panel.
export function Submenu({
  trigger,
  children,
  disabled = false,
  minWidth = 170,
}: {
  trigger: (opened: boolean) => React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  minWidth?: number;
}) {
  const [opened, setOpened] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  // Default placement: to the right of the trigger, top-aligned. Adjusted in a
  // layout effect to flip leftward and/or shift up when it would overflow.
  const [placement, setPlacement] = useState<React.CSSProperties>({
    left: "100%",
    marginLeft: 4,
    top: 0,
  });

  const open = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (!disabled) setOpened(true);
  };
  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setOpened(false), 150);
  };
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!opened || disabled) return;
    const el = flyoutRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next: React.CSSProperties =
      r.right > window.innerWidth - PAD
        ? { right: "100%", marginRight: 4, top: 0 }
        : { left: "100%", marginLeft: 4, top: 0 };
    const overflowY = r.bottom - (window.innerHeight - PAD);
    if (overflowY > 0) next.top = -overflowY;
    setPlacement(next);
  }, [opened, disabled]);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      {trigger(opened)}
      {opened && !disabled && (
        <Paper
          ref={flyoutRef}
          shadow="md"
          withBorder
          p={4}
          bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
          style={{
            position: "absolute",
            zIndex: 1,
            minWidth,
            ...placement,
          }}
        >
          {children}
        </Paper>
      )}
    </div>
  );
}
