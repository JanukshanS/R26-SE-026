"use client";

import { useState } from "react";
import { Car, ChevronRight, Mail, Phone, Plus, Search, UserPlus } from "lucide-react";

import { createCustomer, createVehicle, getCustomer, listCustomers, listJobCards, updateCustomer, type Customer } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Avatar,
  Card,
  Empty,
  ErrorNote,
  Field,
  JobStatusBadge,
  Loading,
  Panel,
  Spinner,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  num,
  text,
  toneFor,
  useAction,
  useDebounced,
  useLoad,
  vehicleLabel,
  vehicleName,
} from "./ui";

export default function Customers({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const list = useLoad(() => listCustomers(search || undefined, 200), [search]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">{t("garage.action.search")}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("garage.customers.searchPlaceholder")} className={`${inputCls} py-2 pl-10`} />
        </label>
        {list.data && <span className="text-sm text-muted-foreground">{t("garage.customers.count", { n: list.data.total })}</span>}
        <div className="flex-1" />
        <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
          <UserPlus /> {t("garage.customers.new")}
        </button>
      </div>

      {list.error ? (
        <ErrorNote message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <Empty title={search ? t("garage.customers.noMatch") : t("garage.customers.emptyTitle")} body={search ? undefined : t("garage.customers.emptyBody")} />
      ) : (
        <Card className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 pb-3 pt-5 font-medium">{t("garage.col.customer")}</th>
                  <th className="hidden px-3 pb-3 pt-5 font-medium sm:table-cell">{t("garage.field.email")}</th>
                  <th className="hidden px-3 pb-3 pt-5 font-medium md:table-cell">{t("garage.customers.since")}</th>
                  <th className="px-5 pb-3 pt-5" />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((c) => (
                  <tr key={c.id} onClick={() => setOpenId(c.id)} className={`cursor-pointer border-t border-border hover:bg-canvas/60 ${openId === c.id ? "bg-brand-soft/50" : ""}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} tone={toneFor(c.name)} />
                        <div className="min-w-0">
                          <button type="button" onClick={() => setOpenId(c.id)} className="font-medium hover:underline">{c.name}</button>
                          <p className="text-xs text-muted-foreground">{c.phone ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 text-muted-foreground sm:table-cell">{c.email ?? "—"}</td>
                    <td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{formatDate(c.createdAt, { month: "short", year: "numeric" })}</td>
                    <td className="px-5 py-3 text-right text-muted-foreground"><ChevronRight className="ml-auto size-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CustomerForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          list.reload();
          setOpenId(c.id);
        }}
      />
      <CustomerPanel id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} onOpenJob={onOpenJob} />
    </div>
  );
}

function CustomerForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (c: Customer) => void }) {
  const t = useT();
  const action = useAction();
  return (
    <Panel open={open} onClose={onClose} title={t("garage.customers.new")}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const c = await action.run("save", () =>
            createCustomer({ name: text(f.get("name")) ?? "", phone: text(f.get("phone")), email: text(f.get("email")), notes: text(f.get("notes")) })
          );
          if (c) onSaved(c);
        }}
      >
        <Card className="space-y-3 p-5">
          <CustomerFields />
        </Card>
        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
          {action.busy && <Spinner />} {t("garage.action.save")}
        </button>
      </form>
    </Panel>
  );
}

function CustomerFields({ customer }: { customer?: Customer }) {
  const t = useT();
  return (
    <>
      <Field label={t("garage.field.name")}>
        <input name="name" required maxLength={160} defaultValue={customer?.name} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("garage.field.phone")}>
          <input name="phone" type="tel" maxLength={40} defaultValue={customer?.phone ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.field.email")}>
          <input name="email" type="email" maxLength={200} defaultValue={customer?.email ?? ""} className={inputCls} />
        </Field>
      </div>
      <Field label={t("garage.field.notes")}>
        <textarea name="notes" rows={2} maxLength={2000} defaultValue={customer?.notes ?? ""} className={inputCls} />
      </Field>
    </>
  );
}

function CustomerPanel({ id, onClose, onChanged, onOpenJob }: { id: string | null; onClose: () => void; onChanged: () => void; onOpenJob: (id: string) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  const customer = useLoad(() => (id ? getCustomer(id) : Promise.resolve(null)), [id]);
  const jobs = useLoad(() => (id ? listJobCards({ customerId: id, limit: 50 }) : Promise.resolve(null)), [id]);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const c = customer.data && customer.data.id === id ? customer.data : null;
  const history = jobs.data?.items ?? [];

  return (
    <Panel
      open={id !== null}
      onClose={() => {
        setEditing(false);
        setAddingVehicle(false);
        onClose();
      }}
      title={c?.name ?? t("garage.loading")}
      description={c ? t("garage.customers.sinceDate", { date: formatDate(c.createdAt, { month: "short", year: "numeric" }) }) : undefined}
    >
      {customer.error ? (
        <ErrorNote message={customer.error} onRetry={customer.reload} />
      ) : !c ? (
        <Loading />
      ) : (
        <>
          <Card className="p-5">
            {editing ? (
              <form
                className="space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const saved = await action.run("save", () =>
                    updateCustomer(c.id, { name: text(f.get("name")) ?? "", phone: text(f.get("phone")), email: text(f.get("email")), notes: text(f.get("notes")) })
                  );
                  if (saved) {
                    setEditing(false);
                    customer.reload();
                    onChanged();
                  }
                }}
              >
                <CustomerFields customer={c} />
                <div className="flex gap-2">
                  <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
                    {action.busy === "save" && <Spinner />} {t("garage.action.save")}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className={`${btnSecondary} ${btnSm}`}>
                    {t("garage.action.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-start gap-4">
                <Avatar name={c.name} tone={toneFor(c.name)} size="lg" />
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{c.phone ?? "—"}</p>
                  <p className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{c.email ?? "—"}</p>
                  {c.notes && <p className="whitespace-pre-line pt-1 text-muted-foreground">{c.notes}</p>}
                </div>
                <button type="button" onClick={() => setEditing(true)} className={`${btnSecondary} ${btnSm}`}>
                  {t("garage.action.edit")}
                </button>
              </div>
            )}
            <div className="mt-5 grid grid-cols-2 gap-3 text-center">
              <div className="rounded-xl bg-canvas p-3">
                <p className="font-display text-lg font-bold">{history.length}</p>
                <p className="text-[11px] text-muted-foreground">{t("garage.customers.visits")}</p>
              </div>
              <div className="rounded-xl bg-canvas p-3">
                <p className="font-display text-lg font-bold">{c.vehicles.length}</p>
                <p className="text-[11px] text-muted-foreground">{t("garage.customers.vehicles")}</p>
              </div>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{t("garage.customers.vehicles")}</h3>
              {!addingVehicle && (
                <button type="button" onClick={() => setAddingVehicle(true)} className={`${btnSecondary} ${btnSm}`}>
                  <Plus /> {t("garage.customers.addVehicle")}
                </button>
              )}
            </div>
            {c.vehicles.length === 0 && !addingVehicle && <p className="text-sm text-muted-foreground">{t("garage.customers.noVehicles")}</p>}
            <ul className="space-y-2">
              {c.vehicles.map((v) => (
                <li key={v.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-canvas text-muted-foreground"><Car className="size-5" strokeWidth={1.75} /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{vehicleName(v, t("garage.vehicle.unknown"))}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {v.plate ?? "—"}
                      {v.odometerKm != null && ` · ${v.odometerKm.toLocaleString()} km`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            {addingVehicle && (
              <form
                className="space-y-3 rounded-2xl bg-canvas p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const v = await action.run("vehicle", () =>
                    createVehicle({
                      customerId: c.id,
                      plate: text(f.get("plate")),
                      make: text(f.get("make")),
                      model: text(f.get("model")),
                      year: num(f.get("year")),
                      odometerKm: num(f.get("odometerKm")),
                    })
                  );
                  if (v) {
                    setAddingVehicle(false);
                    customer.reload();
                  }
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("garage.field.plate")}>
                    <input name="plate" required maxLength={20} placeholder="CAB-1234" className={`${inputCls} font-mono uppercase`} />
                  </Field>
                  <Field label={t("garage.field.odometer")}>
                    <input name="odometerKm" type="number" min={0} className={inputCls} />
                  </Field>
                  <Field label={t("garage.field.make")}>
                    <input name="make" maxLength={60} className={inputCls} />
                  </Field>
                  <Field label={t("garage.field.model")}>
                    <input name="model" maxLength={60} className={inputCls} />
                  </Field>
                  <Field label={t("garage.field.year")}>
                    <input name="year" type="number" min={1950} max={2100} className={inputCls} />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
                    {action.busy === "vehicle" && <Spinner />} {t("garage.customers.addVehicle")}
                  </button>
                  <button type="button" onClick={() => setAddingVehicle(false)} className={`${btnSecondary} ${btnSm}`}>
                    {t("garage.action.cancel")}
                  </button>
                </div>
              </form>
            )}
          </Card>

          {action.error && <ErrorNote message={action.error} />}

          <Card className="space-y-3 p-5">
            <h3 className="font-display text-lg font-semibold">{t("garage.customers.history")}</h3>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("garage.customers.noHistory")}</p>
            ) : (
              <ol className="relative ml-1.5 space-y-4 border-l-2 border-border">
                {history.map((j) => (
                  <li key={j.id} className="relative pl-5">
                    <span className="absolute -left-[7px] top-1.5 size-3 rounded-full bg-primary ring-4 ring-white" />
                    <button type="button" onClick={() => onOpenJob(j.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm hover:opacity-80">
                      <span className="font-medium">#{j.number}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{j.complaint ?? vehicleLabel(j.vehicle, "")}</span>
                      <JobStatusBadge status={j.status} />
                      <span className="text-xs text-muted-foreground">{formatDate(j.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </>
      )}
    </Panel>
  );
}
