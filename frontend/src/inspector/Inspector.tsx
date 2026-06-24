import {
  Button,
  Divider,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useEditor } from "../store";
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

const HEADERS: Record<string, string> = {
  bus: "BUS BAR",
  generator: "GENERATOR",
  sgen: "STATIC GENERATOR",
  extgrid: "EXTERNAL GRID",
  load: "LOAD",
  switch: "SWITCH",
  trafo2w: "TRANSFORMER",
  trafo3w: "3W TRANSFORMER",
};

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
          <Text size="xs" c="dimmed">
            Result: {d.res_loading_percent.toFixed(1)}% loading, P{" "}
            {(d.res_p_mw ?? 0).toFixed(4)} MW
          </Text>
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
        <Select
          label="Standard type"
          data={TRAFO_STD_TYPES}
          value={(node.data as Trafo2WData).std_type}
          onChange={(v) => v && update({ std_type: v })}
          allowDeselect={false}
          searchable
        />
      )}

      {node.type === "trafo3w" && (
        <Select
          label="Standard type"
          data={TRAFO3W_STD_TYPES}
          value={(node.data as Trafo3WData).std_type}
          onChange={(v) => v && update({ std_type: v })}
          allowDeselect={false}
        />
      )}

      {node.type === "bus" && (node.data as BusData).vm_pu !== undefined && (
        <Text size="xs" c="dimmed">
          Result: {(node.data as BusData).vm_pu!.toFixed(4)} p.u. ·{" "}
          {((node.data as BusData).va_degree ?? 0).toFixed(2)}°
        </Text>
      )}

      {node.type === "generator" &&
        (node.data as GeneratorData).res_p_mw !== undefined && (
          <Text size="xs" c="dimmed">
            Result: P {(node.data as GeneratorData).res_p_mw!.toFixed(4)} MW,
            Q {((node.data as GeneratorData).res_q_mvar ?? 0).toFixed(4)} Mvar
          </Text>
        )}

      {(node.type === "sgen" || node.type === "extgrid") &&
        (node.data as SgenData | ExtGridData).res_p_mw !== undefined && (
          <Text size="xs" c="dimmed">
            Result: P {(node.data as SgenData | ExtGridData).res_p_mw!.toFixed(4)} MW,
            Q {((node.data as SgenData | ExtGridData).res_q_mvar ?? 0).toFixed(4)} Mvar
          </Text>
        )}

      {(node.type === "trafo2w" || node.type === "trafo3w") &&
        (node.data as Trafo2WData).res_loading_percent !== undefined && (
          <Text size="xs" c="dimmed">
            Result: {(node.data as Trafo2WData).res_loading_percent!.toFixed(1)}% loading,
            P {((node.data as Trafo2WData).res_p_mw ?? 0).toFixed(4)} MW
          </Text>
        )}

      <Divider my="xs" />
      <Button color="red" variant="light" size="xs" onClick={() => removeNode(node.id)}>
        Delete element
      </Button>
      <Text size="xs" c="dimmed">
        Tip: select an element or wire and press Backspace/Delete.
      </Text>
    </Stack>
  );
}
