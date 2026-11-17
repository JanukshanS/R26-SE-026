"use client";

import { useState } from "react";
import { CalendarCheck, ClipboardList, Plus, Receipt, Wallet, Warehouse } from "lucide-react";

import { Badge, Card, Chip, Empty, ErrorNote, Field, Kpi, Loading, Panel, Segmented, Spinner, btnPrimary, inputCls, useAction, useLoad } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { COMPONENTS, RESETS_WEAR, SERVICE_TYPES, getServiceHistory, logService, type ServiceComponent, type ServiceRecord, type ServiceType } from "@/lib/maintenanceApi";

import { VehicleSwitch, type DriverData } from "./shared";

const PARTS: ServiceComponent[] = [...COMPONENTS, "full_service"];
const NO_ITEM: ServiceType[] = ["full_service", "inspection"];

export default function Services({ data, logOpen, onLogOpen }: { data: DriverData; logOpen: boolean; onLogOpen: (open: boolean) => void }) {
  const t = useT();
  const { formatDate, formatCurrency } = useI18n();
  const v = data.selected;
  const plate = v?.plateNumber ?? "";
  const history = useLoad(() => (plate ? getServiceHistory(plate) : Promise.resolve([] as ServiceRecord[])), [plate]);
  const [filter, setFilter] = useState<ServiceComponent | "all">("all");

  if (data.vehicles.error) return <ErrorNote message={data.vehicles.error} onRetry={data.vehicles.reload} />;
  if (!data.vehicles.data) return <Loading />;
  if (!v) return <Empty title={t("me.vehicles.emptyTitle")} body={t("me.vehicles.emptyBody")} />;

  const records = history.data ?? [];
  const shown = filter === "all" ? records : records.filter((r) => r.component === filter);
  const spent = records.reduce((a, r) => a + (r.cost_lkr ?? 0), 0);
  const last = [...records].sort((a, b) => b.service_date.localeCompare(a.service_date))[0];

  return (
    <div className="space-y-6">
      <VehicleSwitch vehicles={data.vehicles.data} value={v} onChange={data.select} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi tone="brand" icon={ClipboardList} value={history.data ? records.length : "–"} label={t("me.services.kpiRecords")} />
        <Kpi tone="ok" icon={Wallet} value={history.data ? formatCurrency(spent) : "–"} label={t("me.services.kpiSpent")} />
        <div className="col-span-2 lg:col-span-1">
          <Kpi tone="info" icon={CalendarCheck} value={last ? formatDate(last.service_date) : "–"} label={t("me.services.kpiLast")} delta={last ? t(`me.serviceType.${last.service_type}`) : undefined} />
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">{t("me.services.history")}</h2>
            <p className="text-xs text-muted-foreground">{t("me.services.historySub")}</p>
          </div>
          <button type="button" onClick={() => onLogOpen(true)} className={btnPrimary}>
            <Plus /> {t("me.services.log")}
          </button>
        </div>
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
          <Chip on={filter === "all"} onClick={() => setFilter("all")}>
            {t("me.services.all")}
          </Chip>
          {PARTS.map((p) => (
            <Chip key={p} on={filter === p} onClick={() => setFilter(p)}>
              {t(`me.part.${p}`)}
            </Chip>
          ))}
        </div>

        {history.error ? (
          <ErrorNote message={t("me.health.offline")} onRetry={history.reload} />
        ) : !history.data ? (
          <Loading className="p-6!" />
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{records.length === 0 ? t("me.services.empty") : t("me.services.emptyFilter")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((r) => (
              <li key={r.id} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                <div className="w-14 shrink-0 rounded-xl bg-canvas py-2 text-center">
                  <p className="font-display text-lg font-bold leading-5">{formatDate(r.service_date, { day: "numeric" })}</p>
                  <p className="text-[11px] font-medium uppercase text-muted-foreground">{formatDate(r.service_date, { month: "short", year: "2-digit" })}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{r.item_name || t(`me.serviceType.${r.service_type}`)}</p>
                    <Badge tone={RESETS_WEAR[r.service_type as ServiceType] ? "brand" : "gray"} dot={false}>
                      {t(`me.serviceType.${r.service_type}`)}
                    </Badge>
                    <Badge tone="info" dot={false}>
                      {t(`me.part.${r.component}`)}
                    </Badge>
                    {r.is_estimated && <Badge tone="warn">{t("me.services.estimated")}</Badge>}
                  </div>
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {r.garage_name && (
                      <span className="inline-flex items-center gap-1">
                        <Warehouse className="size-3.5" /> {r.garage_name}
                      </span>
                    )}
                    {r.is_original && <span>{t(`me.services.${r.is_original}`)}</span>}
                    {typeof r.odometer_km_at_service === "number" && r.odometer_km_at_service > 0 && <span>{t("me.services.atKm", { km: Math.round(r.odometer_km_at_service).toLocaleString() })}</span>}
                  </p>
                  {r.notes && <p className="mt-1.5 text-sm text-muted-foreground">{r.notes}</p>}
                </div>
                {r.cost_lkr ? (
                  <p className="shrink-0 text-right text-sm font-semibold tabular-nums">
                    <Receipt className="mr-1 inline size-3.5 text-muted-foreground" />
                    {formatCurrency(r.cost_lkr)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Panel open={logOpen} onClose={() => onLogOpen(false)} title={t("me.services.log")} description={t("me.services.logSub", { vehicle: v.plateNumber })}>
        {logOpen && (
          <LogForm
            plate={plate}
            garages={Object.values(data.repairs).map((r) => r.garage.name)}
            onSaved={() => {
              history.reload();
              data.reloadHealth(plate);
              onLogOpen(false);
            }}
          />
        )}
      </Panel>
    </div>
  );
}

function LogForm({ plate, garages, onSaved }: { plate: string; garages: string[]; onSaved: () => void }) {
  const t = useT();
  const action = useAction();
  const [part, setPart] = useState<ServiceComponent>("engine");
  const [type, setType] = useState<ServiceType>("replacement");
  const [original, setOriginal] = useState<"original" | "used" | "">("");
  const today = new Date().toISOString().slice(0, 10);
  const needsItem = !NO_ITEM.includes(type);

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "").trim();
        const cost = Number(s("cost"));
        const saved = await action.run("save", () =>
          logService(plate, {
            component: part,
            service_type: type,
            service_date: new Date(`${s("date") || today}T12:00:00`).toISOString(),
            item_name: s("item") || undefined,
            is_original: original || undefined,
            garage_name: s("garage") || undefined,
            cost_lkr: s("cost") && Number.isFinite(cost) ? cost : undefined,
            notes: s("notes") || undefined,
          })
        );
        if (saved) onSaved();
      }}
    >
      <Card className="space-y-4 p-5">
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("me.services.part")}</p>
          <div className="flex flex-wrap gap-2">
            {PARTS.map((p) => (
              <Chip key={p} on={part === p} onClick={() => setPart(p)}>
                {t(`me.part.${p}`)}
              </Chip>
            ))}
          </div>
        </div>
        <Field label={t("me.services.type")} hint={RESETS_WEAR[type] && part !== "full_service" ? t("me.services.resetsHint", { part: t(`me.part.${part}`) }) : undefined}>
          <select value={type} onChange={(e) => setType(e.target.value as ServiceType)} className={inputCls}>
            {SERVICE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`me.serviceType.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("me.services.date")}>
            <input name="date" type="date" required max={today} defaultValue={today} className={inputCls} />
          </Field>
          <Field label={t("me.services.cost")}>
            <input name="cost" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" className={inputCls} />
          </Field>
        </div>
        <Field label={needsItem ? t("me.services.item") : t("me.services.itemOptional")}>
          <input name="item" required={needsItem} maxLength={120} placeholder={t("me.services.itemPlaceholder")} className={inputCls} />
        </Field>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("me.services.partKind")}</p>
          <Segmented
            value={original}
            onChange={setOriginal}
            options={[
              { value: "", label: t("me.services.notSure") },
              { value: "original", label: t("me.services.original") },
              { value: "used", label: t("me.services.used") },
            ]}
          />
        </div>
        <Field label={t("me.services.garage")}>
          <input name="garage" list="my-garages" maxLength={120} placeholder={t("me.services.garagePlaceholder")} className={inputCls} />
          <datalist id="my-garages">
            {[...new Set(garages)].map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
        <Field label={t("me.services.notes")}>
          <textarea name="notes" rows={3} maxLength={1000} className={inputCls} />
        </Field>
      </Card>
      {action.error && <ErrorNote message={action.error} />}
      <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
        {action.busy === "save" && <Spinner />} {t("me.services.save")}
      </button>
    </form>
  );
}
