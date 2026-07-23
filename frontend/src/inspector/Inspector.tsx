import {
  Divider,
  NumberInput,
  type NumberInputProps,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { Switch } from "../ui/Switch";
import { PanelTitle } from "../ui/Section";
import { CollapsibleSection } from "../ui/Collapsible";
import { useEffect, useState, type ReactNode } from "react";
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
import { MeasurementsSection } from "./Measurements";
import {
  FaultCurrentLegend,
  HEADERS,
  ResultList,
  VoltageLegend,
  busInjectionRows,
  busScRows,
  estimateRows,
  nodeResultRows,
  type ResultRow,
} from "./results";
import type {
  BusData,
  ExtGridData,
  ForeignData,
  GeneratorData,
  ImpedanceData,
  LineData,
  LoadData,
  MeasElementType,
  SgenData,
  ShuntData,
  SvcData,
  SwitchData,
  TapChangerFields,
  TapChangerType,
  Trafo2WData,
  Trafo2WParams,
  Trafo3WData,
  Trafo3WParams,
  XwardData,
} from "../types";

// Editor node type -> the measurement element type it carries (a line is an
// edge, handled separately). Absent means the node can't hold measurements.
const NODE_MEAS_ELEMENT: Partial<Record<string, MeasElementType>> = {
  bus: "bus",
  trafo2w: "trafo",
  trafo3w: "trafo3w",
};

// A physical-quantity symbol with an upright subscript (and optional
// superscript), e.g. S_N, v_kr or x″_d, so labels read in the usual scientific
// notation. `sup` renders before `sub` (e.g. the double-prime on a subtransient
// reactance).
function Sym({
  children,
  sub,
  sup,
}: {
  children: ReactNode;
  sub?: ReactNode;
  sup?: ReactNode;
}) {
  return (
    <>
      <em>{children}</em>
      {sup !== undefined && <sup>{sup}</sup>}
      {sub !== undefined && <sub>{sub}</sub>}
    </>
  );
}

// Every editable quantity is labeled the same way across all elements: the
// visible label is the symbol and unit — e.g. "P (MW)" — and hovering it reveals
// the descriptive name ("Active power"). The label is a plain span so it inherits
// the input label's typography. `unit` is omitted for dimensionless quantities
// (e.g. cos φ).
function ParamInput({
  name,
  symbol,
  unit,
  value,
  onChange,
  ...rest
}: {
  name: string;
  symbol: ReactNode;
  unit?: string;
} & Omit<NumberInputProps, "label">) {
  const [display, setDisplay] = useState<number | string>(value ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDisplay(value ?? "");
  }, [value, editing]);
  return (
    <NumberInput
      label={
        <span style={{ cursor: "help" }} title={name}>
          {symbol}
          {unit ? <> ({unit})</> : null}
        </span>
      }
      {...rest}
      value={display}
      onChange={onChange}
      onValueChange={(payload, event) => {
        if (event.source === "prop") return;
        setDisplay(payload.value);
      }}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        setDisplay(value ?? "");
      }}
    />
  );
}

// One editable transformer parameter: the field key, its symbol/unit (the
// visible label), the descriptive name (shown on hover) and how to step it.
type ParamField = {
  key: string;
  symbol: ReactNode;
  unit?: string;
  name: string;
  step: number;
  dp: number;
};
// Transformer parameters grouped by what they describe (see pandapower's trafo
// model), each shown under a small heading. `standard` groups (the ratings) are
// shown inline; the rest live in the collapsible "Advanced parameters" section.
type ParamGroup = { title: string; standard?: boolean; fields: ParamField[] };

const TRAFO2W_GROUPS: ParamGroup[] = [
  {
    title: "Ratings",
    standard: true,
    fields: [
      {
        key: "sn_mva",
        symbol: <Sym sub="N">S</Sym>,
        unit: "MVA",
        name: "Rated apparent power",
        step: 0.1,
        dp: 4,
      },
      {
        key: "vn_hv_kv",
        symbol: (
          <>
            HV <Sym sub="N">V</Sym>
          </>
        ),
        unit: "kV",
        name: "HV rated voltage",
        step: 1,
        dp: 3,
      },
      {
        key: "vn_lv_kv",
        symbol: (
          <>
            LV <Sym sub="N">V</Sym>
          </>
        ),
        unit: "kV",
        name: "LV rated voltage",
        step: 0.1,
        dp: 3,
      },
    ],
  },
  {
    title: "Short-circuit voltage",
    fields: [
      {
        key: "vk_percent",
        symbol: <Sym sub="k">v</Sym>,
        unit: "%",
        name: "Short-circuit voltage",
        step: 0.1,
        dp: 3,
      },
      {
        key: "vkr_percent",
        symbol: <Sym sub="kr">v</Sym>,
        unit: "%",
        name: "Short-circuit voltage (real part)",
        step: 0.1,
        dp: 4,
      },
    ],
  },
  {
    title: "No-load (magnetising)",
    fields: [
      {
        key: "pfe_kw",
        symbol: <Sym sub="Fe">P</Sym>,
        unit: "kW",
        name: "Iron (no-load) losses",
        step: 0.1,
        dp: 3,
      },
      {
        key: "i0_percent",
        symbol: <Sym sub="0">i</Sym>,
        unit: "%",
        name: "No-load current",
        step: 0.01,
        dp: 4,
      },
    ],
  },
  {
    title: "Phase shift",
    fields: [
      {
        key: "shift_degree",
        symbol: <em>θ</em>,
        unit: "deg",
        name: "Phase shift",
        step: 30,
        dp: 1,
      },
    ],
  },
];

