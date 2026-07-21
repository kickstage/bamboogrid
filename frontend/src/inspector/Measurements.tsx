import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  NumberInput,
  type NumberInputProps,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useEffect, useState } from "react";

import { fixed } from "../format";
import { useEditor } from "../store";
import {
  MEAS_META,
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

function defaultMeasurement(
  elementType: MeasElementType,
  elementId: string,
): Omit<Measurement, "id"> {
  const base = {
    name: "Measurement",
    element_type: elementType,
    element_id: elementId,
    std_dev: 0.01,
    enabled: true,
  };
  return elementType === "bus"
    ? { ...base, meas_type: "v", side: null, value: 1.0 }
    : { ...base, meas_type: "p", side: SIDES[elementType][0], value: 0 };
}

// A number field that buffers its shown text locally while focused, so clearing
// it doesn't snap the controlled value back to "0" (which would leave a sticky
// leading zero on the next keystroke). Mirrors the inspector's ParamInput; the
// store still commits live through `onChange`.
function NumField({
  label,
  value,
  ...rest
}: { label: string; value: number } & Omit<NumberInputProps, "label" | "value">) {
  const [display, setDisplay] = useState<number | string>(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDisplay(value);
  }, [value, editing]);
  return (
    <NumberInput
      label={label}
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

// The estimated value and normalized residual (rᴺ) from the last estimation.
// Only the single measurement the solver identified as bad is reddened: a gross
// error inflates other measurements' residuals too (smearing), so a high rᴺ
// elsewhere usually just reflects that, not a second fault.
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
    <Group gap="xs" wrap="nowrap">
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
  const typeOptions = (elementType === "bus" ? BUS_TYPES : BRANCH_TYPES).map(
    (t) => ({ value: t, label: MEAS_META[t].label }),
  );

  return (
    <Stack gap="xs">
      <Divider label="Measurements" labelPosition="left" />
      <Text size="xs" c="dimmed">
        Feed state estimation with measured quantities and their noise (σ). Run
        it from the Study menu.
      </Text>
      {mine.length === 0 && (
        <Text size="xs" c="dimmed">
          None yet on this element.
        </Text>
      )}
      {mine.map((m) => {
        const r = residuals[m.id];
        const unit = MEAS_META[m.meas_type].unit;
        return (
          <Stack
            key={m.id}
            gap={6}
            p="xs"
            style={{
              border: "1px solid var(--mantine-color-default-border)",
              borderRadius: "var(--mantine-radius-sm)",
              // Dim when excluded from the estimation (kept, just not used).
              opacity: m.enabled ? 1 : 0.55,
            }}
          >
            <Group gap="xs" wrap="nowrap" align="flex-end">
              <Checkbox
                size="xs"
                checked={m.enabled}
                disabled={readOnly}
                onChange={(e) =>
                  updateMeasurement(m.id, { enabled: e.currentTarget.checked })
                }
                aria-label="Include in the state estimation"
                title="Include this measurement in the state estimation"
                mb={7}
                styles={{ input: { cursor: "pointer" } }}
              />
              <Select
                label="Quantity"
                size="xs"
                data={typeOptions}
                value={m.meas_type}
                allowDeselect={false}
                disabled={readOnly}
                onChange={(v) =>
                  v && updateMeasurement(m.id, { meas_type: v as MeasType })
                }
                style={{ flex: 1 }}
              />
              {elementType !== "bus" && (
                <Select
                  label="Side"
                  size="xs"
                  data={SIDES[elementType]}
                  value={m.side}
                  allowDeselect={false}
                  disabled={readOnly}
                  onChange={(v) =>
                    v && updateMeasurement(m.id, { side: v as MeasSide })
                  }
                  style={{ width: 80 }}
                />
              )}
              <ActionIcon
                variant="subtle"
                color="gray"
                disabled={readOnly}
                onClick={() => removeMeasurement(m.id)}
                aria-label="Remove measurement"
                title="Remove measurement"
                mb={2}
              >
                {"×"}
              </ActionIcon>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <NumField
                label={`Value (${unit})`}
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
                label={`σ (${unit})`}
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
      {!readOnly && (
        <Button
          variant="light"
          size="xs"
          onClick={() =>
            addMeasurement(defaultMeasurement(elementType, elementId))
          }
        >
          + Add measurement
        </Button>
      )}
    </Stack>
  );
}
