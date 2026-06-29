import { useEffect, useRef, useState } from "react";
import { Paper } from "@mantine/core";

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

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      {trigger(opened)}
      {opened && !disabled && (
        <Paper
          shadow="md"
          withBorder
          p={4}
          bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
          style={{
            position: "absolute",
            left: "100%",
            top: 0,
            marginLeft: 4,
            zIndex: 1,
            minWidth,
          }}
        >
          {children}
        </Paper>
      )}
    </div>
  );
}
