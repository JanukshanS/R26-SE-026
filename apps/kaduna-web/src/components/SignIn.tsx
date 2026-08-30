"use client";

import { useEffect, useState } from "react";

import LanguagePicker from "@/components/LanguagePicker";
import { supabase } from "@/lib/supabase";

/**
 * Web OAuth client "Kaduna" in Google Cloud project kaduna-lk — the same
 * client Supabase's Google provider is configured with, so One Tap ID tokens
 * carry an audience Supabase already trusts. Public by design.
 */
const GOOGLE_CLIENT_ID =
  "163099306411-kueu6f5ph9ufova4c4ppop92ufejidu6.apps.googleusercontent.com";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: object) => void;
          prompt: () => void;
        };
      };
    };
  }
}

/**
 * Shared sign-in for every gated area. Purely token-styled, so it reads
 * correctly on the dark dashboard and on the warm-light portals.
 *
 * Two Google paths: the button uses the redirect flow (always works), and the
 * Google One Tap prompt is offered on load via signInWithIdToken. One Tap only
 * appears on origins listed in the OAuth client's Authorized JavaScript
 * Origins (kaduna.lk) — elsewhere GIS logs a console warning and stays quiet.
 */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function startOneTap() {
      // Google mints a nonce of its own under FedCM, and Supabase rejects a
      // token whose nonce claim it wasn't told about ("Passed nonce and nonce
      // in id_token should either both exist or not"). So supply our own on
      // both sides: Google gets the SHA-256 hex digest, signInWithIdToken gets
      // the raw value and hashes it to compare.
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
      const hashedNonce = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        nonce: hashedNonce,
        callback: async (response: { credential: string }) => {
          const { error: idError } = await supabase.auth.signInWithIdToken({
            provider: "google",
            token: response.credential,
            nonce,
          });
          if (idError) setError(idError.message);
        },
      });
      window.google?.accounts.id.prompt();
    }

    if (window.google) {
      void startOneTap();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => void startOneTap();
    document.head.appendChild(script);
    return () => {
      script.onload = null;
    };
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
    }
    setBusy(false);
  }

  async function onGoogle() {
    setBusy(true);
    setError(null);
    // Redirect flow: the browser navigates to Google and returns to the page it
    // left, where supabase-js reads the session from the URL and the gate
    // re-renders.
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">Sign in to Kaduna.lk</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your Kaduna.lk account.
          </p>
        </div>

        <label className="block text-sm">
          <span className="text-muted-foreground">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-input bg-card px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted-foreground">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-input bg-card px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded border border-input bg-card px-3 py-2 font-medium disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
            <path
              fill="#4285F4"
              d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.09A12 12 0 0 0 12 24Z"
            />
            <path
              fill="#FBBC05"
              d="M5.29 14.29a7.22 7.22 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l4-3.09Z"
            />
            <path
              fill="#EA4335"
              d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l4 3.09C6.23 6.88 8.88 4.77 12 4.77Z"
            />
          </svg>
          Continue with Google
        </button>
      </form>
    </main>
  );
}
