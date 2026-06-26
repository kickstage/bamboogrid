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
import { flushPending } from "./sync";
import {
  createSession,
  exportPandapower,
  getView,
  importPandapower,
  openShare,
  runLoadFlow,
  shareSession,
} from "./api";

// A pointer to the server-side document this browser is editing. The model
// itself lives on the server; this is just which session to reattach to on
// reload (also mirrored into the URL so the link can be shared).
const SESSION_KEY = "bamboogrid:session";

function rememberSession(id: string): void {
  try {
    localStorage.setItem(SESSION_KEY, id);
  } catch {
    // best-effort
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("s"); // drop any share token we arrived through
  url.searchParams.set("session", id);
  window.history.replaceState(null, "", url.toString());
}

export default function App() {
  const {
    networkName,
    setNetworkName,
    setMessage,
    message,
    applyResults,
    showResults,
    setShowResults,
    attachSession,
    sessionId,
  } = useEditor();
  const [busy, setBusy] = useState(false);
  const ppInputRef = useRef<HTMLInputElement>(null);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const toggleScheme = () => setColorScheme(scheme === "dark" ? "light" : "dark");

  // On first load, reattach to a session (URL ?session wins, then the last one
  // used) or start a fresh one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL(window.location.href);
      // A share token always wins: clone it into a fresh copy to edit.
      const shareToken = url.searchParams.get("s");
      if (shareToken) {
        try {
          const { id, view } = await openShare(shareToken);
          if (cancelled) return;
          attachSession(id, view);
          rememberSession(id);
          setMessage("Opened an editable copy of a shared network.");
          return;
        } catch (err) {
          if (cancelled) return;
          setMessage(`Could not open shared link: ${(err as Error).message}`);
          // Fall through to a normal/fresh session.
        }
      }
      const candidate =
        url.searchParams.get("session") || localStorage.getItem(SESSION_KEY);
      try {
        if (candidate) {
          try {
            const view = await getView(candidate);
            if (cancelled) return;
            attachSession(candidate, view);
            rememberSession(candidate);
            return;
          } catch {
            // Stale/unknown id — fall through and create a new session.
          }
        }
        const { id, view } = await createSession();
        if (cancelled) return;
        attachSession(id, view);
        rememberSession(id);
      } catch (err) {
        if (!cancelled)
          setMessage(`Could not start session: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Copy a short share link. Opening it gives the recipient an editable copy of
  // this network, so they can't change the original.
  const onShare = async () => {
    if (!sessionId) return;
    try {
      const token = await shareSession(sessionId);
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set("s", token);
      const link = url.toString();
      try {
        await navigator.clipboard.writeText(link);
        setMessage("Share link copied — opening it creates an editable copy.");
      } catch {
        window.prompt("Copy this share link:", link);
      }
    } catch (err) {
      setMessage(`Could not create share link: ${(err as Error).message}`);
    }
  };

  // Export the retained net as a single pandapower JSON and download it.
  const onExport = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await flushPending();
      const text = await exportPandapower(sessionId);
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

  // Import a pandapower JSON (ours or a plain pandapower net): it replaces the
  // session's net server-side, and we reload the projection.
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !sessionId) return;
    setBusy(true);
    try {
      await flushPending();
      const view = await importPandapower(sessionId, await file.text());
      attachSession(sessionId, view);
      setMessage(`Imported "${file.name}".`);
    } catch (err) {
      setMessage(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Clear the canvas by starting a brand-new server session. Destructive, so
  // confirm first (skip the prompt when there's nothing to lose).
  const onReset = async () => {
    const { nodes, edges } = useEditor.getState();
    const empty = nodes.length === 0 && edges.length === 0;
    if (!empty && !window.confirm("Clear the editor and start a new network?"))
      return;
    setBusy(true);
    try {
      const { id, view } = await createSession();
      attachSession(id, view);
      rememberSession(id);
      setMessage("Started a new network.");
    } catch (err) {
      setMessage(`Could not start session: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await flushPending();
      const result = await runLoadFlow(sessionId);
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
              New network
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
