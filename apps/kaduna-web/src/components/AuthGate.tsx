"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

const SessionContext = createContext<Session | null>(null);

/** The signed-in Supabase session. Non-null anywhere below AuthGate. */
export function useSession() {
  return useContext(SessionContext);
}

/**
 * Gates the dashboard behind a Supabase session, because the backend services
 * now require a bearer token and the panels are useless without one.
 *
 * Any authenticated Supabase user gets in — there is no role check yet. Once
 * profiles carry an operator role, gate on that here. Identity display and
 * sign-out live in the AppShell account menu, fed via useSession().
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">Kaduna.lk Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your Kaduna.lk account.
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
      </form>
    </main>
  );
}
