import { useEffect, useRef, useState } from "react";
import {
  Anchor,
  Button,
  Group,
  Loader,
  LoadingOverlay,
  Menu,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ReactFlowProvider } from "@xyflow/react";

import { Logo } from "./ui/Logo";
import { Submenu } from "./ui/Submenu";
import { Canvas } from "./canvas/Canvas";
import { Inspector } from "./inspector/Inspector";
import { Palette } from "./palette/Palette";
import { LoadFlowSettingsModal } from "./study/LoadFlowSettingsModal";
import { applySavedLoadFlowSettings } from "./study/loadFlowSettings";
import { SummaryModal } from "./study/SummaryModal";
import { MobileApp } from "./mobile/MobileApp";
import { useIsMobile } from "./mobile/useIsMobile";
import { AuthControls } from "./auth/GoogleSignIn";
import { useAuth } from "./auth/authStore";
import { DEFAULT_SCENARIO_NAME, useEditor } from "./store";
import { toast } from "./toast";
import { flushPending } from "./sync";
import {
  claimGrid,
  createScenarioSession,
  createSession,
  deleteGrid,
  exportPandapower,
  fetchScenarios,
  getView,
  importPandapower,
  openShare,
  renameGrid,
  runLoadFlow,
  runShortCircuit,
  type Scenario,
  shareSession,
} from "./api";
import { GridsModal } from "./auth/GridsModal";
import { ScenarioTitle } from "./ScenarioTitle";

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
  // A blocking message shown over the canvas while a network is being built
  // server-side (opening an example / importing), which can take a moment.
  const [loadingMsg, setLoadingMsg] = useState<string | null>(null);
  // React Flow's d3-zoom handlers stop pointer events from reaching the
  // document, so Mantine's outside-click never closes these menus over the
  // canvas. We control them and close on a capture-phase press of the canvas.
  const [openMenu, setOpenMenu] = useState<
    "file" | "edit" | "view" | "study" | null
  >(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [loadFlowSettingsOpen, setLoadFlowSettingsOpen] = useState(false);
  const [gridsOpen, setGridsOpen] = useState(false);
  // True while the open scenario is unclaimed (not yet in the signed-in user's
  // library); cleared once claimed. Unused for guests.
  const [scenarioUnsaved, setScenarioUnsaved] = useState(false);
  const [leftW, setLeftW] = useState(() => readWidth(PANELS.left));
  const [rightW, setRightW] = useState(() => readWidth(PANELS.right));
  const ppInputRef = useRef<HTMLInputElement>(null);
  // Curated example networks for File ▸ Open example (fetched once, built on
  // demand server-side from pandapower).
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  useEffect(() => {
    fetchScenarios().then(setScenarios).catch(() => {});
  }, []);
  // Validate any persisted sign-in token once on load; a guest resolves straight
  // through. The api client's auth header is already seeded synchronously from
  // localStorage (see authStore), so session requests carry the token before this.
  useEffect(() => {
    void useAuth.getState().hydrate();
  }, []);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("light");
  const isMobile = useIsMobile();
  // Signed-in users get "My scenarios" in the File menu; guests never see it.
  const { user } = useAuth();
  const nodeCount = useEditor((s) => s.nodes.length);

  // Claim an unclaimed scenario into the library once it has any content.
  // claimGrid is idempotent if it's already owned.
  useEffect(() => {
    if (!user || !scenarioUnsaved || !sessionId || nodeCount === 0) return;
    let cancelled = false;
    claimGrid(sessionId)
      .then(() => {
        if (!cancelled) setScenarioUnsaved(false);
      })
      .catch(() => {
        // Best-effort; scenarioUnsaved stays set, so the next edit retries.
      });
    return () => {
      cancelled = true;
    };
  }, [user, scenarioUnsaved, sessionId, nodeCount]);

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
  // used) or start a fresh one. Runs exactly once via a ref guard: it fires
  // resource-creating POSTs (openShare/createSession), so a second run (e.g.
  // StrictMode's double-invoke) would create duplicate sessions. A cleanup flag
  // can't prevent this — the in-flight POST still lands after cancellation.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    // Mobile renders the read-only demo (MobileApp), which runs its own
    // bootstrap. Skip the desktop session bootstrap there.
    if (isMobile) return;
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    (async () => {
      const url = new URL(window.location.href);
      // A share token always wins: clone it into a fresh copy to edit.
      const shareToken = url.searchParams.get("s");
      const candidate =
        url.searchParams.get("session") || localStorage.getItem(SESSION_KEY);
      // Cover the canvas while we pull an existing network off the server.
      if (shareToken) setLoadingMsg("Opening shared network…");
      else if (candidate) setLoadingMsg("Loading network…");
      try {
        if (shareToken) {
          try {
            const { id, view } = await openShare(shareToken);
            await attachSession(id, view);
            rememberSession(id);
            // Owned already when signed in; if opened as a guest, claimed on
            // sign-in once there's content (claim is idempotent either way).
            setScenarioUnsaved(true);
            toast.success("Opened an editable copy of a shared network.");
            return;
          } catch (err) {
            toast.error(`Could not open shared link: ${(err as Error).message}`);
            // Fall through to a normal/fresh session.
          }
        }
        if (candidate) {
          try {
            const view = await getView(candidate);
            await attachSession(candidate, view);
            rememberSession(candidate);
            // Might be a not-yet-claimed blank we're returning to; leave it
            // pending so its first content still saves it (claim is idempotent
            // if it's actually already owned).
            setScenarioUnsaved(true);
            return;
          } catch {
            // Stale/unknown id — fall through and create a new session.
          }
        }
        const { id, view } = await createSession(false);
        await applySavedLoadFlowSettings(id);
        await attachSession(id, view);
        rememberSession(id);
        // A blank landing scenario stays out of the library until it has content.
        setScenarioUnsaved(true);
      } catch (err) {
        toast.error(`Could not start session: ${(err as Error).message}`);
      } finally {
        setLoadingMsg(null);
      }
    })();
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
    setLoadingMsg(`Importing "${file.name}"…`);
    try {
      await flushPending();
      const view = await importPandapower(sessionId, await file.text());
      await attachSession(sessionId, view);
      toast.success(`Imported "${file.name}".`);
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Start a brand-new, blank scenario, created unclaimed. A signed-in user's
  // previous scenario is already saved, so no confirm; a guest confirms first,
  // since clearing loses their work.
  const onReset = async () => {
    if (!user) {
      const { nodes, edges } = useEditor.getState();
      const empty = nodes.length === 0 && edges.length === 0;
      if (
        !empty &&
        !window.confirm("Clear the editor and start a new scenario?")
      )
        return;
    }
    setBusy(true);
    try {
      const { id, view } = await createSession(false);
      await applySavedLoadFlowSettings(id);
      await attachSession(id, view);
      rememberSession(id);
      setScenarioUnsaved(true);
      toast.success("Started a new scenario.");
    } catch (err) {
      toast.error(`Could not start session: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Replace the canvas with a built-in pandapower example (a fresh session).
  // Destructive, so confirm first unless the canvas is already empty.
  const onOpenScenario = async (scenario: Scenario) => {
    const { nodes, edges } = useEditor.getState();
    const empty = nodes.length === 0 && edges.length === 0;
    if (!empty && !window.confirm(`Replace the editor with "${scenario.label}"?`))
      return;
    setBusy(true);
    setLoadingMsg(`Opening "${scenario.label}"…`);
    try {
      const { id, view } = await createScenarioSession(scenario.id);
      await applySavedLoadFlowSettings(id);
      await attachSession(id, view);
      rememberSession(id);
      // Owned already when signed in; if opened as a guest, claimed on sign-in.
      setScenarioUnsaved(true);
      toast.success(`Opened "${scenario.label}".`);
    } catch (err) {
      toast.error(`Could not open example: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Switch the editor to one of the user's saved grids.
  const openGrid = async (id: string) => {
    if (id === sessionId) return;
    setBusy(true);
    setLoadingMsg("Loading scenario…");
    try {
      await flushPending();
      const view = await getView(id);
      await attachSession(id, view);
      rememberSession(id);
      setScenarioUnsaved(false); // opened from the library — already owned
    } catch (err) {
      toast.error(`Could not open scenario: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Start a fresh, blank scenario, created unclaimed (used as the fallback after
  // deleting the one you're viewing).
  const onNewGrid = async () => {
    setBusy(true);
    try {
      const { id, view } = await createSession(false);
      await applySavedLoadFlowSettings(id);
      await attachSession(id, view);
      rememberSession(id);
      setScenarioUnsaved(true);
      toast.success("Started a new scenario.");
    } catch (err) {
      toast.error(`Could not start scenario: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onDeleteGrid = async (id: string) => {
    await deleteGrid(id);
    toast.success("Scenario deleted.");
    // Deleting the scenario you're viewing: fall back to a fresh one.
    if (id === sessionId) await onNewGrid();
  };

  const onRenameGrid = async (id: string, name: string) => {
    await renameGrid(id, name);
    if (id === sessionId) useEditor.setState({ networkName: name });
  };

  // Rename the scenario currently open (from the inline title in the top bar).
  const onRenameCurrent = async (name: string) => {
    if (!sessionId) return;
    try {
      await renameGrid(sessionId, name);
      useEditor.setState({ networkName: name });
    } catch (err) {
      toast.error(`Could not rename scenario: ${(err as Error).message}`);
    }
  };

  const onRun = async () => {
    if (!sessionId || busy) return;

    // An empty canvas has nothing to solve, and the backend rejects it with a
    // cryptic error. Nudge the user to build a grid (or load a ready-made one)
    // instead of surfacing that failure.
    const { nodes } = useEditor.getState();
    if (nodes.length === 0) {
      const study = studyMode === "shortcircuit" ? "short circuit" : "load flow";
      const ieee14 = scenarios.find((s) => s.id === "case14");
      const noticeId = "empty-canvas-run";
      notifications.show({
        id: noticeId,
        color: "blue",
        autoClose: 8000,
        title: "Nothing to solve yet",
        message: (
          <Text size="sm">
            Add some buses and equipment to build a grid before running a{" "}
            {study}
            {ieee14 && (
              <>
                , or{" "}
                <Anchor
                  inherit
                  fw={500}
                  onClick={() => {
                    notifications.hide(noticeId);
                    void onOpenScenario(ieee14);
                  }}
                >
                  try the IEEE 14-bus example
                </Anchor>
              </>
            )}
            .
          </Text>
        ),
      });
      return;
    }

    setBusy(true);
    try {
      await flushPending();
      if (studyMode === "shortcircuit") {
        const result = await runShortCircuit(sessionId);
        applyShortCircuit(result);
        if (result.ok) toast.success("Short circuit complete.");
      } else {
        const result = await runLoadFlow(sessionId);
        applyResults(result);
        if (result.converged) toast.success("Load flow converged.");
      }
    } catch (err) {
      toast.error(`Request failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // Cmd/Ctrl+R runs the active study, replacing the browser's reload — the network
  // lives server-side, so a reload offers nothing here. The ref keeps the listener
  // pinned to the latest onRun closure without re-binding on every render.
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        void onRunRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cmd/Ctrl+S: edits already stream to the server, so this just traps the
  // browser's "save page" dialog, flushes any in-flight edits, and confirms.
  const saveNow = async () => {
    if (!useEditor.getState().sessionId) return;
    try {
      await flushPending();
      toast.success("All changes saved.");
    } catch (err) {
      toast.error(`Could not save: ${(err as Error).message}`);
    }
  };
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNowRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Phones/tablets get the read-only demo instead of the full editor.
  if (isMobile) return <MobileApp />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Paper shadow="xs" p="sm" radius={0} onPointerDown={deselectAll}>
        <Group justify="space-between" style={{ position: "relative" }}>
          <Group gap="xs">
            <Logo height={21} style={{ margin: "2px 10px" }} />

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
                {user && (
                  <>
                    <Menu.Item onClick={() => setGridsOpen(true)}>
                      My scenarios…
                    </Menu.Item>
                    <Menu.Divider />
                  </>
                )}
                <Menu.Item onClick={onReset} disabled={busy}>
                  New scenario
                </Menu.Item>
                {scenarios.length > 0 && (
                  <Submenu
                    minWidth={200}
                    disabled={busy}
                    trigger={() => (
                      <Menu.Item
                        closeMenuOnClick={false}
                        disabled={busy}
                        rightSection={
                          <Text component="span" size="sm" c="dimmed">
                            ›
                          </Text>
                        }
                      >
                        Open example
                      </Menu.Item>
                    )}
                  >
                    {scenarios.map((s) => (
                      <Menu.Item
                        key={s.id}
                        onClick={() => onOpenScenario(s)}
                        disabled={busy}
                      >
                        {s.label}
                      </Menu.Item>
                    ))}
                  </Submenu>
                )}
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
                <Menu.Item onClick={() => setLoadFlowSettingsOpen(true)}>
                  Load flow settings…
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

          {/* Scenario title, absolutely centered on the bar. The wrapper ignores
              pointer events so only the title itself is clickable. */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ pointerEvents: "auto" }}>
              <ScenarioTitle
                name={networkName}
                defaultName={DEFAULT_SCENARIO_NAME}
                disabled={busy}
                onRename={onRenameCurrent}
              />
            </div>
          </div>

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
            <Tooltip
              label={`Run ${/Mac/i.test(navigator.platform) ? "⌘R" : "Ctrl+R"}`}
            >
              <Button size="xs" onClick={onRun} loading={busy}>
                Run
              </Button>
            </Tooltip>
            <AuthControls />
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
          style={{ flex: 1, minWidth: 0, position: "relative" }}
          onPointerDownCapture={() => setOpenMenu(null)}
        >
          <LoadingOverlay
            visible={loadingMsg !== null}
            zIndex={5}
            overlayProps={{ blur: 1 }}
            loaderProps={{
              children: (
                <Stack align="center" gap="xs">
                  <Loader />
                  <Text size="sm">{loadingMsg}</Text>
                </Stack>
              ),
            }}
          />
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
        {" · "}
        <Anchor
          href="https://github.com/kickstage/bamboogrid"
          target="_blank"
          rel="noopener noreferrer"
          inherit
          aria-label="Source code on GitHub"
          style={{ display: "inline-flex", verticalAlign: "text-bottom" }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
          </svg>
        </Anchor>
      </Text>

      <SummaryModal opened={summaryOpen} onClose={() => setSummaryOpen(false)} />
      <LoadFlowSettingsModal
        opened={loadFlowSettingsOpen}
        onClose={() => setLoadFlowSettingsOpen(false)}
      />
      <GridsModal
        opened={gridsOpen}
        onClose={() => setGridsOpen(false)}
        currentId={sessionId}
        onOpen={openGrid}
        onDelete={onDeleteGrid}
        onRename={onRenameGrid}
      />
    </div>
  );
}
