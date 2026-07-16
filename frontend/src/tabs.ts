// Open scenarios as switchable tabs. Only the active tab's editor state lives in
// the useEditor store; a background tab is just an id + cached name, its net held
// on the server session it points at and resumed from there when reactivated.

import { create } from "zustand";

export interface Tab {
  // The server session id this tab edits.
  id: string;
  name: string;
  // Unsaved edits, or a never-saved scenario with content. Only current while the
  // tab is active; a background tab keeps its value from when it last was.
  unsaved: boolean;
}

const STORAGE_KEY = "bamboogrid:tabs";

interface Persisted {
  tabs: Tab[];
  activeId: string | null;
}

function loadPersisted(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw) as Persisted;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter(
            (t) => !!t && typeof t.id === "string" && typeof t.name === "string",
          )
          .map((t) => ({ id: t.id, name: t.name, unsaved: !!t.unsaved }))
      : [];
    const activeId = tabs.some((t) => t.id === parsed.activeId)
      ? parsed.activeId
      : (tabs[0]?.id ?? null);
    return { tabs, activeId };
  } catch {
    return { tabs: [], activeId: null };
  }
}

interface TabsState extends Persisted {
  // No-op if the session is already open; does not change the active tab.
  addTab: (tab: Tab) => void;
  // The caller must activate a neighbour first, or the editor points at nothing.
  removeTab: (id: string) => void;
  setActive: (id: string) => void;
  moveTab: (dragId: string, overId: string) => void;
  renameTab: (id: string, name: string) => void;
  setUnsaved: (id: string, unsaved: boolean) => void;
  // Sign-out swaps an owned session for a guest copy; keep the tab in place.
  replaceId: (oldId: string, newId: string) => void;
}

export const useTabs = create<TabsState>((set) => ({
  ...loadPersisted(),

  addTab: (tab) =>
    set((s) =>
      s.tabs.some((t) => t.id === tab.id) ? s : { tabs: [...s.tabs, tab] },
    ),

  removeTab: (id) => set((s) => ({ tabs: s.tabs.filter((t) => t.id !== id) })),

  setActive: (id) => set({ activeId: id }),

  moveTab: (dragId, overId) =>
    set((s) => {
      if (dragId === overId) return s;
      const from = s.tabs.findIndex((t) => t.id === dragId);
      const to = s.tabs.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1) return s;
      const tabs = [...s.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { tabs };
    }),

  renameTab: (id, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    })),

  setUnsaved: (id, unsaved) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, unsaved } : t)),
    })),

  replaceId: (oldId, newId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === oldId ? { ...t, id: newId } : t)),
      activeId: s.activeId === oldId ? newId : s.activeId,
    })),
}));

// Mirror every change back to localStorage so the tab set survives a reload.
useTabs.subscribe((s) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs: s.tabs, activeId: s.activeId }),
    );
  } catch {
    // best-effort
  }
});
