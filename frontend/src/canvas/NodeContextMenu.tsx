import { Button, Divider, Paper, Stack, Text } from "@mantine/core";

import { Submenu } from "../ui/Submenu";
import { useClampedPosition } from "../ui/useClampedPosition";

export type BusGraphKind = "triangle" | "waves";

const item = {
  variant: "subtle",
  color: "gray",
  size: "xs",
  fullWidth: true,
  justify: "space-between",
  c: "var(--mantine-color-text)",
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
// for a bus, a nested "Graph" flyout submenu. Closing (click-away / Escape) is
// handled globally by the canvas.
export function NodeContextMenu({
  x,
  y,
  canGraph,
  solved,
  onDuplicate,
  onCopy,
  onDelete,
  onGraph,
}: {
  x: number;
  y: number;
  canGraph: boolean;
  solved: boolean;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onGraph: (kind: BusGraphKind) => void;
}) {
  const { ref, left, top } = useClampedPosition(x, y);
  return (
    <Paper
      ref={ref}
      data-canvas-menu
      shadow="md"
      withBorder
      p={4}
      bg="light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))"
      style={{ position: "fixed", left, top, zIndex: 11, minWidth: 160 }}
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
            <Submenu
              disabled={!solved}
              trigger={() => (
                <Button
                  {...item}
                  disabled={!solved}
                  rightSection={<span aria-hidden>▸</span>}
                >
                  Graph
                </Button>
              )}
            >
              <Stack gap={2}>
                <Button {...item} onClick={() => onGraph("triangle")}>
                  Power triangle
                </Button>
                <Button {...item} onClick={() => onGraph("waves")}>
                  U/I waveform
                </Button>
              </Stack>
            </Submenu>
            {!solved && (
              <Text size="xs" c="dimmed" px="xs" py={2}>
                Run a load flow first
              </Text>
            )}
          </>
        )}
    </Paper>
  );
}
