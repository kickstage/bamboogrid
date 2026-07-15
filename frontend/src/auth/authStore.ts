// Optional Google sign-in state, kept separate from the (large) editor store.
//
// The flow: the Google Identity Services button hands us a credential (a Google
// ID token); we exchange it at /auth/google for our own app token + user. The
// token is mirrored into the api client (so every request carries it) and
// persisted to localStorage so a reload stays signed in. A guest simply has no
// token and no user — the default, fully-working state.

import { create } from "zustand";
import { fetchMe, googleLogin, setAuthToken } from "../api";
import type { User } from "../types";

const TOKEN_KEY = "bamboogrid:authToken";

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // best-effort; sign-in still works for this session without persistence
  }
  // Keep the api client's outgoing Authorization header in sync.
  setAuthToken(token);
}

interface AuthState {
  user: User | null;
  token: string | null;
  // True until the initial hydrate() settles, so the UI can avoid flashing the
  // signed-out state before a stored token is validated.
  loading: boolean;
  // Validate a persisted token on startup; clears it if expired/invalid. Safe to
  // call when there is no token (resolves straight to guest).
  hydrate: () => Promise<void>;
  // Exchange a Google credential for an app token and become signed in.
  login: (credential: string) => Promise<User>;
  // Drop the token/user (client-side; the stateless token isn't server-revoked).
  logout: () => void;
}

// Seed the api client from any persisted token before the first request goes out.
const initialToken = loadToken();
setAuthToken(initialToken);

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: initialToken,
  loading: Boolean(initialToken),

  hydrate: async () => {
    if (!loadToken()) {
      set({ loading: false });
      return;
    }
    try {
      const user = await fetchMe();
      set({ user, loading: false });
    } catch {
      // Token missing/expired/invalid → fall back to guest silently.
      storeToken(null);
      set({ user: null, token: null, loading: false });
    }
  },

  login: async (credential: string) => {
    const { token, user } = await googleLogin(credential);
    storeToken(token);
    set({ user, token, loading: false });
    return user;
  },

  logout: () => {
    storeToken(null);
    set({ user: null, token: null });
  },
}));
