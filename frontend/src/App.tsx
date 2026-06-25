import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
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
import { exportPandapower, importPandapower, runLoadFlow } from "./api";
import { buildShareUrl, clearShareHash, readSharedNetwork } from "./share";
import {
  clearSavedNetwork,
  loadSavedNetwork,
  startAutosave,
} from "./persistence";

// Whether a restored/shared network is worth loading (skip an empty canvas).
const hasContent = (n: { buses: unknown[] }) => n.buses.length > 0;

export default function App() {
  const {
    networkName,
    setNetworkName,
    setMessage,
    message,
    toNetwork,
    loadNetwork,
    applyResults,
    showResults,
    setShowResults,
    resetNetwork,
  } = useEditor();
  const [busy, setBusy] = useState(false);
  const ppInputRef = useRef<HTMLInputElement>(null);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const toggleScheme = () => setColorScheme(scheme === "dark" ? "light" : "dark");

  // On first load: a shared link wins (and is then cleared from the URL),
  // otherwise restore the autosaved session. Then keep autosaving edits.
  useEffect(() => {
    const shared = readSharedNetwork();
    if (shared && hasContent(shared)) {
      loadNetwork(shared);
      clearShareHash();
      setMessage("Loaded a shared scenario.");
    } else {
      const saved = loadSavedNetwork();
      if (saved && hasContent(saved)) loadNetwork(saved);
    }
    return startAutosave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy a self-contained share link (the whole scenario lives in the URL).
  const onShare = async () => {
    const url = buildShareUrl(toNetwork());
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Share link copied to clipboard.");
    } catch {
      // Clipboard needs a secure context; fall back to a manual copy prompt.
      window.prompt("Copy this share link:", url);
    }
  };

  // Export the current network as a single pandapower JSON (valid net +
  // diagram_* layout tables) and download it.
  const onExport = async () => {
    setBusy(true);
    try {
      const text = await exportPandapower(toNetwork());
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${networkName || "network"}.pp.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Exported pandapower net.");
    } catch (err) {
      setMessage(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Import a pandapower JSON (ours or a plain pandapower net) into the editor.
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const network = await importPandapower(await file.text());
      loadNetwork(network);
      setMessage(`Imported "${file.name}".`);
    } catch (err) {
      setMessage(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Clear the whole canvas back to an empty network. Destructive, so confirm
  // first (skip the prompt when there's nothing to lose).
  const onReset = () => {
    const { nodes, edges } = useEditor.getState();
    const empty = nodes.length === 0 && edges.length === 0;
    if (empty || window.confirm("Clear the editor and remove everything?")) {
      resetNetwork();
      clearSavedNetwork();
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
            <Button variant="default" size="xs" onClick={onReset}>
              Reset editor
            </Button>
          </Group>
          <Group>
            <Switch
              size="sm"
              label="Results"
              checked={showResults}
              onChange={(e) => setShowResults(e.currentTarget.checked)}
            />
            <input
              ref={ppInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={onImportFile}
            />
            <Button
              variant="default"
              size="xs"
              loading={busy}
              onClick={() => ppInputRef.current?.click()}
            >
              Import
            </Button>
            <Button variant="default" size="xs" loading={busy} onClick={onExport}>
              Export
            </Button>
            <Button variant="default" size="xs" onClick={onShare}>
              Share
            </Button>
            <Button size="xs" onClick={onRun} loading={busy}>
              Run load flow
            </Button>
            <ActionIcon
              variant="default"
              size="lg"
              onClick={toggleScheme}
              aria-label="Toggle color scheme"
              title="Toggle dark mode"
            >
              {scheme === "dark" ? "☀️" : "🌙"}
            </ActionIcon>
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
