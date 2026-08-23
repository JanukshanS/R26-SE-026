"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export type PortalTab = { label: string; href: string };

/**
 * Warm-light chrome shared by /app, /provider and /admin: wordmark, area
 * title, nav tabs and the account chip. The dashboard keeps its own dark
 * AppShell.
 */
export default function PortalShell({
  title,
  tabs = [],
  active,
  onBeforeSignOut,
  children,
}: {
  title: string;
  tabs?: PortalTab[];
  /* Label, not href: the P1 tabs all point at the same placeholder route. */
  active?: string;
  /** Runs before the session is destroyed — e.g. the provider console flips
   *  its provider OFFLINE so a signed-out operator stops being dispatched.
   *  Failures are swallowed: sign-out must never be blocked by it. */
  onBeforeSignOut?: () => Promise<void>;
  children: React.ReactNode;
}) {
  const { session } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground [--radius:0.9rem]">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            Kaduna<span className="text-primary">.lk</span>
          </Link>
          <span className="h-5 w-px bg-border" />
          <h1 className="font-display text-lg font-semibold tracking-tight">{title}</h1>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {session?.user.email}
            </span>
            <button
              type="button"
              onClick={async () => {
                await onBeforeSignOut?.().catch(() => {});
                await supabase.auth.signOut();
              }}
              className="rounded-md border border-input px-3 py-1.5 font-medium hover:bg-accent"
            >
              Sign out
            </button>
          </div>

          {tabs.length > 0 && (
            <nav className="-mb-4 flex w-full gap-1 overflow-x-auto">
              {tabs.map((t) => (
                <Link
                  key={t.label}
                  href={t.href}
                  className={`border-b-2 px-3 py-2 text-sm ${
                    t.label === active
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">{children}</main>
    </div>
  );
}

/** Placeholder card used by the P1 shells until each area gets real data. */
export function EmptyCard({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
