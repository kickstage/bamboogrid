import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";

import { networkSummary } from "../api";
import { fixed } from "../format";
import { flushPending } from "../sync";
import { useEditor } from "../store";
import type { LastRun } from "../store";
import { Pending } from "../ui/Pending";
import { ToolWindow } from "../ui/ToolWindow";
import type {
  Diagnostic,
  Extreme,
  NetworkSummary,
  SummaryCounts,
} from "../types";
import { useLiveRefresh } from "./useLiveRefresh";

const SEVERITY_COLOR: Record<Diagnostic["severity"], string> = {
  error: "red",
  warning: "yellow",
  info: "blue",
};

// The status badge for the most recent study run. Short circuit is a direct
// IEC 60909 calc (not an iterative solve), so it reads "complete/failed" rather
// than "converged".
function runStatus(lastRun: LastRun | null): { color: string; label: string } {
  if (!lastRun) return { color: "gray", label: "No study run yet" };
  const { study, ok, badData } = lastRun;
  if (study === "shortcircuit")
    return ok
      ? { color: "green", label: "Short circuit complete" }
      : { color: "red", label: "Short circuit failed" };
  if (study === "estimation") {
    if (!ok) return { color: "red", label: "Estimation did not converge" };
    return badData
      ? { color: "yellow", label: "Estimation converged · bad data" }
      : { color: "green", label: "Estimation converged" };
  }
  return ok
    ? { color: "green", label: "Load flow converged" }
    : { color: "red", label: "Load flow did not converge" };
}

// A labeled stat row in the summary table.
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Table.Tr>
      <Table.Td c="dimmed">{label}</Table.Td>
      <Table.Td ta="right" ff="monospace" style={{ whiteSpace: "nowrap" }}>
        {value}
      </Table.Td>
    </Table.Tr>
  );
}

function extreme(
  e: Extreme | null,
  unit: string,
  digits: number,
  onReveal: (id: string) => void,
): React.ReactNode {
  if (!e) return "—";
  return (
    <Group gap={6} justify="flex-end" wrap="nowrap">
      <span>
        {fixed(e.value, digits)} {unit}
      </span>
      {e.id ? (
        <Button
          size="compact-xs"
          variant="default"
          onClick={() => onReveal(e.id)}
          title="Show in editor"
        >
          {e.label}
        </Button>
      ) : e.label ? (
        <Text span c="dimmed">
          · {e.label}
        </Text>
      ) : null}
    </Group>
  );
}

function pq(p: number, q: number): string {
  return `${fixed(p, 3)} MW · ${fixed(q, 3)} Mvar`;
}

