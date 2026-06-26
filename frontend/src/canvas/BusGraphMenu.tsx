import { useEffect, useRef, useState } from "react";
import { Button, Paper, Stack, Text } from "@mantine/core";

export type BusGraphKind = "triangle" | "waves";

// A right-click context menu for a bus with a nested "Graph" submenu. Hand-rolled
// (Mantine 7.17 has no public Menu.Sub) on the same floating Paper + backdrop
// pattern as the canvas branch menu. When the bus has no solved injection the
// graphs would be empty, so the submenu is replaced by a hint.
export function BusGraphMenu({
  x,
  y,
  hasInjection,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  hasInjection: boolean;
  onPick: (kind: BusGraphKind) => void;
  onClose: () => void;
}) {
  const [sub, setSub] = useState(false);
  // Close the submenu on a short delay so crossing the small gap between the
  // "Graph" item and the submenu doesn't unmount it before the cursor lands;
  // re-entering (the submenu is a DOM descendant) cancels the pending close.
  const closeTimer = useRef<number | null>(null);
  const openSub = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setSub(true);
  };
  const scheduleClose = () => {
    closeTimer.current = window.setTimeout(() => setSub(false), 150);
  };
  useEffect(
    () => () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    },
    [],
  );
  return (
    <>
      {/* Click-away backdrop. */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
      <Paper
        shadow="md"
        withBorder
        p={4}
        style={{ position: "fixed", left: x, top: y, zIndex: 11, minWidth: 160 }}
      >
        <div
          style={{ position: "relative" }}
          onMouseEnter={openSub}
          onMouseLeave={scheduleClose}
        >
          <Button
            variant="subtle"
            size="xs"
            fullWidth
            justify="space-between"
            disabled={!hasInjection}
            c="white"
            rightSection={<span aria-hidden>▸</span>}
          >
            Graph
          </Button>
          {!hasInjection && (
            <Text size="xs" c="dimmed" px="xs" py={2}>
              Run a load flow first
            </Text>
          )}
          {sub && hasInjection && (
            <Paper
              shadow="md"
              withBorder
              p={4}
              style={{
                position: "absolute",
                left: "100%",
                top: 0,
                marginLeft: 4,
                zIndex: 12,
                minWidth: 170,
              }}
            >
              <Stack gap={2}>
                <Button
                  variant="subtle"
                  size="xs"
                  fullWidth
                  justify="flex-start"
                  c="white"
                  onClick={() => onPick("triangle")}
                >
                  Power triangle
                </Button>
                <Button
                  variant="subtle"
                  size="xs"
                  fullWidth
                  justify="flex-start"
                  c="white"
                  onClick={() => onPick("waves")}
                >
                  U/I waveform
                </Button>
              </Stack>
            </Paper>
          )}
        </div>
      </Paper>
    </>
  );
}
