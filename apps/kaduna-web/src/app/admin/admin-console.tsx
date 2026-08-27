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
import { CompaniesTab } from "@/components/insurer/admin/CompaniesTab";
import { API_BASE } from "@/lib/insurer/api";

const TAB_LABELS = ["Users", "Providers", "Parts", "Garages", "Insurers"] as const;
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

// ─── Insurer Portal Users ─────────────────────────────────────

type InsurerUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  company_id: string | null;
  company_name: string | null;
  is_active: boolean;
};

type InsurerCompany = { id: string; name: string };

const INSURER_ROLE_LABEL: Record<string, string> = {
  admin: "Ops",
  agent: "Agent",
  staff: "Assessor",
};

const INSURER_ROLE_TONE: Record<string, string> = {
  admin: "bg-primary/15 text-primary",
  agent: "bg-blue-100 text-blue-800",
  staff: "bg-muted text-muted-foreground",
};

const INSURER_ROLES = ["admin", "agent", "staff"] as const;

async function insurerHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function InsurerUsersSection() {
  const [users, setUsers] = useState<InsurerUser[] | null>(null);
  const [companies, setCompanies] = useState<InsurerCompany[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    email: "", name: "", password: "", role: "staff", company_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const hdrs = await insurerHeaders();
      const [uRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/admin/users`, { headers: hdrs }),
        fetch(`${API_BASE}/admin/companies`, { headers: hdrs }),
      ]);
      if (!uRes.ok) throw new Error(`HTTP ${uRes.status}`);
      setUsers(await uRes.json());
      if (cRes.ok) setCompanies(await cRes.json());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load insurer users");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleToggle(id: string) {
    const hdrs = await insurerHeaders();
    await fetch(`${API_BASE}/admin/users/${id}`, { method: "PATCH", headers: hdrs });
    void load();
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    try {
      const hdrs = { ...(await insurerHeaders()), "Content-Type": "application/json" };
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({ ...form, company_id: form.company_id || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error((err as { detail?: string }).detail ?? "Failed to create user");
      }
      await load();
      setShowModal(false);
      setForm({ email: "", name: "", password: "", role: "staff", company_id: "" });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-10 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold tracking-tight">Insurer Portal Users</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Agents and assessors who access the insurer dashboard</p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          + Add User
        </button>
      </div>

      {loadError ? (
        <ErrorCard title="Couldn't load insurer users" message={loadError} onRetry={() => void load()} />
      ) : !users ? (
        <TableSkeleton />
      ) : users.length === 0 ? (
        <EmptyCard title="No insurer users yet" body="Add agents and assessors who will handle claims in the insurer dashboard." />
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={INSURER_ROLE_LABEL[u.role] ?? u.role}
                      tone={INSURER_ROLE_TONE[u.role] ?? "bg-muted text-muted-foreground"}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.company_name ?? "—"}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.is_active ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>
                      {u.is_active ? "Active" : "Inactive"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => void handleToggle(u.id)}
                      className="rounded-md border border-input px-3 py-1 text-xs font-medium hover:bg-accent transition-colors"
                    >
                      {u.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowModal(false)}>
          <div className="w-[min(480px,94vw)] rounded-xl border border-border bg-card shadow-lg flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">Add Insurer Portal User</h3>
              <button type="button" onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-4">
              {(["name", "email", "password"] as const).map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground capitalize">{field === "name" ? "Full Name" : field.charAt(0).toUpperCase() + field.slice(1)}</label>
                  <input
                    type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                    value={form[field]}
                    onChange={(e) => setForm({ ...form, [field]: e.target.value })}
                    placeholder={field === "name" ? "Jane Silva" : field === "email" ? "jane@company.lk" : "••••••••"}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  {INSURER_ROLES.map((r) => (
                    <option key={r} value={r}>{INSURER_ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Company</label>
                <select value={form.company_id} onChange={(e) => setForm({ ...form, company_id: e.target.value })} className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">— None —</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {formError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{formError}</p>}
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button type="button" onClick={() => setShowModal(false)} className="rounded-md border border-input px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
              <button type="button" onClick={() => void handleSave()} disabled={saving || !form.email || !form.name || !form.password} className="rounded-md px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed">
                {saving ? "Saving…" : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const USER_SUB_TABS = ["App Users", "Insurer Portal Users"] as const;
type UserSubTab = (typeof USER_SUB_TABS)[number];

export default function AdminConsole() {
  const [tab, setTab] = useState<Tab>("Users");
  const [userSubTab, setUserSubTab] = useState<UserSubTab>("App Users");

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
        <>
          <nav className="flex gap-1 border-b border-border mb-6">
            {USER_SUB_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setUserSubTab(t)}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
                  userSubTab === t
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
          {userSubTab === "App Users" ? (
            <UsersTab
              profiles={profiles}
              error={profilesError}
              reload={loadProfiles}
              onRoleChanged={setProfiles}
            />
          ) : (
            <InsurerUsersSection />
          )}
        </>
      ) : tab === "Providers" ? (
        <ProvidersTab
          providers={providers}
          error={providersError}
          reload={loadProviders}
          profiles={profiles}
        />
      ) : tab === "Parts" ? (
        <PartsTab />
      ) : tab === "Garages" ? (
        <GaragesTab />
      ) : (
        <CompaniesTab />
      )}
    </PortalShell>
  );
}