function SummaryTab({
  s,
  onReveal,
}: {
  s: NetworkSummary;
  onReveal: (id: string) => void;
}) {
  const c: SummaryCounts = s.counts;
  return (
    <Stack gap="md" mt="md">
      {s.balance && (
        <div>
          <Divider label="Power balance" labelPosition="left" mb="sm" />
          <Table withRowBorders={false} verticalSpacing={2}>
            <Table.Tbody>
              <Row label="Generation" value={pq(s.balance.gen_p_mw, s.balance.gen_q_mvar)} />
              <Row label="Load" value={pq(s.balance.load_p_mw, s.balance.load_q_mvar)} />
              <Row label="Losses" value={pq(s.balance.loss_p_mw, s.balance.loss_q_mvar)} />
            </Table.Tbody>
          </Table>
        </div>
      )}

      {s.converged && (
        <div>
          <Divider label="Voltage & loading" labelPosition="left" mb="sm" />
          <Table withRowBorders={false} verticalSpacing={2}>
            <Table.Tbody>
              <Row label="Min voltage" value={extreme(s.min_voltage, "p.u.", 4, onReveal)} />
              <Row label="Max voltage" value={extreme(s.max_voltage, "p.u.", 4, onReveal)} />
              <Row label="Peak line loading" value={extreme(s.max_line_loading, "%", 1, onReveal)} />
              <Row
                label="Peak transformer loading"
                value={extreme(s.max_trafo_loading, "%", 1, onReveal)}
              />
            </Table.Tbody>
          </Table>
        </div>
      )}

      <div>
        <Divider label="Composition" labelPosition="left" mb="sm" />
        <Table withRowBorders={false} verticalSpacing={2}>
          <Table.Tbody>
            <Row label="Buses" value={c.buses} />
            <Row label="Lines" value={c.lines} />
            <Row label="Transformers" value={c.transformers} />
            <Row label="Loads" value={c.loads} />
            <Row label="Generators / sources" value={c.generators} />
            <Row label="Switches" value={c.switches} />
            <Row label="Shunts" value={c.shunts} />
            {c.foreign > 0 && <Row label="Other (foreign)" value={c.foreign} />}
            <Row label="Islands" value={c.islands} />
            <Row
              label="Unsupplied buses"
              value={
                c.unsupplied_buses > 0 ? (
                  <Text span c="red">
                    {c.unsupplied_buses}
                  </Text>
                ) : (
                  c.unsupplied_buses
                )
              }
            />
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}

function DiagnosticsTab({
  items,
  onReveal,
}: {
  items: Diagnostic[];
  onReveal: (id: string) => void;
}) {
  if (items.length === 0)
    return (
      <Text mt="md" c="dimmed" size="sm">
        No diagnostic issues found.
      </Text>
    );
  return (
    <Stack gap="xs" mt="md">
      {items.map((d, i) => (
        <Alert
          key={i}
          color={SEVERITY_COLOR[d.severity]}
          title={d.check}
          variant="light"
          p="xs"
        >
          {d.elements.length > 0 ? (
            <Group gap={6}>
              {d.elements.map((el) => (
                <Button
                  key={el.id}
                  size="compact-xs"
                  variant="default"
                  onClick={() => onReveal(el.id)}
                  title="Show in editor"
                >
                  {el.label}
                </Button>
              ))}
            </Group>
          ) : (
            <Text size="xs" ff="monospace" style={{ whiteSpace: "pre-wrap" }}>
              {d.detail}
            </Text>
          )}
        </Alert>
      ))}
    </Stack>
  );
}

// A floating overview of the network: power balance, voltage/loading extremes,
// element counts and pandapower diagnostic findings. Re-solves on each open so
// the figures reflect the latest edits. Non-blocking, so revealing an element
// keeps the panel open (handy when popped out to a second screen).
export function SummaryPanel() {
  const opened = useEditor((s) => s.summaryOpen);
  const setOpen = useEditor((s) => s.setSummaryOpen);
  const sessionId = useEditor((s) => s.sessionId);
  const revealElement = useEditor((s) => s.revealElement);
  // The latest study run drives the status badge and a study-specific line, so
  // the summary reflects whatever the user last ran — not only load flow.
  const lastRun = useEditor((s) => s.lastRun);
  const scMaxIkss = useEditor((s) => s.scMaxIkss);
  const measurementCount = useEditor((s) => s.measurements.length);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<NetworkSummary | null>(null);

  // A quiet reload (live auto-refresh) keeps the current figures on screen and
  // swaps them when new ones arrive, rather than flashing the loader. The
  // request id guards against an earlier fetch overwriting a newer one.
  const reqIdRef = useRef(0);
  const load = useCallback(
    async (quiet = false) => {
      if (!sessionId) return;
      const myId = ++reqIdRef.current;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        await flushPending();
        const result = await networkSummary(sessionId);
        if (reqIdRef.current === myId) setSummary(result);
      } catch (err) {
        if (reqIdRef.current === myId) setError((err as Error).message);
      } finally {
        if (reqIdRef.current === myId && !quiet) setLoading(false);
      }
    },
    [sessionId],
  );

  useLiveRefresh(opened, load);

  const issues = summary?.diagnostics.length ?? 0;
  const status = runStatus(lastRun);

  return (
    <ToolWindow
      title="Network summary"
      opened={opened}
      onClose={() => setOpen(false)}
      width={600}
    >
      {loading || !summary ? (
        <Pending error={error} />
      ) : (
        <Stack gap="sm">
          <Group gap="xs">
            <Badge color={status.color} variant="light">
              {status.label}
            </Badge>
            {lastRun && !lastRun.ok && lastRun.message && (
              <Text size="sm" c="dimmed">
                {lastRun.message}
              </Text>
            )}
          </Group>

          {lastRun?.study === "shortcircuit" && lastRun.ok && scMaxIkss > 0 && (
            <Text size="sm" c="dimmed">
              Peak fault current:{" "}
              <Text span ff="monospace">
                {fixed(scMaxIkss, 3)} kA
              </Text>
            </Text>
          )}
          {lastRun?.study === "estimation" && lastRun.ok && (
            <Text size="sm" c="dimmed">
              {measurementCount} measurement
              {measurementCount === 1 ? "" : "s"} ·{" "}
              {lastRun.badData ? (
                <Text span c="yellow.7">
                  bad data flagged
                </Text>
              ) : (
                <Text span c="green.7">
                  no bad data
                </Text>
              )}
            </Text>
          )}

          <Tabs defaultValue="summary">
            <Tabs.List>
              <Tabs.Tab value="summary">Summary</Tabs.Tab>
              <Tabs.Tab
                value="diagnostics"
                rightSection={
                  issues > 0 ? (
                    <Badge size="xs" circle variant="filled" color="yellow">
                      {issues}
                    </Badge>
                  ) : null
                }
              >
                Diagnostics
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="summary">
              <SummaryTab s={summary} onReveal={revealElement} />
            </Tabs.Panel>
            <Tabs.Panel value="diagnostics">
              <DiagnosticsTab items={summary.diagnostics} onReveal={revealElement} />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
    </ToolWindow>
  );
}
