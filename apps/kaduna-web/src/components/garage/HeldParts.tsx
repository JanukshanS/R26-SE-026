"use client";

/**
 * Customers' own parts the garage is holding: a battery or brake pads they
 * brought in to be fitted, or parts set aside for a job. They are kept apart
 * from the garage's own stock, so they are never counted, priced or sold.
 */
import { useState } from "react";
import { CheckCheck, PackageOpen, Plus, Undo2, UserRound } from "lucide-react";

import {
  createHeldPart,
  listCustomers,
  listHeldParts,
  listJobCards,
  listVehicles,
  updateHeldPart,
  type HeldPart,
  type HeldStatus,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { Badge, Card, Chip, Empty, ErrorNote, Field, Loading, Panel, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, num, text, useAction, useLoad, vehicleLabel } from "./ui";
import { LocationSelect, useLocations } from "./stockShared";

type Filter = "open" | "FITTED" | "RETURNED";

export default function HeldParts() {
  const t = useT();
  const { formatDate } = useI18n();
  const action = useAction();
  const [filter, setFilter] = useState<Filter>("open");
  const [creating, setCreating] = useState(false);
  const list = useLoad(() => listHeldParts(filter), [filter]);

  async function close(h: HeldPart, status: HeldStatus) {
    const done = await action.run(h.id, () => updateHeldPart(h.id, { status }));
    if (done) list.reload();
  }

  return (
    <div className="space-y-6">
      <p className="max-w-2xl rounded-xl bg-white px-4 py-3 text-sm text-muted-foreground">{t("garage.held.explain")}</p>
      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {(["open", "FITTED", "RETURNED"] as Filter[]).map((f) => (
            <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
              {t(`garage.held.f.${f}`)}
            </Chip>
          ))}
          <div className="flex-1" />
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            <Plus /> {t("garage.held.new")}
          </button>
        </div>
        {action.error && <div className="mb-4"><ErrorNote message={action.error} /></div>}
        {list.error ? (
          <ErrorNote message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading className="p-4!" />
        ) : list.data.length === 0 ? (
          <Empty title={filter === "open" ? t("garage.held.emptyTitle") : t("garage.held.noneClosed")} body={filter === "open" ? t("garage.held.emptyBody") : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {list.data.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-canvas text-muted-foreground">
                  <PackageOpen className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {h.name} {h.quantity !== 1 && <span className="text-muted-foreground">× {h.quantity}</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {h.customerName && (
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3" /> {h.customerName}
                      </span>
                    )}
                    {h.vehicleLabel && <span>{h.vehicleLabel}</span>}
                    {h.jobNumber != null && <span>{t("garage.held.job", { n: h.jobNumber })}</span>}
                    {h.locationName && <span>{h.locationName}</span>}
                    <span>{t("garage.held.since", { date: formatDate(h.receivedAt, { day: "numeric", month: "short" }) })}</span>
                  </p>
                  {h.note && <p className="mt-0.5 text-xs text-muted-foreground">{h.note}</p>}
                </div>
                {h.status === "HELD" ? (
                  <div className="flex gap-2">
                    <button type="button" disabled={action.busy !== null} onClick={() => close(h, "FITTED")} className={`${btnPrimary} ${btnSm}`}>
                      {action.busy === h.id ? <Spinner /> : <CheckCheck />} {t("garage.held.markFitted")}
                    </button>
                    <button type="button" disabled={action.busy !== null} onClick={() => close(h, "RETURNED")} className={`${btnSecondary} ${btnSm}`}>
                      <Undo2 /> {t("garage.held.markReturned")}
                    </button>
                  </div>
                ) : (
                  <Badge tone={h.status === "FITTED" ? "ok" : "gray"}>{t(`garage.held.status.${h.status}`)}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NewHeld
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          setFilter("open");
          list.reload();
        }}
      />
    </div>
  );
}

function NewHeld({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const action = useAction();
  const locations = useLocations(open);
  const [customerId, setCustomerId] = useState("");
  const customers = useLoad(() => (open ? listCustomers(undefined, 100) : Promise.resolve(null)), [open]);
  const vehicles = useLoad(() => (open && customerId ? listVehicles({ customerId, limit: 50 }) : Promise.resolve(null)), [open, customerId]);
  const jobs = useLoad(() => (open ? listJobCards({ active: true, limit: 100 }) : Promise.resolve(null)), [open]);
  const openJobs = (jobs.data?.items ?? []).filter((j) => !customerId || j.customer?.id === customerId);

  return (
    <Panel open={open} onClose={onClose} title={t("garage.held.new")} description={t("garage.held.newBody")}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const h = await action.run("save", () =>
            createHeldPart({
              name: text(f.get("name")) ?? "",
              quantity: num(f.get("quantity")) ?? 1,
              customerId: customerId || null,
              vehicleId: text(f.get("vehicleId")),
              jobCardId: text(f.get("jobCardId")),
              locationId: text(f.get("locationId")),
              note: text(f.get("note")),
            })
          );
          if (h) onCreated();
        }}
      >
        <Card className="space-y-3 p-5">
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("garage.held.partName")} className="col-span-2">
              <input name="name" required maxLength={160} placeholder={t("garage.held.partPlaceholder")} className={inputCls} />
            </Field>
            <Field label={t("garage.po.qty")}>
              <input name="quantity" type="number" min={0.01} step="any" defaultValue={1} className={inputCls} />
            </Field>
          </div>
          <Field label={t("garage.held.customer")}>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={inputCls}>
              <option value="">{t("garage.held.anyone")}</option>
              {(customers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </select>
          </Field>
          {customerId && (
            <Field label={t("garage.held.vehicle")}>
              <select name="vehicleId" defaultValue="" key={customerId} className={inputCls}>
                <option value="">{t("garage.held.noVehicle")}</option>
                {(vehicles.data?.items ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {vehicleLabel(v, "—")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t("garage.held.forJob")}>
            <select name="jobCardId" defaultValue="" key={customerId} className={inputCls}>
              <option value="">{t("garage.held.noJob")}</option>
              {openJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  #{j.number} · {j.customer?.name ?? "—"} · {vehicleLabel(j.vehicle, "—")}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("garage.asset.location")}>
            <LocationSelect locations={locations.data ?? []} />
          </Field>
          <Field label={t("garage.field.note")}>
            <input name="note" maxLength={500} placeholder={t("garage.held.notePlaceholder")} className={inputCls} />
          </Field>
        </Card>
        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
          {action.busy && <Spinner />} {t("garage.action.save")}
        </button>
      </form>
    </Panel>
  );
}
