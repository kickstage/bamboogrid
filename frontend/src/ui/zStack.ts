import { useSyncExternalStore } from "react";

// Shared stacking order for docked tool windows: the most recently opened or
// clicked one renders on top. Only currently-open windows are tracked, so
// z-values stay in a small band just above the canvas and below Mantine's
// popover layer (300) — that keeps in-panel dropdowns overlaying their window.
// Context menus sit above the whole band (see `MENU_Z`).
const BASE = 200;

// Context menus must always cover the tool windows (a right-click menu is never
// hidden behind a "modal"). Well above the window band, still below Mantine's
// max layer.
export const MENU_Z = 1000;

let order: string[] = []; // bottom -> top
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function registerWindow(id: string): void {
  if (order.includes(id)) return;
  order = [...order, id];
  emit();
}

export function unregisterWindow(id: string): void {
  if (!order.includes(id)) return;
  order = order.filter((w) => w !== id);
  emit();
}

export function raiseWindow(id: string): void {
  if (order[order.length - 1] === id) return; // already on top
  order = [...order.filter((w) => w !== id), id];
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// The z-index a tool window should render at, reactive to focus/open order.
export function useWindowZ(id: string): number {
  return useSyncExternalStore(subscribe, () => {
    const i = order.indexOf(id);
    return i === -1 ? BASE : BASE + i;
  });
}
