import { Collapse, UnstyledButton } from "@mantine/core";
import type { ReactNode } from "react";
import { SectionLabel } from "./Section";
import "./collapsible.css";

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

// The shared foldable section used across side panels (palette groups, inspector
// parameter blocks): a dimmed uppercase caption with a leading chevron over a
// Mantine Collapse. Open state is controlled by the caller so it can be
// persisted or forced open. Callers own the body's padding/layout.
export function CollapsibleSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <UnstyledButton
        className="collapsibleHeader"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--mantine-color-dimmed)",
        }}
      >
        <Chevron open={open} />
        <SectionLabel>{label}</SectionLabel>
      </UnstyledButton>
      <Collapse in={open}>{children}</Collapse>
    </div>
  );
}
