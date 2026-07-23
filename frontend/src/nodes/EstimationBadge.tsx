import { Fragment, type ReactNode, useEffect, useState } from "react";
import { Group, Popover, Stack, Text } from "@mantine/core";
import { ACCENT } from "../theme";
import { fixed } from "../format";
import { estimateRows } from "../inspector/results";
import { useEditor } from "../store";
import { groupByQuantity, MEAS_META, measLabel } from "../types";

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

  // Group readings of the same quantity (and branch side) under one symbol, so a
  // bus with several voltage readings shows one heading with the rows beneath.
  const measGroups = groupByQuantity(rows, (x) => x.m);

  const anyBad = rows.some((x) => x.r.is_bad);
  const color = anyBad
    ? "var(--mantine-color-red-6)"
    : selected
      ? ACCENT
      : "currentColor";

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

  const Line = ({ label, value }: { label: ReactNode; value: string }) => (
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
        style={{ maxHeight: "70vh", overflowY: "auto" }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <Stack gap={8} style={{ minWidth: 200 }}>
          {est && (
            <Stack gap={2}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                {estCaption}
              </Text>
              {estimateRows(est).map(([label, value], i) => (
                <Line key={i} label={label} value={value} />
              ))}
            </Stack>
          )}
          {measGroups.length > 0 && (
            <Stack gap={8}>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                Measurements
              </Text>
              {measGroups.map((g) => {
                const meta = MEAS_META[g.measType];
                const num = (v: number | null) =>
                  v === null ? "—" : fixed(v, meta.dp);
                return (
                  <Stack key={g.key} gap={2}>
                    {/* Quantity heading, symbol (unit), with a describing tooltip. */}
                    <Text
                      size="xs"
                      fw={600}
                      title={meta.description}
                      style={{ width: "fit-content", cursor: "help" }}
                    >
                      {measLabel(g.measType, g.side)}
                    </Text>
                    {/* Readings as an aligned measured / estimated / rₙ table. */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr auto",
                        columnGap: 12,
                        rowGap: 2,
                        paddingLeft: 4,
                      }}
                    >
                      <Text size="xs" c="dimmed">
                        measured
                      </Text>
                      <Text size="xs" c="dimmed">
                        estimated
                      </Text>
                      <Text size="xs" c="dimmed" ta="right">
                        r{"ₙ"}
                      </Text>
                      {g.items.map(({ m, r }) => (
                        <Fragment key={m.id}>
                          <Text size="xs" ff="monospace">
                            {num(r.measured)}
                          </Text>
                          <Text size="xs" ff="monospace">
                            {num(r.estimated)}
                          </Text>
                          <Text
                            size="xs"
                            ff="monospace"
                            ta="right"
                            c={r.is_bad ? "red" : r.is_critical ? "yellow.7" : undefined}
                            title={
                              r.is_critical
                                ? "Critical — no redundancy, so its error is undetectable (no normalized residual)."
                                : undefined
                            }
                            style={r.is_critical ? { cursor: "help" } : undefined}
                          >
                            {r.is_critical
                              ? "crit"
                              : fixed(r.normalized_residual ?? 0, 2)}
                            {r.is_bad ? " ⚠" : ""}
                          </Text>
                        </Fragment>
                      ))}
                    </div>
                  </Stack>
                );
              })}
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
