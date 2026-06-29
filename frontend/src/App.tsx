import { useEffect, useRef, useState } from "react";
import {
  Anchor,
  Button,
  Group,
  Menu,
  Paper,
  SegmentedControl,
  Text,
  Title,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";

import { Canvas } from "./canvas/Canvas";
import { Inspector } from "./inspector/Inspector";
import { Palette } from "./palette/Palette";
import { SummaryModal } from "./study/SummaryModal";
import { MobileApp } from "./mobile/MobileApp";
import { useIsMobile } from "./mobile/useIsMobile";
import { useEditor } from "./store";
import { toast } from "./toast";
import { flushPending } from "./sync";
import {
  createSession,
  exportPandapower,
  getView,
  importPandapower,
  openShare,
  runLoadFlow,
  runShortCircuit,
  shareSession,
} from "./api";

// A pointer to the server-side document this browser is editing. The model
// itself lives on the server; this is just which session to reattach to on
// reload (also mirrored into the URL so the link can be shared).
const SESSION_KEY = "bamboogrid:session";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
// Shortcut labels shown in the Edit menu (the canvas listens for both ⌘/Ctrl+Z
// + Shift to redo and Ctrl/⌘+Y).
const UNDO_HINT = isMac ? "⌘Z" : "Ctrl+Z";
const REDO_HINT = isMac ? "⇧⌘Z" : "Ctrl+Y";
const FIND_HINT = isMac ? "⌘F" : "Ctrl+F";

const PANELS = {
  left: { key: "bamboogrid:leftW", default: 220, min: 160, max: 460 },
  right: { key: "bamboogrid:rightW", default: 260, min: 200, max: 560 },
} as const;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

function readWidth(p: (typeof PANELS)[keyof typeof PANELS]): number {
  try {
    const raw = Number(localStorage.getItem(p.key));
    if (Number.isFinite(raw) && raw > 0) return clamp(raw, p.min, p.max);
  } catch {
    // best-effort
  }
  return p.default;
}

// A 5px hit area that drives a width via mouse drag. `dir` is +1 when dragging
// right grows the panel (left sidebar) and -1 when it shrinks it (right one).
function ResizeHandle({
  panel,
  dir,
  get,
  set,
}: {
  panel: (typeof PANELS)[keyof typeof PANELS];
  dir: 1 | -1;
  get: () => number;
  set: (w: number) => void;
}) {
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = get();
    const onMove = (ev: MouseEvent) => {
      set(clamp(startW + (ev.clientX - startX) * dir, panel.min, panel.max));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(panel.key, String(get()));
      } catch {
        // best-effort
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  return (
    <div
      onMouseDown={onDown}
      style={{
        width: 5,
        flex: "0 0 5px",
        cursor: "col-resize",
        background: "var(--mantine-color-default-border)",
      }}
    />
  );
}

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
    applyResults,
    applyShortCircuit,
    studyMode,
    setStudyMode,
    showResults,
    setShowResults,
    voltageUnit,
    setVoltageUnit,
    attachSession,
    sessionId,
    deselectAll,
    canUndo,
    canRedo,
    undo,
    redo,
    setSearchOpen,
  } = useEditor();
  const [busy, setBusy] = useState(false);
  // React Flow's d3-zoom handlers stop pointer events from reaching the
  // document, so Mantine's outside-click never closes these menus over the
  // canvas. We control them and close on a capture-phase press of the canvas.
  const [openMenu, setOpenMenu] = useState<
    "file" | "edit" | "view" | "study" | null
  >(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [leftW, setLeftW] = useState(() => readWidth(PANELS.left));
  const [rightW, setRightW] = useState(() => readWidth(PANELS.right));
  const ppInputRef = useRef<HTMLInputElement>(null);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const isMobile = useIsMobile();

  // Fixed-width checkmark gutter so menu items align whether ticked or not.
  const check = (on: boolean) => (
    <span style={{ display: "inline-block", width: 14 }}>{on ? "✓" : ""}</span>
  );

  // A dimmed, right-aligned shortcut hint for a menu item.
  const hotkey = (keys: string) => (
    <Text component="span" size="xs" c="dimmed">
      {keys}
    </Text>
  );

  // Desktop menu-bar behaviour: once a menu is open, hovering a sibling button
  // switches to it without an extra click.
  const hoverSwitch = (menu: NonNullable<typeof openMenu>) => () =>
    setOpenMenu((cur) => (cur ? menu : cur));

  // On first load, reattach to a session (URL ?session wins, then the last one
  // used) or start a fresh one.
  useEffect(() => {
    // Mobile renders the read-only demo (MobileApp), which runs its own
    // bootstrap. Skip the desktop session bootstrap there.
    if (isMobile) return;
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
          toast.success("Opened an editable copy of a shared network.");
          return;
        } catch (err) {
          if (cancelled) return;
          toast.error(`Could not open shared link: ${(err as Error).message}`);
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
          toast.error(`Could not start session: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

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
        toast.success("Share link copied — opening it creates an editable copy.");
      } catch {
        window.prompt("Copy this share link:", link);
      }
    } catch (err) {
      toast.error(`Could not create share link: ${(err as Error).message}`);
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
      toast.success("Exported pandapower net.");
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
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
      toast.success(`Imported "${file.name}".`);
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
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
      toast.success("Started a new network.");
    } catch (err) {
      toast.error(`Could not start session: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onRun = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await flushPending();
      if (studyMode === "shortcircuit") {
        applyShortCircuit(await runShortCircuit(sessionId));
      } else {
        applyResults(await runLoadFlow(sessionId));
      }
    } catch (err) {
      toast.error(`Request failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Phones/tablets get the read-only demo instead of the full editor.
  if (isMobile) return <MobileApp />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Paper shadow="xs" p="sm" radius={0} onPointerDown={deselectAll}>
        <Group justify="space-between">
          <Group gap="xs">
            <Title order={4} mr="xs">
              BambooGrid
            </Title>

            <Menu
              shadow="md"
              width={200}
              position="bottom-start"
              trigger="click"
              opened={openMenu === "file"}
              onChange={(o) => setOpenMenu(o ? "file" : null)}
            >
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onMouseEnter={hoverSwitch("file")}
                >
                  File
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={onReset} disabled={busy}>
                  New network
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  onClick={() => ppInputRef.current?.click()}
                  disabled={busy}
                >
                  Import…
                </Menu.Item>
                <Menu.Item onClick={onExport} disabled={busy}>
                  Export…
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item onClick={onShare} disabled={busy}>
                  Share…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>

            <Menu
              shadow="md"
              width={200}
              position="bottom-start"
              trigger="click"
              opened={openMenu === "edit"}
              onChange={(o) => setOpenMenu(o ? "edit" : null)}
            >
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onMouseEnter={hoverSwitch("edit")}
                >
                  Edit
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={() => void undo()}
                  disabled={!canUndo}
                  rightSection={hotkey(UNDO_HINT)}
                >
                  Undo
                </Menu.Item>
                <Menu.Item
                  onClick={() => void redo()}
                  disabled={!canRedo}
                  rightSection={hotkey(REDO_HINT)}
                >
                  Redo
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  onClick={() => setSearchOpen(true)}
                  rightSection={hotkey(FIND_HINT)}
                >
                  Find…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>

            <Menu
              shadow="md"
              width={200}
              position="bottom-start"
              trigger="click"
              opened={openMenu === "study"}
              onChange={(o) => setOpenMenu(o ? "study" : null)}
            >
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onMouseEnter={hoverSwitch("study")}
                >
                  Study
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setSummaryOpen(true)}>
                  Network summary…
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>

            <Menu
              shadow="md"
              width={230}
              position="bottom-start"
              trigger="click"
              closeOnItemClick={false}
              opened={openMenu === "view"}
              onChange={(o) => setOpenMenu(o ? "view" : null)}
            >
              <Menu.Target>
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onMouseEnter={hoverSwitch("view")}
                >
                  View
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Voltage display</Menu.Label>
                <Menu.Item
                  leftSection={check(voltageUnit === "kv")}
                  onClick={() => setVoltageUnit("kv")}
                >
                  Kilovolts (kV)
                </Menu.Item>
                <Menu.Item
                  leftSection={check(voltageUnit === "pu")}
                  onClick={() => setVoltageUnit("pu")}
                >
                  Per-unit (p.u.)
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  leftSection={check(showResults)}
                  onClick={() => setShowResults(!showResults)}
                >
                  Show results
                </Menu.Item>
                <Menu.Divider />
                <Menu.Label>Appearance</Menu.Label>
                <Menu.Item
                  leftSection={check(scheme === "light")}
                  onClick={() => setColorScheme("light")}
                >
                  Light
                </Menu.Item>
                <Menu.Item
                  leftSection={check(scheme === "dark")}
                  onClick={() => setColorScheme("dark")}
                >
                  Dark
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
          <Group>
            <input
              ref={ppInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={onImportFile}
            />
            <SegmentedControl
              size="xs"
              value={studyMode}
              onChange={(v) => setStudyMode(v as typeof studyMode)}
              data={[
                { label: "Load flow", value: "loadflow" },
                { label: "Short circuit", value: "shortcircuit" },
              ]}
            />
            <Button size="xs" onClick={onRun} loading={busy}>
              Run
            </Button>
          </Group>
        </Group>
      </Paper>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Paper
          withBorder
          radius={0}
          onPointerDown={deselectAll}
          style={{
            width: leftW,
            flex: `0 0 ${leftW}px`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, overflowY: "auto" }}>
            <Palette />
          </div>
        </Paper>
        <ResizeHandle
          panel={PANELS.left}
          dir={1}
          get={() => leftW}
          set={setLeftW}
        />
        <div
          style={{ flex: 1, minWidth: 0 }}
          onPointerDownCapture={() => setOpenMenu(null)}
        >
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </div>
        <ResizeHandle
          panel={PANELS.right}
          dir={-1}
          get={() => rightW}
          set={setRightW}
        />
        <Paper
          withBorder
          radius={0}
          style={{ width: rightW, flex: `0 0 ${rightW}px`, overflowY: "auto" }}
        >
          <Inspector />
        </Paper>
      </div>

      <Text
        size="xs"
        c="dimmed"
        ta="center"
        py={6}
        onPointerDown={deselectAll}
        style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      >
        Made with ⚡ by{" "}
        <Anchor
          href="https://kickstage.com"
          target="_blank"
          rel="noopener noreferrer"
          inherit
        >
          Kickstage
        </Anchor>
        {" · "}powered by{" "}
        <Anchor
          href="https://www.pandapower.org/"
          target="_blank"
          rel="noopener noreferrer"
          inherit
        >
          pandapower
        </Anchor>
        {" · "}
        <Text component="span" inherit c="dimmed">
          {__APP_VERSION__}
        </Text>
      </Text>

      <SummaryModal opened={summaryOpen} onClose={() => setSummaryOpen(false)} />
    </div>
  );
}
