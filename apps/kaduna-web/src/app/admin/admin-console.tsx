"use client";

import { useCallback, useEffect, useState } from "react";

import PortalShell, { EmptyCard } from "@/components/portal/PortalShell";
import { GaragesTab, PartsTab } from "@/app/admin/marketplace-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth, type Role } from "@/lib/auth";
import { enumLabel, listProviders, type ProviderRecord } from "@/lib/dispatchApi";
import { supabase } from "@/lib/supabase";

const TAB_LABELS = ["Users", "Providers", "Parts", "Garages"] as const;
type Tab = (typeof TAB_LABELS)[number];

const TABS = TAB_LABELS.map((label) => ({ label, href: `#${label.toLowerCase()}` }));

const ROLES: Role[] = ["driver", "provider", "ops"];

/** Ops-visible profile row. Email lives in auth.users, which no client can read. */
type AdminProfile = {
  id: string;
  name: string | null;
  phone: string | null;
  role: Role;
  provider_id: string | null;
  created_at: string;
};

const ROLE_TONE: Record<Role, string> = {
  driver: "bg-muted text-muted-foreground",
  provider: "bg-amber-100 text-amber-900",
  ops: "bg-primary/15 text-primary",
};

/** Provider status wording matches the provider console. */
const PROVIDER_STATUS: Record<string, [string, string]> = {
  AVAILABLE: ["Available", "bg-emerald-100 text-emerald-900"],
  BUSY: ["Busy", "bg-amber-100 text-amber-900"],
  OFFLINE: ["Offline", "bg-muted text-muted-foreground"],
};

function Chip({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  );
}

