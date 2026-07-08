import { Text } from "@mantine/core";
import type { ReactNode } from "react";

// Shared section typography, so every panel and group heading reads the same
// wherever it appears — the inspector, the palette, result blocks, the mobile
// sheet. Casing is owned here via `tt="uppercase"`, so callers pass natural-case
// strings ("Static generator", not "STATIC GENERATOR").

// The title at the top of a side panel: the selected element's type
// ("Generator", "Line") or the panel's own name ("Properties"). One per panel.
export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <Text size="sm" fw={700} c="dimmed" tt="uppercase">
      {children}
    </Text>
  );
}

// A caption introducing a group of controls or a block of read-outs — a palette
// group, the load-flow result block, a legend, the element type on the mobile
// sheet. Smaller than a PanelTitle; several can appear within one panel.
export function SectionLabel({ children }: { children: ReactNode }) {
  // Rendered as a span (not the default block <p>) so it can sit inside an
  // interactive element like the palette's collapsible group header button.
  return (
    <Text component="span" size="xs" fw={700} c="dimmed" tt="uppercase">
      {children}
    </Text>
  );
}
