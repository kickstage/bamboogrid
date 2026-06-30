import { useEffect, useState } from "react";
import {
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
} from "@mantine/core";

import { getLoadFlowSettings, updateLoadFlowSettings } from "../api";
import { useEditor } from "../store";
import { toast } from "../toast";
import type { LoadFlowSettings } from "../types";
import { saveLoadFlowSettingsLocal } from "./loadFlowSettings";

// Mirrors the backend `LoadFlowSettings` defaults (which mirror pandapower's),
// used to reset the form.
const DEFAULT_SETTINGS: LoadFlowSettings = {
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
const SWITCHES: { key: keyof LoadFlowSettings; label: string }[] = [
  { key: "calculate_voltage_angles", label: "Calculate voltage angles" },
  { key: "voltage_depend_loads", label: "Voltage-dependent loads" },
  { key: "enforce_q_lims", label: "Enforce generator Q limits" },
  { key: "enforce_p_lims", label: "Enforce generator P limits" },
  { key: "check_connectivity", label: "Check connectivity" },
  { key: "consider_line_temperature", label: "Consider line temperature" },
];

// The session's pandapower runpp options. Stored server-side on the net, so they
// apply to the next load flow / summary solve and round-trip with export/share.
export function LoadFlowSettingsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const sessionId = useEditor((s) => s.sessionId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<LoadFlowSettings | null>(null);
  const [draft, setDraft] = useState<LoadFlowSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!opened || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const s = await getLoadFlowSettings(sessionId);
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
  }, [opened, sessionId]);

  const set = <K extends keyof LoadFlowSettings>(
    key: K,
    value: LoadFlowSettings[K],
  ) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const dirty =
    !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const atDefaults =
    !!draft && JSON.stringify(draft) === JSON.stringify(DEFAULT_SETTINGS);

  const save = async () => {
    if (!sessionId || !draft) return;
    setSaving(true);
    try {
      const next = await updateLoadFlowSettings(sessionId, draft);
      setSaved(next);
      setDraft(next);
      // Remember as a browser preference so it carries to new networks/examples.
      saveLoadFlowSettingsLocal(next);
      toast.success("Load flow settings saved");
    } catch (err) {
      toast.error(`Could not save settings: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Load flow settings" size="lg">
      {loading || !draft ? (
        <Center py="xl">
          {error ? (
            <Text c="red" size="sm">
              {error}
            </Text>
          ) : (
            <Loader />
          )}
        </Center>
      ) : (
        <Stack gap="md">
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
                onChange={(v) =>
                  set("max_iteration", v === "" ? null : Number(v))
                }
              />
              <NumberInput
                label="Tolerance"
                description="Power mismatch [MVA]"
                min={0}
                step={1e-8}
                decimalScale={10}
                value={draft.tolerance_mva}
                onChange={(v) =>
                  set(
                    "tolerance_mva",
                    Number(v) || DEFAULT_SETTINGS.tolerance_mva,
                  )
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
                  v &&
                  set("trafo_loading", v as LoadFlowSettings["trafo_loading"])
                }
              />
            </SimpleGrid>
          </div>

          <div>
            <Divider label="Modeling" labelPosition="left" mb="sm" />
            {draft.consider_line_temperature && (
              <NumberInput
                mb="sm"
                label="Line temperature"
                description="Applied to all lines [°C] · 20 °C = no correction"
                min={-50}
                max={250}
                suffix=" °C"
                value={draft.line_temperature_degree_celsius}
                onChange={(v) =>
                  set(
                    "line_temperature_degree_celsius",
                    v === "" ? 20 : Number(v),
                  )
                }
              />
            )}
            <SimpleGrid cols={2} spacing="xs">
              {SWITCHES.map((s) => (
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

          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              size="xs"
              disabled={atDefaults || saving}
              onClick={() => setDraft(DEFAULT_SETTINGS)}
            >
              Reset to defaults
            </Button>
            <Button size="xs" loading={saving} disabled={!dirty} onClick={save}>
              Save
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