const TRAFO3W_GROUPS: ParamGroup[] = [
  {
    title: "Rated power",
    standard: true,
    fields: [
      {
        key: "sn_hv_mva",
        symbol: (
          <>
            HV <Sym sub="N">S</Sym>
          </>
        ),
        unit: "MVA",
        name: "HV rated apparent power",
        step: 0.1,
        dp: 4,
      },
      {
        key: "sn_mv_mva",
        symbol: (
          <>
            MV <Sym sub="N">S</Sym>
          </>
        ),
        unit: "MVA",
        name: "MV rated apparent power",
        step: 0.1,
        dp: 4,
      },
      {
        key: "sn_lv_mva",
        symbol: (
          <>
            LV <Sym sub="N">S</Sym>
          </>
        ),
        unit: "MVA",
        name: "LV rated apparent power",
        step: 0.1,
        dp: 4,
      },
    ],
  },
  {
    title: "Rated voltage",
    standard: true,
    fields: [
      {
        key: "vn_hv_kv",
        symbol: (
          <>
            HV <Sym sub="N">V</Sym>
          </>
        ),
        unit: "kV",
        name: "HV rated voltage",
        step: 1,
        dp: 3,
      },
      {
        key: "vn_mv_kv",
        symbol: (
          <>
            MV <Sym sub="N">V</Sym>
          </>
        ),
        unit: "kV",
        name: "MV rated voltage",
        step: 1,
        dp: 3,
      },
      {
        key: "vn_lv_kv",
        symbol: (
          <>
            LV <Sym sub="N">V</Sym>
          </>
        ),
        unit: "kV",
        name: "LV rated voltage",
        step: 0.1,
        dp: 3,
      },
    ],
  },
  {
    title: "Short-circuit voltage",
    fields: [
      {
        key: "vk_hv_percent",
        symbol: (
          <>
            HV <Sym sub="k">v</Sym>
          </>
        ),
        unit: "%",
        name: "HV short-circuit voltage",
        step: 0.1,
        dp: 3,
      },
      {
        key: "vk_mv_percent",
        symbol: (
          <>
            MV <Sym sub="k">v</Sym>
          </>
        ),
        unit: "%",
        name: "MV short-circuit voltage",
        step: 0.1,
        dp: 3,
      },
      {
        key: "vk_lv_percent",
        symbol: (
          <>
            LV <Sym sub="k">v</Sym>
          </>
        ),
        unit: "%",
        name: "LV short-circuit voltage",
        step: 0.1,
        dp: 3,
      },
      {
        key: "vkr_hv_percent",
        symbol: (
          <>
            HV <Sym sub="kr">v</Sym>
          </>
        ),
        unit: "%",
        name: "HV short-circuit voltage (real part)",
        step: 0.1,
        dp: 4,
      },
      {
        key: "vkr_mv_percent",
        symbol: (
          <>
            MV <Sym sub="kr">v</Sym>
          </>
        ),
        unit: "%",
        name: "MV short-circuit voltage (real part)",
        step: 0.1,
        dp: 4,
      },
      {
        key: "vkr_lv_percent",
        symbol: (
          <>
            LV <Sym sub="kr">v</Sym>
          </>
        ),
        unit: "%",
        name: "LV short-circuit voltage (real part)",
        step: 0.1,
        dp: 4,
      },
    ],
  },
  {
    title: "No-load (magnetising)",
    fields: [
      {
        key: "pfe_kw",
        symbol: <Sym sub="Fe">P</Sym>,
        unit: "kW",
        name: "Iron (no-load) losses",
        step: 0.1,
        dp: 3,
      },
      {
        key: "i0_percent",
        symbol: <Sym sub="0">i</Sym>,
        unit: "%",
        name: "No-load current",
        step: 0.01,
        dp: 4,
      },
    ],
  },
  {
    title: "Phase shift",
    fields: [
      {
        key: "shift_mv_degree",
        symbol: (
          <>
            MV <em>θ</em>
          </>
        ),
        unit: "deg",
        name: "MV phase shift",
        step: 30,
        dp: 1,
      },
      {
        key: "shift_lv_degree",
        symbol: (
          <>
            LV <em>θ</em>
          </>
        ),
        unit: "deg",
        name: "LV phase shift",
        step: 30,
        dp: 1,
      },
    ],
  },
];

