// Google sign-in controls: renders the official Google Identity Services (GIS)
// button for a guest, or the account menu (email + sign out) when signed in.
//
// The whole thing is gated on the Google Client ID: with no client id the
// feature is off and this renders nothing, so the app stays guest-only.

import { useEffect, useRef } from "react";
import "./GoogleSignIn.css";
import {
  Avatar,
  Group,
  Menu,
  Text,
  UnstyledButton,
  useComputedColorScheme,
} from "@mantine/core";
import { useAuth } from "./authStore";
import { toast } from "../toast";

// Runtime config injected by the backend into index.html at request time (see
// main.py). Falls back to the Vite dev-server env var so local development
// (where the backend doesn't serve the HTML) still works without changes.
declare global {
  interface Window {
    __BAMBOOGRID_CONFIG__?: { googleClientId?: string | null };
  }
}

const GOOGLE_CLIENT_ID =
  window.__BAMBOOGRID_CONFIG__?.googleClientId ??
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ??
  "";

export function authEnabled(): boolean {
  return Boolean(GOOGLE_CLIENT_ID);
}

// --- GIS script + minimal typings ------------------------------------------

interface CredentialResponse {
  credential: string;
}
interface GoogleIdApi {
  initialize(cfg: {
    client_id: string;
    callback: (r: CredentialResponse) => void;
    auto_select?: boolean;
  }): void;
  renderButton(parent: HTMLElement, opts: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let gsiPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

// --- components ------------------------------------------------------------

// The official Google button. Mount only while signed out.
export function GoogleButton({
  size = "medium",
}: {
  size?: "medium" | "large";
}) {
  const login = useAuth((s) => s.login);
  const buttonRef = useRef<HTMLDivElement>(null);
  const scheme = useComputedColorScheme("light");

  useEffect(() => {
    if (!authEnabled()) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: ({ credential }) => {
            login(credential).catch((err) =>
              toast.error(`Sign-in failed: ${(err as Error).message}`),
            );
          },
        });
        // Clear any stale button so renderButton always creates a fresh iframe
        // with the correct theme — GIS does not reliably replace an existing one.
        buttonRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: scheme === "dark" ? "filled_black" : "outline",
          size,
          type: "standard",
          text: "signin",
          shape: "pill",
        });
      })
      .catch((err) => toast.error((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [scheme, size, login]);

  return <div ref={buttonRef} className="gsi-button-mount" />;
}

// Sign-out also detaches the editor from the scenario, which App owns — so App
// owns the whole sign-out and this only handles the GIS side of it.
export function AuthControls({ onSignOut }: { onSignOut: () => void }) {
  const { user, loading } = useAuth();

  if (!authEnabled() || loading) return null;

  if (user) {
    const label = user.name || user.email || "Account";
    const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
    return (
      <Menu position="bottom-end" width={200} withinPortal>
        <Menu.Target>
          <UnstyledButton aria-label="Account menu">
            <Group gap={6} wrap="nowrap">
              <Avatar size={24} radius="xl" color="blue">
                {initial}
              </Avatar>
              <Text size="sm" fw={500} maw={140} truncate>
                {label}
              </Text>
            </Group>
          </UnstyledButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label><Text size="xs" truncate="end">{user.email}</Text></Menu.Label>
          <Menu.Divider />
          <Menu.Item
            onClick={() => {
              // Stop GIS from silently re-selecting this account next load.
              window.google?.accounts.id.disableAutoSelect();
              onSignOut();
            }}
          >
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  return <GoogleButton />;
}
