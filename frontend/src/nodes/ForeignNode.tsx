import { type NodeProps } from "@xyflow/react";
import type { ForeignData } from "../types";

// A pandapower element the editor doesn't model yet (e.g. dcline, impedance,
// motor, storage). It stays on the authoritative server net and is solved with
// the rest of the grid; here it's shown read-only so it's visible and obviously
// not editable.
export function ForeignNode({ data, selected }: NodeProps) {
  const d = data as ForeignData;
  return (
    <div
      title={`${d.table} (read-only — not editable yet)`}
      style={{
        padding: "4px 8px",
        borderRadius: 6,
        border: `1px dashed ${selected ? "#0ea5e9" : "#9ca3af"}`,
        background: "var(--mantine-color-body)",
        color: "var(--mantine-color-dimmed)",
        fontSize: 10,
        textAlign: "center",
        opacity: 0.85,
        minWidth: 56,
      }}
    >
      <div style={{ fontWeight: 600 }}>{d.label}</div>
      <div style={{ textTransform: "uppercase", letterSpacing: 0.3 }}>
        {d.table}
      </div>
    </div>
  );
}
