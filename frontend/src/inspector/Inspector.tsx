import {
  Accordion,
  Divider,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Switch } from "../ui/Switch";
import { useEffect, useState, type ReactNode } from "react";
import "./inspector.css";
import { fetchStdTypes, type StdTrafoTypes } from "../api";
import { useEditor } from "../store";
import { fixed } from "../format";
import { busInjection } from "../power";
import {
  connectedTrafoVoltages,
  formatTrafoVoltages,
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
  XwardData,
} from "../types";

// A physical-quantity symbol with an upright subscript, e.g. S_N or v_kr, so the
// advanced labels read in the usual scientific notation.
function Sym({ children, sub }: { children: ReactNode; sub: ReactNode }) {
  return (
    <>
      <em>{children}</em>
      <sub>{sub}</sub>
    </>
  );
}

// One editable transformer parameter: which field, how to label and step it.
type ParamField = { key: string; label: ReactNode; step: number; dp: number };
// Advanced parameters grouped by what they describe (see pandapower's trafo
// model), each shown under a small heading.
type ParamGroup = { title: string; fields: ParamField[] };

const TRAFO2W_GROUPS: ParamGroup[] = [
  {
    title: "Ratings",
    fields: [
      { key: "sn_mva", label: <>Rated power <Sym sub="N">S</Sym> (MVA)</>, step: 0.1, dp: 4 },
      { key: "vn_hv_kv", label: <>HV rated voltage <Sym sub="N">V</Sym> (kV)</>, step: 1, dp: 3 },
      { key: "vn_lv_kv", label: <>LV rated voltage <Sym sub="N">V</Sym> (kV)</>, step: 0.1, dp: 3 },
    ],
  },
  {
    title: "Short-circuit voltage",
    fields: [
      { key: "vk_percent", label: <><Sym sub="k">v</Sym> (%)</>, step: 0.1, dp: 3 },
      { key: "vkr_percent", label: <>Real part <Sym sub="kr">v</Sym> (%)</>, step: 0.1, dp: 4 },
    ],
  },
  {
    title: "No-load (magnetising)",
    fields: [
      { key: "pfe_kw", label: <>Iron losses <Sym sub="Fe">P</Sym> (kW)</>, step: 0.1, dp: 3 },
      { key: "i0_percent", label: <>No-load current <Sym sub="0">i</Sym> (%)</>, step: 0.01, dp: 4 },
    ],
  },
  {
    title: "Phase shift",
    fields: [
      { key: "shift_degree", label: <>Phase shift <em>θ</em> (deg)</>, step: 30, dp: 1 },
    ],
  },
];

const TRAFO3W_GROUPS: ParamGroup[] = [
  {
    title: "Rated power",
    fields: [
      { key: "sn_hv_mva", label: <>HV <Sym sub="N">S</Sym> (MVA)</>, step: 0.1, dp: 4 },
      { key: "sn_mv_mva", label: <>MV <Sym sub="N">S</Sym> (MVA)</>, step: 0.1, dp: 4 },
      { key: "sn_lv_mva", label: <>LV <Sym sub="N">S</Sym> (MVA)</>, step: 0.1, dp: 4 },
    ],
  },
  {
    title: "Rated voltage",
    fields: [
      { key: "vn_hv_kv", label: <>HV <Sym sub="N">V</Sym> (kV)</>, step: 1, dp: 3 },
      { key: "vn_mv_kv", label: <>MV <Sym sub="N">V</Sym> (kV)</>, step: 1, dp: 3 },
      { key: "vn_lv_kv", label: <>LV <Sym sub="N">V</Sym> (kV)</>, step: 0.1, dp: 3 },
    ],
  },
  {
    title: "Short-circuit voltage",
    fields: [
      { key: "vk_hv_percent", label: <>HV <Sym sub="k">v</Sym> (%)</>, step: 0.1, dp: 3 },
      { key: "vk_mv_percent", label: <>MV <Sym sub="k">v</Sym> (%)</>, step: 0.1, dp: 3 },
      { key: "vk_lv_percent", label: <>LV <Sym sub="k">v</Sym> (%)</>, step: 0.1, dp: 3 },
      { key: "vkr_hv_percent", label: <>HV real part <Sym sub="kr">v</Sym> (%)</>, step: 0.1, dp: 4 },
      { key: "vkr_mv_percent", label: <>MV real part <Sym sub="kr">v</Sym> (%)</>, step: 0.1, dp: 4 },
      { key: "vkr_lv_percent", label: <>LV real part <Sym sub="kr">v</Sym> (%)</>, step: 0.1, dp: 4 },
    ],
  },
  {
    title: "No-load (magnetising)",
    fields: [
      { key: "pfe_kw", label: <>Iron losses <Sym sub="Fe">P</Sym> (kW)</>, step: 0.1, dp: 3 },
      { key: "i0_percent", label: <>No-load current <Sym sub="0">i</Sym> (%)</>, step: 0.01, dp: 4 },
    ],
  },
  {
    title: "Phase shift",
    fields: [
      { key: "shift_mv_degree", label: <>MV phase shift <em>θ</em> (deg)</>, step: 30, dp: 1 },
      { key: "shift_lv_degree", label: <>LV phase shift <em>θ</em> (deg)</>, step: 30, dp: 1 },
    ],
  },
];

