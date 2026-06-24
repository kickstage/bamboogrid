import { Group, Stack, Text, Paper } from "@mantine/core";
import type { ElementKind } from "../types";
import {
  BusGlyph,
  ExtGridGlyph,
  GeneratorGlyph,
  LoadGlyph,
  SgenGlyph,
  SwitchGlyph,
  TransformerGlyph,
  Transformer3WGlyph,
} from "../nodes/glyphs";

type Item = { kind: ElementKind; label: string; hint: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Nodes",
    items: [{ kind: "bus", label: "Bus bar", hint: "Node — components attach here" }],
  },
  {
    title: "Sources",
    items: [
      { kind: "generator", label: "Generator", hint: "Sets P + voltage; can be slack" },
      { kind: "sgen", label: "Static generator", hint: "PQ injection (PV/wind/storage)" },
      { kind: "extgrid", label: "External grid", hint: "Slack / voltage reference" },
    ],
  },
  {
    title: "Loads",
    items: [{ kind: "load", label: "Load", hint: "Consumes power" }],
  },
  {
    title: "Connections",
    items: [
      { kind: "switch", label: "Switch", hint: "Ties two buses (open/closed)" },
      { kind: "trafo2w", label: "Transformer", hint: "2-winding (HV ↔ LV)" },
      { kind: "trafo3w", label: "3W transformer", hint: "3-winding (HV/MV/LV)" },
    ],
  },
];

function Glyph({ kind }: { kind: ElementKind }) {
  if (kind === "generator") return <GeneratorGlyph size={34} />;
  if (kind === "sgen") return <SgenGlyph size={34} />;
  if (kind === "extgrid") return <ExtGridGlyph size={34} />;
  if (kind === "load") return <LoadGlyph size={34} />;
  if (kind === "switch") return <SwitchGlyph size={40} />;
  if (kind === "trafo2w") return <TransformerGlyph size={26} />;
  if (kind === "trafo3w") return <Transformer3WGlyph size={34} />;
  return <BusGlyph width={34} />;
}

function PaletteItem({
  item,
  onDragStart,
}: {
  item: Item;
  onDragStart: (e: React.DragEvent, kind: ElementKind) => void;
}) {
  return (
    <Paper
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
  );
}

export function Palette() {
  const onDragStart = (e: React.DragEvent, kind: ElementKind) => {
    e.dataTransfer.setData("application/bamboogrid", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <Stack gap="md" p="sm">
      {GROUPS.map((group) => (
        <Stack key={group.title} gap="xs">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">
            {group.title}
          </Text>
          {group.items.map((item) => (
            <PaletteItem key={item.kind} item={item} onDragStart={onDragStart} />
          ))}
        </Stack>
      ))}
      <Text size="xs" c="dimmed" mt="xs">
        Drag onto the canvas. Connect a generator/load handle to a bus. Drag bus →
        bus and pick what to add (line or switch; a transformer across voltages).
      </Text>
    </Stack>
  );
}
