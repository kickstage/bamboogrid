import {
  Accordion,
  Divider,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { fetchStdTypes, type StdTrafoTypes } from "../api";
import { useEditor } from "../store";
import { fixed } from "../format";
import { busInjection } from "../power";
import {
  connectedTrafoVoltages,
  kvEqual,
  matchingTrafo2wTypes,
  matchingTrafo3wTypes,
  trafo2wNames,
  trafo3wNames,
} from "../trafo";
import {
  FaultCurrentLegend,
  HEADERS,
  ResultList,
  VoltageLegend,
  busInjectionRows,
  busScRows,
  nodeResultRows,
  type ResultRow,
} from "./results";
import type {
  BusData,
  ExtGridData,
  ForeignData,
  GeneratorData,
  LineData,
  LoadData,
  SgenData,
  ShuntData,
  SwitchData,
  Trafo2WData,
  Trafo2WParams,
  Trafo3WData,
  Trafo3WParams,
} from "../types";

// One editable transformer parameter: which field, how to label and step it.
type ParamField = { key: string; label: string; step: number; dp: number };

const TRAFO2W_FIELDS: ParamField[] = [
  { key: "sn_mva", label: "Rated power (MVA)", step: 0.1, dp: 4 },
  { key: "vn_hv_kv", label: "HV nominal voltage (kV)", step: 1, dp: 3 },
  { key: "vn_lv_kv", label: "LV nominal voltage (kV)", step: 0.1, dp: 3 },
  { key: "vk_percent", label: "Short-circuit voltage vk (%)", step: 0.1, dp: 3 },
  { key: "vkr_percent", label: "Real part vkr (%)", step: 0.1, dp: 4 },
  { key: "pfe_kw", label: "Iron losses (kW)", step: 0.1, dp: 3 },
  { key: "i0_percent", label: "No-load current i0 (%)", step: 0.01, dp: 4 },
  { key: "shift_degree", label: "Phase shift (deg)", step: 30, dp: 1 },
];

const TRAFO3W_FIELDS: ParamField[] = [
  { key: "sn_hv_mva", label: "HV rated power (MVA)", step: 0.1, dp: 4 },
  { key: "sn_mv_mva", label: "MV rated power (MVA)", step: 0.1, dp: 4 },
  { key: "sn_lv_mva", label: "LV rated power (MVA)", step: 0.1, dp: 4 },
  { key: "vn_hv_kv", label: "HV nominal voltage (kV)", step: 1, dp: 3 },
  { key: "vn_mv_kv", label: "MV nominal voltage (kV)", step: 1, dp: 3 },
  { key: "vn_lv_kv", label: "LV nominal voltage (kV)", step: 0.1, dp: 3 },
  { key: "vk_hv_percent", label: "HV short-circuit voltage vk (%)", step: 0.1, dp: 3 },
  { key: "vk_mv_percent", label: "MV short-circuit voltage vk (%)", step: 0.1, dp: 3 },
  { key: "vk_lv_percent", label: "LV short-circuit voltage vk (%)", step: 0.1, dp: 3 },
  { key: "vkr_hv_percent", label: "HV real part vkr (%)", step: 0.1, dp: 4 },
  { key: "vkr_mv_percent", label: "MV real part vkr (%)", step: 0.1, dp: 4 },
  { key: "vkr_lv_percent", label: "LV real part vkr (%)", step: 0.1, dp: 4 },
  { key: "pfe_kw", label: "Iron losses (kW)", step: 0.1, dp: 3 },
  { key: "i0_percent", label: "No-load current i0 (%)", step: 0.01, dp: 4 },
  { key: "shift_mv_degree", label: "MV phase shift (deg)", step: 30, dp: 1 },
  { key: "shift_lv_degree", label: "LV phase shift (deg)", step: 30, dp: 1 },
];

// The "Advanced" expander: editable NumberInputs for each transformer parameter.
// A std_type only fills these — editing any one makes the transformer custom.
function AdvancedParams({
  fields,
  params,
  onChange,
}: {
  fields: ParamField[];
  params: Record<string, number>;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <Accordion variant="separated" chevronPosition="right" px={0}>
      <Accordion.Item value="advanced">
        <Accordion.Control>Advanced parameters</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="xs">
            {fields.map((f) => (
              <NumberInput
                key={f.key}
                label={f.label}
                value={params[f.key] ?? 0}
                step={f.step}
                decimalScale={f.dp}
                onChange={(v) => onChange(f.key, Number(v) || 0)}
              />
            ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

export function Inspector() {
  const {
    nodes,
    edges,
    selectedId,
    selectedEdgeId,
    updateNodeData,
    updateEdgeData,
    studyMode,
  } = useEditor();

  // pandapower's std transformer catalog, fetched once (cached in api.ts). Used
  // to expand a picked std_type into editable params and to show a std-type
  // transformer's values before it's been re-projected with explicit params.
  const [trafo2wStd, setTrafo2wStd] = useState<StdTrafoTypes>();
  const [trafo3wStd, setTrafo3wStd] = useState<StdTrafoTypes>();
  useEffect(() => {
    fetchStdTypes("trafo").then(setTrafo2wStd).catch(() => {});
    fetchStdTypes("trafo3w").then(setTrafo3wStd).catch(() => {});
  }, []);

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
              ["Q", `${fixed(d.res_q_mvar ?? 0, 4)} Mvar`],
              ...(d.res_i_ka !== undefined
                ? ([["Current", `${fixed(d.res_i_ka * 1000, 1)} A`]] as ResultRow[])
                : []),
            ]}
          />
        )}
      </Stack>
    );
  }

  if (node?.type === "foreign") {
    const d = node.data as ForeignData;
    return (
      <Stack gap="sm" p="sm">
        <Text size="sm" fw={700} c="dimmed">
          {d.table.toUpperCase()}
        </Text>
        <Text size="sm">{d.label}</Text>
        <Text size="xs" c="dimmed">
          This pandapower element type isn't editable in the diagram yet. It stays
          on the network and is included in the load flow; edit it in pandapower
          or re-import to change it.
        </Text>
        {d.bus_ids.length > 0 && (
          <Text size="xs" c="dimmed">
            Connected to {d.bus_ids.length} bus
            {d.bus_ids.length === 1 ? "" : "es"}.
          </Text>
        )}
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

  // Net injection at a solved bus, summed from the elements wired to it. Powers
  // the P/Q figures and the power-factor tools below.
  const bus = node.type === "bus" ? (node.data as BusData) : null;
  const inj =
    bus && bus.vm_pu !== undefined ? busInjection(node.id, nodes, edges) : null;

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
          <Divider my={4} label="Short-circuit" labelPosition="left" />
          <NumberInput
            label="Rated power (MVA)"
            value={(node.data as GeneratorData).sn_mva}
            min={0}
            step={0.1}
            decimalScale={3}
            onChange={(v) => update({ sn_mva: Number(v) || 0 })}
          />
          <NumberInput
            label="Subtransient reactance (p.u.)"
            description="xdss″ — drives the machine's fault contribution"
            value={(node.data as GeneratorData).xdss_pu}
            min={0}
            step={0.01}
            decimalScale={4}
            onChange={(v) => update({ xdss_pu: Number(v) || 0 })}
          />
          <NumberInput
            label="Power factor (cos φ)"
            value={(node.data as GeneratorData).cos_phi}
            min={0}
            max={1}
            step={0.01}
            decimalScale={3}
            onChange={(v) => update({ cos_phi: Number(v) || 0 })}
          />
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
          <Divider my={4} label="Short-circuit" labelPosition="left" />
          <NumberInput
            label="Fault level (MVA)"
            description="Max short-circuit power at this connection"
            value={(node.data as ExtGridData).s_sc_max_mva}
            min={0}
            step={10}
            decimalScale={2}
            onChange={(v) => update({ s_sc_max_mva: Number(v) || 0 })}
          />
          <NumberInput
            label="R/X ratio (max)"
            value={(node.data as ExtGridData).rx_max}
            min={0}
            step={0.01}
            decimalScale={4}
            onChange={(v) => update({ rx_max: Number(v) || 0 })}
          />
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

      {node.type === "shunt" && (
        <>
          <NumberInput
            label="Active power (MW)"
            value={(node.data as ShuntData).p_mw}
            min={0}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Math.max(0, Number(v) || 0) })}
          />
          <NumberInput
            label="Reactive power (MVar)"
            value={(node.data as ShuntData).q_mvar}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ q_mvar: Number(v) || 0 })}
          />
          <Text size="xs" c="dimmed">
            Negative MVar = capacitor (injects reactive power); positive = reactor
            (absorbs it).
          </Text>
        </>
      )}

      {node.type === "switch" && (
        <Switch
          label="Closed"
          checked={(node.data as SwitchData).closed}
          onChange={(e) => update({ closed: e.currentTarget.checked })}
        />
      )}

      {node.type === "trafo2w" &&
        (() => {
          const d = node.data as Trafo2WData;
          const volts = connectedTrafoVoltages(node.id, nodes, edges);
          const haveBoth = volts.hv != null && volts.lv != null;
          const matching = haveBoth
            ? matchingTrafo2wTypes(volts.hv!, volts.lv!)
            : trafo2wNames();
          const isCustom = !d.std_type;
          // Params are the source of truth; a just-picked std type not yet
          // re-projected falls back to the fetched catalog values for display.
          const params =
            d.params ??
            (d.std_type
              ? (trafo2wStd?.[d.std_type] as Trafo2WParams | undefined)
              : undefined);
          const mismatch =
            haveBoth &&
            (isCustom
              ? !!params &&
                !(
                  kvEqual(params.vn_hv_kv, volts.hv!) &&
                  kvEqual(params.vn_lv_kv, volts.lv!)
                )
              : !matching.includes(d.std_type));
          const pickStd = (v: string | null) => {
            if (!v) return;
            const filled = trafo2wStd?.[v] as Trafo2WParams | undefined;
            update({ std_type: v, params: filled ? { ...filled } : d.params });
          };
          const editParam = (key: string, value: number) => {
            if (!params) return;
            // Editing any field makes the transformer custom (drops the preset).
            update({ std_type: "", params: { ...params, [key]: value } });
          };
          return (
            <>
              <Text size="xs" c="dimmed">
                Connected buses: HV {volts.hv ?? "?"} kV / LV {volts.lv ?? "?"} kV
              </Text>
              {mismatch && (
                <Text size="xs" c="orange">
                  Rated voltages don't match the connected buses (HV {volts.hv} kV
                  / LV {volts.lv} kV).
                </Text>
              )}
              <Select
                label="Standard type"
                data={matching}
                value={matching.includes(d.std_type) ? d.std_type : null}
                placeholder={
                  matching.length === 0
                    ? "No standard type for these voltages"
                    : isCustom
                      ? "Custom"
                      : undefined
                }
                onChange={pickStd}
                allowDeselect={false}
                searchable
              />
              {params && (
                <AdvancedParams
                  fields={TRAFO2W_FIELDS}
                  params={params}
                  onChange={editParam}
                />
              )}
            </>
          );
        })()}

      {node.type === "trafo3w" &&
        (() => {
          const d = node.data as Trafo3WData;
          const volts = connectedTrafoVoltages(node.id, nodes, edges);
          const haveAll =
            volts.hv != null && volts.mv != null && volts.lv != null;
          const matching = haveAll
            ? matchingTrafo3wTypes(volts.hv!, volts.mv!, volts.lv!)
            : trafo3wNames();
          const isCustom = !d.std_type;
          const params =
            d.params ??
            (d.std_type
              ? (trafo3wStd?.[d.std_type] as Trafo3WParams | undefined)
              : undefined);
          const mismatch =
            haveAll &&
            (isCustom
              ? !!params &&
                !(
                  kvEqual(params.vn_hv_kv, volts.hv!) &&
                  kvEqual(params.vn_mv_kv, volts.mv!) &&
                  kvEqual(params.vn_lv_kv, volts.lv!)
                )
              : !matching.includes(d.std_type));
          const pickStd = (v: string | null) => {
            if (!v) return;
            const filled = trafo3wStd?.[v] as Trafo3WParams | undefined;
            update({ std_type: v, params: filled ? { ...filled } : d.params });
          };
          const editParam = (key: string, value: number) => {
            if (!params) return;
            update({ std_type: "", params: { ...params, [key]: value } });
          };
          return (
            <>
              <Text size="xs" c="dimmed">
                Connected buses: HV {volts.hv ?? "?"} kV / MV {volts.mv ?? "?"} kV
                / LV {volts.lv ?? "?"} kV
              </Text>
              {mismatch && (
                <Text size="xs" c="orange">
                  Rated voltages don't match the connected buses (HV {volts.hv} kV
                  / MV {volts.mv} kV / LV {volts.lv} kV).
                </Text>
              )}
              <Select
                label="Standard type"
                data={matching}
                value={matching.includes(d.std_type) ? d.std_type : null}
                placeholder={
                  matching.length === 0
                    ? "No standard type for these voltages"
                    : isCustom
                      ? "Custom"
                      : undefined
                }
                onChange={pickStd}
                allowDeselect={false}
              />
              {params && (
                <AdvancedParams
                  fields={TRAFO3W_FIELDS}
                  params={params}
                  onChange={editParam}
                />
              )}
            </>
          );
        })()}

      <ResultList
        rows={[
          ...nodeResultRows(node.type, node.data),
          ...(inj ? busInjectionRows(inj) : []),
        ]}
      />

      {node.type === "bus" && (
        <ResultList label="Short-circuit result" rows={busScRows(bus!)} />
      )}

      {node.type === "bus" && (
        <>
          <Divider my="xs" />
          {studyMode === "shortcircuit" ? <FaultCurrentLegend /> : <VoltageLegend />}
        </>
      )}
    </Stack>
  );
}