const TRAFO2W_KEYS = TRAFO2W_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
const TRAFO3W_KEYS = TRAFO3W_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

// Sentinel shown in the Standard type dropdown for hand-entered parameters.
const CUSTOM_TYPE = "Custom";

// Blank advanced inputs for a fresh custom transformer. null leaves each field
// empty; the backend skips nulls (keeping the prior electrical columns) while
// still dropping the std_type label, so the trafo reads as custom.
const emptyParams = (keys: string[]): Record<string, null> =>
  Object.fromEntries(keys.map((k) => [k, null]));

// The "Advanced" expander: editable NumberInputs grouped by purpose. Rendered
// without the Accordion's separated card so the inputs span the full panel
// width. A std_type only fills these — editing any one makes the trafo custom.
function AdvancedParams({
  groups,
  params,
  onChange,
}: {
  groups: ParamGroup[];
  params: Record<string, number | null>;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <Accordion
      chevronPosition="right"
      classNames={{ control: "advancedControl" }}
      styles={{
        item: { border: "none" },
        control: { paddingInline: 0 },
        content: { paddingInline: 0 },
      }}
    >
      <Accordion.Item value="advanced">
        <Accordion.Control>Advanced parameters</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            {groups.map((g) => (
              <Stack gap="xs" key={g.title}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  {g.title}
                </Text>
                {g.fields.map((f) => (
                  <NumberInput
                    key={f.key}
                    label={f.label}
                    value={params[f.key] ?? ""}
                    step={f.step}
                    decimalScale={f.dp}
                    onChange={(v) => onChange(f.key, Number(v) || 0)}
                  />
                ))}
              </Stack>
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

      {node.type === "bus" &&
        (() => {
          // A line — or a bus–bus switch — joins two buses at one voltage level,
          // so while either is attached we lock the nominal voltage to keep both
          // ends consistent.
          const lineConnected = edges.some(
            (e) =>
              e.type === "line" && (e.source === node.id || e.target === node.id),
          );
          // Switch nodes wired to this bus (switch = wire source, bus = target)…
          const switchIds = new Set(
            edges
              .filter(
                (e) =>
                  e.target === node.id &&
                  nodes.find((n) => n.id === e.source)?.type === "switch",
              )
              .map((e) => e.source),
          );
          // …that also reach a second bus.
          const switchConnected = edges.some(
            (e) =>
              switchIds.has(e.source) &&
              e.target !== node.id &&
              nodes.find((n) => n.id === e.target)?.type === "bus",
          );
          const locked = lineConnected || switchConnected;
          return (
            <Tooltip
              label="Connected buses share one nominal voltage. Remove the connection to change it."
              disabled={!locked}
              color="yellow"
              styles={{ tooltip: { color: "var(--mantine-color-black)" } }}
              multiline
              w={220}
              withArrow
            >
              <div>
                <NumberInput
                  label="Nominal voltage (kV)"
                  value={(node.data as BusData).vn_kv}
                  min={0}
                  step={0.01}
                  decimalScale={3}
                  disabled={locked}
                  onChange={(v) => update({ vn_kv: Number(v) || 0 })}
                />
              </div>
            </Tooltip>
          );
        })()}

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

      {node.type === "xward" &&
        (() => {
          const d = node.data as XwardData;
          const num = (
            label: ReactNode,
            key: keyof XwardData,
            step: number,
            dp: number,
            min?: number,
          ) => (
            <NumberInput
              label={label}
              value={d[key] as number}
              min={min}
              step={step}
              decimalScale={dp}
              onChange={(v) => update({ [key]: Number(v) || 0 })}
            />
          );
          return (
            <>
              <Text size="xs" c="dimmed">
                A reduced equivalent of an external network: a fixed injection plus
                an impedance plus a voltage source behind it.
              </Text>
              <Divider my={4} label="Constant power" labelPosition="left" />
              {num("Active power (MW)", "ps_mw", 0.1, 4)}
              {num("Reactive power (MVar)", "qs_mvar", 0.1, 4)}
              <Divider my={4} label="Constant impedance (at 1 p.u.)" labelPosition="left" />
              {num("Active power (MW)", "pz_mw", 0.1, 4)}
              {num("Reactive power (MVar)", "qz_mvar", 0.1, 4)}
              <Divider my={4} label="Internal source" labelPosition="left" />
              {num(<>Resistance <Sym sub="int">R</Sym> (Ω)</>, "r_ohm", 0.1, 4, 0)}
              {num(<>Reactance <Sym sub="int">X</Sym> (Ω)</>, "x_ohm", 0.1, 4, 0)}
              {num("Voltage setpoint (p.u.)", "vm_pu", 0.01, 4, 0)}
            </>
          );
        })()}

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
                params.vn_hv_kv != null &&
                params.vn_lv_kv != null &&
                !(
                  kvEqual(params.vn_hv_kv, volts.hv!) &&
                  kvEqual(params.vn_lv_kv, volts.lv!)
                )
              : !matching.includes(d.std_type));
          const editParam = (key: string, value: number) => {
            if (!params) return;
            // Editing any field makes the transformer custom (drops the preset).
            update({ std_type: "", params: { ...params, [key]: value } });
          };
          // Custom blanks the inputs; a named type fills them — overwriting any
          // hand-entered values, so confirm before leaving a custom transformer.
          const onTypeChange = (v: string | null) => {
            if (!v) return;
            if (v === CUSTOM_TYPE) {
              if (!isCustom)
                update({ std_type: "", params: emptyParams(TRAFO2W_KEYS) });
              return;
            }
            if (
              isCustom &&
              !window.confirm(
                "Switching to a standard type replaces your custom values. Continue?",
              )
            )
              return;
            const filled = trafo2wStd?.[v] as Trafo2WParams | undefined;
            update({ std_type: v, params: filled ? { ...filled } : d.params });
          };
          return (
            <>
              <Text size="xs" c="dimmed">
                Connected buses: {formatTrafoVoltages(volts, ["hv", "lv"])}
              </Text>
              {mismatch && (
                <Text size="xs" c="orange">
                  Rated voltages don't match the connected buses (
                  {formatTrafoVoltages(volts, ["hv", "lv"])}).
                </Text>
              )}
              <Select
                label="Standard type"
                data={[...matching, CUSTOM_TYPE]}
                value={
                  isCustom
                    ? CUSTOM_TYPE
                    : matching.includes(d.std_type)
                      ? d.std_type
                      : null
                }
                placeholder={
                  matching.length === 0
                    ? "No standard type for these voltages"
                    : undefined
                }
                onChange={onTypeChange}
                allowDeselect={false}
                searchable
              />
              {params && (
                <AdvancedParams
                  groups={TRAFO2W_GROUPS}
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
                params.vn_hv_kv != null &&
                params.vn_mv_kv != null &&
                params.vn_lv_kv != null &&
                !(
                  kvEqual(params.vn_hv_kv, volts.hv!) &&
                  kvEqual(params.vn_mv_kv, volts.mv!) &&
                  kvEqual(params.vn_lv_kv, volts.lv!)
                )
              : !matching.includes(d.std_type));
          const editParam = (key: string, value: number) => {
            if (!params) return;
            update({ std_type: "", params: { ...params, [key]: value } });
          };
          // Custom blanks the inputs; a named type fills them — overwriting any
          // hand-entered values, so confirm before leaving a custom transformer.
          const onTypeChange = (v: string | null) => {
            if (!v) return;
            if (v === CUSTOM_TYPE) {
              if (!isCustom)
                update({ std_type: "", params: emptyParams(TRAFO3W_KEYS) });
              return;
            }
            if (
              isCustom &&
              !window.confirm(
                "Switching to a standard type replaces your custom values. Continue?",
              )
            )
              return;
            const filled = trafo3wStd?.[v] as Trafo3WParams | undefined;
            update({ std_type: v, params: filled ? { ...filled } : d.params });
          };
          return (
            <>
              <Text size="xs" c="dimmed">
                Connected buses: {formatTrafoVoltages(volts, ["hv", "mv", "lv"])}
              </Text>
              {mismatch && (
                <Text size="xs" c="orange">
                  Rated voltages don't match the connected buses (
                  {formatTrafoVoltages(volts, ["hv", "mv", "lv"])}).
                </Text>
              )}
              <Select
                label="Standard type"
                data={[...matching, CUSTOM_TYPE]}
                value={
                  isCustom
                    ? CUSTOM_TYPE
                    : matching.includes(d.std_type)
                      ? d.std_type
                      : null
                }
                placeholder={
                  matching.length === 0
                    ? "No standard type for these voltages"
                    : undefined
                }
                onChange={onTypeChange}
                allowDeselect={false}
              />
              {params && (
                <AdvancedParams
                  groups={TRAFO3W_GROUPS}
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
