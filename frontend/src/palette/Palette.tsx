import { Group, Stack, Text, Paper } from "@mantine/core";
import type { ElementKind } from "../types";
import { BusGlyph, GeneratorGlyph, LoadGlyph, SwitchGlyph } from "../nodes/glyphs";

const ITEMS: { kind: ElementKind; label: string; hint: string }[] = [
  { kind: "bus", label: "Bus", hint: "Node — components attach here" },
  { kind: "generator", label: "Generator", hint: "Slack source (ext_grid)" },
  { kind: "load", label: "Load", hint: "Consumes power" },
  { kind: "switch", label: "Switch", hint: "Ties two buses (open/closed)" },
];

function Glyph({ kind }: { kind: ElementKind }) {
  if (kind === "generator") return <GeneratorGlyph size={34} />;
  if (kind === "load") return <LoadGlyph size={34} />;
  if (kind === "switch") return <SwitchGlyph size={40} />;
  return <BusGlyph width={34} />;
}

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
          <Group gap="sm" wrap="nowrap">
            <div
              style={{
                width: 40,
                display: "flex",
                justifyContent: "center",
                color: "var(--mantine-color-text)",
              }}
            >
              <Glyph kind={item.kind} />
            </div>
            <div>
              <Text size="sm" fw={600}>
                {item.label}
              </Text>
              <Text size="xs" c="dimmed">
                {item.hint}
              </Text>
            </div>
          </Group>
        </Paper>
      ))}
      <Text size="xs" c="dimmed" mt="md">
        Drag onto the canvas. Connect a generator/load handle to a bus.
      </Text>
    </Stack>
  );
}
