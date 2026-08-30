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

type Company = {
  id: string;
  name: string;
  app_name: string;
  phone_tel: string | null;
  contact_email: string | null;
  is_active: boolean;
};

type FormState = {
  name: string;
  app_name: string;
  phone_tel: string;
  contact_email: string;
};

const EMPTY_FORM: FormState = { name: "", app_name: "", phone_tel: "", contact_email: "" };

export function CompaniesTab() {
  const t = useT();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const jsonHeaders = { ...authHeaders(), "Content-Type": "application/json" };

  async function load() {
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/admin/companies`, { headers: authHeaders() });
      if (res.ok) setCompanies(await res.json());
      else throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("insurer.companies.loadErrorFallback"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openAdd() {
    setEditingCompany(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowModal(true);
  }

  function openEdit(c: Company) {
    setEditingCompany(c);
    setForm({
      name: c.name,
      app_name: c.app_name,
      phone_tel: c.phone_tel ?? "",
      contact_email: c.contact_email ?? "",
    });
    setError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingCompany(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const method = editingCompany ? "PUT" : "POST";
      const url = editingCompany
        ? `${API_BASE}/admin/companies/${editingCompany.id}`
        : `${API_BASE}/admin/companies`;
      const phone = form.phone_tel
        ? form.phone_tel.startsWith("tel:")
          ? form.phone_tel
          : `tel:${form.phone_tel}`
        : "";
      const res = await fetch(url, {
        method,
        headers: jsonHeaders,
        body: JSON.stringify({ ...form, phone_tel: phone || null }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? t("insurer.companies.saveFailedFallback"));
      }
      await load();
      closeModal();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("insurer.companies.genericError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    await fetch(`${API_BASE}/admin/companies/${id}`, {
      method: "PATCH",
      headers: authHeaders(),
    });
    await load();
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p className="font-medium">{t("insurer.companies.loadErrorTitle")}</p>
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

  if (!companies) {
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
          <h2 className="font-display text-lg font-semibold tracking-tight">
            {t("insurer.companies.heading")}
          </h2>
          <button
            type="button"
            onClick={openAdd}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {t("insurer.companies.add")}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("insurer.companies.colName")}</TableHead>
                <TableHead>{t("insurer.companies.colAppName")}</TableHead>
                <TableHead>{t("insurer.companies.colPhone")}</TableHead>
                <TableHead>{t("insurer.companies.colEmail")}</TableHead>
                <TableHead>{t("insurer.companies.colStatus")}</TableHead>
                <TableHead>{t("insurer.companies.colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    {t("insurer.companies.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.app_name || "—"}</TableCell>
                    <TableCell>{c.phone_tel ?? "—"}</TableCell>
                    <TableCell>{c.contact_email ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          c.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {c.is_active ? t("insurer.status.active") : t("insurer.status.inactive")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          className="rounded-md border border-input px-3 py-1 text-xs font-medium hover:bg-accent transition-colors"
                        >
                          {t("insurer.action.edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggle(c.id)}
                          className="rounded-md border border-input px-3 py-1 text-xs font-medium hover:bg-accent transition-colors"
                        >
                          {c.is_active ? t("insurer.action.deactivate") : t("insurer.action.activate")}
                        </button>
                      </div>
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
          onClick={closeModal}
        >
          <div
            className="w-[min(480px,94vw)] rounded-xl border border-border bg-card shadow-lg flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold">
                {editingCompany
                  ? t("insurer.companies.editTitle")
                  : t("insurer.companies.addTitle")}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.companies.fieldName")}</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Allianz Insurance Lanka Ltd"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("insurer.companies.fieldAppName")}{" "}
                  <span className="font-normal">{t("insurer.companies.fieldAppNameHint")}</span>
                </label>
                <input
                  value={form.app_name}
                  onChange={(e) => setForm({ ...form, app_name: e.target.value })}
                  placeholder="Allianz Insurance"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.companies.fieldPhone")}</label>
                <input
                  value={form.phone_tel}
                  onChange={(e) => setForm({ ...form, phone_tel: e.target.value })}
                  placeholder="tel:+94112303300"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("insurer.companies.fieldEmail")}</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  placeholder="admin@company.lk"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
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
                onClick={closeModal}
                className="rounded-md border border-input px-4 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                {t("insurer.action.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !form.name || !form.app_name}
                className="rounded-md px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving
                  ? t("insurer.action.saving")
                  : editingCompany
                    ? t("insurer.companies.saveChanges")
                    : t("insurer.companies.create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
