"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authHeaders, API_BASE } from "@/lib/insurer/api";
import { useT } from "@/lib/i18n";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  company_id: string | null;
  company_name: string | null;
  is_active: boolean;
};

type Company = { id: string; name: string };

const ROLES = ["admin", "agent", "staff"] as const;

const ROLE_KEYS: Record<string, string> = {
  admin: "insurer.role.admin",
  agent: "insurer.role.agent",
  staff: "insurer.role.staff",
};

const ROLE_TONE: Record<string, string> = {
  admin: "bg-primary/15 text-primary border border-primary/30",
  agent: "bg-blue-100 text-blue-800 border border-blue-200",
  staff: "bg-muted text-muted-foreground border border-border",
};

export function UsersTab() {
  const t = useT();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "staff",
    company_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const jsonHeaders = { ...authHeaders(), "Content-Type": "application/json" };

  async function load() {
    setLoadError(null);
    try {
      const hdrs = authHeaders();
      const [uRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/admin/users`, { headers: hdrs }),
        fetch(`${API_BASE}/admin/companies`, { headers: hdrs }),
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      else throw new Error(`HTTP ${uRes.status}`);
      if (cRes.ok) setCompanies(await cRes.json());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("insurer.users.loadErrorFallback"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const body = { ...form, company_id: form.company_id || null };
      const res = await fetch(`${API_BASE}/admin/users`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? t("insurer.users.createErrorFallback"));
      }
      await load();
      setShowModal(false);
      setForm({ email: "", name: "", password: "", role: "staff", company_id: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("insurer.users.genericError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    await fetch(`${API_BASE}/admin/users/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    await load();
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p className="font-medium">{t("insurer.users.loadErrorTitle")}</p>
        <p className="mt-1">{loadError}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
        >
          {t("insurer.action.retry")}
        </button>
      </div>
    );
  }

  if (!users) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight">{t("insurer.users.heading")}</h2>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("insurer.users.add")}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("insurer.users.colName")}</TableHead>
                <TableHead>{t("insurer.users.colEmail")}</TableHead>
                <TableHead>{t("insurer.users.colRole")}</TableHead>
                <TableHead>{t("insurer.users.colCompany")}</TableHead>
                <TableHead>{t("insurer.users.colStatus")}</TableHead>
                <TableHead>{t("insurer.users.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    {t("insurer.users.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          ROLE_TONE[u.role] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {u.role}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.company_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {u.is_active ? t("insurer.status.active") : t("insurer.status.inactive")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => void handleToggle(u.id)}
                        className="rounded-md border border-input px-3 py-1 text-xs font-medium hover:bg-accent transition-colors"
                      >
                        {u.is_active ? t("insurer.action.deactivate") : t("insurer.action.activate")}
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowModal(false)}
        >
          <div
            className="w-[min(480px,94vw)] rounded-xl border border-border bg-card shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">{t("insurer.users.modalTitle")}</h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.users.fieldName")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Silva"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.users.fieldEmail")}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@company.lk"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.users.fieldPassword")}</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.users.fieldRole")}</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(ROLE_KEYS[r])}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.users.fieldCompany")}</label>
                <select
                  value={form.company_id}
                  onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t("insurer.users.companyNone")}</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-border">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-md border border-input px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                {t("insurer.action.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !form.email || !form.name || !form.password}
                className="rounded-md px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? t("insurer.action.saving") : t("insurer.users.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
