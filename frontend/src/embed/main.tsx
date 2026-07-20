import React from "react";
import ReactDOM from "react-dom/client";
import { ColorSchemeScript, MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";

import { EmbedApp } from "./EmbedApp";

const theme = createTheme({});

const params = new URLSearchParams(window.location.search);
const colorScheme = params.get("theme") === "light"
  ? "light"
  : params.get("theme") === "dark"
    ? "dark"
    : "auto";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme={colorScheme} />
    <MantineProvider defaultColorScheme={colorScheme} theme={theme}>
      <EmbedApp />
    </MantineProvider>
  </React.StrictMode>,
);