function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
      >
        Try again
      </button>
    </div>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function UsersTab({
  profiles,
  error,
  reload,
  onRoleChanged,
}: {
  profiles: AdminProfile[] | null;
  error: string | null;
  reload: () => void;
  onRoleChanged: (next: AdminProfile[]) => void;
}) {
  const { profile: me } = useAuth();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Granting operator access is one-way in practice — confirm before the RPC.
  const [pendingOps, setPendingOps] = useState<string | null>(null);

  async function setRole(target: AdminProfile, next: Role) {
    if (!profiles) return;
    const previous = profiles;
    setPendingOps(null);
    setBusyId(target.id);
    setRowError((prev) => ({ ...prev, [target.id]: "" }));
    onRoleChanged(profiles.map((p) => (p.id === target.id ? { ...p, role: next } : p)));

    const { error: rpcError } = await supabase.rpc("admin_set_role", {
      target_id: target.id,
      new_role: next,
    });

    if (rpcError) {
      onRoleChanged(previous);
      setRowError((prev) => ({ ...prev, [target.id]: rpcError.message }));
    }
    setBusyId(null);
  }

  if (error) {
    return <ErrorCard title="Couldn't load users" message={error} onRetry={reload} />;
  }
  if (!profiles) return <TableSkeleton />;
  if (profiles.length === 0) {
    return (
      <EmptyCard
        title="No users yet"
        body="Every account that signs in — mobile or web — gets a profile row here. Nobody has signed up on this project yet."
      />
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? profiles.filter((p) =>
        [p.name, p.phone, p.id].some((f) => f?.toLowerCase().includes(q))
      )
    : profiles;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone or id"
          className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <span className="text-sm text-muted-foreground">
          {q ? `${shown.length} of ${profiles.length}` : `${profiles.length}`} user
          {profiles.length === 1 ? "" : "s"}
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyCard
          title="No match"
          body="No user matches that search. Try part of a name, a phone number, or the start of a user id."
        />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Change role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="font-medium">{p.name || "—"}</span>
                    <span className="block font-mono text-xs text-muted-foreground">
                      {shortId(p.id)}
                    </span>
                  </TableCell>
                  <TableCell>{p.phone || "—"}</TableCell>
                  <TableCell>
                    <Chip label={enumLabel(p.role)} tone={ROLE_TONE[p.role]} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {p.provider_id ? shortId(p.provider_id) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(p.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <select
                      value={p.role}
                      aria-label={`Role for ${p.name || shortId(p.id)}`}
                      disabled={busyId === p.id || p.id === me?.id}
                      title={
                        p.id === me?.id
                          ? "You can't change your own role — ask another operator."
                          : undefined
                      }
                      onChange={(e) => {
                        const next = e.target.value as Role;
                        if (next === "ops") setPendingOps(p.id);
                        else setRole(p, next);
                      }}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-60"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {enumLabel(r)}
                        </option>
                      ))}
                    </select>

                    {pendingOps === p.id && (
                      <div className="mt-2 w-64 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs whitespace-normal text-amber-900">
                        <p>
                          Give {p.name || shortId(p.id)} operator access? They&apos;ll see every
                          incident and be able to change roles, including yours.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setRole(p, "ops")}
                            className="rounded bg-amber-900 px-2 py-1 font-medium text-amber-50"
                          >
                            Grant operator
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingOps(null)}
                            className="rounded border border-amber-300 px-2 py-1 font-medium"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {rowError[p.id] && (
                      <p className="mt-2 text-xs text-red-700">{rowError[p.id]}</p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function ProvidersTab({
  providers,
  error,
  reload,
  profiles,
}: {
  providers: ProviderRecord[] | null;
  error: string | null;
  reload: () => void;
  profiles: AdminProfile[] | null;
}) {
  if (error) {
    return <ErrorCard title="Couldn't load providers" message={error} onRetry={reload} />;
  }
  if (!providers) return <TableSkeleton rows={3} />;
  if (providers.length === 0) {
    return (
      <EmptyCard
        title="No providers registered"
        body="Providers register from the mobile app. Once one signs up, its availability, trust score and location show up here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {providers.length} provider{providers.length === 1 ? "" : "s"} · read-only
      </p>

      {providers.map((p) => {
        const [label, tone] = PROVIDER_STATUS[p.status] ?? [
          enumLabel(p.status),
          "bg-muted text-muted-foreground",
        ];
        const linked = (profiles ?? []).filter((u) => u.provider_id === p.id);

        return (
          <div key={p.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-lg font-semibold tracking-tight">{p.name}</h3>
              <Chip label={label} tone={tone} />
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {shortId(p.id)}
              </span>
            </div>

            <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Type</dt>
                <dd>{enumLabel(p.type)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Trust</dt>
                <dd>
                  {(p.trustScore * 100).toFixed(0)}%
                  {p.averageRating != null ? ` · ${p.averageRating.toFixed(1)}★` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Jobs</dt>
                <dd>
                  {p.successfulJobs}/{p.totalJobs} completed
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Location
                </dt>
                <dd>
                  {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">Contact</dt>
                <dd>
                  {p.phone ? (
                    <a className="text-primary hover:underline" href={`tel:${p.phone}`}>
                      {p.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                  {p.vehiclePlate ? ` · ${p.vehiclePlate}` : ""}
                </dd>
              </div>
              <div className="lg:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Linked account
                </dt>
                <dd>
                  {linked.length === 0
                    ? "No profile points at this provider"
                    : linked
                        .map((u) => `${u.name || "Unnamed"} (${shortId(u.id)})`)
                        .join(", ")}
                </dd>
              </div>
            </dl>

            {p.capabilities.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {p.capabilities.map((c) => (
                  <span key={c} className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                    {enumLabel(c)}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AdminConsole() {
  const [tab, setTab] = useState<Tab>("Users");

  // Read on mount (not during render) so the prerendered HTML always matches.
  useEffect(() => {
    const sync = () => {
      const want = window.location.hash.replace("#", "").toLowerCase();
      setTab(TAB_LABELS.find((t) => t.toLowerCase() === want) ?? "Users");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const [profiles, setProfiles] = useState<AdminProfile[] | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderRecord[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);

  // Both tabs load at mount: the Providers tab joins against the profiles rows
  // to show which account each provider belongs to.
  const loadProfiles = useCallback(() => {
    setProfilesError(null);
    supabase
      .from("profiles")
      .select("id,name,phone,role,provider_id,created_at")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setProfilesError(error.message);
        else setProfiles((data ?? []) as AdminProfile[]);
      });
  }, []);

  const loadProviders = useCallback(() => {
    setProvidersError(null);
    listProviders().then(
      (page) => setProviders(page.providers),
      (err: unknown) => setProvidersError(err instanceof Error ? err.message : String(err))
    );
  }, []);

  useEffect(loadProfiles, [loadProfiles]);
  useEffect(loadProviders, [loadProviders]);

  return (
    <PortalShell title="Administration" tabs={TABS} active={tab}>
      {tab === "Users" ? (
        <UsersTab
          profiles={profiles}
          error={profilesError}
          reload={loadProfiles}
          onRoleChanged={setProfiles}
        />
      ) : tab === "Providers" ? (
        <ProvidersTab
          providers={providers}
          error={providersError}
          reload={loadProviders}
          profiles={profiles}
        />
      ) : tab === "Parts" ? (
        <PartsTab />
      ) : (
        <GaragesTab />
      )}
    </PortalShell>
  );
}
