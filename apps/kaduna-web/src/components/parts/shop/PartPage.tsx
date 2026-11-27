"use client";

/**
 * One part, in full (at /seller#part/<id>). A menu down the side switches
 * what's shown: the part's details and specifications, its photos and
 * documents, stock at each location (add, remove, move), the stock history,
 * purchasing and sales, substitutes, and the edit and other operations.
 * What shows depends on the role: costs, editing and stock changes.
 */
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Boxes,
  Copy,
  Download,
  ExternalLink,
  FileText,
  History,
  ImagePlus,
  Info,
  Link2,
  MinusSquare,
  PackageOpen,
  Package,
  Pencil,
  PlusSquare,
  Printer,
  Receipt,
  Replace,
  Settings2,
  Star,
  Tags,
  Trash2,
  Truck,
  Upload,
  Wrench,
} from "lucide-react";

import { Badge, Card, CardHeader, Chip, Empty, ErrorNote, Field, Loading, Segmented, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney, type Tone } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import {
  addPartLink,
  addSubstitute,
  adjustStock,
  createLocation,
  getPart,
  getPartTrade,
  openPacks,
  setKit,
  unsetKit,
  listLocations,
  removePartFile,
  removeSubstitute,
  transferStock,
  updatePart,
  updatePartFile,
  uploadPartFile,
  type Part,
  type PartView,
  type Shop,
  type Spec,
} from "@/lib/partsApi";

import { useAccess } from "./access";
import { PartPicker } from "./common";
import { PartEditor, fitLabel } from "./Inventory";
import { printLabels } from "./print";

type Section = "info" | "files" | "stock" | "add" | "remove" | "move" | "history" | "purchasing" | "sales" | "substitutes" | "settings" | "other";

const MENU: { key: Section; icon: typeof Info; needs?: "catalogue" | "stock" }[] = [
  { key: "info", icon: Info },
  { key: "files", icon: ImagePlus },
  { key: "stock", icon: Boxes },
  { key: "add", icon: PlusSquare, needs: "stock" },
  { key: "remove", icon: MinusSquare, needs: "stock" },
  { key: "move", icon: ArrowRightLeft, needs: "stock" },
  { key: "history", icon: History },
  { key: "purchasing", icon: Truck },
  { key: "sales", icon: Receipt },
  { key: "substitutes", icon: Replace },
  { key: "settings", icon: Settings2, needs: "catalogue" },
  { key: "other", icon: Wrench },
];

