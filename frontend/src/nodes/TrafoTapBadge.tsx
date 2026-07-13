import { useEffect, useState } from "react";
import { ActionIcon, Group, Popover, Text } from "@mantine/core";
import { ACCENT } from "../theme";
import { useEditor } from "../store";
import type { Trafo2WParams, Trafo3WParams } from "../types";

// A small tap-position tag overlapping a transformer's top-right corner, shown
// only when a tap changer is configured. Clicking it opens a compact stepper to
// nudge the operating tap position (clamped to tap_min…tap_max). Tabular presets
// and read-only sessions show the tag but can't change it.
export function TrafoTapBadge({
  nodeId,
  params,
  right = -7,
  selected = false,
}: {
  nodeId: string;
  params: Trafo2WParams | Trafo3WParams;
  right?: number;
  selected?: boolean;
}) {
  const setTrafoTapPos = useEditor((s) => s.setTrafoTapPos);
  const readOnly = useEditor((s) => s.readOnly);
  const [open, setOpen] = useState(false);

  // React Flow's drag handling stops pointer events from bubbling, so Mantine's
  // default click-outside never fires. Detect it ourselves in the capture phase,
  // ignoring clicks on the badge or its dropdown (both tagged data-tap-popover).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-tap-popover]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const type = params.tap_changer_type;
  if (!type) return null;

  const neutral = params.tap_neutral ?? 0;
  const pos = params.tap_pos ?? neutral;
  const min = params.tap_min ?? null;
  const max = params.tap_max ?? null;
  const side = params.tap_side ? params.tap_side.toUpperCase() : null;
  const editable = !readOnly && type !== "Tabular";
  // Match the glyph: accent while selected, otherwise the node's own text color.
  const color = selected ? ACCENT : "currentColor";

  const step = (delta: number) => {
    let next = pos + delta;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    if (next !== pos) setTrafoTapPos(nodeId, next, params);
  };

  const badge = (
    <div
      className="nodrag nopan"
      data-tap-popover
      title={`Tap changer${side ? ` (${side})` : ""}: position ${pos}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (editable) setOpen((o) => !o);
      }}
      style={{
        position: "absolute",
        top: 5,
        right,
        zIndex: 2,
        minWidth: 16,
        height: 16,
        padding: "0 3px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        background: "var(--mantine-color-body)",
        color,
        fontSize: 9,
        fontWeight: 700,
        lineHeight: "14px",
        textAlign: "center",
        cursor: editable ? "pointer" : "default",
      }}
    >
      {pos}
    </div>
  );

  if (!editable) return badge;

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="top"
      withArrow
      shadow="md"
      trapFocus
      closeOnClickOutside={false}
    >
      <Popover.Target>{badge}</Popover.Target>
      <Popover.Dropdown
        className="nodrag nopan"
        data-tap-popover
        p={6}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Group gap={6} wrap="nowrap" justify="center">
          <ActionIcon
            size="sm"
            variant="default"
            disabled={min != null && pos <= min}
            onClick={() => step(-1)}
            aria-label="Lower tap position"
          >
            −
          </ActionIcon>
          <Text size="sm" fw={600} ta="center" style={{ minWidth: 32 }}>
            {pos}
          </Text>
          <ActionIcon
            size="sm"
            variant="default"
            disabled={max != null && pos >= max}
            onClick={() => step(1)}
            aria-label="Raise tap position"
          >
            +
          </ActionIcon>
        </Group>
        {(min != null || max != null) && (
          <Text size="xs" c="dimmed" ta="center" mt={4}>
            {min ?? "–"} … {max ?? "–"}
            {side ? ` · ${side}` : ""}
          </Text>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
