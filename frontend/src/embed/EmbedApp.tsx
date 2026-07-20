import { useEffect, useState } from "react";
import { LoadingOverlay, Text } from "@mantine/core";
import { ReactFlowProvider } from "@xyflow/react";

import { EmbedViewer } from "./EmbedViewer";
import type { ViewModel } from "../types";

const BASE = "";

async function fetchEmbedView(sessionId: string): Promise<{ view: ViewModel; name: string; shareToken: string | null }> {
  const res = await fetch(`${BASE}/embed/view/${sessionId}`);
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
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const showControls = params.get("controls") !== "false";

  useEffect(() => {
    const pathParts = window.location.pathname.split("/");
    const embedIdx = pathParts.indexOf("embed");
    const sessionId = embedIdx >= 0 ? pathParts[embedIdx + 1] : null;

    if (!sessionId) {
      setError("No session ID in URL.");
      return;
    }

    fetchEmbedView(sessionId)
      .then((data) => {
        setView(data.view);
        setName(data.name);
        setShareToken(data.shareToken);
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

  if (!view) {
    return <LoadingOverlay visible />;
  }

  return (
    <ReactFlowProvider>
      <EmbedViewer
        view={view}
        name={name}
        shareToken={shareToken}
        showControls={showControls}
      />
    </ReactFlowProvider>
  );
}
