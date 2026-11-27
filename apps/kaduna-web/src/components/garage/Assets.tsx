"use client";

/**
 * Tools & equipment: lifts, scanners, jacks, compressors and hand tools. Where
 * each lives, who has it out, its condition and when it is next due a service,
 * with a history of everything that happened to it.
 */
import { useState } from "react";
import { AlertTriangle, CalendarClock, HardHat, MapPin, Plus, Search, Wrench } from "lucide-react";

import {
  checkInAsset,
  checkOutAsset,
  createAsset,
  getAssetLog,
  listAssets,
  listStaff,
  serviceAsset,
  updateAsset,
  type Asset,
  type AssetCondition,
  type Garage,
} from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import {
  Badge,
  Card,
  Chip,
  Empty,
  ErrorNote,
  Field,
  Kpi,
  Loading,
  Panel,
  Spinner,
  btnDanger,
  btnPrimary,
  btnSecondary,
  btnSm,
  inputCls,
  num,
  text,
  useAction,
  useDebounced,
  useLoad,
  useMoney,
  type Tone,
} from "./ui";
import { LocationSelect, LocationsPanel, prettyDay, useLocations } from "./stockShared";

const CONDITIONS: AssetCondition[] = ["GOOD", "FAIR", "NEEDS_REPAIR", "RETIRED"];
const CONDITION_TONE: Record<AssetCondition, Tone> = { GOOD: "ok", FAIR: "info", NEEDS_REPAIR: "bad", RETIRED: "gray" };
const SERVICE_TONE: Record<string, Tone> = { OK: "ok", SOON: "warn", OVERDUE: "bad" };
type Filter = "all" | "available" | "out" | "due" | "attention";

export default function Assets({ garage }: { garage: Garage }) {
  const t = useT();
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [placing, setPlacing] = useState(false);

  const list = useLoad(
    () => listAssets({ q: search || undefined, status: filter === "all" ? undefined : filter, category: category || undefined }),
    [search, filter, category]
  );
  // KPIs and the category list describe the whole register, not the filtered view.
  const all = useLoad(() => listAssets({}), [list.data]);
  const items = all.data ?? [];
  const categories = [...new Set(items.map((a) => a.category).filter((c): c is string => !!c))].sort();
  const out = items.filter((a) => a.heldById).length;
  const due = items.filter((a) => a.serviceState === "SOON" || a.serviceState === "OVERDUE").length;
  const repair = items.filter((a) => a.condition === "NEEDS_REPAIR").length;
  const open = list.data?.find((a) => a.id === openId) ?? all.data?.find((a) => a.id === openId) ?? null;

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: t("garage.asset.f.all") },
    { id: "available", label: t("garage.asset.f.available") },
    { id: "out", label: t("garage.asset.f.out") },
    { id: "due", label: t("garage.asset.f.due") },
    { id: "attention", label: t("garage.asset.f.attention") },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="brand" icon={Wrench} value={items.length} label={t("garage.asset.kpiTotal")} delta={t("garage.asset.kpiTotalSub")} />
        <Kpi tone="info" icon={HardHat} value={out} label={t("garage.asset.kpiOut")} delta={t("garage.asset.kpiOutSub")} />
        <Kpi tone="warn" icon={CalendarClock} value={due} label={t("garage.asset.kpiDue")} delta={t("garage.asset.kpiDueSub")} />
        <Kpi tone="bad" icon={AlertTriangle} value={repair} label={t("garage.asset.kpiRepair")} delta={t("garage.asset.kpiRepairSub")} />
      </div>

      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">{t("garage.action.search")}</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("garage.asset.search")} className={`${inputCls} py-2 pl-10`} />
          </label>
          {filters.map((f) => (
            <Chip key={f.id} on={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </Chip>
          ))}
          {categories.length > 0 && (
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("garage.asset.category")} className={`${inputCls} w-auto! py-1.5 text-[13px]`}>
              <option value="">{t("garage.asset.allCategories")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <button type="button" onClick={() => setPlacing(true)} className={`${btnSecondary} ${btnSm}`}>
            <MapPin /> {t("garage.stk.locations")}
          </button>
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            <Plus /> {t("garage.asset.new")}
          </button>
        </div>

        {list.error ? (
          <ErrorNote message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading className="p-4!" />
        ) : list.data.length === 0 ? (
          <Empty
            title={search || filter !== "all" || category ? t("garage.asset.noMatch") : t("garage.asset.emptyTitle")}
            body={search || filter !== "all" || category ? undefined : t("garage.asset.emptyBody")}
          />
        ) : (
          <div className="overflow-x-auto">
            <AssetTable assets={list.data} onOpen={setOpenId} />
          </div>
        )}
      </Card>

      <NewAsset
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(a) => {
          setCreating(false);
          list.reload();
          setOpenId(a.id);
        }}
      />
      <AssetPanel asset={open} garage={garage} onClose={() => setOpenId(null)} onChanged={list.reload} />
      <LocationsPanel open={placing} onClose={() => setPlacing(false)} onChanged={list.reload} />
    </div>
  );
}

