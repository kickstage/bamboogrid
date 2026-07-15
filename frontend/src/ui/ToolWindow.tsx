import { useEffect, useState } from "react";
import { ActionIcon, Group, Paper } from "@mantine/core";

import { DetachedWindow } from "./DetachedWindow";
import { SectionLabel } from "./Section";
import { useDraggable } from "./useDraggable";

interface ToolWindowProps {
  title: string;
  opened: boolean;
  onClose: () => void;
  // Docked panel width; also the initial pop-out window width.
  width?: number;
  height?: number;
  // Floor for both docked and detached sizes so a panel never collapses into an
  // unreadable sliver (e.g. an empty/error state that would otherwise size to its
  // tiny content).
  minWidth?: number;
  minHeight?: number;
  // Extra buttons for the header (e.g. a refresh action), left of pop-out/close.
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

// A floating tool panel with unified chrome that can either dock over the canvas
// (draggable) or pop out into a separate browser window (movable to a second
// screen). All study tools share this so they look and behave the same.
export function ToolWindow({
  title,
  opened,
  onClose,
  width = 560,
  height = 640,
  minWidth = 360,
  minHeight = 280,
  headerActions,
  children,
}: ToolWindowProps) {
  const [detached, setDetached] = useState(false);
  const drag = useDraggable();

  // Closing (from anywhere) returns the tool to its docked default next time.
  useEffect(() => {
    if (!opened) setDetached(false);
  }, [opened]);

  if (!opened) return null;

  const header = (isDetached: boolean) => (
    <Group
      justify="space-between"
      px="xs"
      py={6}
      onPointerDown={isDetached ? undefined : drag.onPointerDown}
      style={{
        cursor: isDetached ? "default" : "move",
        touchAction: "none",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <SectionLabel>{title}</SectionLabel>
      <Group gap={4}>
        {headerActions}
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={() => setDetached((d) => !d)}
          aria-label={isDetached ? "Dock into app" : "Pop out to a window"}
          title={isDetached ? "Dock back into the app" : "Pop out to a window"}
        >
          {isDetached ? "↙" : "↗"}
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </ActionIcon>
      </Group>
    </Group>
  );

  const body = (
    <div
      style={{
        padding: 8,
        // Fill the remaining height (of the popup window, or up to the docked
        // Paper's max height) so children can flex to fit instead of relying on
        // magic offsets.
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        // Setting only overflow-y makes the browser compute overflow-x as auto
        // too, so a sub-pixel-wide child would spawn a spurious horizontal
        // scrollbar. Panels that need horizontal scroll do it on an inner box.
        overflowX: "hidden",
      }}
    >
      {children}
    </div>
  );

  if (detached) {
    return (
      <DetachedWindow
        title={title}
        width={width}
        height={height}
        minWidth={minWidth}
        minHeight={minHeight}
        onClose={() => {
          setDetached(false);
          onClose();
        }}
      >
        {header(true)}
        {body}
      </DetachedWindow>
    );
  }

  return (
    <Paper
      ref={drag.ref}
      shadow="md"
      withBorder
      radius="md"
      style={{
        // Default: docked over the canvas (top-right). Once dragged, switch to
        // viewport-fixed coords so it can be moved over the sidebars too.
        position: drag.pos ? "fixed" : "absolute",
        top: drag.pos ? drag.pos.y : 12,
        ...(drag.pos ? { left: drag.pos.x } : { right: 12 }),
        width,
        minWidth,
        minHeight,
        maxWidth: "calc(100% - 24px)",
        maxHeight: "calc(100vh - 24px)",
        display: "flex",
        flexDirection: "column",
        zIndex: 200,
      }}
    >
      {header(false)}
      {body}
    </Paper>
  );
}
