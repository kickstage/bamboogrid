// Google sign-in controls: renders the official Google Identity Services (GIS)
// button for a guest, or the account menu (email + sign out) when signed in.
//
// The whole thing is gated on VITE_GOOGLE_CLIENT_ID: with no client id the
// feature is off and this renders nothing, so the app stays guest-only.

import { useEffect, useRef } from "react";
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
import type { User } from "../types";

// The OAuth Client ID from the environment (dev: personal project; prod: the
// company's). Public by design — it's embedded in the GIS button.
const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

export function authEnabled(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
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

// --- component -------------------------------------------------------------

export function AuthControls({
  onSignedIn,
}: {
  // Invoked with the signed-in user after a successful sign-in.
  onSignedIn?: (user: User) => void;
}) {
  const { user, loading, login, logout } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const scheme = useComputedColorScheme("light");

  // Render the GIS button while signed out. Re-runs if the user or theme changes.
  useEffect(() => {
    if (!authEnabled() || user || loading) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !window.google || !buttonRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: ({ credential }) => {
            login(credential)
              .then((u) => onSignedIn?.(u))
              .catch((err) =>
                toast.error(`Sign-in failed: ${(err as Error).message}`),
              );
          },
        });
        window.google.accounts.id.renderButton(buttonRef.current, {
          theme: scheme === "dark" ? "filled_black" : "outline",
          size: "medium",
          type: "standard",
          text: "signin",
          shape: "pill",
        });
      })
      .catch((err) => toast.error((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [user, loading, scheme, login, onSignedIn]);

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
          <Menu.Label>{user.email}</Menu.Label>
          <Menu.Item
            onClick={() => {
              // Stop GIS from silently re-selecting this account next load.
              window.google?.accounts.id.disableAutoSelect();
              logout();
            }}
          >
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    );
  }

  // Guest: the GIS button mounts here.
  return <div ref={buttonRef} />;
}