function AssetTable({ assets, onOpen }: { assets: Asset[]; onOpen: (id: string) => void }) {
  const t = useT();
  const { formatDate } = useI18n();
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th className="pb-3 pr-3 font-medium">{t("garage.asset.name")}</th>
          <th className="hidden pb-3 pr-3 font-medium md:table-cell">{t("garage.asset.location")}</th>
          <th className="pb-3 pr-3 font-medium">{t("garage.asset.condition")}</th>
          <th className="hidden pb-3 pr-3 font-medium sm:table-cell">{t("garage.asset.with")}</th>
          <th className="pb-3 text-right font-medium">{t("garage.asset.nextService")}</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a) => (
          <tr key={a.id} onClick={() => onOpen(a.id)} className={`cursor-pointer border-t border-border hover:bg-canvas/60 ${a.active ? "" : "opacity-50"}`}>
            <td className="py-3 pr-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-muted-foreground">
                  <Wrench className="size-4" />
                </span>
                <div className="min-w-0">
                  <button type="button" className="font-medium hover:underline" onClick={() => onOpen(a.id)}>
                    {a.name}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {[a.tag, a.category, a.serialNo].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>
            </td>
            <td className="hidden py-3 pr-3 text-muted-foreground md:table-cell">{a.locationName ?? "—"}</td>
            <td className="py-3 pr-3">
              <Badge tone={CONDITION_TONE[a.condition]}>{t(`garage.asset.cond.${a.condition}`)}</Badge>
            </td>
            <td className="hidden py-3 pr-3 sm:table-cell">
              {a.heldByName ? <Badge tone="info">{a.heldByName}</Badge> : <span className="text-muted-foreground">{t("garage.asset.inWorkshop")}</span>}
            </td>
            <td className="py-3 text-right">
              {a.nextServiceDue ? (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="tabular-nums">{prettyDay(formatDate, a.nextServiceDue)}</span>
                  {a.serviceState && a.serviceState !== "OK" && <Badge tone={SERVICE_TONE[a.serviceState]}>{a.serviceState === "OVERDUE" ? t("garage.asset.overdue", { n: Math.abs(a.dueInDays ?? 0) }) : t("garage.asset.dueIn", { n: a.dueInDays ?? 0 })}</Badge>}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AssetFields({ asset }: { asset?: Asset }) {
  const t = useT();
  const locations = useLocations();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("garage.asset.name")} className="col-span-2">
          <input name="name" required maxLength={160} defaultValue={asset?.name} placeholder={t("garage.asset.namePlaceholder")} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.tag")} hint={t("garage.asset.tagHint")}>
          <input name="tag" maxLength={40} defaultValue={asset?.tag ?? ""} placeholder="AST-001" className={`${inputCls} font-mono uppercase`} />
        </Field>
        <Field label={t("garage.asset.category")}>
          <input name="category" maxLength={80} defaultValue={asset?.category ?? ""} placeholder={t("garage.asset.categoryPlaceholder")} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.serial")}>
          <input name="serialNo" maxLength={80} defaultValue={asset?.serialNo ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.location")}>
          <LocationSelect locations={locations.data ?? []} defaultValue={asset?.locationId} />
        </Field>
        <Field label={t("garage.asset.purchaseDate")}>
          <input name="purchaseDate" type="date" defaultValue={asset?.purchaseDate ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.cost")}>
          <input name="cost" type="number" min={0} step="0.01" defaultValue={asset?.cost ?? 0} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.interval")} hint={t("garage.asset.intervalHint")}>
          <input name="serviceIntervalDays" type="number" min={1} max={3650} step={1} defaultValue={asset?.serviceIntervalDays ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.nextService")}>
          <input name="nextServiceDue" type="date" defaultValue={asset?.nextServiceDue ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.warranty")} className="col-span-2 sm:col-span-1">
          <input name="warrantyUntil" type="date" defaultValue={asset?.warrantyUntil ?? ""} className={inputCls} />
        </Field>
        <Field label={t("garage.asset.condition")} className="col-span-2 sm:col-span-1">
          <select name="condition" defaultValue={asset?.condition ?? "GOOD"} className={inputCls}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`garage.asset.cond.${c}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("garage.field.note")}>
        <textarea name="note" maxLength={1000} rows={2} defaultValue={asset?.note ?? ""} className={inputCls} />
      </Field>
    </>
  );
}

function readAsset(f: FormData) {
  return {
    name: text(f.get("name")) ?? "",
    tag: text(f.get("tag")),
    category: text(f.get("category")),
    serialNo: text(f.get("serialNo")),
    purchaseDate: text(f.get("purchaseDate")),
    cost: num(f.get("cost")) ?? 0,
    locationId: text(f.get("locationId")),
    condition: (text(f.get("condition")) ?? "GOOD") as AssetCondition,
    serviceIntervalDays: num(f.get("serviceIntervalDays")),
    nextServiceDue: text(f.get("nextServiceDue")),
    warrantyUntil: text(f.get("warrantyUntil")),
    note: text(f.get("note")),
  };
}

function NewAsset({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (a: Asset) => void }) {
  const t = useT();
  const action = useAction();
  return (
    <Panel open={open} onClose={onClose} title={t("garage.asset.new")} description={t("garage.asset.newBody")}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const a = await action.run("save", () => createAsset(readAsset(new FormData(e.currentTarget))));
          if (a) onCreated(a);
        }}
      >
        <Card className="space-y-3 p-5">
          <AssetFields />
        </Card>
        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
          {action.busy && <Spinner />} {t("garage.action.save")}
        </button>
      </form>
    </Panel>
  );
}

function AssetPanel({ asset, garage, onClose, onChanged }: { asset: Asset | null; garage: Garage; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const [mode, setMode] = useState<"out" | "in" | "service" | "edit" | null>(null);
  const log = useLoad(() => (asset ? getAssetLog(asset.id) : Promise.resolve(null)), [asset?.id, asset?.condition, asset?.heldById, asset?.nextServiceDue]);
  const staff = useLoad(() => (asset && mode === "out" ? listStaff() : Promise.resolve(null)), [asset?.id, mode]);

  async function done<T>(key: string, fn: () => Promise<T>) {
    const result = await action.run(key, fn);
    if (result) {
      setMode(null);
      onChanged();
    }
  }

  const unusable = asset ? !asset.active || asset.condition === "RETIRED" || asset.condition === "NEEDS_REPAIR" : false;

  return (
    <Panel
      open={asset !== null}
      onClose={() => {
        setMode(null);
        action.setError(null);
        onClose();
      }}
      title={asset?.name ?? ""}
      description={
        asset ? (
          <>
            {asset.tag && <span className="font-mono">{asset.tag}</span>}
            <Badge tone={CONDITION_TONE[asset.condition]}>{t(`garage.asset.cond.${asset.condition}`)}</Badge>
            {!asset.active && <Badge tone="gray">{t("garage.parts.inactive")}</Badge>}
          </>
        ) : undefined
      }
    >
      {asset && (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("garage.asset.status")}</p>
              <p className="mt-1 font-semibold">{asset.heldByName ? t("garage.asset.withName", { name: asset.heldByName }) : t("garage.asset.inWorkshop")}</p>
              {asset.checkedOutAt && <p className="text-xs text-muted-foreground">{formatDate(asset.checkedOutAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("garage.asset.location")}</p>
              <p className="mt-1 font-semibold">{asset.locationName ?? "—"}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("garage.asset.nextService")}</p>
              <p className={`mt-1 font-semibold ${asset.serviceState === "OVERDUE" ? "text-bad" : ""}`}>{prettyDay(formatDate, asset.nextServiceDue)}</p>
              {asset.serviceIntervalDays && <p className="text-xs text-muted-foreground">{t("garage.asset.everyDays", { n: asset.serviceIntervalDays })}</p>}
            </Card>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              [t("garage.asset.category"), asset.category],
              [t("garage.asset.serial"), asset.serialNo],
              [t("garage.asset.purchaseDate"), asset.purchaseDate ? prettyDay(formatDate, asset.purchaseDate) : null],
              [t("garage.asset.cost"), asset.cost ? money(asset.cost, garage.currency) : null],
              [t("garage.asset.warranty"), asset.warrantyUntil ? prettyDay(formatDate, asset.warrantyUntil) : null],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-3 border-b border-border/60 py-1.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-medium">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {asset.note && <p className="rounded-xl bg-white px-4 py-3 text-sm text-muted-foreground">{asset.note}</p>}
          {asset.condition === "NEEDS_REPAIR" && <p className="rounded-xl bg-bad-soft px-4 py-2.5 text-sm text-bad">{t("garage.asset.repairWarning")}</p>}

          <div className="flex flex-wrap gap-2">
            {asset.heldById ? (
              <button type="button" onClick={() => setMode("in")} className={`${btnPrimary} ${btnSm}`}>
                {t("garage.asset.checkIn")}
              </button>
            ) : (
              <button type="button" disabled={unusable} onClick={() => setMode("out")} className={`${btnPrimary} ${btnSm} disabled:opacity-50`}>
                {t("garage.asset.checkOut")}
              </button>
            )}
            <button type="button" onClick={() => setMode("service")} className={`${btnSecondary} ${btnSm}`}>
              {t("garage.asset.recordService")}
            </button>
            <button type="button" onClick={() => setMode("edit")} className={`${btnSecondary} ${btnSm}`}>
              {t("garage.action.edit")}
            </button>
            <button
              type="button"
              disabled={action.busy !== null || !!asset.heldById}
              onClick={() => done("active", () => updateAsset(asset.id, { active: !asset.active }))}
              className={`${asset.active ? btnDanger : btnSecondary} ${btnSm} ml-auto disabled:opacity-50`}
            >
              {action.busy === "active" && <Spinner />} {asset.active ? t("garage.asset.retire") : t("garage.parts.reactivate")}
            </button>
          </div>

          {mode === "out" && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                done("out", () => checkOutAsset(asset.id, { staffId: text(f.get("staffId")) ?? "", note: text(f.get("note")) }));
              }}
            >
              <p className="text-sm">{t("garage.asset.checkOutBody")}</p>
              {staff.data && staff.data.filter((s) => s.active).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("garage.asset.noMechanics")}</p>
              ) : (
                <>
                  <Field label={t("garage.asset.mechanic")}>
                    <select name="staffId" required defaultValue="" className={inputCls}>
                      <option value="" disabled>
                        {t("garage.asset.pickMechanic")}
                      </option>
                      {(staff.data ?? [])
                        .filter((s) => s.active)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label={t("garage.field.note")}>
                    <input name="note" maxLength={240} placeholder={t("garage.asset.checkOutNote")} className={inputCls} />
                  </Field>
                </>
              )}
              <FormButtons busy={action.busy === "out"} onCancel={() => setMode(null)} />
            </form>
          )}

          {mode === "in" && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                done("in", () => checkInAsset(asset.id, { condition: (text(f.get("condition")) ?? undefined) as AssetCondition | undefined, note: text(f.get("note")) }));
              }}
            >
              <p className="text-sm">{t("garage.asset.checkInBody", { name: asset.heldByName ?? "" })}</p>
              <Field label={t("garage.asset.conditionNow")}>
                <select name="condition" defaultValue={asset.condition} className={inputCls}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {t(`garage.asset.cond.${c}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("garage.field.note")}>
                <input name="note" maxLength={240} className={inputCls} />
              </Field>
              <FormButtons busy={action.busy === "in"} onCancel={() => setMode(null)} />
            </form>
          )}

          {mode === "service" && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                done("service", () => serviceAsset(asset.id, { note: text(f.get("note")), nextServiceDue: text(f.get("nextServiceDue")), condition: (text(f.get("condition")) ?? undefined) as AssetCondition | undefined }));
              }}
            >
              <p className="text-sm">{t("garage.asset.serviceBody")}</p>
              <Field label={t("garage.asset.whatDone")}>
                <input name="note" maxLength={500} placeholder={t("garage.asset.whatDonePlaceholder")} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("garage.asset.nextService")} hint={asset.serviceIntervalDays ? t("garage.asset.autoNext", { n: asset.serviceIntervalDays }) : undefined}>
                  <input name="nextServiceDue" type="date" className={inputCls} />
                </Field>
                <Field label={t("garage.asset.conditionNow")}>
                  <select name="condition" defaultValue={asset.condition === "NEEDS_REPAIR" ? "GOOD" : asset.condition} className={inputCls}>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {t(`garage.asset.cond.${c}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <FormButtons busy={action.busy === "service"} onCancel={() => setMode(null)} />
            </form>
          )}

          {mode === "edit" && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                done("edit", () => updateAsset(asset.id, readAsset(new FormData(e.currentTarget))));
              }}
            >
              <AssetFields asset={asset} />
              <FormButtons busy={action.busy === "edit"} onCancel={() => setMode(null)} />
            </form>
          )}

          {action.error && <ErrorNote message={action.error} />}

          <Card className="p-5">
            <h3 className="mb-3 font-display text-lg font-semibold">{t("garage.asset.history")}</h3>
            {log.error ? (
              <ErrorNote message={log.error} onRetry={log.reload} />
            ) : !log.data ? (
              <Loading className="p-4!" />
            ) : log.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("garage.asset.noHistory")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {log.data.map((l) => (
                  <li key={l.id} className="flex items-start gap-3 py-2.5">
                    <Badge tone={l.type === "SERVICE" ? "ok" : l.type === "CHECK_OUT" ? "info" : l.type === "CONDITION" ? "warn" : "gray"}>{t(`garage.asset.log.${l.type}`)}</Badge>
                    <span className="min-w-0 flex-1">
                      {l.staffName && <span className="font-medium">{l.staffName}</span>}
                      {l.note && <span className="text-muted-foreground">{l.staffName ? " · " : ""}{l.note}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(l.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </Panel>
  );
}

function FormButtons({ busy, onCancel }: { busy: boolean; onCancel: () => void }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      <button type="submit" disabled={busy} className={`${btnPrimary} ${btnSm}`}>
        {busy && <Spinner />} {t("garage.action.save")}
      </button>
      <button type="button" onClick={onCancel} className={`${btnSecondary} ${btnSm}`}>
        {t("garage.action.cancel")}
      </button>
    </div>
  );
}
