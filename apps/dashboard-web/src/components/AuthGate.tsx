"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

/**
 * Gates the dashboard behind a Supabase session, because the backend services
 * now require a bearer token and the panels are useless without one.
 *
 * Any authenticated Supabase user gets in — there is no role check yet. Once
 * profiles carry an operator role, gate on that here.
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
      <main className="grid min-h-screen place-items-center text-sm text-neutral-400">
        Loading…
      </main>
    );
  }

  if (!session) {
    return <SignIn />;
  }

  return (
    <>
      <SignedInBar email={session.user.email ?? "signed in"} />
      {children}
    </>
  );
}

function SignedInBar({ email }: { email: string }) {
  return (
    <div className="flex items-center justify-end gap-3 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
      <span>{email}</span>
      <button
        type="button"
        onClick={() => void supabase.auth.signOut()}
        className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
      >
        Sign out
      </button>
    </div>
  );
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
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-800 p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">Kaduna.lk Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Sign in with your Kaduna.lk account.
          </p>
        </div>

        <label className="block text-sm">
          <span className="text-neutral-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="text-neutral-400">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-neutral-100 px-3 py-2 font-medium text-neutral-900 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