export default function PartPage({ shop, partId, onBack, onOpen }: { shop: Shop; partId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const money = useMoney();
  const access = useAccess();
  const part = useLoad(() => getPart(partId), [partId]);
  const [section, setSection] = useState<Section>("info");
  const p = part.data;

  if (part.error) return <ErrorNote message={part.error} onRetry={part.reload} />;
  if (!p) return <Loading />;
  const photo = p.files.find((f) => f.kind === "IMAGE" && f.primary) ?? p.files.find((f) => f.kind === "IMAGE");
  const menu = MENU.filter((m) => !m.needs || access.can(m.needs));
  const changed = (next: PartView) => part.setData(next);

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> {t("shop.part.back")}</button>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-border bg-white">
            {photo?.url ? <img src={photo.url} alt={p.name} className="size-full object-contain" /> : <Package className="size-16 text-muted-foreground/40" strokeWidth={1.25} />}
          </div>
          <nav className="overflow-hidden rounded-2xl border border-border bg-white" aria-label={t("shop.part.menu")}>
            {menu.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setSection(m.key)}
                aria-current={section === m.key ? "page" : undefined}
                className={`flex w-full items-center justify-between border-b border-border px-4 py-2.5 text-left text-sm last:border-b-0 ${section === m.key ? "bg-brand-soft font-semibold text-primary" : "hover:bg-canvas"}`}
              >
                {t(`shop.part.menu.${m.key}`)}
                <m.icon className="size-4 opacity-70" />
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-bold">{p.name}{p.brand && <span className="font-normal text-muted-foreground"> — {p.brand}</span>}</h2>
                {p.description && <p className="mt-0.5 text-muted-foreground">{p.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyChip label={p.sku} />
                {p.barcode && <CopyChip label={p.barcode} />}
                {access.can("catalogue") && <button type="button" onClick={() => setSection("settings")} className={`${btnPrimary} ${btnSm}`}><Pencil /> {t("me.action.edit")}</button>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {!p.active && <Badge tone="gray" dot={false}>{t("shop.part.auto.inactive")}</Badge>}
              {autoTags(p).map((a) => <Badge key={a.key} tone={a.tone} dot={false}>{t(`shop.part.auto.${a.key}`, a.vars)}</Badge>)}
              {p.tags.map((tag) => <Badge key={tag} tone="vio" dot={false}>#{tag}</Badge>)}
            </div>
          </Card>

          {section === "info" && <InfoSection shop={shop} p={p} onGo={setSection} onChanged={changed} />}
          {section === "files" && <FilesSection p={p} onChanged={part.reload} />}
          {section === "stock" && (
            <>
              <StockSection shop={shop} p={p} onGo={setSection} />
              {p.breaksInto && access.can("stock") && <OpenPacks p={p} onChanged={changed} />}
            </>
          )}
          {(section === "add" || section === "remove") && <AdjustSection key={section} p={p} mode={section} onChanged={changed} />}
          {section === "move" && <MoveSection p={p} onChanged={changed} />}
          {section === "history" && <HistorySection shop={shop} p={p} />}
          {(section === "purchasing" || section === "sales") && <TradeSection shop={shop} p={p} view={section} />}
          {section === "substitutes" && <SubstitutesSection shop={shop} p={p} onChanged={changed} onOpen={onOpen} />}
          {section === "settings" && (
            <>
              <Card><PartEditor shop={shop} part={p} onSaved={() => { part.reload(); setSection("info"); }} /></Card>
              <KitEditor shop={shop} p={p} onChanged={changed} />
            </>
          )}
          {section === "other" && <OtherSection shop={shop} p={p} onChanged={changed} />}
          <p className="text-right text-xs text-muted-foreground">{money(p.retailPrice, shop.currency)} · {t("shop.part.updated")} {new Date(p.updatedAt).toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}

type AutoTag = { key: string; tone: Tone; vars?: Record<string, string | number> };
const tag = (key: string, tone: Tone, vars?: Record<string, string | number>): AutoTag => ({ key, tone, vars });

function autoTags(p: PartView): AutoTag[] {
  return [
    p.isKit ? tag("kit", "brand") : null,
    p.fractional ? tag("measure", "info", { unit: p.unit }) : null,
    p.purchaseUnit && p.purchaseFactor !== 1 ? tag("boughtIn", "gray", { unit: p.purchaseUnit, n: p.purchaseFactor, sell: p.unit }) : null,
    p.stockQty <= 0 ? tag("out", "bad") : p.lowStock ? tag("low", "warn") : null,
    p.universal ? tag("universal", "info") : null,
    p.serialized ? tag("serialized", "info") : null,
    p.warrantyMonths ? tag("warranty", "ok", { n: p.warrantyMonths }) : null,
    p.coreCharge ? tag("core", "vio") : null,
    !p.listed ? tag("unlisted", "gray") : null,
    !p.barcode ? tag("noBarcode", "gray") : null,
    p.onOrder > 0 ? tag("onOrder", "info", { n: p.onOrder }) : null,
  ].filter((x): x is AutoTag => x !== null);
}

function CopyChip({ label }: { label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard?.writeText(label).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className={`${btnSecondary} ${btnSm} font-mono`}
      title="Copy"
    >
      <Copy /> {done ? "✓" : label}
    </button>
  );
}

const Item = ({ label, children, wide = false, hl = false }: { label: string; children: React.ReactNode; wide?: boolean; hl?: boolean }) => (
  <div className={`${wide ? "sm:col-span-2" : ""} ${hl ? "rounded-xl bg-brand-soft px-3 py-2" : ""}`}>
    <dt className="text-xs font-semibold text-foreground">{label}</dt>
    <dd className="mt-1 text-sm text-muted-foreground">{children ?? "—"}</dd>
  </div>
);
const dash = (v: React.ReactNode) => (v === null || v === undefined || v === "" ? "—" : v);

function InfoSection({ shop, p, onGo, onChanged }: { shop: Shop; p: PartView; onGo: (s: Section) => void; onChanged: (p: PartView) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [tab, setTab] = useState<"info" | "specs">("info");
  const cur = shop.currency;
  const docs = p.files.filter((f) => f.kind !== "IMAGE");
  const cost = p.costPrice;

  return (
    <Card className="space-y-5">
      <Segmented value={tab} onChange={setTab} options={[{ value: "info", label: t("shop.part.menu.info") }, { value: "specs", label: `${t("shop.part.specs")} (${p.specs.length})` }]} />
      {tab === "specs" ? (
        <SpecsEditor p={p} onChanged={onChanged} />
      ) : (
        <>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            <Item label={t("shop.part.name")}>{p.name}</Item>
            <Item label={t("shop.part.description")} wide>{dash(p.description)}</Item>
            <Item label={t("shop.part.manufacturer")}>{dash(p.brand)}</Item>
            <Item label={t("shop.part.mpn")}><span className="font-mono">{dash(p.partNumber)}</span></Item>
            <Item label={t("shop.inv.oem")}><span className="font-mono">{dash(p.oemNumber)}</span></Item>
            <Item label={t("shop.inv.category")}>{dash(p.category)}</Item>
            <Item label={t("shop.inv.crossRefs")} wide><span className="font-mono">{p.crossRefs.length ? p.crossRefs.join(", ") : "—"}</span></Item>
            <Item label={t("shop.inv.barcode")}><span className="font-mono">{dash(p.barcode)}</span></Item>
            <Item label={t("shop.part.unit")}>{p.unit}</Item>
            <Item label={t("parts.field.fits")} wide>{p.universal ? t("parts.fit.universal") : p.fitments.length ? <span className="flex flex-wrap gap-1">{p.fitments.map((f) => <Badge key={f.id} tone="gray" dot={false}>{fitLabel(f)}</Badge>)}</span> : "—"}</Item>
            {p.isKit && (
              <Item label={t("shop.kit.components")} wide>
                <span className="flex flex-col gap-0.5">{p.kitComponents.map((c) => <span key={c.partId}>{c.quantity} {c.unit} × {c.name} <span className="text-xs">({t("shop.stockShort", { n: c.stockQty })})</span></span>)}</span>
              </Item>
            )}
            {p.breaksInto && <Item label={t("shop.inv.breaksInto")} wide>{t("shop.kit.opensInto", { qty: p.breaksInto.qty ?? 0, unit: p.breaksInto.unit ?? "", name: p.breaksInto.name ?? "" })}</Item>}
            {p.openedFrom.length > 0 && <Item label={t("shop.kit.packs")} wide>{p.openedFrom.map((x) => `${x.name} (${x.qty} ${p.unit}, ${t("shop.stockShort", { n: x.stockQty })})`).join(", ")}</Item>}
            {p.purchaseUnit && <Item label={t("shop.inv.purchaseUnit")}>{t("shop.kit.boughtAs", { unit: p.purchaseUnit, n: p.purchaseFactor, sell: p.unit })}</Item>}
          </dl>

          <div className="grid gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-4">
            <Item label={t("shop.part.datasheets")} wide>
              {docs.length ? (
                <span className="flex flex-col gap-1">
                  {docs.map((f) => <a key={f.id} href={f.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><FileText className="size-4" /> {f.name}</a>)}
                </span>
              ) : (
                <button type="button" onClick={() => onGo("files")} className="text-primary hover:underline">{t("shop.part.addFiles")}</button>
              )}
            </Item>
            <Item label={t("shop.part.where")} wide>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {(p.stockByLocation ?? []).filter((l) => l.qty !== 0 || l.default).map((l) => (
                  <button key={l.locationId} type="button" onClick={() => onGo("stock")} className="text-primary hover:underline">
                    {l.name} <span className="text-muted-foreground">({l.qty}){l.default ? ` · ${t("shop.part.default")}` : ""}</span>
                  </button>
                ))}
              </span>
            </Item>
          </div>

          <div className="grid gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-3 xl:grid-cols-6">
            <Item label={t("shop.part.total")} hl><span className={`font-semibold ${p.stockQty <= 0 ? "text-bad" : "text-foreground"}`}>{p.stockQty} {p.unit}</span></Item>
            <Item label={t("shop.part.ordered")}>{p.onOrder}</Item>
            <Item label={t("shop.part.reorder")}>{p.reorderLevel} / {p.reorderQty}</Item>
            <Item label={t("shop.inv.retail")}>{money(p.retailPrice, cur)}</Item>
            <Item label={t("shop.inv.trade")}>{money(p.tradePrice ?? p.retailPrice, cur)}</Item>
            <Item label={t("shop.inv.vat")}>{p.taxRate == null ? `${shop.taxRate}% (${t("shop.part.shopRate")})` : `${p.taxRate}%`}</Item>
            {cost != null && (
              <>
                <Item label={t("shop.part.avgCost")}>{money(cost, cur)}</Item>
                <Item label={t("shop.part.purchaseValue")}>{money(Math.max(0, p.stockQty) * cost, cur)}</Item>
                <Item label={t("shop.part.margin")}>{p.retailPrice > 0 ? `${Math.round(((p.retailPrice - cost) / p.retailPrice) * 1000) / 10}%` : "—"}</Item>
              </>
            )}
            <Item label={t("shop.part.retailValue")}>{money(Math.max(0, p.stockQty) * p.retailPrice, cur)}</Item>
            <Item label={t("shop.inv.warranty")}>{p.warrantyMonths ? t("shop.sale.warrantyMonths", { n: p.warrantyMonths }) : "—"}</Item>
            <Item label={t("shop.inv.core")}>{p.coreCharge ? money(p.coreCharge, cur) : "—"}</Item>
          </div>

          <div className="grid gap-x-6 gap-y-4 border-t border-border pt-4 sm:grid-cols-3">
            <Item label={t("shop.part.created")}>{formatDate(p.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</Item>
            <Item label={t("shop.inv.supplier")}>{dash(p.supplierName)}</Item>
            <Item label={t("shop.part.substitutes")}>
              {p.substitutes.length ? <button type="button" onClick={() => onGo("substitutes")} className="text-primary hover:underline">{p.substitutes.map((s) => s.part.name).join(", ")}</button> : "—"}
            </Item>
            <Item label={t("shop.inv.notes")} wide>{p.notes ? <span className="whitespace-pre-line">{p.notes}</span> : "—"}</Item>
          </div>
        </>
      )}
    </Card>
  );
}

function SpecsEditor({ p, onChanged }: { p: PartView; onChanged: (p: PartView) => void }) {
  const t = useT();
  const access = useAccess();
  const action = useAction();
  const [rows, setRows] = useState<Spec[]>(p.specs);
  const edit = access.can("catalogue");
  const dirty = JSON.stringify(rows) !== JSON.stringify(p.specs);

  if (!edit) {
    return p.specs.length ? (
      <dl className="divide-y divide-border text-sm">{p.specs.map((s, i) => <div key={i} className="grid grid-cols-[200px_1fr] py-2"><dt className="font-medium">{s.name}</dt><dd className="text-muted-foreground">{s.value}</dd></div>)}</dl>
    ) : (
      <Empty title={t("shop.part.noSpecs")} />
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("shop.part.specsHint")}</p>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2">
          <input value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder={t("shop.part.specName")} maxLength={60} className={inputCls} />
          <input value={r.value} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} placeholder={t("shop.part.specValue")} maxLength={120} className={inputCls} />
          <button type="button" aria-label={t("garage.action.remove")} onClick={() => setRows(rows.filter((_, k) => k !== i))} className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setRows([...rows, { name: "", value: "" }])} className={`${btnSecondary} ${btnSm}`}>+ {t("shop.part.addSpec")}</button>
        <button type="button" disabled={!dirty || action.busy !== null} onClick={async () => { const next = await action.run("specs", () => updatePart(p.id, { specs: rows.filter((r) => r.name.trim() && r.value.trim()) })); if (next) onChanged(next); }} className={`${btnPrimary} ${btnSm}`}>
          {action.busy === "specs" && <Spinner />} {t("garage.action.save")}
        </button>
      </div>
      {action.error && <ErrorNote message={action.error} />}
    </div>
  );
}

function FilesSection({ p, onChanged }: { p: PartView; onChanged: () => void }) {
  const t = useT();
  const access = useAccess();
  const action = useAction();
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [link, setLink] = useState({ name: "", url: "", kind: "LINK" as "LINK" | "DOCUMENT" | "IMAGE" });
  const edit = access.can("catalogue");
  const images = p.files.filter((f) => f.kind === "IMAGE");
  const docs = p.files.filter((f) => f.kind !== "IMAGE");

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setProgress({ name: f.name, pct: 0 });
      const ok = await action.run("upload", () => uploadPartFile(p.id, f, (x) => setProgress({ name: f.name, pct: Math.round(x * 100) })));
      if (!ok) break;
    }
    setProgress(null);
    onChanged();
  }

  return (
    <div className="space-y-5">
      {edit && (
        <Card className="space-y-3">
          <label
            className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border bg-canvas px-4 py-8 text-center text-sm text-muted-foreground hover:border-primary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files); }}
          >
            {action.busy === "upload" ? <Spinner /> : <Upload className="size-6" />}
            {progress ? t("shop.part.uploading", { name: progress.name, pct: progress.pct }) : t("shop.part.dropFiles")}
            <span className="text-xs">{t("shop.part.fileLimits")}</span>
            <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip" className="sr-only" onChange={(e) => upload(e.target.files)} />
          </label>
          <form className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto_auto]" onSubmit={async (e) => { e.preventDefault(); if (await action.run("link", () => addPartLink(p.id, { name: link.name.trim(), url: link.url.trim(), kind: link.kind }))) { setLink({ name: "", url: "", kind: "LINK" }); onChanged(); } }}>
            <input value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} placeholder={t("shop.part.linkName")} maxLength={160} className={inputCls} />
            <input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://…" type="url" className={inputCls} />
            <select value={link.kind} onChange={(e) => setLink({ ...link, kind: e.target.value as typeof link.kind })} className={`${inputCls} w-auto!`}>
              <option value="LINK">{t("shop.part.kind.LINK")}</option>
              <option value="DOCUMENT">{t("shop.part.kind.DOCUMENT")}</option>
              <option value="IMAGE">{t("shop.part.kind.IMAGE")}</option>
            </select>
            <button type="submit" disabled={!link.name.trim() || !/^https?:\/\//.test(link.url.trim()) || action.busy !== null} className={btnSecondary}><Link2 /> {t("shop.part.addLink")}</button>
          </form>
          {action.error && <ErrorNote message={action.error} />}
        </Card>
      )}
      <Card>
        <CardHeader title={t("shop.part.photos")} />
        {images.length === 0 ? <p className="text-sm text-muted-foreground">{t("shop.part.noPhotos")}</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {images.map((f) => (
              <figure key={f.id} className={`overflow-hidden rounded-xl border ${f.primary ? "border-primary" : "border-border"} bg-white`}>
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="block aspect-square bg-canvas">{f.url && <img src={f.url} alt={f.name} className="size-full object-contain" />}</a>
                <figcaption className="flex items-center gap-1 px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {edit && !f.primary && <button type="button" aria-label={t("shop.part.makeMain")} title={t("shop.part.makeMain")} onClick={async () => (await action.run(f.id, () => updatePartFile(p.id, f.id, { primary: true }))) && onChanged()} className="text-muted-foreground hover:text-primary"><Star className="size-3.5" /></button>}
                  {f.primary && <Star className="size-3.5 fill-primary text-primary" />}
                  {edit && <button type="button" aria-label={t("garage.action.remove")} onClick={async () => window.confirm(t("shop.part.confirmRemove", { name: f.name })) && (await action.run(f.id, () => removePartFile(p.id, f.id))) && onChanged()} className="text-muted-foreground hover:text-bad"><Trash2 className="size-3.5" /></button>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-0!">
        <div className="px-5 pt-4"><CardHeader title={t("shop.part.documents")} /></div>
        {docs.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.noDocs")}</p> : (
          <ul className="divide-y divide-border text-sm">
            {docs.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-2.5">
                {f.kind === "LINK" ? <ExternalLink className="size-4 text-muted-foreground" /> : <FileText className="size-4 text-muted-foreground" />}
                <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">{f.name}</a>
                <span className="text-xs text-muted-foreground">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB · ` : ""}{f.byName}</span>
                {edit && <button type="button" aria-label={t("garage.action.remove")} onClick={async () => window.confirm(t("shop.part.confirmRemove", { name: f.name })) && (await action.run(f.id, () => removePartFile(p.id, f.id))) && onChanged()} className="text-muted-foreground hover:text-bad"><Trash2 className="size-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StockSection({ shop, p, onGo }: { shop: Shop; p: PartView; onGo: (s: Section) => void }) {
  const t = useT();
  const money = useMoney();
  const access = useAccess();
  const rows = p.stockByLocation ?? [];
  return (
    <Card className="p-0!">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
        <CardHeader title={t("shop.part.where")} sub={t("shop.part.totalN", { n: p.stockQty, unit: p.unit })} />
        {access.can("stock") && (
          <span className="flex gap-2">
            <button type="button" onClick={() => onGo("add")} className={`${btnSecondary} ${btnSm}`}><PlusSquare /> {t("shop.part.menu.add")}</button>
            <button type="button" onClick={() => onGo("move")} className={`${btnSecondary} ${btnSm}`}><ArrowRightLeft /> {t("shop.part.menu.move")}</button>
          </span>
        )}
      </div>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">{t("shop.part.location")}</th><th className="px-3 py-2 text-right font-medium">{t("parts.field.stock")}</th>{p.costPrice != null && <th className="px-5 py-2 text-right font-medium">{t("shop.rep.atCost")}</th>}</tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.locationId} className="border-t border-border">
              <td className="px-5 py-2.5 font-medium">{l.name} {l.default && <Badge tone="brand" dot={false}>{t("shop.part.default")}</Badge>}</td>
              <td className={`px-3 py-2.5 text-right tabular-nums ${l.qty <= 0 ? "text-muted-foreground" : "font-semibold"}`}>{l.qty}</td>
              {p.costPrice != null && <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{money(Math.max(0, l.qty) * p.costPrice, shop.currency)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function LocationSelect({ value, onChange, label, allowNew = false, only }: { value: string; onChange: (v: string) => void; label: string; allowNew?: boolean; only?: { locationId: string; name: string; qty: number }[] }) {
  const t = useT();
  const locs = useLoad(listLocations, []);
  const options = only ?? (locs.data ?? []).filter((l) => l.active).map((l) => ({ locationId: l.id, name: l.name, qty: NaN }));
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map((o) => <option key={o.locationId} value={o.locationId}>{o.name}{Number.isFinite(o.qty) ? ` (${o.qty})` : ""}</option>)}
        {allowNew && <option value="__new">{t("shop.part.newLocation")}</option>}
      </select>
    </Field>
  );
}

function AdjustSection({ p, mode, onChanged }: { p: PartView; mode: "add" | "remove"; onChanged: (p: PartView) => void }) {
  const t = useT();
  const action = useAction();
  const here = p.stockByLocation ?? [];
  const [loc, setLoc] = useState(p.defaultLocationId);
  const [qty, setQty] = useState("");
  const [why, setWhy] = useState<"ADJUSTMENT" | "DAMAGED">("ADJUSTMENT");
  const [note, setNote] = useState("");
  const atLoc = here.find((l) => l.locationId === loc)?.qty ?? 0;
  const n = Number(qty) || 0;
  return (
    <Card className="max-w-xl space-y-4">
      <CardHeader title={t(`shop.part.menu.${mode}`)} sub={mode === "add" ? t("shop.part.addHint") : t("shop.part.removeHint")} />
      <LocationSelect value={loc} onChange={setLoc} label={t("shop.part.location")} only={mode === "remove" ? here.filter((l) => l.qty > 0) : undefined} />
      <Field label={t("garage.field.qty")} hint={mode === "remove" ? t("shop.part.atLocation", { n: atLoc }) : undefined}><input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></Field>
      {mode === "remove" && <Segmented value={why} onChange={setWhy} options={[{ value: "ADJUSTMENT", label: t("shop.part.why.ADJUSTMENT") }, { value: "DAMAGED", label: t("shop.part.why.DAMAGED") }]} />}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("shop.inv.adjustNote")} maxLength={500} className={inputCls} />
      {action.error && <ErrorNote message={action.error} />}
      <button
        type="button"
        disabled={action.busy !== null || n <= 0 || (mode === "remove" && n > atLoc)}
        onClick={async () => {
          const next = await action.run("adj", () => adjustStock(p.id, { change: mode === "add" ? n : -n, reason: mode === "add" ? "ADJUSTMENT" : why, locationId: loc, note: note.trim() || null }));
          if (next) {
            setQty("");
            setNote("");
            onChanged(next);
          }
        }}
        className={mode === "add" ? btnPrimary : btnDanger}
      >
        {action.busy === "adj" ? <Spinner /> : mode === "add" ? <PlusSquare /> : <MinusSquare />} {t(`shop.part.menu.${mode}`)}
      </button>
    </Card>
  );
}

function MoveSection({ p, onChanged }: { p: PartView; onChanged: (p: PartView) => void }) {
  const t = useT();
  const action = useAction();
  const here = (p.stockByLocation ?? []).filter((l) => l.qty > 0);
  const [from, setFrom] = useState(here[0]?.locationId ?? "");
  const [to, setTo] = useState("");
  const [newName, setNewName] = useState("");
  const [qty, setQty] = useState("");
  const avail = here.find((l) => l.locationId === from)?.qty ?? 0;
  const n = Number(qty) || 0;
  if (!here.length) return <Card><Empty title={t("shop.part.nothingToMove")} /></Card>;
  return (
    <Card className="max-w-xl space-y-4">
      <CardHeader title={t("shop.part.menu.move")} sub={t("shop.part.moveHint")} />
      <LocationSelect value={from} onChange={setFrom} label={t("shop.part.from")} only={here} />
      <LocationSelect value={to} onChange={setTo} label={t("shop.part.to")} allowNew />
      {to === "__new" && <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("shop.part.newLocationName")} maxLength={60} className={inputCls} />}
      <Field label={t("garage.field.qty")} hint={t("shop.part.atLocation", { n: avail })}><input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></Field>
      {action.error && <ErrorNote message={action.error} />}
      <button
        type="button"
        disabled={action.busy !== null || n <= 0 || n > avail || !to || (to === "__new" && !newName.trim()) || to === from}
        onClick={async () => {
          const next = await action.run("move", async () => {
            const target = to === "__new" ? (await createLocation({ name: newName.trim() })).id : to;
            return transferStock(p.id, { fromLocationId: from, toLocationId: target, quantity: n });
          });
          if (next) {
            setQty("");
            setNewName("");
            setTo("");
            onChanged(next);
          }
        }}
        className={btnPrimary}
      >
        {action.busy === "move" ? <Spinner /> : <ArrowRightLeft />} {t("shop.part.menu.move")}
      </button>
    </Card>
  );
}

function OpenPacks({ p, onChanged }: { p: PartView; onChanged: (p: PartView) => void }) {
  const t = useT();
  const action = useAction();
  const [n, setN] = useState("1");
  const packs = Math.max(0, Math.floor(Number(n) || 0));
  return (
    <Card className="max-w-xl space-y-3">
      <CardHeader title={t("shop.kit.openTitle")} sub={t("shop.kit.openHint", { qty: p.breaksInto?.qty ?? 0, unit: p.breaksInto?.unit ?? "", name: p.breaksInto?.name ?? "" })} />
      <div className="flex gap-2">
        <input type="number" min={1} step={1} max={p.stockQty} value={n} onChange={(e) => setN(e.target.value)} aria-label={t("shop.kit.howMany")} className={`${inputCls} w-24!`} />
        <button type="button" disabled={action.busy !== null || packs < 1 || packs > p.stockQty} onClick={async () => { const next = await action.run("open", () => openPacks(p.id, { quantity: packs })); if (next) onChanged(next); }} className={btnPrimary}>
          {action.busy === "open" ? <Spinner /> : <PackageOpen />} {t("shop.kit.open", { n: packs, total: packs * (p.breaksInto?.qty ?? 0), unit: p.breaksInto?.unit ?? "" })}
        </button>
      </div>
      {action.error && <ErrorNote message={action.error} />}
    </Card>
  );
}

function KitEditor({ shop, p, onChanged }: { shop: Shop; p: PartView; onChanged: (p: PartView) => void }) {
  const t = useT();
  const money = useMoney();
  const action = useAction();
  const [rows, setRows] = useState<{ partId: string; name: string; quantity: number; cost: number | null }[]>(p.kitComponents.map((c) => ({ partId: c.partId, name: c.name, quantity: c.quantity, cost: c.costPrice })));
  const cost = rows.reduce((s, r) => s + (r.cost ?? 0) * r.quantity, 0);
  return (
    <Card className="space-y-3">
      <CardHeader title={t("shop.kit.title")} sub={p.isKit ? t("shop.kit.isKit") : t("shop.kit.hint")} />
      {!p.isKit && p.stockQty > 0 && <p className="text-xs text-warn">{t("shop.kit.hasStock")}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {rows.map((r) => (
            <li key={r.partId} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <input type="number" min={0.001} step="any" value={r.quantity} onChange={(e) => setRows(rows.map((x) => (x.partId === r.partId ? { ...x, quantity: Number(e.target.value) || 0 } : x)))} aria-label={t("garage.field.qty")} className={`${inputCls} w-20! py-1! text-right`} />
              <button type="button" aria-label={t("garage.action.remove")} onClick={() => setRows(rows.filter((x) => x.partId !== r.partId))} className="text-muted-foreground hover:text-bad"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <PartPicker onPick={(x: Part) => x.id !== p.id && !x.isKit && setRows((rs) => (rs.some((r) => r.partId === x.id) ? rs : [...rs, { partId: x.id, name: x.name, quantity: 1, cost: x.costPrice }]))} placeholder={t("shop.kit.add")} />
      {rows.length > 0 && p.costPrice !== null && <p className="text-xs text-muted-foreground">{t("shop.kit.cost", { cost: money(cost, shop.currency), price: money(p.retailPrice, shop.currency) })}</p>}
      {action.error && <ErrorNote message={action.error} />}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={action.busy !== null || !rows.some((r) => r.quantity > 0)} onClick={async () => { const next = await action.run("kit", () => setKit(p.id, rows.filter((r) => r.quantity > 0).map((r) => ({ partId: r.partId, quantity: r.quantity })))); if (next) onChanged(next); }} className={btnPrimary}>
          {action.busy === "kit" && <Spinner />} {p.isKit ? t("garage.action.save") : t("shop.kit.make")}
        </button>
        {p.isKit && <button type="button" disabled={action.busy !== null} onClick={async () => { const next = await action.run("unkit", () => unsetKit(p.id)); if (next) { setRows([]); onChanged(next); } }} className={btnSecondary}>{t("shop.kit.unmake")}</button>}
      </div>
    </Card>
  );
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function HistorySection({ shop, p }: { shop: Shop; p: PartView }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [loc, setLoc] = useState("");
  const rows = p.movements.filter((m) => !loc || m.locationId === loc);
  const locations = useMemo(() => [...new Map(p.movements.filter((m) => m.locationId).map((m) => [m.locationId!, m.locationName ?? ""])).entries()], [p.movements]);
  const exportCsv = () => {
    const lines = [["date", "reason", "change", "location", "by", "unit_cost", "note"], ...rows.map((m) => [m.createdAt, m.reason, m.quantityChange, m.locationName, m.byName, m.unitCost, m.note])];
    const url = URL.createObjectURL(new Blob(["﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.sku}-stock-history.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Card className="p-0!">
      <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
        <CardHeader title={t("shop.part.menu.history")} />
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Chip on={loc === ""} onClick={() => setLoc("")}>{t("shop.count.filterAll")}</Chip>
          {locations.map(([id, name]) => <Chip key={id} on={loc === id} onClick={() => setLoc(id)}>{name}</Chip>)}
          <button type="button" onClick={exportCsv} className={`${btnSecondary} ${btnSm}`}><Download /> CSV</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.noHistory")}</p> : (
        <ul className="divide-y divide-border text-sm">
          {rows.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t(`shop.reason.${m.reason}`)}{m.locationName && <span className="font-normal text-muted-foreground"> · {m.locationName}</span>}</span>
                <span className="block truncate text-xs text-muted-foreground">{formatDate(m.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}{m.byName && ` · ${m.byName}`}{m.note && ` · ${m.note}`}</span>
              </span>
              <span className={`font-semibold tabular-nums ${m.quantityChange < 0 ? "text-bad" : "text-ok"}`}>{m.quantityChange > 0 ? "+" : ""}{m.quantityChange}</span>
              {m.unitCost != null && <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{money(m.unitCost, shop.currency)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TradeSection({ shop, p, view }: { shop: Shop; p: PartView; view: "purchasing" | "sales" }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const trade = useLoad(() => getPartTrade(p.id), [p.id]);
  const cur = shop.currency;
  if (trade.error) return <ErrorNote message={trade.error} onRetry={trade.reload} />;
  if (!trade.data) return <Loading />;
  const d = trade.data;
  const day = (s: string) => formatDate(s, { day: "numeric", month: "short", year: "numeric" });

  if (view === "purchasing") {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.part.ordered")}</p><p className="mt-1 font-display text-xl font-bold">{p.onOrder}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.part.reorder")}</p><p className="mt-1 font-display text-xl font-bold">{p.reorderLevel} / {p.reorderQty}</p></Card>
          {p.costPrice != null && <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.part.avgCost")}</p><p className="mt-1 font-display text-xl font-bold">{money(p.costPrice, cur)}</p></Card>}
          <Card className="flex items-center p-4"><a href="#purchases" className={`${btnSecondary} ${btnSm}`}><Truck /> {t("shop.part.orderMore")}</a></Card>
        </div>
        {p.costPrice == null ? <Card><p className="text-sm text-muted-foreground">{t("shop.part.noCostAccess")}</p></Card> : (
          <>
            <Card className="p-0!">
              <div className="px-5 pt-4"><CardHeader title={t("shop.part.supplierPrices")} /></div>
              {d.suppliers.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.neverBought")}</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-5 py-2 font-medium">{t("shop.pur.supplier")}</th><th className="px-3 py-2 text-right font-medium">{t("shop.part.lastCost")}</th><th className="px-3 py-2 text-right font-medium">{t("shop.part.bestCost")}</th><th className="px-3 py-2 text-right font-medium">{t("shop.part.bought")}</th><th className="px-5 py-2 text-right font-medium">{t("shop.part.lastBought")}</th></tr></thead>
                  <tbody>{d.suppliers.map((s, i) => (
                    <tr key={s.id} className="border-t border-border"><td className="px-5 py-2.5 font-medium">{s.name} {i === 0 && d.suppliers.length > 1 && <Badge tone="ok" dot={false}>{t("shop.part.cheapest")}</Badge>}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(s.lastCost, cur)}</td><td className="px-3 py-2.5 text-right tabular-nums">{money(s.bestCost, cur)}</td><td className="px-3 py-2.5 text-right tabular-nums">{s.bought}</td><td className="px-5 py-2.5 text-right text-xs text-muted-foreground">{day(s.lastAt)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Card>
            <Card className="p-0!">
              <div className="px-5 pt-4"><CardHeader title={t("shop.part.purchaseOrders")} /></div>
              {d.purchases.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.neverBought")}</p> : (
                <ul className="divide-y divide-border text-sm">{d.purchases.map((x) => (
                  <li key={x.purchaseId} className="flex items-center gap-3 px-5 py-2.5"><span className="w-16 font-mono text-muted-foreground">PO {x.number}</span><span className="min-w-0 flex-1 truncate">{x.supplier.name} · {day(x.createdAt)}</span><Badge tone="gray" dot={false}>{t(`shop.po.${x.status}`)}</Badge><span className="w-20 text-right tabular-nums">{x.receivedQty}/{x.quantity}</span><span className="w-28 text-right tabular-nums">{money(x.unitCost, cur)}</span></li>
                ))}</ul>
              )}
            </Card>
          </>
        )}
      </div>
    );
  }

  const sold = d.sales.filter((s) => !s.voided).reduce((t2, s) => t2 + s.quantity - s.returnedQty, 0) + d.orders.filter((o) => o.status === "COMPLETED").reduce((t2, o) => t2 + o.quantity, 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.part.soldShown")}</p><p className="mt-1 font-display text-xl font-bold">{sold}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.part.counterSales")}</p><p className="mt-1 font-display text-xl font-bold">{d.sales.length}</p></Card>
        <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.part.garageOrders")}</p><p className="mt-1 font-display text-xl font-bold">{d.orders.length}</p></Card>
      </div>
      <Card className="p-0!">
        <div className="px-5 pt-4"><CardHeader title={t("shop.part.counterSales")} /></div>
        {d.sales.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.neverSold")}</p> : (
          <ul className="divide-y divide-border text-sm">{d.sales.map((x, i) => (
            <li key={`${x.saleId}-${i}`} className={`flex items-center gap-3 px-5 py-2.5 ${x.voided ? "opacity-50" : ""}`}>
              <span className="w-14 font-mono text-muted-foreground">#{x.number}</span>
              <span className="min-w-0 flex-1 truncate">{[x.customerName, x.plate, x.serialNumber, x.cashierName].filter(Boolean).join(" · ") || "—"} · {day(x.createdAt)}</span>
              {x.voided && <Badge tone="bad" dot={false}>{t("shop.sale.voided")}</Badge>}
              {x.returnedQty > 0 && <Badge tone="warn" dot={false}>{t("shop.sale.returnedN", { n: x.returnedQty })}</Badge>}
              <span className="w-12 text-right tabular-nums">{x.quantity}</span>
              <span className="w-28 text-right tabular-nums">{money(x.unitPrice, cur)}</span>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card className="p-0!">
        <div className="px-5 pt-4"><CardHeader title={t("shop.part.garageOrders")} /></div>
        {d.orders.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.noOrders")}</p> : (
          <ul className="divide-y divide-border text-sm">{d.orders.map((x, i) => (
            <li key={`${x.orderId}-${i}`} className="flex items-center gap-3 px-5 py-2.5"><span className="w-14 font-mono text-muted-foreground">#{x.number}</span><span className="min-w-0 flex-1 truncate">{x.garageName} · {day(x.createdAt)}</span><Badge tone="gray" dot={false}>{t(`parts.status.${x.status}`)}</Badge><span className="w-12 text-right tabular-nums">{x.quantity}</span><span className="w-28 text-right tabular-nums">{x.unitPrice != null ? money(x.unitPrice, cur) : "—"}</span></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function SubstitutesSection({ shop, p, onChanged, onOpen }: { shop: Shop; p: PartView; onChanged: (p: PartView) => void; onOpen: (id: string) => void }) {
  const t = useT();
  const money = useMoney();
  const access = useAccess();
  const action = useAction();
  const [note, setNote] = useState("");
  const edit = access.can("catalogue");
  return (
    <div className="space-y-5">
      {edit && (
        <Card className="space-y-3">
          <CardHeader title={t("shop.part.addSubstitute")} sub={t("shop.part.substitutesHint")} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("shop.part.substituteNote")} maxLength={300} className={inputCls} />
          <PartPicker onPick={async (other: Part) => { const next = await action.run("sub", () => addSubstitute(p.id, other.id, note.trim() || null)); if (next) { setNote(""); onChanged(next); } }} />
          {action.error && <ErrorNote message={action.error} />}
        </Card>
      )}
      <Card className="p-0!">
        <div className="px-5 pt-4"><CardHeader title={t("shop.part.menu.substitutes")} /></div>
        {p.substitutes.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.part.noSubstitutes")}</p> : (
          <ul className="divide-y divide-border text-sm">{p.substitutes.map((s) => (
            <li key={s.part.id} className="flex items-center gap-3 px-5 py-2.5">
              <button type="button" onClick={() => onOpen(s.part.id)} className="min-w-0 flex-1 text-left">
                <span className="block font-medium text-primary hover:underline">{s.part.name}{s.part.brand && <span className="font-normal text-muted-foreground"> · {s.part.brand}</span>}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{s.part.sku}{s.note && <span className="font-sans"> · {s.note}</span>}</span>
              </button>
              <span className={`text-xs ${s.part.stockQty > 0 ? "text-ok" : "text-bad"}`}>{t("shop.stockShort", { n: s.part.stockQty })}</span>
              <span className="w-28 text-right tabular-nums">{money(s.part.retailPrice, shop.currency)}</span>
              {edit && <button type="button" aria-label={t("garage.action.remove")} onClick={async () => { const next = await action.run(s.part.id, () => removeSubstitute(p.id, s.part.id)); if (next) onChanged(next); }} className="text-muted-foreground hover:text-bad"><Trash2 className="size-4" /></button>}
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}

function OtherSection({ shop, p, onChanged }: { shop: Shop; p: PartView; onChanged: (p: PartView) => void }) {
  const t = useT();
  const access = useAccess();
  const action = useAction();
  const [copies, setCopies] = useState(Math.max(1, Math.round(p.stockQty)));
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card className="space-y-3">
        <CardHeader title={t("shop.labels.title")} sub={p.barcode ? p.barcode : t("shop.labels.noBarcode")} />
        <Field label={t("shop.labels.copies")}><input type="number" min={1} max={100} value={copies} onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))} className={`${inputCls} w-28!`} /></Field>
        <button type="button" onClick={() => printLabels(shop, [{ ...p, copies }], t)} className={btnSecondary}><Printer /> {t("shop.labels.print")}</button>
      </Card>
      <Card className="space-y-3">
        <CardHeader title={t("shop.part.quickLinks")} />
        <div className="flex flex-wrap gap-2">
          <a href="#sale" className={`${btnSecondary} ${btnSm}`}><Receipt /> {t("shop.tab.sale")}</a>
          <a href="#purchases" className={`${btnSecondary} ${btnSm}`}><Truck /> {t("shop.part.orderMore")}</a>
          <a href="#stocktake" className={`${btnSecondary} ${btnSm}`}><Tags /> {t("shop.tab.stocktake")}</a>
        </div>
      </Card>
      {access.can("catalogue") && (
        <Card className="space-y-3 md:col-span-2">
          <CardHeader title={p.active ? t("shop.inv.deactivate") : t("shop.inv.reactivate")} sub={p.active ? t("shop.part.deactivateHint") : t("shop.part.reactivateHint")} />
          {action.error && <ErrorNote message={action.error} />}
          <button type="button" disabled={action.busy !== null} onClick={async () => { const next = await action.run("active", () => updatePart(p.id, { active: !p.active })); if (next) onChanged(next); }} className={p.active ? btnDanger : btnPrimary}>
            {action.busy === "active" && <Spinner />} {p.active ? t("shop.inv.deactivate") : t("shop.inv.reactivate")}
          </button>
        </Card>
      )}
    </div>
  );
}
