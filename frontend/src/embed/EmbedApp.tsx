import { useEffect, useState } from "react";
import { LoadingOverlay, Text } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";

import { EmbedViewer } from "./EmbedViewer";
import type { ViewModel } from "../types";

const BASE = "";

// The URL carries a *share token* (see /session/share), never a session id —
// the session id is the session's bearer capability and must not appear in
// embed markup published on third-party pages.
async function fetchEmbedView(
  token: string,
): Promise<{ view: ViewModel; name: string }> {
  const res = await fetch(`${BASE}/embed/view/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.text();
    let detail: string;
    try {
      detail = JSON.parse(body)?.detail ?? body;
    } catch {
      detail = body || `${res.status} ${res.statusText}`;
    }
    throw new Error(detail);
  }
  return res.json();
}

export function EmbedApp() {
  const [view, setView] = useState<ViewModel | null>(null);
  const [name, setName] = useState("BambooGrid");
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const showControls = params.get("controls") !== "false";

  useEffect(() => {
    const pathParts = window.location.pathname.split("/");
    const embedIdx = pathParts.indexOf("embed");
    const urlToken = embedIdx >= 0 ? pathParts[embedIdx + 1] : null;

    if (!urlToken) {
      setError("No embed token in URL.");
      return;
    }
    setToken(urlToken);

    fetchEmbedView(urlToken)
      .then((data) => {
        setView(data.view);
        setName(data.name);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        padding: 24,
      }}>
        <Text size="sm" c="dimmed" ta="center">
          {error}
        </Text>
      </div>
    );
  }

  if (!view || !token) {
    return <LoadingOverlay visible />;
  }

  return (
    <ReactFlowProvider>
      <EmbedViewer
        view={view}
        name={name}
        token={token}
        showControls={showControls}
      />
    </ReactFlowProvider>
  );
}
