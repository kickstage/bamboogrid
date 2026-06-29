import { useEffect, useState } from "react";
import { Anchor, Button, Group, Modal, Paper, Stack, Text, Title } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";

import { Canvas } from "../canvas/Canvas";
import { useEditor } from "../store";
import { toast } from "../toast";
import { createDemoSession, openShare, runLoadFlow } from "../api";
import { MobileSheet } from "./MobileSheet";

type Entry = "share" | "demo";

export function MobileApp() {
  const { networkName, attachSession, setReadOnly, applyResults, sessionId } =
    useEditor();
  const [busy, setBusy] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [notice, setNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReadOnly(true);
    (async () => {
      const token = new URL(window.location.href).searchParams.get("s");
      if (token) {
        try {
          const { id, view } = await openShare(token);
          if (cancelled) return;
          await attachSession(id, view);
          setEntry("share");
          setNotice(true);
          return;
        } catch {
          if (cancelled) return;
          // Fall through to the default demo network.
        }
      }
      try {
        const { id, view } = await createDemoSession();
        if (cancelled) return;
        await attachSession(id, view);
        setEntry("demo");
        setNotice(true);
      } catch (err) {
        if (!cancelled)
          toast.error(`Could not start demo: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRun = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const result = await runLoadFlow(sessionId);
      applyResults(result);
    } catch (err) {
      toast.error(`Request failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <Paper withBorder radius={0} px="sm" py={6}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Title order={5} style={{ whiteSpace: "nowrap" }}>
              BambooGrid
            </Title>
            <Text size="xs" c="dimmed" truncate>
              {networkName}
            </Text>
          </Group>
          <Button size="xs" onClick={onRun} loading={busy} disabled={!sessionId}>
            Run load flow
          </Button>
        </Group>
      </Paper>

      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </div>

      <MobileSheet />

      <Modal
        opened={notice}
        onClose={() => setNotice(false)}
        centered
        title="Demo mode"
      >
        <Stack gap="sm">
          {entry === "share" ? (
            <Text size="sm">
              Welcome to BambooGrid, a power grid study tool based on pandapower.
              You're viewing a shared network. On mobile it's read-only: you can
              pan, zoom, tap elements to inspect them, and run a load flow to see
              results, but you can't make changes.
            </Text>
          ) : (
            <Text size="sm">
              Welcome to BambooGrid, a power grid study tool based on pandapower.
              We've loaded the IEEE 14-bus example so you can explore. On mobile
              it's read-only: you can pan, zoom, tap elements to inspect them,
              and run a load flow to see results, but you can't make changes.
            </Text>
          )}
          <Text size="sm" c="dimmed">
            To build and edit your own networks, open BambooGrid on a desktop
            browser.
          </Text>
          <Button onClick={() => setNotice(false)} mt="xs">
            Got it
          </Button>
          <Text size="xs" c="dimmed" ta="center">
            Made with ⚡ by{" "}
            <Anchor
              href="https://kickstage.com"
              target="_blank"
              rel="noopener noreferrer"
              inherit
            >
              Kickstage
            </Anchor>
          </Text>
        </Stack>
      </Modal>
    </div>
  );
}
