import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Group,
  Paper,
  ScrollArea,
  Text,
  TextInput,
} from "@mantine/core";

import { useEditor } from "../store";
import type { BusData, ForeignData } from "../types";

// Friendly element-kind labels, used both as the per-result subtitle and as a
// search term (typing "bus" lists every bus, "line" every line, ...).
const KIND_LABEL: Record<string, string> = {
  bus: "Bus",
  generator: "Generator",
  sgen: "Static generator",
  extgrid: "External grid",
  load: "Load",
  shunt: "Shunt",
  switch: "Switch",
  trafo2w: "Transformer",
  trafo3w: "3W Transformer",
  line: "Line",
};

interface Match {
  id: string;
  label: string;
  sub: string;
}

// A floating Find panel (top-right over the canvas). Lists elements matching the
// query; selecting one spotlights it on the canvas (dimming the rest) and
// pans/zooms to it via the store's revealElement.
export function SearchPanel() {
  const open = useEditor((s) => s.searchOpen);
  const setSearchOpen = useEditor((s) => s.setSearchOpen);
  const revealElement = useEditor((s) => s.revealElement);
  const highlightElement = useEditor((s) => s.highlightElement);
  const highlightId = useEditor((s) => s.searchHighlightId);
  const nodes = useEditor((s) => s.nodes);
  const edges = useEditor((s) => s.edges);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const items = useMemo<Match[]>(() => {
    const out: Match[] = [];
    for (const n of nodes) {
      if (n.type === "foreign") {
        const d = n.data as ForeignData;
        out.push({ id: n.id, label: d.label, sub: d.table });
        continue;
      }
      const kind = KIND_LABEL[n.type ?? ""] ?? n.type ?? "Element";
      const name = (n.data as { name?: string }).name ?? kind;
      const sub =
        n.type === "bus" ? `${kind} · ${(n.data as BusData).vn_kv} kV` : kind;
      out.push({ id: n.id, label: name, sub });
    }
    for (const e of edges) {
      if (e.type !== "line") continue;
      const name = (e.data as { name?: string })?.name ?? "Line";
      out.push({ id: e.id, label: name, sub: KIND_LABEL.line });
    }
    return out;
  }, [nodes, edges]);

  const matches = useMemo<Match[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (m) =>
        m.label.toLowerCase().includes(q) || m.sub.toLowerCase().includes(q),
    );
  }, [items, query]);

  // Focus the field and reset when (re)opened.
  useEffect(() => {
    if (!open) return;
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  // A press anywhere outside the panel (e.g. on the canvas) closes it. Attached
  // only while open, after the render that opened it — so the opening click
  // doesn't immediately dismiss it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node))
        setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setSearchOpen]);

  // Keep the active row in range as matches shrink, and scrolled into view.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)));
  }, [matches.length]);
  useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  // Preview: spotlight the row's element (dim the rest) without moving the view.
  const preview = (i: number) => {
    setActive(i);
    highlightElement(matches[i]?.id ?? null);
  };
  // Commit: pan/zoom the canvas onto it (the "jump"), on click or Enter only.
  const reveal = (i: number) => {
    const m = matches[i];
    if (!m) return;
    setActive(i);
    revealElement(m.id, { highlight: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      preview(Math.min(active + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      preview(Math.max(active - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      reveal(active);
      setSearchOpen(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSearchOpen(false);
    }
  };

  return (
    <Paper
      ref={panelRef}
      shadow="md"
      withBorder
      radius="md"
      p="xs"
      style={{ position: "absolute", top: 12, right: 12, width: 320, zIndex: 20 }}
      onKeyDown={onKeyDown}
    >
      <TextInput
        ref={inputRef}
        size="xs"
        placeholder="Find elements by name or type…"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        rightSection={
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={() => setSearchOpen(false)}
            aria-label="Close find"
          >
            ✕
          </ActionIcon>
        }
      />

      <Group justify="space-between" px={4} pt={6} pb={2}>
        <Text size="xs" c="dimmed">
          {matches.length} match{matches.length === 1 ? "" : "es"}
        </Text>
        <Text size="xs" c="dimmed">
          ↑↓ preview · ↵ zoom to it
        </Text>
      </Group>

      {matches.length > 0 ? (
        <ScrollArea.Autosize mah={320} type="auto">
          <Box>
            {matches.map((m, i) => (
              <Box
                component="button"
                key={m.id}
                ref={(el: HTMLButtonElement | null) => {
                  rowRefs.current[i] = el;
                }}
                onClick={() => reveal(i)}
                onMouseEnter={() => preview(i)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 4,
                  padding: "4px 6px",
                  background:
                    i === active
                      ? "var(--mantine-color-default-hover)"
                      : "transparent",
                }}
              >
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Text size="sm" truncate>
                    {m.label}
                  </Text>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {m.id === highlightId ? "● " : ""}
                    {m.sub}
                  </Text>
                </Group>
              </Box>
            ))}
          </Box>
        </ScrollArea.Autosize>
      ) : (
        <Text size="sm" c="dimmed" px={4} py={6}>
          {items.length === 0 ? "Nothing to search yet." : "No matches."}
        </Text>
      )}
    </Paper>
  );
}
