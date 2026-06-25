import {
  Button,
  Divider,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useEditor } from "../store";
import { fixed } from "../format";
import type {
  BusData,
  ExtGridData,
  GeneratorData,
  LineData,
  LoadData,
  SgenData,
  SwitchData,
  Trafo2WData,
  Trafo3WData,
} from "../types";

const TRAFO_STD_TYPES = [
  "160 MVA 380/110 kV",
  "100 MVA 220/110 kV",
  "63 MVA 110/20 kV",
  "40 MVA 110/20 kV",
  "25 MVA 110/20 kV",
  "63 MVA 110/10 kV",
  "40 MVA 110/10 kV",
  "25 MVA 110/10 kV",
  "0.25 MVA 20/0.4 kV",
  "0.4 MVA 20/0.4 kV",
  "0.63 MVA 20/0.4 kV",
  "0.25 MVA 10/0.4 kV",
  "0.4 MVA 10/0.4 kV",
  "0.63 MVA 10/0.4 kV",
];

const TRAFO3W_STD_TYPES = [
  "63/25/38 MVA 110/20/10 kV",
  "63/25/38 MVA 110/10/10 kV",
];

// Explains the busbar colors a load flow paints on (see voltageColor in
// BusNode): how far each bus's solved voltage sits from nominal (1.0 p.u.).
function VoltageLegend() {
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

const HEADERS: Record<string, string> = {
  bus: "BUS",
  generator: "GENERATOR",
  sgen: "STATIC GENERATOR",
  extgrid: "EXTERNAL GRID",
  load: "LOAD",
  switch: "SWITCH",
  trafo2w: "TRANSFORMER",
  trafo3w: "3W TRANSFORMER",
};

// A quantity row in the load-flow result block: its symbol (the "sign", e.g. P,
// Q, Vm) and its formatted value+unit. Unlike the compact on-canvas readouts,
// the inspector shows every result with its label so it's unambiguous.
type ResultRow = [label: string, value: string];

// The labeled load-flow result block, rendered consistently for every element.
function ResultList({ rows }: { rows: ResultRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <Divider my="xs" label="Load flow result" labelPosition="left" />
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
    </>
  );
}

// Build the labeled result rows for a node, or [] if it has no solved result.
function nodeResultRows(type: string | undefined, data: unknown): ResultRow[] {
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
  if (type === "trafo2w" || type === "trafo3w") {
    const t = data as Trafo2WData;
    if (t.res_loading_percent === undefined) return [];
    return [
      ["Loading", `${fixed(t.res_loading_percent, 1)} %`],
      ["P", `${fixed(t.res_p_mw ?? 0, 4)} MW`],
    ];
  }
  return [];
}

export function Inspector() {
  const {
    nodes,
    edges,
    selectedId,
    selectedEdgeId,
    updateNodeData,
    updateEdgeData,
    removeNode,
    removeEdge,
  } = useEditor();
  const node = nodes.find((n) => n.id === selectedId);
  const lineEdge = edges.find((e) => e.id === selectedEdgeId && e.type === "line");

  // A line is a bus-to-bus edge; edit its explicit electrical parameters (the
  // solver builds the line straight from these).
  if (lineEdge) {
    const d = lineEdge.data as LineData;
    const set = (patch: Partial<LineData>) =>
      updateEdgeData(lineEdge.id, patch);
    const num = (label: string, key: keyof LineData, step: number, dp: number) => (
      <NumberInput
        label={label}
        value={d[key] as number}
        min={0}
        step={step}
        decimalScale={dp}
        onChange={(v) => set({ [key]: Number(v) || 0 } as Partial<LineData>)}
      />
    );
    return (
      <Stack gap="sm" p="sm">
        <Text size="sm" fw={700} c="dimmed">
          LINE
        </Text>
        <TextInput
          label="Name"
          value={d.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        {num("Length (km)", "length_km", 0.1, 3)}
        {num("Resistance (ohm/km)", "r_ohm_per_km", 0.01, 4)}
        {num("Reactance (ohm/km)", "x_ohm_per_km", 0.01, 4)}
        {num("Capacitance (nF/km)", "c_nf_per_km", 1, 2)}
        {num("Max current (kA)", "max_i_ka", 0.01, 4)}
        {d.res_loading_percent !== undefined && (
          <ResultList
            rows={[
              ["Loading", `${fixed(d.res_loading_percent, 1)} %`],
              ["P", `${fixed(d.res_p_mw ?? 0, 4)} MW`],
              ...(d.res_i_ka !== undefined
                ? ([["Current", `${fixed(d.res_i_ka * 1000, 1)} A`]] as ResultRow[])
                : []),
            ]}
          />
        )}
        <Divider my="xs" />
        <Button color="red" variant="light" size="xs" onClick={() => removeEdge(lineEdge.id)}>
          Delete line
        </Button>
      </Stack>
    );
  }

  if (!node) {
    return (
      <Stack p="sm">
        <Text size="sm" fw={700} c="dimmed">
          PROPERTIES
        </Text>
        <Text size="xs" c="dimmed">
          Select an element to edit its parameters.
        </Text>
      </Stack>
    );
  }

  const update = (patch: Record<string, unknown>) =>
    updateNodeData(node.id, patch as never);

  return (
    <Stack gap="sm" p="sm">
      <Text size="sm" fw={700} c="dimmed">
        {HEADERS[node.type ?? ""] ?? node.type?.toUpperCase()}
      </Text>
      <TextInput
        label="Name"
        value={(node.data as { name: string }).name}
        onChange={(e) => update({ name: e.currentTarget.value })}
      />

      {node.type === "bus" && (
        <NumberInput
          label="Nominal voltage (kV)"
          value={(node.data as BusData).vn_kv}
          min={0}
          step={0.01}
          decimalScale={3}
          onChange={(v) => update({ vn_kv: Number(v) || 0 })}
        />
      )}

      {node.type === "generator" && (
        <>
          <NumberInput
            label="Active power (MW)"
            value={(node.data as GeneratorData).p_mw}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Number(v) || 0 })}
          />
          <NumberInput
            label="Voltage setpoint (p.u.)"
            value={(node.data as GeneratorData).vm_pu}
            min={0}
            step={0.01}
            decimalScale={3}
            onChange={(v) => update({ vm_pu: Number(v) || 0 })}
          />
          <Switch
            label="Slack (voltage reference)"
            checked={(node.data as GeneratorData).slack}
            onChange={(e) => update({ slack: e.currentTarget.checked })}
          />
          {(node.data as GeneratorData).slack && (
            <NumberInput
              label="Slack priority (weight)"
              description="Higher share of balancing when multiple slacks"
              value={(node.data as GeneratorData).slack_weight}
              min={0}
              step={0.1}
              decimalScale={2}
              onChange={(v) => update({ slack_weight: Number(v) || 0 })}
            />
          )}
        </>
      )}

      {node.type === "sgen" && (
        <>
          <NumberInput
            label="Active power (MW)"
            value={(node.data as SgenData).p_mw}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Number(v) || 0 })}
          />
          <NumberInput
            label="Reactive power (MVar)"
            value={(node.data as SgenData).q_mvar}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ q_mvar: Number(v) || 0 })}
          />
        </>
      )}

      {node.type === "extgrid" && (
        <>
          <NumberInput
            label="Voltage setpoint (p.u.)"
            value={(node.data as ExtGridData).vm_pu}
            min={0}
            step={0.01}
            decimalScale={3}
            onChange={(v) => update({ vm_pu: Number(v) || 0 })}
          />
          <NumberInput
            label="Voltage angle (deg)"
            value={(node.data as ExtGridData).va_degree}
            step={0.1}
            decimalScale={2}
            onChange={(v) => update({ va_degree: Number(v) || 0 })}
          />
          <Text size="xs" c="dimmed">
            Always a slack (voltage reference) that balances the network.
          </Text>
        </>
      )}

      {node.type === "load" && (
        <>
          <NumberInput
            label="Active power (MW)"
            value={(node.data as LoadData).p_mw}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Number(v) || 0 })}
          />
          <NumberInput
            label="Reactive power (MVar)"
            value={(node.data as LoadData).q_mvar}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ q_mvar: Number(v) || 0 })}
          />
        </>
      )}

      {node.type === "switch" && (
        <Switch
          label="Closed"
          checked={(node.data as SwitchData).closed}
          onChange={(e) => update({ closed: e.currentTarget.checked })}
        />
      )}

      {node.type === "trafo2w" && (
        <>
          {(node.data as Trafo2WData).params && (
            <Text size="xs" c="dimmed">
              Imported with custom parameters (
              {(node.data as Trafo2WData).params!.sn_mva} MVA,{" "}
              {(node.data as Trafo2WData).params!.vn_hv_kv}/
              {(node.data as Trafo2WData).params!.vn_lv_kv} kV). Choosing a standard
              type replaces them.
            </Text>
          )}
          <Select
            label="Standard type"
            data={TRAFO_STD_TYPES}
            value={
              TRAFO_STD_TYPES.includes((node.data as Trafo2WData).std_type)
                ? (node.data as Trafo2WData).std_type
                : null
            }
            placeholder={
              (node.data as Trafo2WData).params ? "Custom (imported)" : undefined
            }
            // Picking a standard type discards any imported explicit params so
            // the chosen type drives the solve.
            onChange={(v) => v && update({ std_type: v, params: null })}
            allowDeselect={false}
            searchable
          />
        </>
      )}

      {node.type === "trafo3w" && (
        <>
          {(node.data as Trafo3WData).params && (
            <Text size="xs" c="dimmed">
              Imported with custom parameters (
              {(node.data as Trafo3WData).params!.sn_hv_mva}/
              {(node.data as Trafo3WData).params!.sn_mv_mva}/
              {(node.data as Trafo3WData).params!.sn_lv_mva} MVA). Choosing a
              standard type replaces them.
            </Text>
          )}
          <Select
            label="Standard type"
            data={TRAFO3W_STD_TYPES}
            value={
              TRAFO3W_STD_TYPES.includes((node.data as Trafo3WData).std_type)
                ? (node.data as Trafo3WData).std_type
                : null
            }
            placeholder={
              (node.data as Trafo3WData).params ? "Custom (imported)" : undefined
            }
            onChange={(v) => v && update({ std_type: v, params: null })}
            allowDeselect={false}
          />
        </>
      )}

      <ResultList rows={nodeResultRows(node.type, node.data)} />


      <Divider my="xs" />
      <Button color="red" variant="light" size="xs" onClick={() => removeNode(node.id)}>
        Delete element
      </Button>
      <Text size="xs" c="dimmed">
        Tip: select an element or wire and press Backspace/Delete.
      </Text>

      {node.type === "bus" && (
        <>
          <Divider my="xs" />
          <VoltageLegend />
        </>
      )}
    </Stack>
  );
}
