import {
  Button,
  Divider,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useEditor } from "../store";
import type { BusData, GeneratorData, LoadData, SwitchData } from "../types";

export function Inspector() {
  const { nodes, selectedId, updateNodeData, removeNode } = useEditor();
  const node = nodes.find((n) => n.id === selectedId);

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
        {node.type === "bus" ? "BUS BAR" : node.type?.toUpperCase()}
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
