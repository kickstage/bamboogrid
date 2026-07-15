// The signed-in user's saved-grids library: open, create, rename, or delete a
// grid. The actual session switching lives in App (it owns attachSession); this
// component fetches the list and delegates the mutations through callbacks.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Group,
  Loader,
  Menu,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { listGrids } from "../api";
import { DEFAULT_SCENARIO_NAME } from "../store";
import { toast } from "../toast";
import type { GridSummary } from "../types";

// A compact "3 minutes ago" / "2 days ago" from a Unix-seconds timestamp.
function relativeTime(unixSeconds: number): string {
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  const units: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let value = secs;
  let unit = "second";
  for (const [size, name] of units) {
    if (value < size) {
      unit = name;
      break;
    }
    value = Math.floor(value / size);
    unit = name;
  }
  if (unit === "second" && value < 5) return "just now";
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

function GridRow({
  grid,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  grid: GridSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(grid.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = async () => {
    const name = draft.trim();
    setEditing(false);
    if (!name || name === grid.name) {
      setDraft(grid.name);
      return;
    }
    await onRename(name);
  };

  if (editing) {
    return (
      <TextInput
        ref={inputRef}
        size="sm"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(grid.name);
            setEditing(false);
          }
        }}
        onBlur={() => void commit()}
      />
    );
  }

  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      px="sm"
      py={8}
      style={{
        borderRadius: 8,
        cursor: "pointer",
        background: active ? "var(--mantine-color-default-hover)" : undefined,
      }}
      onClick={onOpen}
    >
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={500} truncate>
          {grid.name || DEFAULT_SCENARIO_NAME}
          {active && (
            <Text component="span" size="xs" c="dimmed" fw={400}>
              {"  · open"}
            </Text>
          )}
        </Text>
        <Text size="xs" c="dimmed">
          Saved {relativeTime(grid.saved_at)}
        </Text>
      </div>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label="Grid actions"
            onClick={(e) => e.stopPropagation()}
          >
            ⋯
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
          <Menu.Item
            onClick={() => {
              setDraft(grid.name);
              setEditing(true);
            }}
          >
            Rename
          </Menu.Item>
          <Menu.Item color="red" onClick={onDelete}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

export function GridsModal({
  opened,
  onClose,
  currentId,
  onOpen,
  onDelete,
  onRename,
}: {
  opened: boolean;
  onClose: () => void;
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
}) {
  const [grids, setGrids] = useState<GridSummary[] | null>(null);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      setGrids(await listGrids());
    } catch (err) {
      toast.error(`Could not load your scenarios: ${(err as Error).message}`);
      setGrids([]);
    }
  }, []);

  useEffect(() => {
    if (opened) {
      setGrids(null);
      setQuery("");
      void refresh();
    }
  }, [opened, refresh]);

  const q = query.trim().toLowerCase();
  const filtered = (grids ?? []).filter((g) =>
    (g.name || DEFAULT_SCENARIO_NAME).toLowerCase().includes(q),
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="My scenarios"
      size="md"
      centered
    >
      <Stack gap="sm">
        {grids === null ? (
          <Group justify="center" py="lg">
            <Loader size="sm" />
          </Group>
        ) : grids.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="lg">
            No saved scenarios yet. Anything you build while signed in is saved
            here.
          </Text>
        ) : (
          <>
            <TextInput
              placeholder="Search scenarios…"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            {filtered.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py="lg">
                No scenarios match “{query.trim()}”.
              </Text>
            ) : (
              <ScrollArea.Autosize mah={360}>
                <Stack gap={2}>
                  {filtered.map((grid) => (
                    <GridRow
                      key={grid.id}
                      grid={grid}
                      active={grid.id === currentId}
                      onOpen={() => {
                        onOpen(grid.id);
                        onClose();
                      }}
                      onRename={async (name) => {
                        await onRename(grid.id, name);
                        await refresh();
                      }}
                      onDelete={async () => {
                        if (
                          !window.confirm(
                            `Delete "${grid.name || DEFAULT_SCENARIO_NAME}"? This can't be undone.`,
                          )
                        )
                          return;
                        await onDelete(grid.id);
                        await refresh();
                      }}
                    />
                  ))}
                </Stack>
              </ScrollArea.Autosize>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
