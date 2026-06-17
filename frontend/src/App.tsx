import { useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  Paper,
  Switch,
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
import {
  createNetwork,
  exportPandapower,
  importPandapower,
  runLoadFlow,
  updateNetwork,
} from "./api";
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
    showResults,
    setShowResults,
  } = useEditor();
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ppInputRef = useRef<HTMLInputElement>(null);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const toggleScheme = () => setColorScheme(scheme === "dark" ? "light" : "dark");

  const download = (text: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Download the current network as a portable .json file (no server needed).
  const onExport = () => {
    download(JSON.stringify(toNetwork(), null, 2), `${networkName || "network"}.json`);
  };

  // Export as a single pandapower JSON (valid net + diagram_* layout tables).
  const onExportPp = async () => {
    setBusy(true);
    try {
      const text = await exportPandapower(toNetwork());
      download(text, `${networkName || "network"}.pp.json`);
      setMessage("Exported pandapower net.");
    } catch (err) {
      setMessage(`pandapower export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Import a pandapower JSON (ours or a plain pandapower net) into the editor.
  const onImportPpFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const network = await importPandapower(await file.text());
      loadNetwork(network);
      setMessage(`Imported pandapower net "${file.name}".`);
    } catch (err) {
      setMessage(`pandapower import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
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
            <Switch
              size="sm"
              label="Results"
              checked={showResults}
              onChange={(e) => setShowResults(e.currentTarget.checked)}
            />
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
            <input
              ref={ppInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={onImportPpFile}
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
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" size="xs" loading={busy}>
                  pandapower ▾
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={onExportPp}>Export as pandapower net…</Menu.Item>
                <Menu.Item onClick={() => ppInputRef.current?.click()}>
                  Import pandapower net…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
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
