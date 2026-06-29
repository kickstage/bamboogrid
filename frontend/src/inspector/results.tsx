import { Group, Stack, Text } from "@mantine/core";
import { fixed } from "../format";
import { phaseAngleDeg, powerFactor, type BusInjection } from "../power";
import type { BusData, GeneratorData, ShuntData, Trafo2WData } from "../types";

export const HEADERS: Record<string, string> = {
  bus: "BUS",
  generator: "GENERATOR",
  sgen: "STATIC GENERATOR",
  extgrid: "EXTERNAL GRID",
  load: "LOAD",
  shunt: "SHUNT",
  switch: "SWITCH",
  trafo2w: "TRANSFORMER",
  trafo3w: "3W TRANSFORMER",
};

// A quantity row in the load-flow result block: its symbol (the "sign", e.g. P,
// Q, Vm) and its formatted value+unit.
export type ResultRow = [label: string, value: string];

// A labeled result block, rendered consistently for every element.
export function ResultList({
  rows,
  label = "Load flow result",
}: {
  rows: ResultRow[];
  label?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <Stack gap={4} mt="md">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Stack gap={2}>
        {rows.map(([label, value]) => (
          <Group key={label} justify="space-between" gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text size="xs" ff="monospace" style={{ whiteSpace: "nowrap" }}>
              {value}
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}

// Build the labeled result rows for a node, or [] if it has no solved result.
export function nodeResultRows(type: string | undefined, data: unknown): ResultRow[] {
  if (type === "bus") {
    const b = data as BusData;
    if (b.vm_pu === undefined) return [];
    return [
      ["Vm", `${fixed(b.vm_pu, 4)} p.u.`],
      ["Va", `${fixed(b.va_degree ?? 0, 2)}°`],
    ];
  }
  if (type === "generator" || type === "sgen" || type === "extgrid") {
    const g = data as GeneratorData;
    if (g.res_p_mw === undefined) return [];
    return [
      ["P", `${fixed(g.res_p_mw, 4)} MW`],
      ["Q", `${fixed(g.res_q_mvar ?? 0, 4)} Mvar`],
    ];
  }
  if (type === "shunt") {
    const sh = data as ShuntData;
    if (sh.res_q_mvar === undefined) return [];
    return [
      ["P", `${fixed(sh.res_p_mw ?? 0, 4)} MW`],
      ["Q", `${fixed(sh.res_q_mvar, 4)} Mvar`],
    ];
  }
  if (type === "trafo2w" || type === "trafo3w") {
    const t = data as Trafo2WData;
    if (t.res_loading_percent === undefined) return [];
    return [
      ["Loading", `${fixed(t.res_loading_percent, 1)} %`],
      ["P", `${fixed(t.res_p_mw ?? 0, 4)} MW`],
      ["Q", `${fixed(t.res_q_mvar ?? 0, 4)} Mvar`],
    ];
  }
  return [];
}

// Short-circuit result rows for a bus, or [] before a short-circuit run.
export function busScRows(data: BusData): ResultRow[] {
  if (data.ikss_ka === undefined) return [];
  const rows: ResultRow[] = [["Ik″", `${fixed(data.ikss_ka, 3)} kA`]];
  if (data.ip_ka !== undefined) rows.push(["ip", `${fixed(data.ip_ka, 3)} kA`]);
  if (data.ith_ka !== undefined) rows.push(["ith", `${fixed(data.ith_ka, 3)} kA`]);
  if (data.skss_mw !== undefined)
    rows.push(["Sk″", `${fixed(data.skss_mw, 1)} MVA`]);
  return rows;
}

// Derived figures for a solved bus from its net injection: the P/Q the bus
// pushes into the network, and the power factor and power-factor angle they
// imply.
export function busInjectionRows(inj: BusInjection): ResultRow[] {
  const { p_mw, q_mvar } = inj;
  const pf = powerFactor(p_mw, q_mvar);
  return [
    ["P injection", `${fixed(p_mw, 4)} MW`],
    ["Q injection", `${fixed(q_mvar, 4)} Mvar`],
    [
      "Power factor",
      pf.sense === "unity"
        ? fixed(pf.value, 3)
        : `${fixed(pf.value, 3)} ${pf.sense}`,
    ],
    ["Phase angle", `${fixed(phaseAngleDeg(p_mw, q_mvar), 1)}°`],
  ];
}

// Explains the busbar colors a load flow paints on (see voltageColor in
// BusNode): how far each bus's solved voltage sits from nominal (1.0 p.u.).
export function VoltageLegend() {
  const Row = ({ color, label }: { color: string; label: string }) => (
    <Group gap={6} wrap="nowrap">
      <span
        style={{ width: 11, height: 11, borderRadius: 2, background: color, flex: "none" }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="dimmed">
        BUS VOLTAGE AFTER LOAD FLOW
      </Text>
      <Row color="#16a34a" label="Green — within 5% of nominal" />
      <Row color="#d97706" label="Orange — 5–10% off nominal" />
      <Row color="#dc2626" label="Red — more than 10% off" />
    </Stack>
  );
}

// Explains the fault-current heatmap a short circuit paints on (see faultColor
// in BusNode): a cool→hot scale by share of the network's peak Ik″.
export function FaultCurrentLegend() {
  const Row = ({ color, label }: { color: string; label: string }) => (
    <Group gap={6} wrap="nowrap">
      <span
        style={{ width: 11, height: 11, borderRadius: 2, background: color, flex: "none" }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} c="dimmed">
        BUS FAULT CURRENT (IEC 60909)
      </Text>
      <Row color="rgb(125, 211, 252)" label="Light — lower Ik″" />
      <Row color="rgb(190, 24, 93)" label="Dark — network's peak Ik″" />
    </Stack>
  );
}
