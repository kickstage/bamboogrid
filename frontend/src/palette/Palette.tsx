import { useState } from "react";
import {
  CloseButton,
  Collapse,
  Group,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { SectionLabel } from "../ui/Section";
import "./palette.css";
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
    items: [{ kind: "load", label: "Load", hint: "Consumes power" }],
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

// A disclosure chevron that points right when collapsed, down when open.
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={9}
      height={9}
      viewBox="0 0 10 10"
      aria-hidden
      style={{
        flex: "none",
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 150ms ease",
      }}
    >
      <path
        d="M3 1 L7 5 L3 9"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// A compact, draggable element row: the glyph and its label on one line, with
// the longer description on hover so the palette stays short.
function PaletteItem({
  item,
  onDragStart,
}: {
  item: Item;
  onDragStart: (e: React.DragEvent, kind: ElementKind) => void;
}) {
  return (
    <Group
      className="paletteRow"
      title={item.hint}
      gap="xs"
      wrap="nowrap"
      draggable
      onDragStart={(e) => onDragStart(e, item.kind)}
    >
      <div
        style={{
          width: 40,
          height: 40,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--mantine-color-text)",
        }}
      >
        <Glyph kind={item.kind} />
      </div>
      <Text size="sm" fw={500}>
        {item.label}
      </Text>
    </Group>
  );
}

// Which groups the user has collapsed, persisted so the palette reopens the way
// they left it. Stored as the collapsed set, so the default (nothing stored) is
// every group open.
const COLLAPSE_KEY = "bamboogrid:paletteCollapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // best-effort
  }
  return new Set();
}

// A small magnifier for the search field's left section.
function SearchIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden
    >
      <circle cx={7} cy={7} r={4.5} />
      <line x1={10.5} y1={10.5} x2={14} y2={14} strokeLinecap="round" />
    </svg>
  );
}

export function Palette() {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [query, setQuery] = useState("");

  const onDragStart = (e: React.DragEvent, kind: ElementKind) => {
    e.dataTransfer.setData("application/bamboogrid", kind);
    e.dataTransfer.effectAllowed = "move";
  };

  const toggle = (title: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      } catch {
        // best-effort
      }
      return next;
    });

  // While searching, keep only matching items (matched on name, description or
  // element kind) and drop groups that end up empty.
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const groups = searching
    ? GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (it) =>
            it.label.toLowerCase().includes(q) ||
            it.hint.toLowerCase().includes(q) ||
            it.kind.includes(q),
        ),
      })).filter((group) => group.items.length > 0)
    : GROUPS;

  return (
    <Stack gap="xs" p="sm">
      <TextInput
        size="xs"
        placeholder="Search elements…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        leftSection={<SearchIcon />}
        rightSection={
          query ? (
            <CloseButton
              size="xs"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            />
          ) : null
        }
      />

      {groups.map((group) => {
        // Searching forces every matching group open so results are never
        // hidden behind a collapsed header; otherwise honor the saved state.
        const open = searching || !collapsed.has(group.title);
        return (
          <div key={group.title}>
            {searching ? (
              <div style={{ padding: "3px 4px" }}>
                <SectionLabel>{group.title}</SectionLabel>
              </div>
            ) : (
              <UnstyledButton
                className="paletteGroupHeader"
                onClick={() => toggle(group.title)}
                aria-expanded={open}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--mantine-color-dimmed)",
                }}
              >
                <Chevron open={open} />
                <SectionLabel>{group.title}</SectionLabel>
              </UnstyledButton>
            )}
            <Collapse in={open}>
              <Stack gap={0} pt={2}>
                {group.items.map((item) => (
                  <PaletteItem
                    key={item.kind}
                    item={item}
                    onDragStart={onDragStart}
                  />
                ))}
              </Stack>
            </Collapse>
          </div>
        );
      })}

      {searching && groups.length === 0 && (
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          No elements match “{query.trim()}”.
        </Text>
      )}

      {!searching && (
        <Text size="xs" c="dimmed" mt="xs">
          Drag an element onto the canvas, then connect its handle to a bus.
          Drag from one bus to another to add a line, switch, or transformer.
        </Text>
      )}
    </Stack>
  );
}
