import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Menu,
  NumberInput,
  type NumberInputProps,
  Stack,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";

import { fixed } from "../format";
import { useEditor } from "../store";
import {
  groupByQuantity,
  MEAS_META,
  measLabel,
  type MeasElementType,
  type MeasSide,
  type MeasType,
  type Measurement,
} from "../types";

// Which quantities can be measured on each kind of element.
const BUS_TYPES: MeasType[] = ["v", "p", "q", "va"];
const BRANCH_TYPES: MeasType[] = ["p", "q", "i"];

// The branch ends a measurement can sit on, per element type.
const SIDES: Record<Exclude<MeasElementType, "bus">, MeasSide[]> = {
  line: ["from", "to"],
  trafo: ["hv", "lv"],
  trafo3w: ["hv", "mv", "lv"],
};

function newMeasurement(
  elementType: MeasElementType,
  elementId: string,
  measType: MeasType,
  side: MeasSide | null,
): Omit<Measurement, "id"> {
  return {
    name: "Measurement",
    element_type: elementType,
    element_id: elementId,
    meas_type: measType,
    side,
    // A voltage reads ~1 p.u.; power/current start at zero.
    value: measType === "v" ? 1.0 : 0,
    std_dev: 0.01,
    enabled: true,
  };
}

// The quantities that can be added to an element, as flat menu options — one per
// quantity for a bus, one per quantity×side for a branch.
function addOptions(elementType: MeasElementType) {
  if (elementType === "bus")
    return BUS_TYPES.map((t) => ({
      key: t,
      measType: t,
      side: null as MeasSide | null,
      label: MEAS_META[t].label,
    }));
  return BRANCH_TYPES.flatMap((t) =>
    SIDES[elementType].map((s) => ({
      key: `${t}|${s}`,
      measType: t,
      side: s as MeasSide | null,
      label: `${MEAS_META[t].label} · ${s}`,
    })),
  );
}

// A number field that buffers its shown text locally while focused, so clearing
// it doesn't snap the controlled value back to "0" (which would leave a sticky
// leading zero on the next keystroke). Mirrors the inspector's ParamInput; the
// store still commits live through `onChange`.
function NumField({
  value,
  ...rest
}: { value: number } & Omit<NumberInputProps, "label" | "value">) {
  const [display, setDisplay] = useState<number | string>(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDisplay(value);
  }, [value, editing]);
  return (
    <NumberInput
      size="xs"
      {...rest}
      value={display}
      onValueChange={(payload, event) => {
        if (event.source === "prop") return;
        setDisplay(payload.value);
      }}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        setDisplay(value);
      }}
    />
  );
}

// The estimated value and normalized residual (rᴺ) from the last estimation, one
// per reading. `justify="space-between"` pins the estimate to the left and the
// badge to the right so stacked readings line up in two columns. Only the single
// measurement the solver identified as bad is reddened: a gross error inflates
// other measurements' residuals too (smearing), so a high rᴺ elsewhere usually
// just reflects that, not a second fault.
function ResidualBadge({
  normalized,
  estimated,
  isBad,
  unit,
}: {
  normalized: number;
  estimated: number | null;
  isBad: boolean;
  unit: string;
}) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text
        size="xs"
        c="dimmed"
        style={{ cursor: "help" }}
        title="Estimated value the model settled on"
      >
        est {estimated === null ? "—" : `${fixed(estimated, 4)} ${unit}`}
      </Text>
      <Badge
        size="sm"
        variant="light"
        color={isBad ? "red" : "gray"}
        style={{ cursor: "help" }}
        title={
          isBad
            ? "Largest normalized residual — most likely the bad measurement. Fix or remove it and re-run to check the rest."
            : "Normalized residual (rᴺ). A single bad measurement inflates others too (smearing); only the largest is flagged."
        }
      >
        r{"ₙ"} = {fixed(normalized, 2)}
        {isBad ? " · likely bad" : ""}
      </Badge>
    </Group>
  );
}

