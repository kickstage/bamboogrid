import { useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";

import { networkSummary } from "../api";
import { fixed } from "../format";
import { flushPending } from "../sync";
import { useEditor } from "../store";
import type {
  Diagnostic,
  Extreme,
  NetworkSummary,
  SummaryCounts,
} from "../types";

const SEVERITY_COLOR: Record<Diagnostic["severity"], string> = {
  error: "red",
  warning: "yellow",
  info: "blue",
};

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

// A modal overview of the network: power balance, voltage/loading extremes,
// element counts and pandapower diagnostic findings. Re-solves on each open so
// the figures reflect the latest edits.
export function SummaryModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const sessionId = useEditor((s) => s.sessionId);
  const revealElement = useEditor((s) => s.revealElement);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<NetworkSummary | null>(null);

  useEffect(() => {
    if (!opened || !sessionId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        await flushPending();
        const result = await networkSummary(sessionId);
        if (!cancelled) setSummary(result);
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

  const issues = summary?.diagnostics.length ?? 0;

  // Select the element on the canvas/inspector and close the modal so it's
  // visible behind it.
  const reveal = (id: string) => {
    if (revealElement(id)) onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Network summary" size="lg">
      {loading || !summary ? (
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
        <Stack gap="sm">
          <Group gap="xs">
            {summary.converged ? (
              <Badge color="green" variant="light">
                Converged
              </Badge>
            ) : (
              <Badge color="red" variant="light">
                Did not converge
              </Badge>
            )}
            {!summary.converged && summary.message && (
              <Text size="sm" c="dimmed">
                {summary.message}
              </Text>
            )}
          </Group>

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
              <SummaryTab s={summary} onReveal={reveal} />
            </Tabs.Panel>
            <Tabs.Panel value="diagnostics">
              <DiagnosticsTab items={summary.diagnostics} onReveal={reveal} />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
    </Modal>
  );
}
