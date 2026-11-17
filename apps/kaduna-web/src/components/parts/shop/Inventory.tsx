"use client";

/**
 * The shop's stock: search by any number or by the car it fits, low-stock
 * view, add and edit parts (prices, VAT, warranty, core deposit, location,
 * fitment, cross-references), import and export a spreadsheet, print
 * barcode shelf labels, and each part's stock history with counts and
 * damage write-offs. What shows depends on the role (cost prices, editing).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Barcode, Car, FileSpreadsheet, MapPin, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";

import { Badge, Card, Chip, Empty, ErrorNote, Field, Loading, Panel, Segmented, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, num, text, useAction, useDebounced, useLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { assignBarcodes, createLocation, createPart, getPart, listCategories, listLocations, listParts, listSuppliers, listTags, replaceFitments, updateLocation, updatePart, type Fitment, type Location, type Part, type PartView, type Shop } from "@/lib/partsApi";

import { useAccess } from "./access";
import { PartPicker } from "./common";
import ImportExport from "./ImportExport";
import { printLabels } from "./print";

export default function Inventory({ shop, lowOnly = false }: { shop: Shop; lowOnly?: boolean }) {
  const t = useT();
  const money = useMoney();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [car, setCar] = useState({ make: "", model: "", year: "" });
  const carQ = useDebounced(car);
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [locationId, setLocationId] = useState("");
  const [placesOpen, setPlacesOpen] = useState(false);
  const tagList = useLoad(listTags, []);
  const places = useLoad(listLocations, []);
  const [low, setLow] = useState(lowOnly);
  const [hidden, setHidden] = useState(false);
  const [page, setPage] = useState(0);
  const cats = useLoad(listCategories, []);
  const list = useLoad(
    () => listParts({ q: q || undefined, make: carQ.make || undefined, model: carQ.model || undefined, year: Number(carQ.year) || undefined, category: category || undefined, tag: tag || undefined, locationId: locationId || undefined, lowStock: low || undefined, includeInactive: hidden || undefined, limit: 50, offset: page * 50 }),
    [q, carQ.make, carQ.model, carQ.year, category, tag, locationId, low, hidden, page]
  );
  useEffect(() => setPage(0), [q, carQ.make, carQ.model, carQ.year, category, tag, locationId, low, hidden]);
  const [editing, setEditing] = useState<Part | "new" | null>(null);
  const [picked, setPicked] = useState<Map<string, Part>>(new Map());
  const [labels, setLabels] = useState(false);
  const [bulk, setBulk] = useState(false);
  const access = useAccess();
  const canEdit = access.can("catalogue");
  const toggle = (p: Part) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("shop.inv.search")} className={`${inputCls} pl-9`} />
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => setPlacesOpen(true)} className={`${btnSecondary} ${btnSm}`}><MapPin /> {t("shop.loc.title")}</button>
          {canEdit && <button type="button" onClick={() => setBulk(true)} className={`${btnSecondary} ${btnSm}`}><FileSpreadsheet /> {t("shop.inv.importExport")}</button>}
          {canEdit && <button type="button" onClick={() => setLabels(true)} className={`${btnSecondary} ${btnSm}`}><Tags /> {picked.size ? t("shop.labels.printN", { n: picked.size }) : t("shop.labels.title")}</button>}
          {canEdit && <button type="button" onClick={() => setEditing("new")} className={`${btnPrimary} ${btnSm}`}><Plus /> {t("shop.inv.add")}</button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Car className="size-4" /> {t("shop.inv.fits")}</span>
        <input value={car.make} onChange={(e) => setCar({ ...car, make: e.target.value })} placeholder={t("shop.fit.make")} className={`${inputCls} w-28! py-1.5!`} />
        <input value={car.model} onChange={(e) => setCar({ ...car, model: e.target.value })} placeholder={t("shop.fit.model")} className={`${inputCls} w-28! py-1.5!`} />
        <input value={car.year} onChange={(e) => setCar({ ...car, year: e.target.value })} placeholder={t("shop.fit.year")} inputMode="numeric" className={`${inputCls} w-20! py-1.5!`} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} w-40! py-1.5!`} aria-label={t("parts.field.category")}>
          <option value="">{t("shop.inv.allCategories")}</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.category} value={c.category}>{c.category} ({c.parts})</option>
          ))}
        </select>
        {(places.data ?? []).length > 1 && (
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={`${inputCls} w-40! py-1.5!`} aria-label={t("shop.part.location")}>
            <option value="">{t("shop.inv.allLocations")}</option>
            {(places.data ?? []).filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name} ({l.parts})</option>)}
          </select>
        )}
        {(tagList.data ?? []).length > 0 && (
          <select value={tag} onChange={(e) => setTag(e.target.value)} className={`${inputCls} w-36! py-1.5!`} aria-label={t("shop.part.tags")}>
            <option value="">{t("shop.inv.allTags")}</option>
            {(tagList.data ?? []).map((x) => <option key={x.tag} value={x.tag}>#{x.tag} ({x.parts})</option>)}
          </select>
        )}
        <Chip on={low} onClick={() => setLow(!low)}><AlertTriangle className="size-3.5" /> {t("shop.inv.lowOnly")}</Chip>
        <Chip on={hidden} onClick={() => setHidden(!hidden)}>{t("shop.inv.showInactive")}</Chip>
      </div>

      {list.error ? (
        <ErrorNote message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <Empty title={q || carQ.make || low ? t("parts.order.noMatch") : t("shop.inv.emptyTitle")} body={t("shop.inv.emptyBody")} action={canEdit ? <button type="button" onClick={() => setEditing("new")} className={btnPrimary}><Plus /> {t("shop.inv.add")}</button> : undefined} />
      ) : (
        <>
          <Card className="overflow-x-auto p-0!">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  {canEdit && <th className="w-8 pl-5"><span className="sr-only">{t("shop.labels.pick")}</span></th>}
                  <th className="px-5 py-3 font-medium">{t("parts.field.part")}</th>
                  <th className="px-3 py-3 font-medium">{t("shop.inv.numbers")}</th>
                  <th className="px-3 py-3 font-medium">{t("parts.field.fits")}</th>
                  <th className="px-3 py-3 text-right font-medium">{t("parts.field.stock")}</th>
                  <th className="px-3 py-3 text-right font-medium">{t("shop.inv.prices")}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id} className={`border-t border-border ${p.active ? "" : "opacity-60"}`}>
                    {canEdit && <td className="pl-5"><input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p)} aria-label={t("shop.labels.pick")} className="size-4 accent-primary" /></td>}
                    <td className="px-5 py-3">
                      <a href={`#part/${p.id}`} className="block text-left">
                        <span className="block font-medium hover:text-primary">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{[p.brand, p.category, p.location && t("shop.inv.at", { location: p.location })].filter(Boolean).join(" · ")}</span>
                        {p.tags.length > 0 && <span className="mt-0.5 flex flex-wrap gap-1">{p.tags.slice(0, 4).map((x) => <span key={x} className="rounded bg-vio-soft px-1.5 text-[11px] text-vio">#{x}</span>)}</span>}
                      </a>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      <span className="block">{p.sku}</span>
                      {(p.oemNumber || p.partNumber) && <span className="block">{p.oemNumber ?? p.partNumber}</span>}
                      {p.barcode && <span className="flex items-center gap-1"><Barcode className="size-3" />{p.barcode}</span>}
                    </td>
                    <td className="max-w-[220px] px-3 py-3 text-xs text-muted-foreground">{p.universal ? t("parts.fit.universal") : p.fitments.length ? p.fitments.map(fitLabel).join(", ") : "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-semibold tabular-nums ${p.lowStock ? "text-bad" : ""}`}>{p.stockQty}</span>
                      <span className="text-xs text-muted-foreground"> {p.unit}</span>
                      {p.lowStock && <span className="block text-[11px] text-bad">{t("shop.inv.low", { level: p.reorderLevel })}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <span className="block">{money(p.retailPrice, shop.currency)}</span>
                      <span className="block text-xs text-muted-foreground">{t("shop.inv.tradeShort", { amount: money(p.tradePrice ?? p.retailPrice, shop.currency) })}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {canEdit && <button type="button" onClick={() => setEditing(p)} className={`${btnSecondary} ${btnSm}`} aria-label={t("me.action.edit")}><Pencil /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {list.data.total > 50 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("shop.inv.showing", { from: page * 50 + 1, to: Math.min(list.data.total, page * 50 + 50), total: list.data.total })}</span>
              <span className="flex gap-2">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className={`${btnSecondary} ${btnSm}`}>←</button>
                <button type="button" disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)} className={`${btnSecondary} ${btnSm}`}>→</button>
              </span>
            </div>
          )}
        </>
      )}
      <PartPanel shop={shop} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); cats.reload(); places.reload(); tagList.reload(); }} />
      <LabelsPanel shop={shop} open={labels} parts={[...picked.values()]} onClose={() => setLabels(false)} onChanged={() => { list.reload(); setPicked(new Map()); }} />
      <ImportExport open={bulk} onClose={() => setBulk(false)} onImported={() => { list.reload(); cats.reload(); places.reload(); tagList.reload(); }} />
      <LocationsPanel shop={shop} open={placesOpen} onClose={() => setPlacesOpen(false)} onChanged={() => { places.reload(); list.reload(); }} />
    </div>
  );
}

export const fitLabel = (f: Fitment) => `${f.make} ${f.model}${f.yearFrom || f.yearTo ? ` ${f.yearFrom ?? "…"}–${f.yearTo ?? "…"}` : ""}${f.note ? ` (${f.note})` : ""}`;

// ─── Add / edit ──────────────────────────────────────────────────────────

type FitRow = { make: string; model: string; yearFrom: string; yearTo: string; note: string };
const toRows = (f: Fitment[]): FitRow[] => f.map((x) => ({ make: x.make, model: x.model, yearFrom: x.yearFrom?.toString() ?? "", yearTo: x.yearTo?.toString() ?? "", note: x.note ?? "" }));
const fromRows = (rows: FitRow[]) =>
  rows.filter((r) => r.make.trim() && r.model.trim()).map((r) => ({ make: r.make.trim(), model: r.model.trim(), yearFrom: Number(r.yearFrom) || null, yearTo: Number(r.yearTo) || null, note: r.note.trim() || null }));

function PartPanel({ shop, editing, onClose, onSaved }: { shop: Shop; editing: Part | "new" | null; onClose: () => void; onSaved: (saved: PartView) => void }) {
  const t = useT();
  const p = editing && editing !== "new" ? editing : null;
  return (
    <Panel wide open={editing !== null} onClose={onClose} title={p ? t("shop.inv.edit") : t("shop.inv.add")} description={p ? <span className="font-mono text-xs">{p.sku}</span> : undefined}>
      {editing !== null && <PartEditor key={p?.id ?? "new"} shop={shop} part={p} onSaved={onSaved} />}
    </Panel>
  );
}

/** The add / edit form for a part, in the panel here and on the part's page. */
export function PartEditor({ shop, part: p, onSaved }: { shop: Shop; part: Part | null; onSaved: (saved: PartView) => void }) {
  const t = useT();
  const action = useAction();
  const suppliers = useLoad(() => listSuppliers(), []);
  const locations = useLoad(() => listLocations(), []);
  const [universal, setUniversal] = useState(p?.universal ?? false);
  const [listed, setListed] = useState(p?.listed ?? true);
  const [serialized, setSerialized] = useState(p?.serialized ?? false);
  const [fractional, setFractional] = useState(p?.fractional ?? false);
  const [breaksInto, setBreaksInto] = useState<{ id: string; name: string | null } | null>(p?.breaksInto ? { id: p.breaksInto.id, name: p.breaksInto.name } : null);
  const [fits, setFits] = useState<FitRow[]>(p ? toRows(p.fitments) : [{ make: "", model: "", yearFrom: "", yearTo: "", note: "" }]);

  async function submit(form: FormData) {
    const fields = {
      sku: text(form.get("sku")) ?? "",
      name: text(form.get("name")) ?? "",
      description: text(form.get("description")),
      tags: (text(form.get("tags")) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      brand: text(form.get("brand")),
      category: text(form.get("category")),
      oemNumber: text(form.get("oemNumber")),
      partNumber: text(form.get("partNumber")),
      barcode: text(form.get("barcode")),
      location: text(form.get("location")) ?? (p ? undefined : null),
      unit: text(form.get("unit")) ?? "pcs",
      crossRefs: (text(form.get("crossRefs")) ?? "").split(",").map((s) => s.trim()).filter(Boolean),
      costPrice: num(form.get("costPrice")) ?? 0,
      retailPrice: num(form.get("retailPrice")) ?? 0,
      tradePrice: num(form.get("tradePrice")),
      reorderLevel: num(form.get("reorderLevel")) ?? 0,
      reorderQty: num(form.get("reorderQty")) ?? 0,
      supplierId: text(form.get("supplierId")),
      notes: text(form.get("notes")),
      taxRate: num(form.get("taxRate")),
      warrantyMonths: num(form.get("warrantyMonths")),
      coreCharge: num(form.get("coreCharge")),
      warrantyFreeMonths: num(form.get("warrantyFreeMonths")),
      fractional,
      quickQtys: fractional ? (text(form.get("quickQtys")) ?? "").split(/[,\s]+/).map(Number).filter((x) => x > 0) : [],
      purchaseUnit: text(form.get("purchaseUnit")),
      purchaseFactor: num(form.get("purchaseFactor")) ?? 1,
      breaksIntoId: breaksInto?.id ?? null,
      breaksIntoQty: breaksInto ? num(form.get("breaksIntoQty")) : null,
      serialized,
      universal,
      listed,
    };
    if (p && p.costPrice == null) delete (fields as { costPrice?: number }).costPrice;
    const fitments = universal ? [] : fromRows(fits);
    const saved = await action.run("save", async () => {
      if (!p) return createPart({ ...fields, openingStock: num(form.get("openingStock")) ?? 0, fitments });
      await updatePart(p.id, fields);
      return replaceFitments(p.id, fitments);
    });
    if (saved) onSaved(saved);
  }

  return (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>
          <Card className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("parts.field.part")} className="sm:col-span-2"><input name="name" required maxLength={160} defaultValue={p?.name} placeholder={t("parts.catalogue.namePlaceholder")} className={inputCls} /></Field>
              <Field label={t("shop.part.description")} className="sm:col-span-2"><textarea name="description" rows={2} maxLength={1000} defaultValue={p?.description ?? ""} placeholder={t("shop.part.descriptionPlaceholder")} className={inputCls} /></Field>
              <Field label={t("shop.inv.sku")} hint={t("shop.inv.skuHint")}><input name="sku" required maxLength={60} defaultValue={p?.sku} className={`${inputCls} font-mono`} /></Field>
              <Field label={t("parts.field.brand")}><input name="brand" maxLength={80} defaultValue={p?.brand ?? ""} placeholder="Bosch, Denso, Genuine…" className={inputCls} /></Field>
              <Field label={t("shop.inv.oem")}><input name="oemNumber" maxLength={80} defaultValue={p?.oemNumber ?? ""} placeholder="04465-52260" className={`${inputCls} font-mono`} /></Field>
              <Field label={t("parts.field.partNumber")}><input name="partNumber" maxLength={80} defaultValue={p?.partNumber ?? ""} className={`${inputCls} font-mono`} /></Field>
              <Field label={t("shop.inv.crossRefs")} hint={t("shop.inv.crossRefsHint")} className="sm:col-span-2"><input name="crossRefs" maxLength={600} defaultValue={p?.crossRefs.join(", ") ?? ""} className={`${inputCls} font-mono`} /></Field>
              <Field label={t("parts.field.category")}><input name="category" maxLength={80} defaultValue={p?.category ?? ""} placeholder={t("parts.catalogue.categoryPlaceholder")} className={inputCls} /></Field>
              <Field label={t("shop.inv.barcode")}><input name="barcode" maxLength={80} defaultValue={p?.barcode ?? ""} className={`${inputCls} font-mono`} /></Field>
              <Field label={t("shop.part.defaultLocation")} hint={t("shop.part.defaultLocationHint")}>
                <input name="location" list="shop-locations" maxLength={60} defaultValue={p?.location ?? ""} placeholder="A3-02" className={inputCls} />
                <datalist id="shop-locations">{(locations.data ?? []).filter((l) => l.active).map((l) => <option key={l.id} value={l.name} />)}</datalist>
              </Field>
              <Field label={t("shop.inv.unit")}><input name="unit" maxLength={20} defaultValue={p?.unit ?? "pcs"} className={inputCls} /></Field>
              <Field label={t("shop.part.tags")} hint={t("shop.part.tagsHint")} className="sm:col-span-2"><input name="tags" maxLength={600} defaultValue={p?.tags.join(", ") ?? ""} placeholder="fast-moving, fragile" className={inputCls} /></Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">{t("shop.inv.pricing")}</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              {(!p || p.costPrice != null) && <Field label={t("shop.inv.cost")}><input name="costPrice" type="number" min={0} step="0.01" defaultValue={p?.costPrice ?? ""} className={inputCls} /></Field>}
              <Field label={t("shop.inv.retail")}><input name="retailPrice" type="number" min={0} step="0.01" required defaultValue={p?.retailPrice ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.inv.trade")} hint={t("shop.inv.tradeHint")}><input name="tradePrice" type="number" min={0} step="0.01" defaultValue={p?.tradePrice ?? ""} className={inputCls} /></Field>
              {!p && <Field label={t("shop.inv.opening")}><input name="openingStock" type="number" min={0} step="any" defaultValue="" className={inputCls} /></Field>}
              <Field label={t("shop.inv.reorderLevel")}><input name="reorderLevel" type="number" min={0} step="any" defaultValue={p?.reorderLevel ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.inv.reorderQty")}><input name="reorderQty" type="number" min={0} step="any" defaultValue={p?.reorderQty ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.inv.vat")} hint={t("shop.inv.vatHint", { rate: shop.taxRate })}><input name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={p?.taxRate ?? ""} className={inputCls} /></Field>
            </div>
            <Field label={t("shop.inv.supplier")}>
              <select name="supplierId" defaultValue={p?.supplierId ?? ""} className={inputCls}>
                <option value="">—</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t("shop.inv.fitment")}</h3>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={universal} onChange={(e) => setUniversal(e.target.checked)} className="size-4 accent-primary" /> {t("shop.inv.universal")}
              </label>
            </div>
            {universal ? (
              <p className="text-xs text-muted-foreground">{t("shop.inv.universalHint")}</p>
            ) : (
              <>
                {fits.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_5rem_5rem_auto] gap-2 sm:grid-cols-[1fr_1fr_5rem_5rem_1fr_auto]">
                    <input value={r.make} onChange={(e) => setFits(fits.map((x, j) => (j === i ? { ...x, make: e.target.value } : x)))} placeholder={t("shop.fit.make")} className={inputCls} />
                    <input value={r.model} onChange={(e) => setFits(fits.map((x, j) => (j === i ? { ...x, model: e.target.value } : x)))} placeholder={t("shop.fit.model")} className={inputCls} />
                    <input value={r.yearFrom} onChange={(e) => setFits(fits.map((x, j) => (j === i ? { ...x, yearFrom: e.target.value } : x)))} placeholder={t("shop.fit.from")} inputMode="numeric" className={inputCls} />
                    <input value={r.yearTo} onChange={(e) => setFits(fits.map((x, j) => (j === i ? { ...x, yearTo: e.target.value } : x)))} placeholder={t("shop.fit.to")} inputMode="numeric" className={inputCls} />
                    <input value={r.note} onChange={(e) => setFits(fits.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} placeholder={t("shop.fit.note")} className={`${inputCls} hidden sm:block`} />
                    <button type="button" onClick={() => setFits(fits.filter((_, j) => j !== i))} aria-label={t("garage.action.remove")} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad"><Trash2 className="size-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setFits([...fits, { make: "", model: "", yearFrom: "", yearTo: "", note: "" }])} className={`${btnSecondary} ${btnSm}`}><Plus /> {t("shop.inv.addFit")}</button>
              </>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">{t("shop.inv.afterSale")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("shop.inv.warranty")} hint={t("shop.inv.warrantyHint")}><input name="warrantyMonths" type="number" min={0} max={120} step="1" defaultValue={p?.warrantyMonths ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.inv.core")} hint={t("shop.inv.coreHint")}><input name="coreCharge" type="number" min={0} step="0.01" defaultValue={p?.coreCharge ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.inv.freeMonths")} hint={t("shop.inv.freeMonthsHint")}><input name="warrantyFreeMonths" type="number" min={0} max={120} step="1" defaultValue={p?.warrantyFreeMonths ?? ""} className={inputCls} /></Field>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={serialized} onChange={(e) => setSerialized(e.target.checked)} className="size-4 accent-primary" />
              <span><span className="block font-medium">{t("shop.inv.serialized")}</span><span className="block text-xs text-muted-foreground">{t("shop.inv.serializedHint")}</span></span>
            </label>
          </Card>

          <Card className="space-y-4 p-5">
            <h3 className="text-sm font-semibold">{t("shop.inv.measures")}</h3>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={fractional} onChange={(e) => setFractional(e.target.checked)} className="size-4 accent-primary" />
              <span><span className="block font-medium">{t("shop.inv.fractional")}</span><span className="block text-xs text-muted-foreground">{t("shop.inv.fractionalHint")}</span></span>
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              {fractional && <Field label={t("shop.inv.quickQtys")} hint={t("shop.inv.quickQtysHint")}><input name="quickQtys" defaultValue={p?.quickQtys.join(", ") ?? ""} placeholder="0.5, 1, 4" className={inputCls} /></Field>}
              <Field label={t("shop.inv.purchaseUnit")} hint={t("shop.inv.purchaseUnitHint")}><input name="purchaseUnit" maxLength={20} defaultValue={p?.purchaseUnit ?? ""} placeholder="drum, box" className={inputCls} /></Field>
              <Field label={t("shop.inv.purchaseFactor")} hint={t("shop.inv.purchaseFactorHint")}><input name="purchaseFactor" type="number" min={0.001} step="any" defaultValue={p?.purchaseFactor ?? 1} className={inputCls} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <Field label={t("shop.inv.breaksInto")} hint={breaksInto ? t("shop.inv.breaksIntoSet", { name: breaksInto.name ?? "" }) : t("shop.inv.breaksIntoHint")}>
                <div className="flex gap-2">
                  <div className="flex-1"><PartPicker onPick={(x) => x.id !== p?.id && setBreaksInto({ id: x.id, name: x.name })} placeholder={t("shop.inv.breaksIntoPick")} /></div>
                  {breaksInto && <button type="button" onClick={() => setBreaksInto(null)} className={`${btnSecondary} ${btnSm}`}>{t("garage.action.remove")}</button>}
                </div>
              </Field>
              {breaksInto && <Field label={t("shop.inv.breaksIntoQty")}><input name="breaksIntoQty" type="number" min={0.001} step="any" required defaultValue={p?.breaksInto?.qty ?? ""} className={inputCls} /></Field>}
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} className="size-4 accent-primary" />
              <span><span className="block font-medium">{t("shop.inv.listed")}</span><span className="block text-xs text-muted-foreground">{t("shop.inv.listedHint")}</span></span>
            </label>
            <Field label={t("shop.inv.notes")}><textarea name="notes" rows={2} maxLength={1000} defaultValue={p?.notes ?? ""} className={inputCls} /></Field>
          </Card>

          {action.error && <ErrorNote message={action.error} />}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={action.busy !== null} className={`${btnPrimary} flex-1`}>{action.busy === "save" && <Spinner />} {p ? t("garage.action.save") : t("shop.inv.add")}</button>
            {p && (
              <button type="button" disabled={action.busy !== null} onClick={async () => { const next = await action.run("toggle", () => updatePart(p.id, { active: !p.active })); if (next) onSaved(next); }} className={btnSecondary}>
                {p.active ? t("shop.inv.deactivate") : t("shop.inv.reactivate")}
              </button>
            )}
          </div>
        </form>
  );
}

