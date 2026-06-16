import { Stack, Text, Paper } from "@mantine/core";
import type { ElementKind } from "../types";

const ITEMS: { kind: ElementKind; label: string; hint: string }[] = [
  { kind: "bus", label: "Bus", hint: "Node — components attach here" },
  { kind: "generator", label: "Generator", hint: "Slack source (ext_grid)" },
  { kind: "load", label: "Load", hint: "Consumes power" },
];

export function Palette() {
  const onDragStart = (e: React.DragEvent, kind: ElementKind) => {
    e.dataTransfer.setData("application/bamboogrid", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <Stack gap="xs" p="sm">
      <Text size="sm" fw={700} c="dimmed">
        ELEMENTS
      </Text>
      {ITEMS.map((item) => (
        <Paper
          key={item.kind}
          withBorder
          p="xs"
          radius="md"
          draggable
          onDragStart={(e) => onDragStart(e, item.kind)}
          style={{ cursor: "grab" }}
        >
          <Text size="sm" fw={600}>
            {item.label}
          </Text>
          <Text size="xs" c="dimmed">
            {item.hint}
          </Text>
        </Paper>
      ))}
      <Text size="xs" c="dimmed" mt="md">
        Drag onto the canvas. Connect a generator/load handle to a bus.
      </Text>
    </Stack>
  );
}
