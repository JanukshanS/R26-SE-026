"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import SignIn from "@/components/SignIn";
import { supabase } from "@/lib/supabase";

/* Area/role routing lives in a React-free module so it can be unit tested;
   re-exported here because every consumer already imports from auth. */
export { AREAS, areasFor, roleHome, type Profile, type Role } from "./areas";
import type { Profile, Role } from "./areas";

type Auth = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
};

const AuthContext = createContext<Auth>({ session: null, profile: null, loading: true });

export function useAuth() {
  return useContext(AuthContext);
}

/** The signed-in Supabase session. Non-null anywhere below RequireAuth. */
export function useSession() {
  return useAuth().session;
}

/**
 * Holds the Supabase session plus the caller's own profiles row. `loading`
 * stays true until both are settled, so role checks never run against a
 * half-loaded profile.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setSessionReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileReady(true);
      return;
    }
    let cancelled = false;
    setProfileReady(false);
    supabase
      .from("profiles")
      .select("id,name,role,provider_id")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        // No row (or RLS said no) is not an error here — treat them as a plain driver.
        setProfile(
          (data as Profile | null) ?? { id: userId, name: null, role: "driver", provider_id: null }
        );
        setProfileReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <AuthContext.Provider
      value={{ session, profile, loading: !sessionReady || !profileReady }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function Spinner() {
  return (
    <main className="grid min-h-screen place-items-center">
      <div
        role="status"
        aria-label="Loading"
        className="size-8 animate-spin rounded-full border-2 border-border border-t-primary"
      />
    </main>
  );
}

function Gate({ role, children }: { role?: Role; children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();

  if (loading) return <Spinner />;
  if (!session) return <SignIn />;

  if (role && profile?.role !== role) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-sm space-y-4 rounded-lg border border-border p-6 text-center">
          <h1 className="text-lg font-semibold">This area needs operator access</h1>
          <p className="text-sm text-muted-foreground">
            You&apos;re signed in as {session.user.email}, which doesn&apos;t have operator
            permissions. Ask an administrator to grant them, or sign in with another account.
          </p>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="w-full rounded border border-input bg-card px-3 py-2 text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}

/**
 * Session (and optionally role) gate. Renders children only when authorized.
 *
 * The provider lives once in the root layout, so this is a pure gate: moving
 * between /app, /provider, /admin and /dashboard reuses the same session and
 * profile instead of re-fetching both on every navigation.
 */
export default function RequireAuth({
  role,
  children,
}: {
  role?: Role;
  children: React.ReactNode;
}) {
  return <Gate role={role}>{children}</Gate>;
}