// ─── Barcode labels ─────────────────────────────────────────────────────

function LabelsPanel({ shop, open, parts, onClose, onChanged }: { shop: Shop; open: boolean; parts: Part[]; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const action = useAction();
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [fresh, setFresh] = useState<Map<string, Part>>(new Map());
  const rows = parts.map((p) => fresh.get(p.id) ?? p);
  const missing = rows.filter((p) => !p.barcode);

  return (
    <Panel open={open} onClose={onClose} title={t("shop.labels.title")} description={t("shop.labels.body")}>
      {rows.length === 0 ? (
        <Empty title={t("shop.labels.pickFirst")} body={t("shop.labels.pickBody")} />
      ) : (
        <>
          <Card className="p-4">
            <ul className="divide-y divide-border text-sm">
              {rows.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block font-mono text-xs text-muted-foreground">{p.barcode ?? t("shop.labels.noBarcode")}</span></span>
                  <input type="number" min={1} max={100} value={copies[p.id] ?? Math.max(1, Math.round(p.stockQty))} onChange={(e) => setCopies({ ...copies, [p.id]: Math.max(1, Number(e.target.value) || 1) })} aria-label={t("shop.labels.copies")} className={`${inputCls} w-20! py-1! text-right`} />
                </li>
              ))}
            </ul>
          </Card>
          {missing.length > 0 && (
            <Card className="space-y-2 p-4 text-sm">
              <p>{t("shop.labels.missing", { n: missing.length })}</p>
              <button
                type="button"
                disabled={action.busy !== null}
                onClick={async () => {
                  const r = await action.run("codes", async () => {
                    await assignBarcodes(missing.map((p) => p.id));
                    return Promise.all(missing.map((p) => getPart(p.id)));
                  });
                  if (r) {
                    setFresh(new Map([...fresh, ...r.map((p) => [p.id, p as Part] as const)]));
                    onChanged();
                  }
                }}
                className={`${btnSecondary} ${btnSm}`}
              >
                {action.busy === "codes" ? <Spinner /> : <Barcode />} {t("shop.labels.assign")}
              </button>
            </Card>
          )}
          {action.error && <ErrorNote message={action.error} />}
          <button type="button" onClick={() => printLabels(shop, rows.map((p) => ({ ...p, copies: copies[p.id] ?? Math.max(1, Math.round(p.stockQty)) })), t)} className={btnPrimary}><Tags /> {t("shop.labels.print")}</button>
        </>
      )}
    </Panel>
  );
}