export function MeasurementsSection({
  elementType,
  elementId,
}: {
  elementType: MeasElementType;
  elementId: string;
}) {
  const measurements = useEditor((s) => s.measurements);
  const residuals = useEditor((s) => s.estResiduals);
  const readOnly = useEditor((s) => s.readOnly);
  const addMeasurement = useEditor((s) => s.addMeasurement);
  const updateMeasurement = useEditor((s) => s.updateMeasurement);
  const removeMeasurement = useEditor((s) => s.removeMeasurement);

  const mine = measurements.filter((m) => m.element_id === elementId);
  // Group this element's measurements by quantity (and branch side) so repeated
  // readings of the same thing stack in one card instead of each getting its own.
  const groups = groupByQuantity(mine, (m) => m);

  return (
    <Stack gap="xs">
      <Divider label="Measurements" labelPosition="left" />
      {groups.length === 0 && (
        <Text size="xs" c="dimmed">
          None yet on this element.
        </Text>
      )}
      {groups.map((g) => {
        const meta = MEAS_META[g.measType];
        const unit = meta.unit;
        return (
          <Stack
            key={g.key}
            gap={6}
            p="xs"
            style={{
              border: "1px solid var(--mantine-color-default-border)",
              borderRadius: "var(--mantine-radius-sm)",
            }}
          >
            {/* Parameter named symbol (unit) with a tooltip, matching the load
                flow / short circuit result convention. */}
            <Text
              size="xs"
              fw={600}
              title={meta.description}
              style={{ width: "fit-content", cursor: "help" }}
            >
              {measLabel(g.measType, g.side)}
            </Text>
            {/* Column labels, shown once. Invisible checkbox/× reserve the exact
                widths of the controls below so the Value/σ columns line up. */}
            <Group gap="xs" wrap="nowrap" align="center">
              <Checkbox
                size="xs"
                readOnly
                checked={false}
                aria-hidden
                tabIndex={-1}
                style={{ visibility: "hidden" }}
              />
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                Value
              </Text>
              <Text size="xs" c="dimmed" style={{ flex: 1 }}>
                σ
              </Text>
              <ActionIcon
                size="sm"
                aria-hidden
                tabIndex={-1}
                style={{ visibility: "hidden" }}
              >
                {"×"}
              </ActionIcon>
            </Group>
            {g.items.map((m) => {
              const r = residuals[m.id];
              return (
                <Stack
                  key={m.id}
                  gap={2}
                  // Dim when excluded from the estimation (kept, just not used).
                  style={{ opacity: m.enabled ? 1 : 0.55 }}
                >
                  <Group gap="xs" wrap="nowrap" align="center">
                    <Checkbox
                      size="xs"
                      checked={m.enabled}
                      disabled={readOnly}
                      onChange={(e) =>
                        updateMeasurement(m.id, {
                          enabled: e.currentTarget.checked,
                        })
                      }
                      aria-label="Include in the state estimation"
                      title="Include this measurement in the state estimation"
                      styles={{ input: { cursor: "pointer" } }}
                    />
                    <NumField
                      value={m.value}
                      step={0.01}
                      decimalScale={4}
                      disabled={readOnly}
                      onChange={(v) =>
                        updateMeasurement(m.id, { value: Number(v) || 0 })
                      }
                      style={{ flex: 1 }}
                    />
                    <NumField
                      value={m.std_dev}
                      min={1e-6}
                      step={0.001}
                      decimalScale={4}
                      disabled={readOnly}
                      onChange={(v) =>
                        updateMeasurement(m.id, { std_dev: Number(v) || 1e-6 })
                      }
                      style={{ flex: 1 }}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      disabled={readOnly}
                      onClick={() => removeMeasurement(m.id)}
                      aria-label="Remove measurement"
                      title="Remove measurement"
                    >
                      {"×"}
                    </ActionIcon>
                  </Group>
                  {r && r.normalized_residual !== null && (
                    <ResidualBadge
                      normalized={r.normalized_residual}
                      estimated={r.estimated}
                      isBad={r.is_bad}
                      unit={unit}
                    />
                  )}
                </Stack>
              );
            })}
          </Stack>
        );
      })}
      {!readOnly && (
        <Menu shadow="md" position="bottom-start" withinPortal>
          <Menu.Target>
            <Button variant="light" size="xs">
              + Add measurement
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            {addOptions(elementType).map((opt) => (
              <Menu.Item
                key={opt.key}
                onClick={() =>
                  addMeasurement(
                    newMeasurement(
                      elementType,
                      elementId,
                      opt.measType,
                      opt.side,
                    ),
                  )
                }
              >
                {opt.label}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Stack>
  );
}