const TRAFO2W_KEYS = TRAFO2W_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
const TRAFO3W_KEYS = TRAFO3W_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

const TRAFO2W_STD = TRAFO2W_GROUPS.filter((g) => g.standard);
const TRAFO2W_ADV = TRAFO2W_GROUPS.filter((g) => !g.standard);
const TRAFO3W_STD = TRAFO3W_GROUPS.filter((g) => g.standard);
const TRAFO3W_ADV = TRAFO3W_GROUPS.filter((g) => !g.standard);

// Sentinel shown in the Standard type dropdown for hand-entered parameters.
const CUSTOM_TYPE = "Custom";

// Blank advanced inputs for a fresh custom transformer. null leaves each field
// empty; the backend skips nulls (keeping the prior electrical columns) while
// still dropping the std_type label, so the trafo reads as custom.
const emptyParams = (keys: string[]): Record<string, null> =>
  Object.fromEntries(keys.map((k) => [k, null]));

// One parameter group: a labeled divider over its editable inputs. Shared by
// the inline (standard) ratings and the collapsible advanced section.
function GroupFields({
  group,
  params,
  onChange,
}: {
  group: ParamGroup;
  // Only the numeric group fields are read here; string tap fields on the wider
  // param type are ignored.
  params: Record<string, number | string | null | undefined>;
  onChange: (key: string, value: number) => void;
}) {
  return (
    <Stack gap="xs">
      <Divider label={group.title} labelPosition="left" />
      {group.fields.map((f) => (
        <ParamInput
          key={f.key}
          name={f.name}
          symbol={f.symbol}
          unit={f.unit}
          value={params[f.key] ?? ""}
          step={f.step}
          decimalScale={f.dp}
          onChange={(v) => onChange(f.key, Number(v) || 0)}
        />
      ))}
    </Stack>
  );
}

