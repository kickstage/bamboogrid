import { Divider, Drawer, Group, Stack, Text } from "@mantine/core";
import { useEditor } from "../store";
import { fixed } from "../format";
import { busInjection } from "../power";
import {
  HEADERS,
  ResultList,
  busInjectionRows,
  nodeResultRows,
  type ResultRow,
} from "../inspector/results";
import type {
  BusData,
  ExtGridData,
  GeneratorData,
  LineData,
  LoadData,
  SgenData,
  ShuntData,
  SwitchData,
  Trafo2WData,
  Trafo3WData,
} from "../types";

// Read-only input parameters for the selected element. Mirrors the editable
// fields in the desktop Inspector, but rendered as plain labeled values.
function nodeParamRows(type: string | undefined, data: unknown): ResultRow[] {
  switch (type) {
    case "bus": {
      const b = data as BusData;
      return [["Nominal voltage", `${fixed(b.vn_kv, 3)} kV`]];
    }
    case "generator": {
      const g = data as GeneratorData;
      return [
        ["Active power", `${fixed(g.p_mw, 4)} MW`],
        ["Voltage setpoint", `${fixed(g.vm_pu, 3)} p.u.`],
        ["Slack", g.slack ? "yes" : "no"],
        ...(g.slack
          ? ([["Slack weight", fixed(g.slack_weight, 2)]] as ResultRow[])
          : []),
      ];
    }
    case "sgen": {
      const s = data as SgenData;
      return [
        ["Active power", `${fixed(s.p_mw, 4)} MW`],
        ["Reactive power", `${fixed(s.q_mvar, 4)} Mvar`],
      ];
    }
    case "extgrid": {
      const e = data as ExtGridData;
      return [
        ["Voltage setpoint", `${fixed(e.vm_pu, 3)} p.u.`],
        ["Voltage angle", `${fixed(e.va_degree, 2)}°`],
      ];
    }
    case "load": {
      const l = data as LoadData;
      return [
        ["Active power", `${fixed(l.p_mw, 4)} MW`],
        ["Reactive power", `${fixed(l.q_mvar, 4)} Mvar`],
      ];
    }
    case "shunt": {
      const sh = data as ShuntData;
      return [
        ["Active power", `${fixed(sh.p_mw, 4)} MW`],
        ["Reactive power", `${fixed(sh.q_mvar, 4)} Mvar`],
      ];
    }
    case "switch": {
      const sw = data as SwitchData;
      return [["State", sw.closed ? "closed" : "open"]];
    }
    case "trafo2w":
    case "trafo3w": {
      const t = data as Trafo2WData | Trafo3WData;
      return [["Type", t.std_type || "custom (imported)"]];
    }
    default:
      return [];
  }
}

function lineParamRows(d: LineData): ResultRow[] {
  return [
    ["Length", `${fixed(d.length_km, 3)} km`],
    ["Resistance", `${fixed(d.r_ohm_per_km, 4)} Ω/km`],
    ["Reactance", `${fixed(d.x_ohm_per_km, 4)} Ω/km`],
    ["Capacitance", `${fixed(d.c_nf_per_km, 2)} nF/km`],
    ["Max current", `${fixed(d.max_i_ka, 4)} kA`],
  ];
}

function ParamList({ rows }: { rows: ResultRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Stack gap={2}>
      {rows.map(([label, value]) => (
        <Group key={label} justify="space-between" gap="xs" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Text size="sm" ff="monospace" style={{ whiteSpace: "nowrap" }}>
            {value}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

// Bottom sheet showing read-only details and load-flow results for whatever is
// tapped on the mobile canvas. The desktop Inspector's editing is unavailable.
export function MobileSheet() {
  const { nodes, edges, selectedId, selectedEdgeId, select, selectEdge } =
    useEditor();

  const node = nodes.find((n) => n.id === selectedId);
  const lineEdge = edges.find((e) => e.id === selectedEdgeId && e.type === "line");
  const opened = Boolean(node || lineEdge);

  const close = () => {
    select(null);
    selectEdge(null);
  };

  let title = "Details";
  let body: React.ReactNode = null;

  if (lineEdge) {
    const d = lineEdge.data as LineData;
    title = d.name || "Line";
    body = (
      <Stack gap="sm">
        <Text size="xs" fw={700} c="dimmed">
          LINE
        </Text>
        <ParamList rows={lineParamRows(d)} />
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
  } else if (node?.type === "foreign") {
    title = (node.data as { label?: string }).label ?? "Element";
    body = (
      <Stack gap="sm">
        <Text size="sm">
          This pandapower element isn't shown in detail here. It stays on the
          network and is included in the load flow.
        </Text>
      </Stack>
    );
  } else if (node) {
    const name = (node.data as { name?: string }).name;
    title = name || node.type || "Element";
    const bus = node.type === "bus" ? (node.data as BusData) : null;
    const inj =
      bus && bus.vm_pu !== undefined ? busInjection(node.id, nodes, edges) : null;
    body = (
      <Stack gap="sm">
        <Text size="xs" fw={700} c="dimmed">
          {HEADERS[node.type ?? ""] ?? node.type?.toUpperCase()}
        </Text>
        <ParamList rows={nodeParamRows(node.type, node.data)} />
        <ResultList
          rows={[
            ...nodeResultRows(node.type, node.data),
            ...(inj ? busInjectionRows(inj) : []),
          ]}
        />
      </Stack>
    );
  }

  return (
    <Drawer
      opened={opened}
      onClose={close}
      position="bottom"
      size="auto"
      withCloseButton
      title={title}
      overlayProps={{ backgroundOpacity: 0.2 }}
      styles={{ content: { maxHeight: "60vh" } }}
    >
      {body}
      <Divider my="sm" />
      <Text size="xs" c="dimmed">
        Read-only demo — open BambooGrid on a desktop to edit.
      </Text>
    </Drawer>
  );
}
