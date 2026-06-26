import { useEffect, useRef, useState } from "react";
import { Button, Divider, Paper, Stack, Text } from "@mantine/core";

export type BusGraphKind = "triangle" | "waves";

const item = {
  variant: "subtle",
  size: "xs",
  fullWidth: true,
  justify: "space-between",
  c: "white",
} as const;

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

function Hotkey({ children }: { children: React.ReactNode }) {
  return (
    <Text component="span" size="xs" c="dimmed" style={{ fontWeight: 400 }}>
      {children}
    </Text>
  );
}

// A right-click context menu for a canvas element: duplicate/copy actions and,
// for a bus, a nested "Graph" submenu. Hand-rolled (Mantine 7.17 has no public
// Menu.Sub) on the same floating Paper + backdrop pattern as the branch menu.
export function NodeContextMenu({
  x,
  y,
  canGraph,
  solved,
  onDuplicate,
  onCopy,
  onDelete,
  onGraph,
  onClose,
}: {
  x: number;
  y: number;
  canGraph: boolean;
  solved: boolean;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onGraph: (kind: BusGraphKind) => void;
  onClose: () => void;
}) {
  const [sub, setSub] = useState(false);
  // Close the submenu on a short delay so crossing the gap between "Graph" and
  // the submenu doesn't unmount it before the cursor lands; re-entering (the
  // submenu is a DOM descendant) cancels the pending close.
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
        <Stack gap={2}>
          <Button {...item} onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button {...item} rightSection={<Hotkey>{MOD}C</Hotkey>} onClick={onCopy}>
            Copy
          </Button>
          <Button
            {...item}
            c="red"
            rightSection={<Hotkey>⌫</Hotkey>}
            onClick={onDelete}
          >
            Delete
          </Button>
        </Stack>

        {canGraph && (
          <>
            <Divider my={4} />
            <div
              style={{ position: "relative" }}
              onMouseEnter={openSub}
              onMouseLeave={scheduleClose}
            >
              <Button
                {...item}
                justify="space-between"
                disabled={!solved}
                rightSection={<span aria-hidden>▸</span>}
              >
                Graph
              </Button>
              {!solved && (
                <Text size="xs" c="dimmed" px="xs" py={2}>
                  Run a load flow first
                </Text>
              )}
              {sub && solved && (
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
                    <Button {...item} onClick={() => onGraph("triangle")}>
                      Power triangle
                    </Button>
                    <Button {...item} onClick={() => onGraph("waves")}>
                      U/I waveform
                    </Button>
                  </Stack>
                </Paper>
              )}
            </div>
          </>
        )}
      </Paper>
    </>
  );
}
