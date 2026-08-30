"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import LanguagePicker from "@/components/LanguagePicker";
import { areasFor, useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export type PortalTab = { label: string; href: string };

/**
 * Chrome shared by every signed-in area, operations included: wordmark, the
 * areas this account may enter, the account chip, then the page's own title
 * and tabs.
 *
 * The area nav is what makes these one system rather than five URLs — it is
 * derived from the signed-in profile, so a driver never sees the operator
 * areas and an operator can walk the whole platform without retyping a URL.
 */
export default function PortalShell({
  title,
  tabs = [],
  active,
  fullWidth = false,
  stretch = false,
  onBeforeSignOut,
  children,
}: {
  title: string;
  tabs?: PortalTab[];
  active?: string;
  fullWidth?: boolean;
  stretch?: boolean;
  onBeforeSignOut?: () => Promise<void>;
  children: React.ReactNode;
}) {
  const { session, profile } = useAuth();
  const pathname = usePathname();
  const areas = areasFor(profile);

  return (
    <div className={`bg-background text-foreground [--radius:0.9rem] ${stretch ? "min-h-screen lg:flex lg:h-screen lg:flex-col lg:overflow-hidden" : "min-h-screen"}`}>
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className={`mx-auto flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:px-6 ${fullWidth ? "max-w-full" : "max-w-6xl"}`}>
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            Kaduna<span className="text-primary">.lk</span>
          </Link>

          <nav aria-label="Areas" className="flex items-center gap-1 overflow-x-auto">
            {areas.map((a) => {
              const current = pathname === a.href;
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  aria-current={current ? "page" : undefined}
                  className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                    current
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}
                >
                  {a.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground lg:inline">{session?.user.email}</span>
            <LanguagePicker />
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
        </div>
      </header>

      <main className={`mx-auto px-4 sm:px-6 ${fullWidth ? "max-w-full" : "max-w-6xl"} ${stretch ? "pt-4 pb-10 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden lg:pb-2" : "pb-16 pt-8"}`}>
        {title && <h1 className="font-display text-2xl font-bold tracking-tight shrink-0">{title}</h1>}

        {tabs.length > 0 && (
          <nav aria-label={title} className="mt-4 flex gap-1 overflow-x-auto border-b border-border shrink-0">
            {tabs.map((t) => {
              const className = `-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${
                t.label === active
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`;
              return t.href.startsWith("#") ? (
                <a key={t.label} href={t.href} className={className}>
                  {t.label}
                </a>
              ) : (
                <Link key={t.label} href={t.href} className={className}>
                  {t.label}
                </Link>
              );
            })}
          </nav>
        )}

        <div className={stretch ? "mt-4 lg:flex-1 lg:overflow-hidden" : "mt-8"}>{children}</div>
      </main>
    </div>
  );
}

/** Placeholder card for an area with nothing to show yet. */
export function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