// The "Advanced parameters" expander: editable NumberInputs grouped by purpose,
// spanning the full panel width. A std_type only fills these — editing any one
// makes the trafo custom.
function AdvancedParams({
  groups,
  params,
  onChange,
}: {
  groups: ParamGroup[];
  params: Record<string, number | string | null | undefined>;
  onChange: (key: string, value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <CollapsibleSection
      label="Advanced parameters"
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <Stack gap="md" pt="xs">
        {groups.map((g) => (
          <GroupFields
            key={g.title}
            group={g}
            params={params}
            onChange={onChange}
          />
        ))}
      </Stack>
    </CollapsibleSection>
  );
}

// A transformer's tap changer. pandapower models a voltage regulator and a
// phase shifter with the same fields — shared identically between the 2- and
// 3-winding transformer — distinguished by `tap_changer_type`: "Ratio" moves
// voltage magnitude (via tap_step_percent), "Ideal"/"Symmetrical" move the phase
// angle (via tap_step_degree). Picking a type reveals the relevant fields;
// "None" removes the tap changer. Tabular (table-defined) presets are shown
// read-only — editing them isn't supported yet. `sides` lists the tappable
// windings (HV/LV for 2W; HV/MV/LV for 3W).
const TAP_TYPES = ["None", "Ratio", "Symmetrical", "Ideal"] as const;

// Tappable windings per transformer kind (value = pandapower's lowercase side).
const TAP_SIDES_2W = [
  { value: "hv", label: "HV" },
  { value: "lv", label: "LV" },
];
const TAP_SIDES_3W = [
  { value: "hv", label: "HV" },
  { value: "mv", label: "MV" },
  { value: "lv", label: "LV" },
];

function TapChanger({
  params,
  onPatch,
  onTapPos,
  sides,
}: {
  params: TapChangerFields;
  onPatch: (patch: Partial<TapChangerFields>) => void;
  // tap_pos is the operating setpoint — routed separately so moving the tap
  // doesn't drop the transformer's preset label (unlike every other tap edit).
  onTapPos: (pos: number) => void;
  sides: { value: string; label: string }[];
}) {
  const type = params.tap_changer_type ?? "None";
  const [open, setOpen] = useState(false);

  const section = (body: ReactNode) => (
    <CollapsibleSection
      label="Tap changer"
      open={open}
      onToggle={() => setOpen((o) => !o)}
    >
      <div style={{ paddingTop: "var(--mantine-spacing-xs)" }}>{body}</div>
    </CollapsibleSection>
  );

  if (type === "Tabular") {
    return section(
      <Text size="xs" c="dimmed">
        This transformer uses a tabular (table-defined) tap changer, which isn't
        editable here yet.
      </Text>,
    );
  }

  const setType = (v: string | null) => {
    if (!v || v === type) return;
    if (v === "None") {
      // Remove the tap changer entirely.
      onPatch({
        tap_changer_type: null,
        tap_side: null,
        tap_neutral: null,
        tap_min: null,
        tap_max: null,
        tap_pos: null,
        tap_step_percent: null,
        tap_step_degree: null,
      });
      return;
    }
    const tct = v as TapChangerType;
    const phase = tct === "Ideal" || tct === "Symmetrical";
    // Seed the position fields when turning a tap changer on from nothing.
    const seed =
      type === "None"
        ? {
            tap_side: params.tap_side ?? sides[0].value,
            tap_neutral: params.tap_neutral ?? 0,
            tap_min: params.tap_min ?? -9,
            tap_max: params.tap_max ?? 9,
            tap_pos: params.tap_pos ?? 0,
          }
        : {};
    onPatch({
      tap_changer_type: tct,
      ...seed,
      // The step fields are mutually exclusive by type: pandapower rejects a
      // voltage step on an ideal phase shifter, and an angle step is meaningless
      // for a ratio changer. Symmetrical uses both.
      tap_step_percent: tct === "Ideal" ? 0 : params.tap_step_percent || 1.5,
      tap_step_degree: phase ? params.tap_step_degree || 1.5 : 0,
    });
  };

  const numField = (
    key: keyof TapChangerFields,
    symbol: ReactNode,
    unit: string | undefined,
    name: string,
    step: number,
    dp: number,
  ) => (
    <ParamInput
      name={name}
      symbol={symbol}
      unit={unit}
      value={(params[key] as number | null) ?? ""}
      step={step}
      decimalScale={dp}
      onChange={(v) =>
        onPatch({ [key]: Number(v) || 0 } as Partial<TapChangerFields>)
      }
    />
  );

  const ratio = type === "Ratio" || type === "Symmetrical";
  const phase = type === "Ideal" || type === "Symmetrical";

  return section(
    <Stack gap="xs">
      <Select
        label="Type"
        data={[...TAP_TYPES]}
        value={type}
        onChange={setType}
        allowDeselect={false}
      />
      {type !== "None" && (
        <>
          <Select
            label="Tap side"
            // Displayed uppercase to match the bus labels on the diagram; the
            // stored value stays pandapower's lowercase "hv"/"mv"/"lv".
            data={sides}
            value={params.tap_side ?? sides[0].value}
            onChange={(v) => v && onPatch({ tap_side: v })}
            allowDeselect={false}
          />
          {numField(
            "tap_neutral",
            "Neutral",
            undefined,
            "Neutral (mid) tap position",
            1,
            0,
          )}
          {numField("tap_min", "Min", undefined, "Minimum tap position", 1, 0)}
          {numField("tap_max", "Max", undefined, "Maximum tap position", 1, 0)}
          <ParamInput
            name="Current tap position"
            symbol="Position"
            value={params.tap_pos ?? params.tap_neutral ?? 0}
            step={1}
            decimalScale={0}
            onChange={(v) => onTapPos(Number(v) || 0)}
          />
          {ratio &&
            numField(
              "tap_step_percent",
              <>
                Δ<Sym sub="tap">V</Sym>
              </>,
              "%",
              "Voltage change per tap step",
              0.1,
              3,
            )}
          {phase &&
            numField(
              "tap_step_degree",
              <>
                Δ<Sym sub="tap">θ</Sym>
              </>,
              "deg",
              "Angle change per tap step",
              0.5,
              2,
            )}
        </>
      )}
    </Stack>,
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
    setTrafoTapPos,
    studyMode,
    estById,
  } = useEditor();

  // pandapower's std transformer catalog, fetched once (cached in api.ts). Used
  // to expand a picked std_type into editable params and to show a std-type
  // transformer's values before it's been re-projected with explicit params.
  const [trafo2wStd, setTrafo2wStd] = useState<StdTrafoTypes>();
  const [trafo3wStd, setTrafo3wStd] = useState<StdTrafoTypes>();
  useEffect(() => {
    fetchStdTypes("trafo")
      .then(setTrafo2wStd)
      .catch(() => {});
    fetchStdTypes("trafo3w")
      .then(setTrafo3wStd)
      .catch(() => {});
  }, []);

  const node = nodes.find((n) => n.id === selectedId);
  const lineEdge = edges.find(
    (e) => e.id === selectedEdgeId && e.type === "line",
  );

  // A line is a bus-to-bus edge; edit its explicit electrical parameters (the
  // solver builds the line straight from these).
  if (lineEdge) {
    const d = lineEdge.data as LineData;
    const set = (patch: Partial<LineData>) =>
      updateEdgeData(lineEdge.id, patch);
    const num = (
      name: string,
      symbol: ReactNode,
      unit: string,
      key: keyof LineData,
      step: number,
      dp: number,
    ) => (
      <ParamInput
        name={name}
        symbol={symbol}
        unit={unit}
        value={d[key] as number}
        min={0}
        step={step}
        decimalScale={dp}
        onChange={(v) => set({ [key]: Number(v) || 0 } as Partial<LineData>)}
      />
    );
    return (
      <Stack gap="sm" p="sm">
        <PanelTitle>Line</PanelTitle>
        <TextInput
          label="Name"
          value={d.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        {/* Line parameters are hidden in estimation mode to keep the panel
            focused on measurements and results. */}
        {studyMode !== "estimation" && (
          <>
            {num("Length", <em>l</em>, "km", "length_km", 0.1, 3)}
            {num(
              "Resistance per length",
              <>
                <em>R</em>′
              </>,
              "Ω/km",
              "r_ohm_per_km",
              0.01,
              4,
            )}
            {num(
              "Reactance per length",
              <>
                <em>X</em>′
              </>,
              "Ω/km",
              "x_ohm_per_km",
              0.01,
              4,
            )}
            {num(
              "Capacitance per length",
              <>
                <em>C</em>′
              </>,
              "nF/km",
              "c_nf_per_km",
              1,
              2,
            )}
            {num(
              "Max current (thermal limit)",
              <Sym sub="max">I</Sym>,
              "kA",
              "max_i_ka",
              0.01,
              4,
            )}
          </>
        )}
        {studyMode === "loadflow" && d.res_loading_percent !== undefined && (
          <ResultList
            rows={[
              ["Loading", `${fixed(d.res_loading_percent, 1)} %`],
              ["P", `${fixed(d.res_p_mw ?? 0, 4)} MW`],
              ["Q", `${fixed(d.res_q_mvar ?? 0, 4)} Mvar`],
              ...(d.res_i_ka !== undefined
                ? ([
                    ["Current", `${fixed(d.res_i_ka * 1000, 1)} A`],
                  ] as ResultRow[])
                : []),
            ]}
          />
        )}
        {studyMode === "estimation" && estById[lineEdge.id] && (
          <ResultList
            label="State estimation result"
            rows={estimateRows(estById[lineEdge.id])}
          />
        )}
        {studyMode === "estimation" && (
          <MeasurementsSection elementType="line" elementId={lineEdge.id} />
        )}
      </Stack>
    );
  }

  if (node?.type === "foreign") {
    const d = node.data as ForeignData;
    return (
      <Stack gap="sm" p="sm">
        <PanelTitle>{d.table}</PanelTitle>
        <Text size="sm">{d.label}</Text>
        <Text size="xs" c="dimmed">
          This pandapower element type isn't editable in the diagram yet. It
          stays on the network and is included in the load flow; edit it in
          pandapower or re-import to change it.
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
      <Stack gap="sm" p="sm">
        <PanelTitle>Properties</PanelTitle>
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
  // Estimation mode is about measurements and results, not editing the network,
  // so the element's parameter editors are hidden to keep the panel focused
  // (they're set up in load-flow mode). Physical params still feed the solve.
  const showParams = studyMode !== "estimation";

  return (
    <Stack gap="sm" p="sm">
      <PanelTitle>{HEADERS[node.type ?? ""] ?? node.type}</PanelTitle>
      <TextInput
        label="Name"
        value={(node.data as { name: string }).name}
        onChange={(e) => update({ name: e.currentTarget.value })}
      />

      {showParams && (
        <>

      {node.type === "bus" &&
        (() => {
          // A line — or a bus–bus switch/impedance — joins two buses at one
          // voltage level, so while either is attached we lock the nominal voltage
          // to keep both ends consistent.
          const lineConnected = edges.some(
            (e) =>
              e.type === "line" &&
              (e.source === node.id || e.target === node.id),
          );
          // Switch/impedance nodes wired to this bus (branch = wire source, bus =
          // target)…
          const branchIds = new Set(
            edges
              .filter((e) => {
                if (e.target !== node.id) return false;
                const t = nodes.find((n) => n.id === e.source)?.type;
                return t === "switch" || t === "impedance";
              })
              .map((e) => e.source),
          );
          // …that also reach a second bus.
          const branchConnected = edges.some(
            (e) =>
              branchIds.has(e.source) &&
              e.target !== node.id &&
              nodes.find((n) => n.id === e.target)?.type === "bus",
          );
          const locked = lineConnected || branchConnected;
          return (
            <ParamInput
              name="Nominal voltage"
              symbol={<Sym sub="N">V</Sym>}
              unit="kV"
              value={(node.data as BusData).vn_kv}
              min={0}
              step={0.01}
              decimalScale={3}
              disabled={locked}
              onChange={(v) => update({ vn_kv: Number(v) || 0 })}
              // The "voltage is locked" note hangs off the input field only (not
              // the label), below it, so it never collides with the label's
              // descriptive tooltip above.
              inputContainer={(children) => (
                <Tooltip
                  label="Connected buses share one nominal voltage. Remove the connection to change it."
                  disabled={!locked}
                  color="yellow"
                  styles={{ tooltip: { color: "var(--mantine-color-black)" } }}
                  multiline
                  w={220}
                  withArrow
                  position="bottom"
                >
                  <div>{children}</div>
                </Tooltip>
              )}
            />
          );
        })()}

      {node.type === "generator" && (
        <>
          <ParamInput
            name="Active power"
            symbol={<>P</>}
            unit="MW"
            value={(node.data as GeneratorData).p_mw}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Number(v) || 0 })}
          />
          <ParamInput
            name="Voltage setpoint"
            symbol={<Sym sub="m">V</Sym>}
            unit="p.u."
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
          {studyMode === "shortcircuit" && (
            <>
              <Divider label="Short-circuit" labelPosition="left" />
              <ParamInput
                name="Rated apparent power"
                symbol={<Sym sub="N">S</Sym>}
                unit="MVA"
                value={(node.data as GeneratorData).sn_mva}
                min={0}
                step={0.1}
                decimalScale={3}
                onChange={(v) => update({ sn_mva: Number(v) || 0 })}
              />
              <ParamInput
                name="Subtransient reactance — drives the machine's fault contribution"
                symbol={
                  <Sym sub="d" sup="″">
                    X
                  </Sym>
                }
                unit="p.u."
                value={(node.data as GeneratorData).xdss_pu}
                min={0}
                step={0.01}
                decimalScale={4}
                onChange={(v) => update({ xdss_pu: Number(v) || 0 })}
              />
              <ParamInput
                name="Power factor"
                symbol={<>cos φ</>}
                value={(node.data as GeneratorData).cos_phi}
                min={0}
                max={1}
                step={0.01}
                decimalScale={3}
                onChange={(v) => update({ cos_phi: Number(v) || 0 })}
              />
            </>
          )}
        </>
      )}

      {node.type === "sgen" && (
        <>
          <ParamInput
            name="Active power"
            symbol={<>P</>}
            unit="MW"
            value={(node.data as SgenData).p_mw}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Number(v) || 0 })}
          />
          <ParamInput
            name="Reactive power"
            symbol={<>Q</>}
            unit="Mvar"
            value={(node.data as SgenData).q_mvar}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ q_mvar: Number(v) || 0 })}
          />
        </>
      )}

      {node.type === "extgrid" && (
        <>
          <ParamInput
            name="Voltage setpoint"
            symbol={<Sym sub="m">V</Sym>}
            unit="p.u."
            value={(node.data as ExtGridData).vm_pu}
            min={0}
            step={0.01}
            decimalScale={3}
            onChange={(v) => update({ vm_pu: Number(v) || 0 })}
          />
          <ParamInput
            name="Voltage angle"
            symbol={<em>δ</em>}
            unit="deg"
            value={(node.data as ExtGridData).va_degree}
            step={0.1}
            decimalScale={2}
            onChange={(v) => update({ va_degree: Number(v) || 0 })}
          />
          <Text size="xs" c="dimmed">
            Always a slack (voltage reference) that balances the network.
          </Text>
          {studyMode === "shortcircuit" && (
            <>
              <Divider label="Short-circuit" labelPosition="left" />
              <ParamInput
                name="Fault level — max short-circuit power at this connection"
                symbol={
                  <Sym sub="k" sup="″">
                    S
                  </Sym>
                }
                unit="MVA"
                value={(node.data as ExtGridData).s_sc_max_mva}
                min={0}
                step={10}
                decimalScale={2}
                onChange={(v) => update({ s_sc_max_mva: Number(v) || 0 })}
              />
              <ParamInput
                name="R/X ratio (max case)"
                symbol={<>R/X</>}
                value={(node.data as ExtGridData).rx_max}
                min={0}
                step={0.01}
                decimalScale={4}
                onChange={(v) => update({ rx_max: Number(v) || 0 })}
              />
            </>
          )}
        </>
      )}

      {node.type === "load" && (
        <>
          <ParamInput
            name="Active power"
            symbol={<>P</>}
            unit="MW"
            value={(node.data as LoadData).p_mw}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Number(v) || 0 })}
          />
          <ParamInput
            name="Reactive power"
            symbol={<>Q</>}
            unit="Mvar"
            value={(node.data as LoadData).q_mvar}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ q_mvar: Number(v) || 0 })}
          />
        </>
      )}

      {node.type === "shunt" && (
        <>
          <ParamInput
            name="Active power at rated voltage"
            symbol={<>P</>}
            unit="MW"
            value={(node.data as ShuntData).p_mw}
            min={0}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ p_mw: Math.max(0, Number(v) || 0) })}
          />
          <ParamInput
            name="Reactive power at rated voltage"
            symbol={<>Q</>}
            unit="Mvar"
            value={(node.data as ShuntData).q_mvar}
            step={0.001}
            decimalScale={4}
            onChange={(v) => update({ q_mvar: Number(v) || 0 })}
          />
          <Text size="xs" c="dimmed">
            Negative MVar = capacitor (injects reactive power); positive =
            reactor (absorbs it).
          </Text>
        </>
      )}

      {node.type === "xward" &&
        (() => {
          const d = node.data as XwardData;
          const num = (
            name: string,
            symbol: ReactNode,
            unit: string | undefined,
            key: keyof XwardData,
            step: number,
            dp: number,
            min?: number,
          ) => (
            <ParamInput
              name={name}
              symbol={symbol}
              unit={unit}
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
                A reduced equivalent of an external network: a fixed injection
                plus an impedance plus a voltage source behind it.
              </Text>
              <Divider label="Constant power" labelPosition="left" />
              {num(
                "Constant active power",
                <Sym sub="s">P</Sym>,
                "MW",
                "ps_mw",
                0.1,
                4,
              )}
              {num(
                "Constant reactive power",
                <Sym sub="s">Q</Sym>,
                "Mvar",
                "qs_mvar",
                0.1,
                4,
              )}
              <Divider
                label="Constant impedance (at 1 p.u.)"
                labelPosition="left"
              />
              {num(
                "Constant-impedance active power",
                <Sym sub="z">P</Sym>,
                "MW",
                "pz_mw",
                0.1,
                4,
              )}
              {num(
                "Constant-impedance reactive power",
                <Sym sub="z">Q</Sym>,
                "Mvar",
                "qz_mvar",
                0.1,
                4,
              )}
              <Divider label="Internal source" labelPosition="left" />
              {num(
                "Internal resistance",
                <Sym sub="int">R</Sym>,
                "Ω",
                "r_ohm",
                0.1,
                4,
                0,
              )}
              {num(
                "Internal reactance",
                <Sym sub="int">X</Sym>,
                "Ω",
                "x_ohm",
                0.1,
                4,
                0,
              )}
              {num(
                "Internal voltage setpoint",
                <Sym sub="m">V</Sym>,
                "p.u.",
                "vm_pu",
                0.01,
                4,
                0,
              )}
            </>
          );
        })()}

      {node.type === "svc" &&
        (() => {
          const d = node.data as SvcData;
          const num = (
            name: string,
            symbol: ReactNode,
            unit: string | undefined,
            key: keyof SvcData,
            step: number,
            dp: number,
          ) => (
            <ParamInput
              name={name}
              symbol={symbol}
              unit={unit}
              value={d[key] as number}
              step={step}
              decimalScale={dp}
              onChange={(v) => update({ [key]: Number(v) || 0 })}
            />
          );
          return (
            <>
              <Text size="xs" c="dimmed">
                A shunt FACTS regulator: a thyristor-controlled reactor in
                parallel with a fixed capacitor. When regulating it solves for a
                firing angle to hold the target voltage; otherwise the angle is
                fixed.
              </Text>
              <Switch
                label="Regulate voltage"
                checked={d.controllable}
                onChange={(e) =>
                  update({ controllable: e.currentTarget.checked })
                }
              />
              {d.controllable
                ? num(
                    "Target voltage the SVC holds",
                    <Sym sub="set">V</Sym>,
                    "p.u.",
                    "set_vm_pu",
                    0.01,
                    4,
                  )
                : num(
                    "Fixed thyristor firing angle",
                    <>α</>,
                    "deg",
                    "thyristor_firing_angle_degree",
                    1,
                    2,
                  )}
              <Divider label="Susceptance range" labelPosition="left" />
              {num(
                "Reactor reactance",
                <Sym sub="L">X</Sym>,
                "Ω",
                "x_l_ohm",
                0.1,
                4,
              )}
              {num(
                "Capacitor reactance (negative)",
                <Sym sub="Cvar">X</Sym>,
                "Ω",
                "x_cvar_ohm",
                0.1,
                4,
              )}
              {d.controllable && (
                <>
                  <Divider label="Firing-angle limits" labelPosition="left" />
                  {num(
                    "Minimum firing angle",
                    <>
                      α<sub>min</sub>
                    </>,
                    "deg",
                    "min_angle_degree",
                    1,
                    2,
                  )}
                  {num(
                    "Maximum firing angle",
                    <>
                      α<sub>max</sub>
                    </>,
                    "deg",
                    "max_angle_degree",
                    1,
                    2,
                  )}
                </>
              )}
            </>
          );
        })()}

      {node.type === "impedance" &&
        (() => {
          const d = node.data as ImpedanceData;
          return (
            <>
              <Text size="xs" c="dimmed">
                A per-unit series impedance tying two buses together, on the
                rating base below. Modeled symmetrically (from→to = to→from).
              </Text>
              <ParamInput
                name="Rating base — the per-unit R/X below are referenced to this"
                symbol={<Sym sub="N">S</Sym>}
                unit="MVA"
                value={d.sn_mva}
                min={0}
                step={1}
                decimalScale={4}
                onChange={(v) =>
                  update({ sn_mva: Math.max(0, Number(v) || 0) })
                }
              />
              <ParamInput
                name="Resistance"
                symbol={<>R</>}
                unit="p.u."
                value={d.rft_pu}
                min={0}
                step={0.001}
                decimalScale={6}
                onChange={(v) => {
                  const r = Math.max(0, Number(v) || 0);
                  update({ rft_pu: r, rtf_pu: r });
                }}
              />
              <ParamInput
                name="Reactance"
                symbol={<>X</>}
                unit="p.u."
                value={d.xft_pu}
                min={0}
                step={0.001}
                decimalScale={6}
                onChange={(v) => {
                  const x = Math.max(0, Number(v) || 0);
                  update({ xft_pu: x, xtf_pu: x });
                }}
              />
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
          // Editing any field (incl. the tap changer) makes the transformer
          // custom, dropping the preset label but keeping its parameters.
          const patchParams = (patch: Partial<Trafo2WParams>) => {
            if (!params) return;
            update({ std_type: "", params: { ...params, ...patch } });
          };
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
              {params &&
                TRAFO2W_STD.map((g) => (
                  <GroupFields
                    key={g.title}
                    group={g}
                    params={params}
                    onChange={editParam}
                  />
                ))}
              {params && (
                <AdvancedParams
                  groups={TRAFO2W_ADV}
                  params={params}
                  onChange={editParam}
                />
              )}
              {params && (
                <TapChanger
                  params={params}
                  onPatch={patchParams}
                  onTapPos={(pos) => setTrafoTapPos(node.id, pos, params)}
                  sides={TAP_SIDES_2W}
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
          // Editing any field (incl. the tap changer) makes the transformer
          // custom, dropping the preset label but keeping its parameters.
          const patchParams = (patch: Partial<Trafo3WParams>) => {
            if (!params) return;
            update({ std_type: "", params: { ...params, ...patch } });
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
                Connected buses:{" "}
                {formatTrafoVoltages(volts, ["hv", "mv", "lv"])}
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
              {params &&
                TRAFO3W_STD.map((g) => (
                  <GroupFields
                    key={g.title}
                    group={g}
                    params={params}
                    onChange={editParam}
                  />
                ))}
              {params && (
                <AdvancedParams
                  groups={TRAFO3W_ADV}
                  params={params}
                  onChange={editParam}
                />
              )}
              {params && (
                <TapChanger
                  params={params}
                  onPatch={patchParams}
                  onTapPos={(pos) => setTrafoTapPos(node.id, pos, params)}
                  sides={TAP_SIDES_3W}
                />
              )}
            </>
          );
        })()}
        </>
      )}

      {/* Results for the active study only, so the panel isn't cluttered with
          other simulations' output. */}
      {studyMode === "loadflow" && (
        <ResultList
          rows={[
            ...nodeResultRows(node.type, node.data),
            ...(inj ? busInjectionRows(inj) : []),
          ]}
        />
      )}
      {studyMode === "shortcircuit" && node.type === "bus" && (
        <ResultList label="Short-circuit result" rows={busScRows(bus!)} />
      )}
      {studyMode === "estimation" && estById[node.id] && (
        <ResultList
          label="State estimation result"
          rows={estimateRows(estById[node.id])}
        />
      )}

      {/* Measurements belong to state estimation only. */}
      {studyMode === "estimation" && node.type && NODE_MEAS_ELEMENT[node.type] && (
        <MeasurementsSection
          elementType={NODE_MEAS_ELEMENT[node.type]!}
          elementId={node.id}
        />
      )}

      {/* The bus color legend is a reference key — kept at the bottom. */}
      {node.type === "bus" && (
        <>
          <Divider my="xs" />
          {studyMode === "shortcircuit" ? (
            <FaultCurrentLegend />
          ) : (
            <VoltageLegend
              caption={
                studyMode === "estimation"
                  ? "Estimated bus voltage"
                  : "Bus voltage after load flow"
              }
            />
          )}
        </>
      )}
    </Stack>
  );
}
