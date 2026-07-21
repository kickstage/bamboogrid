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
import { applySavedLoadFlowSettings } from "./study/loadFlowSettings";
import { MobileApp } from "./mobile/MobileApp";
import { useIsMobile } from "./mobile/useIsMobile";
import { authEnabled, AuthControls } from "./auth/GoogleSignIn";
import { SignInModal } from "./auth/SignInModal";
import { useAuth } from "./auth/authStore";
import { DEFAULT_SCENARIO_NAME, useEditor } from "./store";
import { toast } from "./toast";
import { dropPending, flushOnUnload, flushPending } from "./sync";
import {
  createScenarioSession,
  createSession,
  detachSession,
  revertSession,
  saveSession,
  deleteGrid,
  exportPandapower,
  fetchScenarios,
  getView,
  importPandapower,
  openShare,
  renameGrid,
  runEstimation,
  runLoadFlow,
  runShortCircuit,
  type Scenario,
  shareSession,
} from "./api";
import type { ViewModel } from "./types";
import { GridsModal } from "./auth/GridsModal";
import { ScenarioTitle } from "./ScenarioTitle";
import { useTabs } from "./tabs";
import { TabStrip } from "./TabStrip";

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
const SAVE_HINT = isMac ? "⌘S" : "Ctrl+S";

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

// The guest copies signing out left behind (one per tab that held a saved
// scenario), each paired with the scenario it came from, so signing back in can
// undo the detach. Only entries whose copy is still untouched are kept.
const DETACHED_KEY = "bamboogrid:detached";

interface Detached {
  copy: string;
  origin: string;
}

function readDetached(): Detached[] {
  try {
    const raw = localStorage.getItem(DETACHED_KEY);
    const parsed = raw ? (JSON.parse(raw) as Detached[]) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => !!d?.copy && !!d?.origin);
  } catch {
    return [];
  }
}

