import { useEffect, useState } from "react";
import {
  Button,
  Divider,
  Group,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { Pending } from "../ui/Pending";
import { Switch } from "../ui/Switch";

import {
  getEstimationSettings,
  getLoadFlowSettings,
  getShortCircuitSettings,
  updateEstimationSettings,
  updateLoadFlowSettings,
  updateShortCircuitSettings,
} from "../api";
import { useEditor } from "../store";
import { toast } from "../toast";
import { ToolWindow } from "../ui/ToolWindow";
import type {
  LoadFlowSettings,
  ShortCircuitSettings,
  StateEstimationSettings,
} from "../types";
import {
  saveEstimationSettingsLocal,
  saveLoadFlowSettingsLocal,
  saveShortCircuitSettingsLocal,
} from "./studySettings";

// --- Model defaults (mirror the backend Pydantic defaults) -----------------

const LOAD_FLOW_DEFAULTS: LoadFlowSettings = {
  algorithm: "nr",
  init: "auto",
  max_iteration: null,
  tolerance_mva: 1e-8,
  calculate_voltage_angles: true,
  trafo_model: "t",
  trafo_loading: "current",
  enforce_q_lims: false,
  enforce_p_lims: false,
  voltage_depend_loads: true,
  consider_line_temperature: false,
  line_temperature_degree_celsius: 20,
  check_connectivity: true,
};

const SHORT_CIRCUIT_DEFAULTS: ShortCircuitSettings = {
  fault: "3ph",
  case: "max",
  ip: true,
  ith: true,
  tk_s: 1.0,
};

const ESTIMATION_DEFAULTS: StateEstimationSettings = {
  algorithm: "wls",
  init: "flat",
  tolerance: 1e-6,
  maximum_iterations: 50,
};

// --- Shared settings-form state --------------------------------------------

interface SettingsForm<T> {
  loading: boolean;
  error: string | null;
  draft: T | null;
  saving: boolean;
  dirty: boolean;
  atDefaults: boolean;
  set: <K extends keyof T>(key: K, value: T[K]) => void;
  save: () => void;
  reset: () => void;
}

// The load/dirty/save lifecycle shared by all three settings tabs: fetch on open,
// track a draft against the saved copy, and persist to the server + browser prefs.
function useSettingsForm<T>(opts: {
  open: boolean;
  sessionId: string | null;
  fetch: (id: string) => Promise<T>;
  update: (id: string, settings: T) => Promise<T>;
  saveLocal: (settings: T) => void;
  defaults: T;
  savedLabel: string;
}): SettingsForm<T> {
  const { open, sessionId, fetch, update, saveLocal, defaults, savedLabel } =
    opts;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const s = await fetch(sessionId);
        if (!cancelled) {
          setSaved(s);
          setDraft(s);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, fetch]);

  const set = <K extends keyof T>(key: K, value: T[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const dirty =
    !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const atDefaults =
    !!draft && JSON.stringify(draft) === JSON.stringify(defaults);

  const save = async () => {
    if (!sessionId || !draft) return;
    setSaving(true);
    try {
      const next = await update(sessionId, draft);
      setSaved(next);
      setDraft(next);
      // Remember as a browser preference so it carries to new networks/examples.
      saveLocal(next);
      toast.success(`${savedLabel} saved`);
    } catch (err) {
      toast.error(`Could not save settings: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => setDraft(defaults);

  return {
    loading,
    error,
    draft,
    saving,
    dirty,
    atDefaults,
    set,
    save,
    reset,
  };
}

// The Reset / Save footer shared by all three tabs.
function Footer<T>({ form }: { form: SettingsForm<T> }) {
  return (
    <Group justify="flex-end" gap="xs">
      <Button
        variant="default"
        size="xs"
        disabled={form.atDefaults || form.saving}
        onClick={form.reset}
      >
        Reset to defaults
      </Button>
      <Button
        size="xs"
        loading={form.saving}
        disabled={!form.dirty}
        onClick={form.save}
      >
        Save
      </Button>
    </Group>
  );
}

// --- Load flow -------------------------------------------------------------

const ALGORITHM_OPTIONS = [
  { value: "nr", label: "Newton-Raphson" },
  { value: "iwamoto_nr", label: "Newton-Raphson (Iwamoto)" },
  { value: "bfsw", label: "Backward/forward sweep" },
  { value: "gs", label: "Gauss-Seidel" },
  { value: "fdbx", label: "Fast-decoupled (BX)" },
  { value: "fdxb", label: "Fast-decoupled (XB)" },
];

const INIT_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "flat", label: "Flat start" },
  { value: "dc", label: "DC power flow" },
  { value: "results", label: "Previous results" },
];

// Toggleable runpp flags rendered as a grid of switches.
const LOAD_FLOW_SWITCHES: { key: keyof LoadFlowSettings; label: string }[] = [
  { key: "calculate_voltage_angles", label: "Calculate voltage angles" },
  { key: "voltage_depend_loads", label: "Voltage-dependent loads" },
  { key: "enforce_q_lims", label: "Enforce generator Q limits" },
  { key: "enforce_p_lims", label: "Enforce generator P limits" },
  { key: "check_connectivity", label: "Check connectivity" },
  { key: "consider_line_temperature", label: "Consider line temperature" },
];

// The line-temperature field keeps its own raw input so it can be cleared while
// typing without snapping back. The draft only ever holds a number; leaving the
// field empty restores the 20 °C default (no correction) on blur.
function LineTemperatureInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [raw, setRaw] = useState<number | string>(value);
  // Follow the draft when it changes elsewhere (e.g. Reset to defaults).
  useEffect(() => setRaw(value), [value]);
  return (
    <NumberInput
      mb="sm"
      label="Line temperature"
      description="Applied to all lines [°C] · 20 °C = no correction"
      min={-50}
      max={250}
      suffix=" °C"
      value={raw}
      onChange={(v) => {
        setRaw(v);
        if (v !== "") onChange(Number(v));
      }}
      onBlur={() => {
        if (raw === "") {
          setRaw(20);
          onChange(20);
        }
      }}
    />
  );
}

function LoadFlowTab({ open }: { open: boolean }) {
  const sessionId = useEditor((s) => s.sessionId);
  const form = useSettingsForm({
    open,
    sessionId,
    fetch: getLoadFlowSettings,
    update: updateLoadFlowSettings,
    saveLocal: saveLoadFlowSettingsLocal,
    defaults: LOAD_FLOW_DEFAULTS,
    savedLabel: "Load flow settings",
  });
  const { draft, set } = form;

  if (form.loading || !draft) return <Pending error={form.error} />;

  return (
    <Stack gap="md" mt="md">
      <div>
        <Divider label="Solver" labelPosition="left" mb="sm" />
        <SimpleGrid cols={2} spacing="sm">
          <Select
            label="Algorithm"
            data={ALGORITHM_OPTIONS}
            value={draft.algorithm}
            allowDeselect={false}
            onChange={(v) =>
              v && set("algorithm", v as LoadFlowSettings["algorithm"])
            }
          />
          <Select
            label="Initialization"
            data={INIT_OPTIONS}
            value={draft.init}
            allowDeselect={false}
            onChange={(v) => v && set("init", v as LoadFlowSettings["init"])}
          />
          <NumberInput
            label="Max iterations"
            placeholder="Auto"
            description="Blank lets pandapower choose"
            min={1}
            max={1000}
            allowDecimal={false}
            value={draft.max_iteration ?? ""}
            onChange={(v) => set("max_iteration", v === "" ? null : Number(v))}
          />
          <NumberInput
            label="Tolerance"
            description="Power mismatch [MVA]"
            min={0}
            step={1e-8}
            decimalScale={10}
            value={draft.tolerance_mva}
            onChange={(v) =>
              set("tolerance_mva", Number(v) || LOAD_FLOW_DEFAULTS.tolerance_mva)
            }
          />
        </SimpleGrid>
      </div>

      <div>
        <Divider label="Transformers" labelPosition="left" mb="sm" />
        <SimpleGrid cols={2} spacing="sm">
          <Select
            label="Model"
            data={[
              { value: "t", label: "T-equivalent" },
              { value: "pi", label: "Pi-equivalent" },
            ]}
            value={draft.trafo_model}
            allowDeselect={false}
            onChange={(v) =>
              v && set("trafo_model", v as LoadFlowSettings["trafo_model"])
            }
          />
          <Select
            label="Loading reference"
            data={[
              { value: "current", label: "Current" },
              { value: "power", label: "Power" },
            ]}
            value={draft.trafo_loading}
            allowDeselect={false}
            onChange={(v) =>
              v && set("trafo_loading", v as LoadFlowSettings["trafo_loading"])
            }
          />
        </SimpleGrid>
      </div>

      <div>
        <Divider label="Modeling" labelPosition="left" mb="sm" />
        {draft.consider_line_temperature && (
          <LineTemperatureInput
            value={draft.line_temperature_degree_celsius}
            onChange={(v) => set("line_temperature_degree_celsius", v)}
          />
        )}
        <SimpleGrid cols={2} spacing="xs">
          {LOAD_FLOW_SWITCHES.map((s) => (
            <Switch
              key={s.key}
              label={s.label}
              checked={draft[s.key] as boolean}
              onChange={(e) => set(s.key, e.currentTarget.checked as never)}
            />
          ))}
        </SimpleGrid>
      </div>

      <Text size="xs" c="dimmed">
        Distributed slack is set automatically from the network topology.
      </Text>

      <Footer form={form} />
    </Stack>
  );
}

// --- Short circuit ---------------------------------------------------------

function ShortCircuitTab({ open }: { open: boolean }) {
  const sessionId = useEditor((s) => s.sessionId);
  const form = useSettingsForm({
    open,
    sessionId,
    fetch: getShortCircuitSettings,
    update: updateShortCircuitSettings,
    saveLocal: saveShortCircuitSettingsLocal,
    defaults: SHORT_CIRCUIT_DEFAULTS,
    savedLabel: "Short circuit settings",
  });
  const { draft, set } = form;

  if (form.loading || !draft) return <Pending error={form.error} />;

  return (
    <Stack gap="md" mt="md">
      <div>
        <Divider label="Fault" labelPosition="left" mb="sm" />
        <SimpleGrid cols={2} spacing="sm">
          <Select
            label="Fault type"
            data={[
              { value: "3ph", label: "3-phase (symmetrical)" },
              { value: "2ph", label: "2-phase (line-to-line)" },
            ]}
            value={draft.fault}
            allowDeselect={false}
            onChange={(v) =>
              v && set("fault", v as ShortCircuitSettings["fault"])
            }
          />
          <Select
            label="Calculation case"
            data={[
              { value: "max", label: "Maximum (design)" },
              { value: "min", label: "Minimum (protection)" },
            ]}
            value={draft.case}
            allowDeselect={false}
            onChange={(v) => v && set("case", v as ShortCircuitSettings["case"])}
          />
        </SimpleGrid>
      </div>

      <div>
        <Divider label="Additional currents" labelPosition="left" mb="sm" />
        <SimpleGrid cols={2} spacing="xs">
          <Switch
            label="Peak current (iₚ)"
            checked={draft.ip}
            onChange={(e) => set("ip", e.currentTarget.checked)}
          />
          <Switch
            label="Thermal current (i_th)"
            checked={draft.ith}
            onChange={(e) => set("ith", e.currentTarget.checked)}
          />
        </SimpleGrid>
        {draft.ith && (
          <NumberInput
            mt="sm"
            label="Fault duration"
            description="Used for the thermal-equivalent current i_th"
            min={0}
            step={0.1}
            suffix=" s"
            value={draft.tk_s}
            onChange={(v) =>
              set("tk_s", v === "" ? SHORT_CIRCUIT_DEFAULTS.tk_s : Number(v))
            }
          />
        )}
      </div>

      <Footer form={form} />
    </Stack>
  );
}

// --- State estimation ------------------------------------------------------

function EstimationTab({ open }: { open: boolean }) {
  const sessionId = useEditor((s) => s.sessionId);
  const form = useSettingsForm({
    open,
    sessionId,
    fetch: getEstimationSettings,
    update: updateEstimationSettings,
    saveLocal: saveEstimationSettingsLocal,
    defaults: ESTIMATION_DEFAULTS,
    savedLabel: "State estimation settings",
  });
  const { draft, set } = form;

  if (form.loading || !draft) return <Pending error={form.error} />;

  return (
    <Stack gap="md" mt="md">
      <div>
        <Divider label="Estimator" labelPosition="left" mb="sm" />
        <SimpleGrid cols={2} spacing="sm">
          <Select
            label="Algorithm"
            data={[{ value: "wls", label: "Weighted least squares" }]}
            value={draft.algorithm}
            allowDeselect={false}
            onChange={(v) =>
              v && set("algorithm", v as StateEstimationSettings["algorithm"])
            }
          />
          <Select
            label="Initialization"
            data={[
              { value: "flat", label: "Flat start" },
              { value: "results", label: "Load-flow results" },
            ]}
            value={draft.init}
            allowDeselect={false}
            onChange={(v) =>
              v && set("init", v as StateEstimationSettings["init"])
            }
          />
          <NumberInput
            label="Tolerance"
            // Render the hint below the input so the box still lines up with
            // "Max iterations" alongside it (Mantine puts it above by default).
            description="Stop when the state change falls below"
            inputWrapperOrder={["label", "input", "description", "error"]}
            min={0}
            step={1e-6}
            decimalScale={8}
            value={draft.tolerance}
            onChange={(v) =>
              set("tolerance", Number(v) || ESTIMATION_DEFAULTS.tolerance)
            }
          />
          <NumberInput
            label="Max iterations"
            min={1}
            max={1000}
            allowDecimal={false}
            value={draft.maximum_iterations}
            onChange={(v) =>
              set(
                "maximum_iterations",
                v === ""
                  ? ESTIMATION_DEFAULTS.maximum_iterations
                  : Number(v),
              )
            }
          />
        </SimpleGrid>
      </div>

      <Footer form={form} />
    </Stack>
  );
}

// --- Panel -----------------------------------------------------------------

// The session's per-study solver options (runpp / calc_sc / WLS estimation).
// Stored server-side on the net, so they apply to the next solve and round-trip
// with export/share. Opens on the tab for the current study mode.
export function StudySettingsPanel() {
  const opened = useEditor((s) => s.settingsOpen);
  const setOpen = useEditor((s) => s.setSettingsOpen);
  const studyMode = useEditor((s) => s.studyMode);
  const [tab, setTab] = useState<string | null>(studyMode);

  // Land on the current study's tab each time the window opens.
  useEffect(() => {
    if (opened) setTab(studyMode);
  }, [opened, studyMode]);

  return (
    <ToolWindow
      title="Study settings"
      opened={opened}
      onClose={() => setOpen(false)}
      width={600}
    >
      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="loadflow">Load flow</Tabs.Tab>
          <Tabs.Tab value="shortcircuit">Short circuit</Tabs.Tab>
          <Tabs.Tab value="estimation">State estimation</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="loadflow">
          <LoadFlowTab open={opened && tab === "loadflow"} />
        </Tabs.Panel>
        <Tabs.Panel value="shortcircuit">
          <ShortCircuitTab open={opened && tab === "shortcircuit"} />
        </Tabs.Panel>
        <Tabs.Panel value="estimation">
          <EstimationTab open={opened && tab === "estimation"} />
        </Tabs.Panel>
      </Tabs>
    </ToolWindow>
  );
}
