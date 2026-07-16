// The row of open scenarios below the top bar. The active tab's unsaved marker
// comes from live editor state; a background tab only knows what it knew when it
// was last active.

import { useState } from "react";
import { Text } from "@mantine/core";

import { useEditor } from "./store";
import { useTabs } from "./tabs";

interface TabStripProps {
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  disabled?: boolean;
}

export function TabStrip({ onActivate, onClose, onNew, disabled }: TabStripProps) {
  const tabs = useTabs((s) => s.tabs);
  const activeId = useTabs((s) => s.activeId);
  const moveTab = useTabs((s) => s.moveTab);
  const dirty = useEditor((s) => s.dirty);
  const savedAt = useEditor((s) => s.savedAt);
  const nodeCount = useEditor((s) => s.nodes.length);
  // Matches App's losesWork: an empty canvas has nothing to lose, so no dot.
  const activeUnsaved = nodeCount > 0 && (dirty || savedAt === null);
  const [dragId, setDragId] = useState<string | null>(null);

  // A lone scenario needs no tab bar.
  if (tabs.length <= 1) return null;

  return (
    <div
      role="tablist"
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 2,
        padding: "2px 6px",
        overflowX: "auto",
        borderBottom: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const showDot = active ? activeUnsaved : tab.unsaved;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            title={tab.name}
            draggable={!disabled}
            onClick={() => !active && !disabled && onActivate(tab.id)}
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnter={() => {
              // Reorder live under the cursor rather than only on drop.
              if (dragId && dragId !== tab.id) moveTab(dragId, tab.id);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={() => setDragId(null)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 200,
              padding: "4px 6px 4px 10px",
              borderRadius: 6,
              cursor: active || disabled ? "default" : "pointer",
              background: active
                ? "var(--mantine-color-default-hover)"
                : "transparent",
              opacity: dragId === tab.id ? 0.5 : 1,
              flex: "0 0 auto",
            }}
          >
            <Text
              size="xs"
              fw={active ? 600 : 400}
              truncate
              c={active ? undefined : "dimmed"}
              style={{ maxWidth: 150 }}
            >
              {tab.name}
            </Text>
            {showDot && (
              <span
                aria-hidden
                title="Unsaved"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--mantine-color-text)",
                  flex: "0 0 auto",
                }}
              />
            )}
            <span
              role="button"
              aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (!disabled) onClose(tab.id);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                borderRadius: 4,
                fontSize: 12,
                lineHeight: 1,
                color: "var(--mantine-color-dimmed)",
                cursor: disabled ? "default" : "pointer",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "var(--mantine-color-default-border)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              ✕
            </span>
          </div>
        );
      })}
      <span
        role="button"
        aria-label="New scenario"
        title="New scenario"
        onClick={() => !disabled && onNew()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          minHeight: 24,
          marginLeft: 2,
          borderRadius: 6,
          fontSize: 16,
          color: "var(--mantine-color-dimmed)",
          cursor: disabled ? "default" : "pointer",
          flex: "0 0 auto",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--mantine-color-default-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        +
      </span>
    </div>
  );
}
