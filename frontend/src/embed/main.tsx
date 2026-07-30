import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ColorSchemeScript,
  MantineProvider,
  createTheme,
  type MantineColorSchemeManager,
} from "@mantine/core";
import "@mantine/core/styles.css";

import { EmbedApp } from "./EmbedApp";

const theme = createTheme({});

type ForcedScheme = "light" | "dark" | undefined;

function parseTheme(value: string | null): ForcedScheme {
  return value === "light" || value === "dark" ? value : undefined;
}

// Without a theme param, follow the viewer's OS ("auto") — and ignore the
// editor's localStorage preference (same origin), which a visitor on a
// third-party page never chose. This manager reads/writes nothing.
const detachedManager: MantineColorSchemeManager = {
  get: (defaultValue) => defaultValue,
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};

function Root() {
  const params = new URLSearchParams(window.location.search);
  // An explicit theme param must win unconditionally, so it is *forced* —
  // `defaultColorScheme` alone loses to the editor's persisted scheme.
  const [forced, setForced] = useState<ForcedScheme>(() =>
    parseTheme(params.get("theme")),
  );
  const [controls, setControls] = useState(
    params.get("controls") !== "false",
  );

  // The embed modal's live preview retunes options without reloading the
  // iframe (a reload would reset the viewport/zoom): it posts them here.
  // Same-origin only — third-party embedders cannot drive this.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.type !== "bamboogrid:embed-options") return;
      setForced(parseTheme(typeof d.theme === "string" ? d.theme : null));
      if (typeof d.controls === "boolean") setControls(d.controls);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <MantineProvider
      forceColorScheme={forced}
      defaultColorScheme="auto"
      colorSchemeManager={detachedManager}
      theme={theme}
    >
      <EmbedApp showControls={controls} />
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="auto" />
    <Root />
  </React.StrictMode>,
);
