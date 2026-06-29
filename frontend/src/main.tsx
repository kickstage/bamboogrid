import React from "react";
import ReactDOM from "react-dom/client";
import { ColorSchemeScript, MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import App from "./App";

// Pure white menus are harsh; tint them a touch (dark surface unchanged). The
// custom canvas/context menus match this in their own Paper bg.
const MENU_SURFACE =
  "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))";

const theme = createTheme({
  components: {
    Menu: {
      styles: { dropdown: { backgroundColor: MENU_SURFACE } },
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider defaultColorScheme="auto" theme={theme}>
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
