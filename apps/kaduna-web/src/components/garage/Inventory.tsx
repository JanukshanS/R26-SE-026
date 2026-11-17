"use client";

import { useState } from "react";
import { AlertTriangle, Boxes, MapPin, Package, Percent, Plus, Search, Tags } from "lucide-react";

import { adjustStock, createPart, listMovements, listParts, listSuppliers, updatePart, type Garage, type Part, type SupplierRow } from "@/lib/garageApi";
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
  Progress,
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
  useShortMoney,
} from "./ui";
import { LocationSelect, LocationsPanel, useLocations } from "./stockShared";

function stockTone(p: Part) {
  return p.stockQty <= 0 ? "bad" : p.lowStock ? (p.reorderLevel && p.stockQty / p.reorderLevel < 0.5 ? "bad" : "warn") : "ok";
}

export default function Inventory({ garage }: { garage: Garage }) {
  const t = useT();
  const money = useMoney();
  const short = useShortMoney();
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [kind, setKind] = useState<"" | "PART" | "CONSUMABLE">("");
  const [locationId, setLocationId] = useState("");
  const [placing, setPlacing] = useState(false);
  const locations = useLocations();
  const parts = useLoad(
    () => listParts({ q: search || undefined, lowStock: lowOnly || undefined, includeInactive: showInactive || undefined, kind: kind || undefined, locationId: locationId || undefined }),
    [search, lowOnly, showInactive, kind, locationId]
  );
  // KPIs always describe the whole active catalogue, not the filtered view.
  const all = useLoad(() => listParts({}), [parts.data]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = parts.data?.items.find((p) => p.id === openId) ?? null;

  const items = all.data?.items ?? [];
  const categories = [...new Set(items.map((p) => p.category).filter((c): c is string => !!c))].sort();
  const value = items.reduce((s, p) => s + Math.max(0, p.stockQty) * p.unitCost, 0);
  const low = items.filter((p) => p.lowStock);
  const out = items.filter((p) => p.stockQty <= 0).length;
  const sell = items.reduce((s, p) => s + p.unitPrice, 0);
  const margin = sell > 0 ? Math.round((items.reduce((s, p) => s + (p.unitPrice - p.unitCost), 0) / sell) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="brand" icon={Package} value={short(value, garage.currency)} label={t("garage.parts.stockValue")} delta={t("garage.parts.skus", { n: items.length })} />
        <Kpi tone="bad" icon={AlertTriangle} value={low.length} label={t("garage.parts.belowReorder")} delta={t("garage.parts.outOfStock", { n: out })} />
        <Kpi tone="info" icon={Boxes} value={items.reduce((s, p) => s + Math.max(0, p.stockQty), 0)} label={t("garage.parts.unitsOnHand")} delta={t("garage.parts.activeOnly")} />
        <Kpi tone="ok" icon={Percent} value={`${margin}%`} label={t("garage.parts.avgMargin")} delta={t("garage.parts.marginHint")} />
      </div>

      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <label className="relative min-w-56 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">{t("garage.action.search")}</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("garage.parts.searchPlaceholder")} className={`${inputCls} py-2 pl-10`} />
          </label>
          <Chip on={lowOnly} onClick={() => setLowOnly((v) => !v)}>
            <span className="size-2 rounded-full bg-bad" />
            {t("garage.parts.lowOnly")}
          </Chip>
          <Chip on={showInactive} onClick={() => setShowInactive((v) => !v)}>{t("garage.parts.showInactive")}</Chip>
          <Chip on={kind === "CONSUMABLE"} onClick={() => setKind((k) => (k === "CONSUMABLE" ? "" : "CONSUMABLE"))}>{t("garage.stk.kindConsumable")}</Chip>
          {(locations.data ?? []).length > 0 && (
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label={t("garage.asset.location")} className={`${inputCls} w-auto! py-1.5 text-[13px]`}>
              <option value="">{t("garage.count.allShelves")}</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <button type="button" onClick={() => setPlacing(true)} className={`${btnSecondary} ${btnSm}`}>
            <MapPin /> {t("garage.stk.locations")}
          </button>
          <button type="button" onClick={() => setCreating(true)} className={btnPrimary}>
            <Plus /> {t("garage.parts.new")}
          </button>
        </div>

        {parts.error ? (
          <ErrorNote message={parts.error} onRetry={parts.reload} />
        ) : !parts.data ? (
          <Loading className="p-4!" />
        ) : parts.data.items.length === 0 ? (
          <Empty title={search || lowOnly || kind || locationId ? t("garage.parts.noMatch") : t("garage.parts.emptyTitle")} body={search || lowOnly || kind || locationId ? undefined : t("garage.parts.emptyBody")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-3 pr-3 font-medium">{t("garage.field.partName")}</th>
                  <th className="hidden pb-3 pr-3 font-medium sm:table-cell">{t("garage.field.sku")}</th>
                  <th className="pb-3 pr-3 font-medium">{t("garage.parts.stockLevel")}</th>
                  <th className="hidden pb-3 pr-3 text-right font-medium md:table-cell">{t("garage.field.costPrice")}</th>
                  <th className="pb-3 text-right font-medium">{t("garage.field.sellPrice")}</th>
                </tr>
              </thead>
              <tbody>
                {parts.data.items.map((p) => {
                  const tone = stockTone(p);
                  return (
                    <tr key={p.id} onClick={() => setOpenId(p.id)} className={`cursor-pointer border-t border-border hover:bg-canvas/60 ${p.active ? "" : "opacity-50"}`}>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-muted-foreground"><Tags className="size-4" /></span>
                          <div className="min-w-0">
                            <button type="button" className="font-medium hover:underline" onClick={() => setOpenId(p.id)}>{p.name}</button>
                            <p className="text-xs text-muted-foreground">
                              {[p.brand, p.category, locations.data?.find((l) => l.id === p.locationId)?.name].filter(Boolean).join(" · ")}
                              {p.kind === "CONSUMABLE" && <span className="ml-1.5 inline-block align-middle"><Badge tone="info" dot={false}>{t("garage.stk.kindConsumable")}</Badge></span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden py-3 pr-3 font-mono text-xs text-muted-foreground sm:table-cell">{p.sku}</td>
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3">
                          <Progress value={(p.stockQty / Math.max(1, p.reorderLevel * 2)) * 100} tone={tone} className="hidden w-[90px] sm:block" />
                          <span className="w-14 text-[13px] font-medium tabular-nums">{p.stockQty}/{p.reorderLevel}</span>
                          <Badge tone={tone}>{p.stockQty <= 0 ? t("garage.parts.out") : p.lowStock ? t("garage.parts.low") : t("garage.parts.ok")}</Badge>
                        </div>
                      </td>
                      <td className="hidden py-3 pr-3 text-right tabular-nums text-muted-foreground md:table-cell">{money(p.unitCost, garage.currency)}</td>
                      <td className="py-3 text-right font-medium tabular-nums">{money(p.unitPrice, garage.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <LocationsPanel open={placing} onClose={() => setPlacing(false)} onChanged={() => { locations.reload(); parts.reload(); }} />
      <NewPart
        categories={categories}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false);
          parts.reload();
          setOpenId(p.id);
        }}
      />
      <PartPanel part={open} garage={garage} categories={categories} locationName={locations.data?.find((l) => l.id === open?.locationId)?.name ?? null} onClose={() => setOpenId(null)} onChanged={parts.reload} />
    </div>
  );
}

/** Active suppliers, for the part forms. */
function useSuppliers(enabled: boolean) {
  return useLoad(() => (enabled ? listSuppliers() : Promise.resolve([] as SupplierRow[])), [enabled]);
}

function SupplierSelect({ suppliers, defaultValue }: { suppliers: SupplierRow[]; defaultValue?: string | null }) {
  const t = useT();
  return (
    <select name="supplierId" defaultValue={defaultValue ?? ""} key={`${defaultValue}-${suppliers.length}`} className={inputCls}>
      <option value="">{t("garage.sup.none")}</option>
      {suppliers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function NewPart({ open, categories, onClose, onCreated }: { open: boolean; categories: string[]; onClose: () => void; onCreated: (p: Part) => void }) {
  const t = useT();
  const action = useAction();
  const suppliers = useSuppliers(open);
  const locations = useLocations(open);
  return (
    <Panel open={open} onClose={onClose} title={t("garage.parts.new")} description={t("garage.parts.newBody")}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const p = await action.run("save", () =>
            createPart({
              sku: text(f.get("sku")) ?? "",
              name: text(f.get("name")) ?? "",
              brand: text(f.get("brand")),
              unitCost: num(f.get("unitCost")) ?? 0,
              unitPrice: num(f.get("unitPrice")) ?? 0,
              reorderLevel: num(f.get("reorderLevel")) ?? 0,
              openingStock: num(f.get("openingStock")) ?? 0,
              supplierId: text(f.get("supplierId")),
              kind: f.get("kind") === "CONSUMABLE" ? "CONSUMABLE" : "PART",
              category: text(f.get("category")),
              barcode: text(f.get("barcode")),
              locationId: text(f.get("locationId")),
            })
          );
          if (p) onCreated(p);
        }}
      >
        <Card className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("garage.field.sku")}>
              <input name="sku" required maxLength={60} placeholder="OF-TOY-01" className={`${inputCls} font-mono uppercase`} />
            </Field>
            <Field label={t("garage.field.brand")}>
              <input name="brand" maxLength={80} className={inputCls} />
            </Field>
          </div>
          <Field label={t("garage.field.partName")}>
            <input name="name" required maxLength={160} placeholder={t("garage.parts.namePlaceholder")} className={inputCls} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("garage.field.costPrice")}>
              <input name="unitCost" type="number" min={0} step="0.01" defaultValue={0} className={inputCls} />
            </Field>
            <Field label={t("garage.field.sellPrice")}>
              <input name="unitPrice" type="number" min={0} step="0.01" defaultValue={0} className={inputCls} />
            </Field>
            <Field label={t("garage.field.openingStock")}>
              <input name="openingStock" type="number" min={0} step="any" defaultValue={0} className={inputCls} />
            </Field>
            <Field label={t("garage.field.reorderLevel")} hint={t("garage.field.reorderHint")}>
              <input name="reorderLevel" type="number" min={0} step="any" defaultValue={0} className={inputCls} />
            </Field>
          </div>
          <Field label={t("garage.sup.usual")}>
            <SupplierSelect suppliers={suppliers.data ?? []} />
          </Field>
          <StockFields categories={categories} locations={locations.data ?? []} />
        </Card>
        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} w-full`}>
          {action.busy && <Spinner />} {t("garage.action.save")}
        </button>
      </form>
    </Panel>
  );
}

function PartPanel({ part, garage, categories, locationName, onClose, onChanged }: { part: Part | null; garage: Garage; categories: string[]; locationName: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const moves = useLoad(() => (part ? listMovements(part.id) : Promise.resolve(null)), [part?.id, part?.stockQty]);
  const [mode, setMode] = useState<"receive" | "adjust" | "use" | "edit" | null>(null);
  const suppliers = useSuppliers(part !== null);
  const locations = useLocations(part !== null);
  const supplierName = (id: string | null) => (id ? suppliers.data?.find((s) => s.id === id)?.name ?? null : null);

  async function done<T>(key: string, fn: () => Promise<T>) {
    const result = await action.run(key, fn);
    if (result) {
      setMode(null);
      onChanged();
    }
  }

  return (
    <Panel
      open={part !== null}
      onClose={() => {
        setMode(null);
        onClose();
      }}
      title={part?.name ?? ""}
      description={part ? <><span className="font-mono">{part.sku}</span>{part.brand && <span>· {part.brand}</span>}{!part.active && <Badge tone="gray">{t("garage.parts.inactive")}</Badge>}</> : undefined}
    >
      {part && (
        <>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("garage.parts.inStock")}</p>
              <p className={`mt-1 font-display text-2xl font-bold tabular-nums ${part.lowStock ? "text-bad" : ""}`}>{part.stockQty}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("garage.field.costPrice")}</p>
              <p className="mt-1 font-semibold tabular-nums">{money(part.unitCost, garage.currency)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">{t("garage.field.sellPrice")}</p>
              <p className="mt-1 font-semibold tabular-nums">{money(part.unitPrice, garage.currency)}</p>
            </Card>
          </div>
          {part.supplierId && supplierName(part.supplierId) && (
            <p className="text-sm text-muted-foreground">
              {t("garage.sup.usual")}: <span className="font-medium text-foreground">{supplierName(part.supplierId)}</span>
            </p>
          )}
          {(part.category || part.barcode || locationName || part.kind === "CONSUMABLE") && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {part.kind === "CONSUMABLE" && <Badge tone="info" dot={false}>{t("garage.stk.kindConsumable")}</Badge>}
              {part.category && <span>{t("garage.stk.category")}: <span className="font-medium text-foreground">{part.category}</span></span>}
              {locationName && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> <span className="font-medium text-foreground">{locationName}</span></span>}
              {part.barcode && <span>{t("garage.stk.barcode")}: <span className="font-mono text-foreground">{part.barcode}</span></span>}
            </p>
          )}
          {part.lowStock && <p className="rounded-xl bg-bad-soft px-4 py-2.5 text-sm text-bad">{t("garage.parts.lowWarning", { min: part.reorderLevel })}</p>}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("receive")} className={`${btnPrimary} ${btnSm}`}>
              {t("garage.parts.receive")}
            </button>
            {part.kind === "CONSUMABLE" && (
              <button type="button" onClick={() => setMode("use")} className={`${btnSecondary} ${btnSm}`}>
                {t("garage.stk.useInWorkshop")}
              </button>
            )}
            <button type="button" onClick={() => setMode("adjust")} className={`${btnSecondary} ${btnSm}`}>
              {t("garage.parts.adjust")}
            </button>
            <button type="button" onClick={() => setMode("edit")} className={`${btnSecondary} ${btnSm}`}>
              {t("garage.action.edit")}
            </button>
            <button
              type="button"
              onClick={() => done("active", () => updatePart(part.id, { active: !part.active }))}
              disabled={action.busy !== null}
              className={`${part.active ? btnDanger : btnSecondary} ${btnSm} ml-auto`}
            >
              {action.busy === "active" && <Spinner />} {part.active ? t("garage.parts.deactivate") : t("garage.parts.reactivate")}
            </button>
          </div>

          {mode === "use" && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                done("stock", () => adjustStock(part.id, { quantityChange: -Math.abs(num(f.get("qty")) ?? 0), reason: "WORKSHOP_USE", note: text(f.get("note")) }));
              }}
            >
              <p className="text-sm">{t("garage.stk.useBody")}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("garage.stk.qtyUsed")}>
                  <input name="qty" type="number" step="any" min={0.01} max={part.stockQty} required className={inputCls} />
                </Field>
                <Field label={t("garage.field.note")}>
                  <input name="note" maxLength={240} placeholder={t("garage.stk.useNote")} className={inputCls} />
                </Field>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
                  {action.busy === "stock" && <Spinner />} {t("garage.action.save")}
                </button>
                <button type="button" onClick={() => setMode(null)} className={`${btnSecondary} ${btnSm}`}>
                  {t("garage.action.cancel")}
                </button>
              </div>
            </form>
          )}

          {(mode === "receive" || mode === "adjust") && (
            <form
              key={mode}
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const qty = num(f.get("qty")) ?? 0;
                done("stock", () =>
                  adjustStock(part.id, {
                    quantityChange: mode === "receive" ? Math.abs(qty) : qty,
                    reason: mode === "receive" ? "PURCHASE" : (f.get("reason") as "RETURN" | "ADJUSTMENT"),
                    note: text(f.get("note")),
                    ...(mode === "receive" && { supplierId: text(f.get("supplierId")), unitCost: num(f.get("unitCost")) }),
                  })
                );
              }}
            >
              <p className="text-sm">{mode === "receive" ? t("garage.parts.receiveBody") : t("garage.parts.adjustBody")}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label={mode === "receive" ? t("garage.parts.qtyReceived") : t("garage.parts.qtyChange")}>
                  <input name="qty" type="number" step="any" required min={mode === "receive" ? 0.01 : undefined} className={inputCls} />
                </Field>
                {mode === "receive" && (
                  <Field label={t("garage.sup.unitCost")} hint={t("garage.sup.lastCost", { cost: money(part.unitCost, garage.currency) })}>
                    <input name="unitCost" type="number" min={0} step="0.01" placeholder={String(part.unitCost)} className={inputCls} />
                  </Field>
                )}
                {mode === "receive" && (
                  <Field label={t("garage.sup.supplier")} className="col-span-2">
                    <SupplierSelect suppliers={suppliers.data ?? []} defaultValue={part.supplierId} />
                  </Field>
                )}
                {mode === "adjust" && (
                  <Field label={t("garage.parts.reason")}>
                    <select name="reason" defaultValue="ADJUSTMENT" className={inputCls}>
                      <option value="ADJUSTMENT">{t("garage.movement.ADJUSTMENT")}</option>
                      <option value="RETURN">{t("garage.movement.RETURN")}</option>
                    </select>
                  </Field>
                )}
              </div>
              <Field label={t("garage.field.note")}>
                <input name="note" maxLength={240} placeholder={mode === "receive" ? t("garage.parts.notePlaceholder") : ""} className={inputCls} />
              </Field>
              <div className="flex gap-2">
                <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
                  {action.busy === "stock" && <Spinner />} {t("garage.action.save")}
                </button>
                <button type="button" onClick={() => setMode(null)} className={`${btnSecondary} ${btnSm}`}>
                  {t("garage.action.cancel")}
                </button>
              </div>
            </form>
          )}

          {mode === "edit" && (
            <form
              className="space-y-3 rounded-2xl bg-white p-5"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                done("edit", () =>
                  updatePart(part.id, {
                    name: text(f.get("name")) ?? part.name,
                    brand: text(f.get("brand")),
                    unitCost: num(f.get("unitCost")) ?? 0,
                    unitPrice: num(f.get("unitPrice")) ?? 0,
                    reorderLevel: num(f.get("reorderLevel")) ?? 0,
                    supplierId: text(f.get("supplierId")),
                    kind: f.get("kind") === "CONSUMABLE" ? "CONSUMABLE" : "PART",
                    category: text(f.get("category")),
                    barcode: text(f.get("barcode")),
                    locationId: text(f.get("locationId")),
                  })
                );
              }}
            >
              <Field label={t("garage.field.partName")}>
                <input name="name" required maxLength={160} defaultValue={part.name} className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("garage.field.brand")}>
                  <input name="brand" maxLength={80} defaultValue={part.brand ?? ""} className={inputCls} />
                </Field>
                <Field label={t("garage.field.reorderLevel")}>
                  <input name="reorderLevel" type="number" min={0} step="any" defaultValue={part.reorderLevel} className={inputCls} />
                </Field>
                <Field label={t("garage.field.costPrice")}>
                  <input name="unitCost" type="number" min={0} step="0.01" defaultValue={part.unitCost} className={inputCls} />
                </Field>
                <Field label={t("garage.field.sellPrice")}>
                  <input name="unitPrice" type="number" min={0} step="0.01" defaultValue={part.unitPrice} className={inputCls} />
                </Field>
              </div>
              <Field label={t("garage.sup.usual")}>
                <SupplierSelect suppliers={suppliers.data ?? []} defaultValue={part.supplierId} />
              </Field>
              <StockFields categories={categories} locations={locations.data ?? []} part={part} />
              <div className="flex gap-2">
                <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} ${btnSm}`}>
                  {action.busy === "edit" && <Spinner />} {t("garage.action.save")}
                </button>
                <button type="button" onClick={() => setMode(null)} className={`${btnSecondary} ${btnSm}`}>
                  {t("garage.action.cancel")}
                </button>
              </div>
            </form>
          )}

          {action.error && <ErrorNote message={action.error} />}

          <Card className="p-5">
            <h3 className="mb-3 font-display text-lg font-semibold">{t("garage.parts.history")}</h3>
            {moves.error ? (
              <ErrorNote message={moves.error} onRetry={moves.reload} />
            ) : !moves.data ? (
              <Loading className="p-4!" />
            ) : moves.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("garage.parts.noHistory")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {moves.data.items.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <span className={`w-14 text-right font-semibold tabular-nums ${m.quantityChange < 0 ? "text-bad" : "text-ok"}`}>
                      {m.quantityChange > 0 ? "+" : ""}
                      {m.quantityChange}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {t(`garage.movement.${m.reason}`)}
                      {supplierName(m.supplierId) && <span className="text-muted-foreground"> · {supplierName(m.supplierId)}</span>}
                      {m.reason === "PURCHASE" && m.unitCost != null && <span className="text-muted-foreground"> · {money(m.unitCost, garage.currency)}</span>}
                      {m.note && <span className="text-muted-foreground"> · {m.note}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(m.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
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

/** Kind, category, barcode and shelf: how a part is filed and found. */
function StockFields({ categories, locations, part }: { categories: string[]; locations: { id: string; name: string; note: string | null; active: boolean; partCount: number | null; assetCount: number | null; heldCount: number | null }[]; part?: Part }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t("garage.stk.kind")} hint={t("garage.stk.kindHint")}>
        <select name="kind" defaultValue={part?.kind ?? "PART"} className={inputCls}>
          <option value="PART">{t("garage.stk.kindPart")}</option>
          <option value="CONSUMABLE">{t("garage.stk.kindConsumable")}</option>
        </select>
      </Field>
      <Field label={t("garage.stk.category")}>
        <input name="category" list="part-categories" maxLength={80} defaultValue={part?.category ?? ""} placeholder={t("garage.stk.categoryPlaceholder")} className={inputCls} />
        <datalist id="part-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label={t("garage.stk.location")}>
        <LocationSelect locations={locations} defaultValue={part?.locationId} />
      </Field>
      <Field label={t("garage.stk.barcode")}>
        <input name="barcode" maxLength={64} defaultValue={part?.barcode ?? ""} className={`${inputCls} font-mono`} />
      </Field>
    </div>
  );
}