// ─── Locations ──────────────────────────────────────────────────────────

function LocationsPanel({ shop, open, onClose, onChanged }: { shop: Shop; open: boolean; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const access = useAccess();
  const action = useAction();
  const list = useLoad(() => (open ? listLocations() : Promise.resolve([] as Location[])), [open]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const edit = access.can("catalogue") || access.can("stock");
  const done = () => {
    list.reload();
    onChanged();
  };
  return (
    <Panel open={open} onClose={onClose} title={t("shop.loc.title")} description={t("shop.loc.body")}>
      {edit && (
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await action.run("add", () => createLocation({ name: name.trim() }))) { setName(""); done(); } }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("shop.loc.placeholder")} maxLength={60} className={inputCls} />
          <button type="submit" disabled={!name.trim() || action.busy !== null} className={btnPrimary}><Plus /> {t("parts.action.add")}</button>
        </form>
      )}
      {action.error && <ErrorNote message={action.error} />}
      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {list.data.map((l) => (
              <li key={l.id} className={`flex items-center gap-3 px-4 py-2.5 ${l.active ? "" : "opacity-50"}`}>
                {renaming?.id === l.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={async (e) => { e.preventDefault(); if (await action.run("ren", () => updateLocation(l.id, { name: renaming.name.trim() }))) { setRenaming(null); done(); } }}>
                    <input value={renaming.name} onChange={(e) => setRenaming({ id: l.id, name: e.target.value })} maxLength={60} autoFocus className={`${inputCls} py-1!`} />
                    <button type="submit" className={`${btnSecondary} ${btnSm}`}>{t("garage.action.save")}</button>
                  </form>
                ) : (
                  <a href="#inventory" onClick={onClose} className="min-w-0 flex-1">
                    <span className="block font-medium">{l.name}</span>
                    <span className="block text-xs text-muted-foreground">{t("shop.loc.holds", { parts: l.parts, units: l.units })}{l.value != null && ` · ${money(l.value, shop.currency)}`}</span>
                  </a>
                )}
                {edit && renaming?.id !== l.id && (
                  <span className="flex gap-1">
                    <button type="button" aria-label={t("me.action.edit")} onClick={() => setRenaming({ id: l.id, name: l.name })} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-canvas"><Pencil className="size-4" /></button>
                    <button type="button" onClick={async () => (await action.run(l.id, () => updateLocation(l.id, { active: !l.active }))) && done()} className={`${btnSecondary} ${btnSm}`}>{l.active ? t("shop.loc.retire") : t("shop.loc.restore")}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Panel>
  );
}