function rememberDetached(list: Detached[]): void {
  try {
    if (list.length) localStorage.setItem(DETACHED_KEY, JSON.stringify(list));
    else localStorage.removeItem(DETACHED_KEY);
  } catch {
    // best-effort
  }
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
    applyEstimation,
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
    setYbusOpen,
    setSummaryOpen,
    setSettingsOpen,
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
  // Summary and load-flow-settings live as floating panels (in Canvas), driven
  // by the store's setSummaryOpen/setSettingsOpen — no local state here.
  const [gridsOpen, setGridsOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // A guest hit Save: run it once they've signed in.
  const pendingSaveRef = useRef(false);
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
  const { user } = useAuth();
  const dirty = useEditor((s) => s.dirty);
  const savedAt = useEditor((s) => s.savedAt);
  const applyViewMeta = useEditor((s) => s.applyViewMeta);
  const nodeCount = useEditor((s) => s.nodes.length);
  // Unsaved edits, or a never-saved scenario with something in it (a freshly
  // opened example is untouched but still in no library).
  const canSave = dirty || (savedAt === null && nodeCount > 0);
  // No sign-in configured means no library to save into, so don't flag a save
  // state the user has no way to act on.
  const unsaved =
    !authEnabled() || !canSave
      ? undefined
      : savedAt === null
        ? "never"
        : "changes";
  // An empty canvas has nothing to lose, so it never warns — even if technically
  // dirty (a node added then deleted).
  const losesWork = nodeCount > 0 && canSave;

  // Every attach (bootstrap, switch, open, new) lands here, so the active tab is
  // ensured and kept current without each open path bookkeeping tabs itself.
  useEffect(() => {
    if (!sessionId) return;
    const name = networkName || DEFAULT_SCENARIO_NAME;
    const saveState = { unsaved: losesWork, everSaved: savedAt !== null };
    const t = useTabs.getState();
    t.addTab({ id: sessionId, name, ...saveState });
    t.setActive(sessionId);
    t.renameTab(sessionId, name);
    t.setSaveState(sessionId, saveState);
  }, [sessionId, networkName, losesWork, savedAt]);

  // Switch to a scenario already open in a tab: settle the current session's
  // edits before attaching the target, so nothing is lost.
  const activateTab = async (id: string) => {
    if (id === useTabs.getState().activeId || busy) return;
    setBusy(true);
    setLoadingMsg("Switching scenario…");
    try {
      await flushPending();
      const view = await getView(id);
      await attachSession(id, view);
      rememberSession(id);
    } catch (err) {
      // An owned session 404s like a deleted one, so a guest can't tell them
      // apart — keep the tab, since signing in may reach it. A signed-in user
      // would have been let in, so for them a 404 really is a dead id.
      toast.error(
        user
          ? `Could not open that tab: ${(err as Error).message}`
          : `Could not open that tab: ${(err as Error).message}. If it's a saved scenario, sign in to reopen it.`,
      );
      if (user) useTabs.getState().removeTab(id);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Closing drops the scenario from the strip for good, so warn first if it holds
  // unsaved work — live state for the active tab, the cached flag otherwise.
  const closeTab = async (id: string) => {
    const { tabs, activeId } = useTabs.getState();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    const isActive = id === activeId;
    const st = useEditor.getState();
    const unsaved = isActive
      ? st.nodes.length > 0 && (st.dirty || st.savedAt === null)
      : tab.unsaved;
    const everSaved = isActive ? st.savedAt !== null : tab.everSaved;
    // What closing actually costs. A scenario that never reached the library lives
    // only as long as a tab points at it, so closing loses the whole thing rather
    // than just recent edits — and with no sign-in, that's every scenario.
    let prompt: string;
    if (!authEnabled())
      prompt =
        `"${tab.name}" isn't saved anywhere — closing it loses the whole ` +
        `scenario for good. Close it?\n\n` +
        `Cancel, then File ▸ Export…, to keep a copy.`;
    else if (!everSaved)
      prompt =
        `"${tab.name}" has never been saved — closing it loses the whole ` +
        `scenario. Close it?\n\n` +
        `Cancel, then Save (${SAVE_HINT}), to keep it.`;
    else
      prompt =
        `"${tab.name}" has unsaved changes. Close it and lose them?\n\n` +
        `Cancel, then Save (${SAVE_HINT}), to keep it.`;
    if (unsaved && !window.confirm(prompt)) return;
    if (isActive) {
      dropPending();
      const next = tabs[idx + 1] ?? tabs[idx - 1];
      if (next) await activateTab(next.id);
      else await onNewGrid();
    }
    useTabs.getState().removeTab(id);
  };

  // Save into the user's library; a guest is prompted to sign in first, and the
  // save then runs itself (pendingSaveRef).
  const onSave = async () => {
    const id = useEditor.getState().sessionId;
    if (!id) return;
    // With no sign-in configured, saving to a library isn't available — Cmd+S
    // should do nothing rather than open a sign-in modal that has no button.
    if (!authEnabled()) return;
    if (!user) {
      pendingSaveRef.current = true;
      setSignInOpen(true);
      return;
    }
    setSaving(true);
    try {
      // A command flushed after the save would re-dirty the scenario.
      await flushPending();
      applyViewMeta(await saveSession(id));
      toast.success("Scenario saved.");
    } catch (err) {
      toast.error(`Could not save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // A saved scenario is unreachable once its owner's token is gone, so every open
  // tab holding one keeps a guest copy. Everything touching an owned session must
  // therefore happen before logout() — hence the order below.
  const onSignOut = async () => {
    const st = useEditor.getState();
    const activeId = st.sessionId;
    const tabs = useTabs.getState().tabs;
    setBusy(true);
    setLoadingMsg(tabs.length > 1 || st.savedAt !== null ? "Signing out…" : null);
    try {
      // Queued edits must reach the session before it's copied.
      await flushPending();

      // Which tabs hold a saved (owned) scenario — a never-saved one is already
      // unowned, so signing out costs it no access. Read while the token still can.
      const owned: { id: string; dirty: boolean }[] = [];
      for (const t of tabs) {
        if (t.id === activeId) {
          if (st.savedAt !== null) owned.push({ id: t.id, dirty: st.dirty });
          continue;
        }
        try {
          const v = await getView(t.id);
          if (v.saved_at !== null) owned.push({ id: t.id, dirty: v.dirty });
        } catch {
          // Already gone (deleted/expired elsewhere): nothing to copy.
        }
      }

      // Unsaved edits leave with the user inside each copy; the library keeps every
      // scenario as it was last saved.
      const copies: {
        origin: string;
        copy: string;
        view: ViewModel;
        dirty: boolean;
      }[] = [];
      for (const o of owned) {
        try {
          const c = await detachSession(o.id);
          if (o.dirty) await revertSession(o.id);
          copies.push({ origin: o.id, copy: c.id, view: c.view, dirty: o.dirty });
        } catch (err) {
          // Losing the canvas's own scenario is worse than not signing out: abort
          // while the token still reaches it. A background tab is dropped instead.
          if (o.id === activeId) throw err;
        }
      }

      useAuth.getState().logout();

      // Keep each tab in place pointing at its copy, rather than opening a second
      // tab for it. A tab that couldn't be copied would 404, so it goes.
      const copied = new Set(copies.map((c) => c.origin));
      for (const c of copies) useTabs.getState().replaceId(c.origin, c.copy);
      for (const o of owned)
        if (!copied.has(o.id)) useTabs.getState().removeTab(o.id);

      const active = copies.find((c) => c.origin === activeId);
      if (active) {
        await attachSession(active.copy, active.view);
        rememberSession(active.copy);
      }

      // Only the clean copies can fold back on sign-in: one carrying unsaved edits
      // is already a different network, and returning would silently drop them.
      reattachedRef.current.clear();
      rememberDetached(
        copies
          .filter((c) => !c.dirty)
          .map((c) => ({ copy: c.copy, origin: c.origin })),
      );

      const stranded = owned.length - copies.length;
      toast.success(
        copies.length === 0
          ? "Signed out."
          : copies.length === 1
            ? "Signed out. Your scenario is still here, as an unsaved copy."
            : `Signed out. Your ${copies.length} saved scenarios are still here, as unsaved copies.`,
      );
      if (stranded > 0)
        toast.error(
          `${stranded} scenario${stranded === 1 ? "" : "s"} could not be copied` +
            " and closed. Sign back in to reopen from your library.",
        );
    } catch (err) {
      toast.error(`Could not sign out cleanly: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Signing back in undoes a sign-out detach: swap the guest copy on the canvas
  // for the real scenario in the library, so it stops reading "Not saved" when it
  // is in fact saved. Only while the copy is untouched — once it's been edited it
  // is its own scenario, and going back to the original would drop that work.
  //
  // Only the active copy is swapped; the rest wait until their tab is opened and
  // this runs for them. The ref keys by copy id: one in-flight swap per copy.
  const reattachedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sessionId) return;
    const list = readDetached();
    const d = list.find((e) => e.copy === sessionId);
    if (!d) return;

    // Edited or saved: it now holds work the original doesn't, so it can never be
    // folded back in. savedAt matters as well as dirty — saving the copy clears
    // dirty, and it must not then look untouched and get swapped away.
    if (dirty || savedAt !== null) {
      rememberDetached(list.filter((e) => e.copy !== d.copy));
      return;
    }
    if (!user || reattachedRef.current.has(d.copy)) return;
    reattachedRef.current.add(d.copy);
    pendingSaveRef.current = false; // the original is already saved
    void (async () => {
      try {
        const view = await getView(d.origin);
        useTabs.getState().replaceId(d.copy, d.origin);
        await attachSession(d.origin, view);
        rememberSession(d.origin);
      } catch {
        // The original is gone (deleted elsewhere): keep the copy.
      } finally {
        // Re-read: other tabs' entries may have changed while this was in flight.
        rememberDetached(readDetached().filter((e) => e.copy !== d.copy));
      }
    })();
  }, [user, sessionId, dirty, savedAt, attachSession]);

  // Signing in resumes whatever prompted it.
  useEffect(() => {
    if (!user || !signInOpen) return;
    setSignInOpen(false);
    if (pendingSaveRef.current) {
      pendingSaveRef.current = false;
      void onSaveRef.current();
    } else {
      setGridsOpen(true);
    }
  }, [user, signInOpen]);

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

  // Same treatment, but for a note about why an item is gated rather than a key.
  const hint = hotkey;

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
      // The strip is already restored from localStorage; only one tab needs
      // attaching. First that loads wins; ones that don't are dropped.
      const restored = useTabs.getState();
      const ordered = [
        ...new Set(
          [
            url.searchParams.get("session"),
            restored.activeId,
            ...restored.tabs.map((t) => t.id),
            localStorage.getItem(SESSION_KEY),
          ].filter((v): v is string => !!v),
        ),
      ];
      // Cover the canvas while we pull an existing network off the server.
      if (shareToken) setLoadingMsg("Opening shared network…");
      else if (ordered.length) setLoadingMsg("Loading network…");
      try {
        if (shareToken) {
          try {
            const { id, view } = await openShare(shareToken);
            await attachSession(id, view);
            rememberSession(id);
            toast.success("Opened an editable copy of a shared network.");
            return;
          } catch (err) {
            toast.error(`Could not open shared link: ${(err as Error).message}`);
            // Fall through to a restored/fresh session.
          }
        }
        for (const candidate of ordered) {
          try {
            const view = await getView(candidate);
            await attachSession(candidate, view);
            rememberSession(candidate);
            // Resumes the working copy, unsaved edits included.
            return;
          } catch {
            // Stale/unknown id — drop its tab and try the next candidate.
            useTabs.getState().removeTab(candidate);
          }
        }
        const { id, view } = await createSession();
        await applySavedLoadFlowSettings(id);
        await attachSession(id, view);
        rememberSession(id);
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

  // Import a pandapower JSON (ours or a plain pandapower net) into a new tab: it
  // lands in a fresh session so the scenario you were on stays open.
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setLoadingMsg(`Importing "${file.name}"…`);
    try {
      await flushPending();
      const { id } = await createSession();
      const view = await importPandapower(id, await file.text());
      await attachSession(id, view);
      rememberSession(id);
      toast.success(`Imported "${file.name}".`);
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // File ▸ New — a blank scenario in its own tab.
  const onReset = async () => {
    await onNewGrid();
  };

  // Open a built-in pandapower example in its own tab (a fresh session).
  const onOpenScenario = async (scenario: Scenario) => {
    setBusy(true);
    setLoadingMsg(`Opening "${scenario.label}"…`);
    try {
      await flushPending();
      const { id, view } = await createScenarioSession(scenario.id);
      await applySavedLoadFlowSettings(id);
      await attachSession(id, view);
      rememberSession(id);
      toast.success(`Opened "${scenario.label}".`);
    } catch (err) {
      toast.error(`Could not open example: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Open one of the user's saved grids — in its own tab. If it's already open,
  // just switch to that tab rather than loading a second copy.
  const openGrid = async (id: string) => {
    if (useTabs.getState().tabs.some((t) => t.id === id)) {
      await activateTab(id);
      return;
    }
    setBusy(true);
    setLoadingMsg("Loading scenario…");
    try {
      // Settle the current tab's edits before pointing sync at the new session;
      // the current scenario stays open in its own tab.
      await flushPending();
      const view = await getView(id);
      await attachSession(id, view);
      rememberSession(id);
    } catch (err) {
      toast.error(`Could not open scenario: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoadingMsg(null);
    }
  };

  // Start a fresh, blank scenario in a new tab. Unowned until saved, like any
  // other. The current scenario stays open in its own tab.
  const onNewGrid = async () => {
    setBusy(true);
    try {
      await flushPending();
      const { id, view } = await createSession();
      await applySavedLoadFlowSettings(id);
      await attachSession(id, view);
      rememberSession(id);
      toast.success("Started a new scenario.");
    } catch (err) {
      toast.error(`Could not start a new scenario: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onDeleteGrid = async (id: string) => {
    await deleteGrid(id);
    toast.success("Scenario deleted.");
    const { tabs, activeId } = useTabs.getState();
    if (!tabs.some((t) => t.id === id)) return;
    // The deleted scenario's session is gone; drop any queued edits for it and
    // move off it to a neighbouring tab (or a fresh blank if it was the last).
    if (id === activeId) {
      dropPending();
      const idx = tabs.findIndex((t) => t.id === id);
      const next = tabs[idx + 1] ?? tabs[idx - 1];
      if (next) await activateTab(next.id);
      else await onNewGrid();
    }
    useTabs.getState().removeTab(id);
  };

  const onRenameGrid = async (id: string, name: string) => {
    await renameGrid(id, name);
    useTabs.getState().renameTab(id, name);
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
      const study =
        studyMode === "shortcircuit"
          ? "short circuit"
          : studyMode === "estimation"
            ? "state estimation"
            : "load flow";
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
      } else if (studyMode === "estimation") {
        const result = await runEstimation(sessionId);
        applyEstimation(result);
        if (result.ok && !result.bad_data)
          toast.success("State estimation converged.");
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

  // Cmd/Ctrl+S saves, replacing the browser's "save page" dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void onSaveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Warn on close/reload whenever the current scenario holds unsaved work — both
  // edits to a saved scenario and a never-saved scenario that isn't in the
  // library yet (canSave). Restore brings tabs back, but a browser-cleared or
  // GC'd session wouldn't, so the standard "are you sure?" is the safety net.
  useEffect(() => {
    if (!losesWork) return;
    // Asks only — the user may still cancel, so it must not discard anything.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [losesWork]);

  // On the way out, land the active tab's last edits with a keepalive request so
  // the browser doesn't cancel it mid-flight. Every open tab — this one included,
  // even a never-saved working copy — is then remembered and restored on return,
  // with nothing reverted: reverting would empty a tab the user expects to find
  // exactly as they left it.
  useEffect(() => {
    const onPageHide = () => {
      flushOnUnload();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
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
                {authEnabled() && (
                  <>
                    <Menu.Item
                      onClick={() =>
                        user ? setGridsOpen(true) : setSignInOpen(true)
                      }
                      // Guests see the item too — hiding it left no hint the
                      // feature exists. The hint says why it's not open yet.
                      rightSection={user ? undefined : hint("Sign in")}
                    >
                      My scenarios…
                    </Menu.Item>
                    <Menu.Divider />
                  </>
                )}
                {authEnabled() && (
                  <>
                    <Menu.Item
                      onClick={onSave}
                      disabled={busy || saving || !canSave}
                      rightSection={hotkey(SAVE_HINT)}
                    >
                      Save
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
                <Menu.Item
                  onClick={() => setYbusOpen(true)}
                  disabled={studyMode === "shortcircuit"}
                >
                  Admittance matrix…
                </Menu.Item>
                <Menu.Item onClick={() => setSettingsOpen(true)}>
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
                unsaved={unsaved}
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
              // Keep the current selection when switching studies (the toolbar
              // deselects on pointer-down; the inspector re-renders for the new
              // mode on the same element).
              onPointerDown={(e) => e.stopPropagation()}
              data={[
                { label: "Load flow", value: "loadflow" },
                { label: "Short circuit", value: "shortcircuit" },
                { label: "Estimation", value: "estimation" },
              ]}
            />
            <Tooltip
              label={`Run ${/Mac/i.test(navigator.platform) ? "⌘R" : "Ctrl+R"}`}
            >
              <Button
                size="xs"
                onClick={onRun}
                loading={busy}
                // Keep the current selection when running (the toolbar deselects
                // on pointer-down), so its results stay visible in the inspector.
                onPointerDown={(e) => e.stopPropagation()}
              >
                Run
              </Button>
            </Tooltip>
            <AuthControls onSignOut={onSignOut} />
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
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
          onPointerDownCapture={() => setOpenMenu(null)}
        >
          {/* Tabs sit above the canvas only (like VS Code's editor tabs), so the
              strip starts at the canvas's left edge, not over the side panels. */}
          <TabStrip
            onActivate={activateTab}
            onClose={closeTab}
            onNew={onNewGrid}
            disabled={busy}
          />
          <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
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

      <GridsModal
        opened={gridsOpen}
        onClose={() => setGridsOpen(false)}
        currentId={sessionId}
        onOpen={openGrid}
        onNew={onNewGrid}
        onDelete={onDeleteGrid}
        onRename={onRenameGrid}
      />
      <SignInModal
        opened={signInOpen}
        onClose={() => setSignInOpen(false)}
      />
    </div>
  );
}
