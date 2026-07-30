import React from "react";
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

const params = new URLSearchParams(window.location.search);
const themeParam = params.get("theme");
// An explicit theme param must win unconditionally, so it is *forced* —
// `defaultColorScheme` alone loses to whatever scheme the editor persisted to
// localStorage (the embed is same-origin with the editor).
const forced =
  themeParam === "light" || themeParam === "dark" ? themeParam : undefined;

// Without a param, follow the viewer's OS ("auto") — and still ignore the
// editor's persisted preference, which a visitor on a third-party page never
// chose. This manager reads/writes nothing.
const detachedManager: MantineColorSchemeManager = {
  get: (defaultValue) => defaultValue,
  set: () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {},
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript forceColorScheme={forced} defaultColorScheme="auto" />
    <MantineProvider
      forceColorScheme={forced}
      defaultColorScheme="auto"
      colorSchemeManager={detachedManager}
      theme={theme}
    >
      <EmbedApp />
    </MantineProvider>
  </React.StrictMode>,
);
