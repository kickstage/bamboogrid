import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MantineProvider, useComputedColorScheme } from "@mantine/core";

// Re-copy the opener's stylesheets into the popup so Mantine (and Vite's dev
// HMR <style> tags) render there. Copies are tagged so they can be replaced
// wholesale when the source head changes.
function syncStyles(src: Document, dst: Document) {
  dst.head.querySelectorAll("[data-detached-copy]").forEach((n) => n.remove());
  src.head
    .querySelectorAll('style, link[rel="stylesheet"]')
    .forEach((node) => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.setAttribute("data-detached-copy", "");
      dst.head.appendChild(clone);
    });
}

interface DetachedWindowProps {
  title: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  // Fired only when the user closes the OS window (not our own teardown).
  onClose: () => void;
  children: React.ReactNode;
}

// Renders its children into a real, separate browser window (movable to another
// screen). The popup shares the opener's JS heap, so this is a plain React
// portal — the store and all context still work, and interactions here drive the
// main-window canvas live.
export function DetachedWindow({
  title,
  width = 560,
  height = 640,
  minWidth = 360,
  minHeight = 280,
  onClose,
  children,
}: DetachedWindowProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const winRef = useRef<Window | null>(null);
  const scheme = useComputedColorScheme("light");

  // Keep the latest onClose reachable from the once-only open effect.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let win: Window | null = null;
    let observer: MutationObserver | null = null;
    // Our own teardown also fires the window's pagehide; distinguish it from a
    // user-initiated close so we don't spuriously dock on unmount/HMR.
    let selfClosing = false;
    const onPageHide = () => {
      if (!selfClosing) onCloseRef.current();
    };
    // If the opener goes away (reload), take the child with it.
    const closeChild = () => win?.close();

    // Defer the actual open: Firefox spins a nested event loop while creating
    // the blank document, which flushes React's scheduler mid-render and throws
    // "Should not already be working." Opening on a fresh macrotask lets the
    // current commit finish first. (This also collapses StrictMode's
    // mount/cleanup/mount into a single opened window.)
    const timer = setTimeout(() => {
      const w = Math.max(width, minWidth);
      const h = Math.max(height, minHeight);
      const left = Math.max(0, window.screenX + (window.outerWidth - w) / 2);
      const top = Math.max(0, window.screenY + (window.outerHeight - h) / 2);
      // `popup=yes` + the no-chrome flags ask for a bare window without an
      // address bar. Chromium honors this; Firefox always keeps a minimal
      // location bar for security (page code cannot suppress it).
      win = window.open(
        "",
        "",
        `popup=yes,location=no,toolbar=no,menubar=no,status=no,scrollbars=yes,` +
          `width=${w},height=${h},left=${left},top=${top}`,
      );
      if (!win) {
        onCloseRef.current(); // popup blocked — fall back to docked
        return;
      }
      winRef.current = win;
      win.document.title = title;
      win.document.body.style.margin = "0";
      // Scroll (instead of collapse) once the window shrinks past the content
      // minimum set on the root below.
      win.document.body.style.overflow = "auto";
      win.document.body.style.background = "var(--mantine-color-body)";
      win.document.body.style.color = "var(--mantine-color-text)";
      const root = win.document.createElement("div");
      // Full-height flex column so panels can flex-fill the window exactly
      // (the header sits at the top, the body takes the rest). The min size
      // keeps the layout usable; below it the body scrolls rather than collapses.
      root.style.height = "100vh";
      root.style.minWidth = `${minWidth}px`;
      root.style.minHeight = `${minHeight}px`;
      root.style.display = "flex";
      root.style.flexDirection = "column";
      root.style.overflow = "hidden";
      win.document.body.appendChild(root);
      syncStyles(document, win.document);

      observer = new MutationObserver(() => {
        if (win) syncStyles(document, win.document);
      });
      observer.observe(document.head, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });

      win.addEventListener("pagehide", onPageHide);
      window.addEventListener("beforeunload", closeChild);
      setContainer(root);
    }, 0);

    return () => {
      selfClosing = true;
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener("beforeunload", closeChild);
      if (win) {
        win.removeEventListener("pagehide", onPageHide);
        win.close();
      }
      winRef.current = null;
      setContainer(null);
    };
    // Open exactly once; size/title are read at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the app's light/dark scheme live.
  useEffect(() => {
    const win = winRef.current;
    if (!win) return;
    win.document.documentElement.setAttribute(
      "data-mantine-color-scheme",
      scheme,
    );
    win.document.documentElement.style.colorScheme = scheme;
  }, [scheme, container]);

  if (!container) return null;

  return createPortal(
    <MantineProvider
      forceColorScheme={scheme}
      getRootElement={() => winRef.current?.document.documentElement}
      cssVariablesSelector=":root"
    >
      {children}
    </MantineProvider>,
    container,
  );
}
