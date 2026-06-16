import { useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Paper,
  TextInput,
  Title,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";

import { Canvas } from "./canvas/Canvas";
import { Inspector } from "./inspector/Inspector";
import { Palette } from "./palette/Palette";
import { useEditor } from "./store";
import { createNetwork, runLoadFlow, updateNetwork } from "./api";
import type { Network } from "./types";

export default function App() {
  const {
    networkId,
    networkName,
    setNetworkName,
    setNetworkId,
    setMessage,
    message,
    toNetwork,
    loadNetwork,
    applyResults,
  } = useEditor();
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const toggleScheme = () => setColorScheme(scheme === "dark" ? "light" : "dark");

  // Download the current network as a portable .json file (no server needed).
  const onExport = () => {
    const doc = toNetwork();
    const blob = new Blob([JSON.stringify(doc, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${networkName || "network"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Open a previously exported .json file back into the editor.
  const onOpenFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-opening the same file later
    if (!file) return;
    try {
      const network = JSON.parse(await file.text()) as Network;
      if (!Array.isArray(network.buses)) throw new Error("Not a network file");
      loadNetwork(network);
      setMessage(`Opened "${file.name}".`);
    } catch (err) {
      setMessage(`Open failed: ${(err as Error).message}`);
    }
  };

  const onRun = async () => {
    setBusy(true);
    try {
      const result = await runLoadFlow(toNetwork());
      applyResults(result);
    } catch (err) {
      setMessage(`Request failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    setBusy(true);
    try {
      const doc = toNetwork();
      const saved = networkId ? await updateNetwork(doc) : await createNetwork(doc);
      setNetworkId(saved.id);
      setMessage(`Saved (${saved.id}).`);
    } catch (err) {
      setMessage(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Paper shadow="xs" p="sm" radius={0}>
        <Group justify="space-between">
          <Group>
            <Title order={4}>BambooGrid</Title>
            <TextInput
              value={networkName}
              onChange={(e) => setNetworkName(e.currentTarget.value)}
              size="xs"
              w={220}
            />
          </Group>
          <Group>
            <ActionIcon
              variant="default"
              size="lg"
              onClick={toggleScheme}
              aria-label="Toggle color scheme"
              title="Toggle dark mode"
            >
              {scheme === "dark" ? "☀️" : "🌙"}
            </ActionIcon>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={onOpenFile}
            />
            <Button
              variant="default"
              size="xs"
              onClick={() => fileInputRef.current?.click()}
            >
              Open JSON
            </Button>
            <Button variant="default" size="xs" onClick={onExport}>
              Export JSON
            </Button>
            <Button variant="default" size="xs" onClick={onSave} loading={busy}>
              Save to server
            </Button>
            <Button size="xs" onClick={onRun} loading={busy}>
              Run load flow
            </Button>
          </Group>
        </Group>
        {message && (
          <Alert mt="xs" py={4} color={message.includes("converged") && !message.includes("not") ? "green" : "blue"}>
            {message}
          </Alert>
        )}
      </Paper>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Paper withBorder w={220} radius={0} style={{ overflowY: "auto" }}>
          <Palette />
        </Paper>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </div>
        <Paper withBorder w={260} radius={0} style={{ overflowY: "auto" }}>
          <Inspector />
        </Paper>
      </div>
    </div>
  );
}
