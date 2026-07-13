// The current scenario's name, shown in the top bar and editable in place: click
// to turn it into a text field; Enter/blur commits, Escape cancels.

import { useEffect, useRef, useState } from "react";
import { Text, TextInput, Tooltip, UnstyledButton } from "@mantine/core";

export function ScenarioTitle({
  name,
  defaultName,
  disabled,
  onRename,
}: {
  name: string;
  // The placeholder name an unnamed scenario carries; shown dimmed to read as a
  // prompt rather than a real title.
  defaultName: string;
  disabled?: boolean;
  onRename: (name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Track the name changing under us (opening another scenario, a rename from
  // the library) while not mid-edit.
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    await onRename(next);
  };

  if (editing) {
    return (
      <TextInput
        ref={inputRef}
        size="xs"
        value={draft}
        aria-label="Scenario name"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        onBlur={() => void commit()}
        styles={{ input: { fontWeight: 500, textAlign: "center", minWidth: 200 } }}
      />
    );
  }

  const isDefault = !name || name === defaultName;
  return (
    <Tooltip label="Rename scenario" openDelay={500} withArrow disabled={disabled}>
      <UnstyledButton
        aria-label={`Scenario: ${name || defaultName}. Click to rename.`}
        disabled={disabled}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          maxWidth: 320,
          padding: "3px 10px",
          borderRadius: 6,
          cursor: disabled ? "default" : "text",
          color: isDefault
            ? "var(--mantine-color-dimmed)"
            : "var(--mantine-color-text)",
          background:
            hovered && !disabled
              ? "var(--mantine-color-default-hover)"
              : "transparent",
        }}
      >
        <Text size="sm" fw={500} truncate inherit>
          {name || defaultName}
        </Text>
      </UnstyledButton>
    </Tooltip>
  );
}
