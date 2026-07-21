import { useEffect, useState } from "react";
import { Badge, Group, Popover, Stack, Text } from "@mantine/core";
import { ACCENT } from "../theme";
import { fixed } from "../format";
import { useEditor } from "../store";
import { MEAS_META, type ElementEstimate, type MeasType } from "../types";

// A labeled value formatted to `dp` decimals, or an em dash when absent.
const nn = (v: number | null, dp: number, unit: string) =>
  v === null ? "—" : `${fixed(v, dp)} ${unit}`;

// The estimated-state rows for an element — the estimator solves the whole
// network, so this is populated for every bus/line/transformer, not only the
// measured ones.
function estimatedRows(est: ElementEstimate): { label: string; value: string }[] {
  if (est.kind === "bus")
    return [
      { label: "|V|", value: nn(est.vm_pu, 4, "p.u.") },
      { label: "∠V", value: nn(est.va_degree, 2, "°") },
      { label: "P inj", value: nn(est.p_mw, 3, "MW") },
      { label: "Q inj", value: nn(est.q_mvar, 3, "Mvar") },
    ];
  // A line or transformer — both branches, reported per end (from/to or
  // hv/mv/lv) since the flow differs across the branch.
  const rows = est.sides.flatMap((s) => [
    { label: `P (${s.side})`, value: nn(s.p_mw, 3, "MW") },
    { label: `Q (${s.side})`, value: nn(s.q_mvar, 3, "Mvar") },
    { label: `I (${s.side})`, value: nn(s.i_ka, 4, "kA") },
  ]);
  rows.push({ label: "Loading", value: nn(est.loading_percent, 1, "%") });
  return rows;
}

// A small "≈" tag overlapping an element that has a state-estimation result,
// shown only in estimation mode after a run. Clicking it opens a popover with
// the element's full estimated state (voltage/injection for a bus, flows for a
// line or transformer) plus, for any metered quantity, the measured value and
// its residual. The tag turns red when the element carries the measurement
// flagged bad — an at-a-glance pointer on the canvas. Mirrors TrafoTapBadge's
// canvas-popover mechanics.
export function EstimationBadge({
  nodeId,
  right = -7,
  left,
  top = 5,
  edgeX,
  edgeY,
  selected = false,
}: {
  nodeId: string;
  right?: number;
  left?: number;
  top?: number;
  // When set, the tag positions itself at this flow coordinate (for a line
  // edge, which has no node container) instead of overlapping a node corner.
  edgeX?: number;
  edgeY?: number;
  selected?: boolean;
}) {
  const studyMode = useEditor((s) => s.studyMode);
  const measurements = useEditor((s) => s.measurements);
  const residuals = useEditor((s) => s.estResiduals);
  const est = useEditor((s) => s.estById[nodeId]);
  const [open, setOpen] = useState(false);

  // React Flow swallows pointer events, so detect click-outside ourselves in the
  // capture phase, ignoring clicks on the tag or its dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-est-popover]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  if (studyMode !== "estimation") return null;
  const rows = measurements
    .filter((m) => m.element_id === nodeId)
    .map((m) => ({ m, r: residuals[m.id] }))
    .filter((x): x is { m: (typeof x)["m"]; r: NonNullable<(typeof x)["r"]> } =>
      Boolean(x.r),
    );
  // Nothing to show until estimation has run (no result and no residuals here).
  if (!est && rows.length === 0) return null;

  const anyBad = rows.some((x) => x.r.is_bad);
  const color = anyBad
    ? "var(--mantine-color-red-6)"
    : selected
      ? ACCENT
      : "currentColor";

  const fmt = (t: MeasType, v: number | null) =>
    nn(v, MEAS_META[t].dp, MEAS_META[t].unit);

  const isEdge = edgeX !== undefined && edgeY !== undefined;

  const badge = (
    <div
      className="nodrag nopan"
      data-est-popover
      title="State estimation result"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      style={{
        ...(isEdge
          ? { position: "relative" }
          : { position: "absolute", top, ...(left !== undefined ? { left } : { right }) }),
        zIndex: 2,
        minWidth: 16,
        height: 16,
        padding: "0 3px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        background: "var(--mantine-color-body)",
        color,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: "14px",
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      ≈
    </div>
  );

  const Line = ({ label, value }: { label: string; value: string }) => (
    <Group justify="space-between" gap="md" wrap="nowrap">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" ff="monospace" style={{ whiteSpace: "nowrap" }}>
        {value}
      </Text>
    </Group>
  );

  const estCaption =
    est?.kind === "line"
      ? "Estimated · from end"
      : est?.kind === "trafo"
        ? "Estimated flow"
        : "Estimated";

  const popover = (
    <Popover
      opened={open}
      onChange={setOpen}
      position="top"
      withArrow
      shadow="md"
      trapFocus
      closeOnClickOutside={false}
    >
      <Popover.Target>{badge}</Popover.Target>
      <Popover.Dropdown
        className="nodrag nopan"
        data-est-popover
        p={8}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Stack gap={8} style={{ minWidth: 200 }}>
          {est && (
            <Stack gap={2}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {estCaption}
              </Text>
              {estimatedRows(est).map((r) => (
                <Line key={r.label} label={r.label} value={r.value} />
              ))}
            </Stack>
          )}
          {rows.length > 0 && (
            <Stack gap={6}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                Measurements
              </Text>
              {rows.map(({ m, r }) => (
                <Stack key={m.id} gap={1}>
                  <Group justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="xs" fw={600} c={r.is_bad ? "red" : undefined}>
                      {MEAS_META[m.meas_type].symbol}
                      {m.side ? ` (${m.side})` : ""}
                    </Text>
                    <Badge size="sm" variant="light" color={r.is_bad ? "red" : "gray"}>
                      r{"ₙ"} {fixed(r.normalized_residual ?? 0, 2)}
                      {r.is_bad ? " · bad" : ""}
                    </Badge>
                  </Group>
                  <Line label="measured" value={fmt(m.meas_type, r.measured)} />
                  <Line label="estimated" value={fmt(m.meas_type, r.estimated)} />
                  <Line label="residual" value={fmt(m.meas_type, r.residual)} />
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );

  // On an edge there's no node container to anchor to, so position the tag at
  // the given flow coordinate (the caller renders this inside its own
  // EdgeLabelRenderer). Offset right of the midpoint to clear the name/readout.
  if (isEdge) {
    return (
      <div
        className="nodrag nopan"
        style={{
          position: "absolute",
          transform: `translate(-50%, -50%) translate(${edgeX! + 16}px, ${edgeY!}px)`,
          pointerEvents: "all",
        }}
      >
        {popover}
      </div>
    );
  }
  return popover;
}
