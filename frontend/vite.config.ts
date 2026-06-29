import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the SPA calls the API on its own origin (BASE=""); proxy those paths
// to the separately-running backend so the two-process workflow still works.
const proxy = Object.fromEntries(
  ["/session", "/share", "/health"].map((p) => [
    p,
    // 127.0.0.1, not "localhost": the backend binds IPv4 only, and Node 17+
    // resolves "localhost" to IPv6 (::1) first → ECONNREFUSED ::1:8000.
    { target: "http://127.0.0.1:8000", changeOrigin: true },
  ]),
);

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // Baked in at build time from the image tag (see Dockerfile/CI); "dev" locally.
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || "dev"),
  },
});
