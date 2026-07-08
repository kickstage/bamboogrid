import { Group, Stack, Text, Paper } from "@mantine/core";
import { SectionLabel } from "../ui/Section";
import type { ElementKind } from "../types";
import {
  BusGlyph,
  ExtGridGlyph,
  GeneratorGlyph,
  LoadGlyph,
  SgenGlyph,
  ShuntGlyph,
  SvcGlyph,
  SwitchGlyph,
  TransformerGlyph,
  Transformer3WGlyph,
  XwardGlyph,
  ImpedanceGlyph,
} from "../nodes/glyphs";

type Item = { kind: ElementKind; label: string; hint: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Nodes",
    items: [
      { kind: "bus", label: "Bus", hint: "Node — components attach here" },
    ],
  },
  {
    title: "Sources",
    items: [
      { kind: "generator", label: "Generator", hint: "Fixed U injection" },
      { kind: "sgen", label: "Static generator", hint: "Fixed Q injection" },
      {
        kind: "extgrid",
        label: "External grid",
        hint: "Slack / voltage reference",
      },
    ],
  },
  {
    title: "Loads",
    items: [
      { kind: "load", label: "Load", hint: "Consumes power" },
    ],
  },
  {
    // Shunt-connected reactive devices — they support voltage, they don't
    // consume power, so they're kept apart from Loads.
    title: "Compensation",
    items: [
      {
        kind: "shunt",
        label: "Shunt",
        hint: "Capacitor / reactor (reactive support)",
      },
      {
        kind: "svc",
        label: "SVC",
        hint: "FACTS — dynamic voltage regulator",
      },
    ],
  },
  {
    title: "Connections",
    items: [
      { kind: "switch", label: "Switch", hint: "Ties two buses (open/closed)" },
      { kind: "trafo2w", label: "Transformer", hint: "2-winding (HV ↔ LV)" },
      {
        kind: "trafo3w",
        label: "3W transformer",
        hint: "3-winding (HV/MV/LV)",
      },
    ],
  },
  {
    // Uncommon elements, kept at the bottom so they don't clutter the common
    // workflow: a network equivalent and a raw per-unit series impedance.
    title: "Advanced",
    items: [
      {
        kind: "xward",
        label: "XWard",
        hint: "Reduced equivalent of an external network",
      },
      {
        kind: "impedance",
        label: "Impedance",
        hint: "Per-unit series branch between two buses",
      },
    ],
  },
];

function Glyph({ kind }: { kind: ElementKind }) {
  if (kind === "generator") return <GeneratorGlyph size={34} />;
  if (kind === "sgen") return <SgenGlyph size={34} />;
  if (kind === "extgrid") return <ExtGridGlyph size={34} />;
  if (kind === "load") return <LoadGlyph size={34} />;
  if (kind === "shunt") return <ShuntGlyph size={34} />;
  if (kind === "svc") return <SvcGlyph size={34} />;
  if (kind === "xward") return <XwardGlyph size={34} />;
  if (kind === "impedance") return <ImpedanceGlyph size={40} />;
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
          <SectionLabel>{group.title}</SectionLabel>
          {group.items.map((item) => (
            <PaletteItem
              key={item.kind}
              item={item}
              onDragStart={onDragStart}
            />
          ))}
        </Stack>
      ))}
      <Text size="xs" c="dimmed" mt="xs">
        Drag an element onto the canvas, then connect its handle to a bus. Drag
        from one bus to another to add a line, switch, or transformer.
      </Text>
    </Stack>
  );
}
