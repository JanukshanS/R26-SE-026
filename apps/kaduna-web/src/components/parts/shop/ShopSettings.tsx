"use client";

/**
 * The shop's details, also the first-time setup: contact, pickup address,
 * delivery, VAT and receipts, and the counter's rules (discount limit, cash
 * drawer). Everyone at the shop can set their own approval PIN here; only the
 * owner changes the shop.
 */
import { useState } from "react";
import { KeyRound, Store } from "lucide-react";

import { Card, ErrorNote, Field, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, num, text, useAction, useLoad } from "@/components/garage/ui";
import { useT } from "@/lib/i18n";
import { listCategories, listReturnRules, saveMyShop, saveReturnRules, setMyPin, type ReturnRule, type Shop } from "@/lib/partsApi";

import { useAccess } from "./access";

export default function ShopSettings({ shop, onSaved }: { shop: Shop | null; onSaved: (s: Shop) => void }) {
  const t = useT();
  const access = useAccess();
  const action = useAction();
  const [delivers, setDelivers] = useState(shop?.delivers ?? true);
  const [requireDrawer, setRequireDrawer] = useState(shop?.requireCashSession ?? false);
  const canEdit = !shop || access.can("settings");

  async function submit(form: FormData) {
    const saved = await action.run("save", () =>
      saveMyShop({
        name: text(form.get("name")) ?? "",
        phone: text(form.get("phone")),
        email: text(form.get("email")),
        address: text(form.get("address")),
        city: text(form.get("city")),
        registrationNo: text(form.get("registrationNo")),
        openingHours: text(form.get("openingHours")),
        delivers,
        deliveryNote: delivers ? text(form.get("deliveryNote")) : null,
        taxRate: num(form.get("taxRate")) ?? 0,
        vatNumber: text(form.get("vatNumber")),
        receiptFooter: text(form.get("receiptFooter")),
        receiptWidth: (text(form.get("receiptWidth")) ?? "80mm") as Shop["receiptWidth"],
        maxDiscountPct: num(form.get("maxDiscountPct")) ?? 10,
        requireCashSession: requireDrawer,
      })
    );
    if (saved) onSaved(saved);
  }

  return (
    <div className="max-w-2xl space-y-5">
      {shop && <MyPin />}
      {canEdit ? (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(new FormData(e.currentTarget)); }}>
          <Card className="space-y-4">
            {!shop && (
              <div>
                <h2 className="font-display text-xl font-bold">{t("parts.shop.setupTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("shop.settings.setupBody")}</p>
              </div>
            )}
            <Field label={t("parts.shop.name")}><input name="name" required maxLength={160} defaultValue={shop?.name} placeholder={t("parts.shop.namePlaceholder")} className={inputCls} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("garage.field.phone")}><input name="phone" maxLength={40} defaultValue={shop?.phone ?? ""} className={inputCls} /></Field>
              <Field label={t("garage.field.email")}><input name="email" type="email" maxLength={200} defaultValue={shop?.email ?? ""} className={inputCls} /></Field>
            </div>
            <Field label={t("parts.shop.address")} hint={t("parts.shop.addressHint")}><input name="address" maxLength={500} defaultValue={shop?.address ?? ""} className={inputCls} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("parts.shop.city")}><input name="city" maxLength={80} defaultValue={shop?.city ?? ""} placeholder="Colombo" className={inputCls} /></Field>
              <Field label={t("parts.shop.hours")}><input name="openingHours" maxLength={200} defaultValue={shop?.openingHours ?? ""} placeholder={t("parts.shop.hoursPlaceholder")} className={inputCls} /></Field>
            </div>
          </Card>

          <Card className="space-y-4">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={delivers} onChange={(e) => setDelivers(e.target.checked)} className="size-4 accent-primary" />
              <span><span className="block font-medium">{t("parts.shop.delivers")}</span><span className="block text-xs text-muted-foreground">{t("parts.shop.deliversHint")}</span></span>
            </label>
            {delivers && <Field label={t("parts.shop.deliveryNote")}><input name="deliveryNote" maxLength={500} defaultValue={shop?.deliveryNote ?? ""} placeholder={t("parts.shop.deliveryNotePlaceholder")} className={inputCls} /></Field>}
          </Card>

          <Card className="space-y-4">
            <h3 className="text-sm font-semibold">{t("shop.settings.receipts")}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("shop.settings.tax")} hint={t("shop.settings.taxHint")}><input name="taxRate" type="number" min={0} max={100} step="0.01" defaultValue={shop?.taxRate ?? 0} className={inputCls} /></Field>
              <Field label={t("shop.settings.vatNumber")} hint={t("shop.settings.vatNumberHint")}><input name="vatNumber" maxLength={40} defaultValue={shop?.vatNumber ?? ""} placeholder="114567890-7000" className={inputCls} /></Field>
              <Field label={t("shop.settings.registration")}><input name="registrationNo" maxLength={80} defaultValue={shop?.registrationNo ?? ""} className={inputCls} /></Field>
              <Field label={t("shop.settings.printer")}>
                <select name="receiptWidth" defaultValue={shop?.receiptWidth ?? "80mm"} className={inputCls}>
                  <option value="80mm">{t("shop.settings.printer80")}</option>
                  <option value="58mm">{t("shop.settings.printer58")}</option>
                  <option value="A4">{t("shop.settings.printerA4")}</option>
                </select>
              </Field>
            </div>
            <Field label={t("shop.settings.footer")}><input name="receiptFooter" maxLength={500} defaultValue={shop?.receiptFooter ?? ""} placeholder={t("shop.settings.footerPlaceholder")} className={inputCls} /></Field>
          </Card>

          {shop && (
            <Card className="space-y-4">
              <h3 className="text-sm font-semibold">{t("shop.settings.counter")}</h3>
              <Field label={t("shop.settings.maxDiscount")} hint={t("shop.settings.maxDiscountHint")}><input name="maxDiscountPct" type="number" min={0} max={100} step="0.5" defaultValue={shop.maxDiscountPct} className={`${inputCls} max-w-40`} /></Field>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" checked={requireDrawer} onChange={(e) => setRequireDrawer(e.target.checked)} className="size-4 accent-primary" />
                <span><span className="block font-medium">{t("shop.settings.requireDrawer")}</span><span className="block text-xs text-muted-foreground">{t("shop.settings.requireDrawerHint")}</span></span>
              </label>
            </Card>
          )}

          {action.error && <ErrorNote message={action.error} />}
          <button type="submit" disabled={action.busy !== null} className={btnPrimary}>{action.busy === "save" ? <Spinner /> : <Store />} {shop ? t("garage.action.save") : t("parts.shop.open")}</button>
        </form>
      ) : (
        <Card className="space-y-1 text-sm">
          <p className="font-semibold">{shop!.name}</p>
          {shop!.address && <p className="text-muted-foreground">{shop!.address}</p>}
          {shop!.phone && <p className="text-muted-foreground">{shop!.phone}</p>}
          <p className="pt-2 text-xs text-muted-foreground">{t("shop.settings.ownerOnly")}</p>
        </Card>
      )}
      {shop && canEdit && <ReturnRules />}
    </div>
  );
}

/** What can come back, per category, with a default for the rest. */
function ReturnRules() {
  const t = useT();
  const action = useAction();
  const saved = useLoad(listReturnRules, []);
  const cats = useLoad(listCategories, []);
  const [rows, setRows] = useState<Omit<ReturnRule, "id">[] | null>(null);
  const list = rows ?? saved.data?.map(({ id: _id, ...r }) => r) ?? [];
  const set = (i: number, next: Partial<Omit<ReturnRule, "id">>) => setRows(list.map((r, k) => (k === i ? { ...r, ...next } : r)));
  const hasDefault = list.some((r) => r.category == null);
  return (
    <Card className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("shop.ret.title")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("shop.ret.body")}</p>
      </div>
      {saved.error ? <ErrorNote message={saved.error} onRetry={saved.reload} /> : (
        <div className="space-y-2">
          {list.map((r, i) => (
            <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1.4fr_auto_6rem_6rem_1.4fr_auto]">
              {r.category == null ? (
                <span className="px-2 text-sm font-medium">{t("shop.ret.default")}</span>
              ) : (
                <>
                  <input list="rule-cats" value={r.category} onChange={(e) => set(i, { category: e.target.value })} placeholder={t("shop.inv.category")} maxLength={80} className={`${inputCls} py-1.5!`} />
                </>
              )}
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.returnable} onChange={(e) => set(i, { returnable: e.target.checked })} className="size-4 accent-primary" /> {t("shop.ret.returnable")}</label>
              <input type="number" min={0} value={r.days ?? ""} onChange={(e) => set(i, { days: e.target.value === "" ? null : Number(e.target.value) })} placeholder={t("shop.ret.anyTime")} aria-label={t("shop.ret.days")} disabled={!r.returnable} className={`${inputCls} py-1.5!`} />
              <input type="number" min={0} max={100} step="0.5" value={r.feePct || ""} onChange={(e) => set(i, { feePct: Number(e.target.value) || 0 })} placeholder={t("shop.ret.fee")} aria-label={t("shop.ret.fee")} disabled={!r.returnable} className={`${inputCls} py-1.5!`} />
              <input value={r.note ?? ""} onChange={(e) => set(i, { note: e.target.value || null })} placeholder={t("shop.ret.note")} maxLength={300} className={`${inputCls} py-1.5!`} />
              <button type="button" onClick={() => setRows(list.filter((_, k) => k !== i))} className="text-xs text-muted-foreground hover:text-bad">{t("garage.action.remove")}</button>
            </div>
          ))}
          <datalist id="rule-cats">{(cats.data ?? []).map((c) => <option key={c.category} value={c.category} />)}</datalist>
          <div className="flex flex-wrap gap-2">
            {!hasDefault && <button type="button" onClick={() => setRows([{ category: null, returnable: true, days: 14, feePct: 0, note: null }, ...list])} className={`${btnSecondary} ${btnSm}`}>+ {t("shop.ret.addDefault")}</button>}
            <button type="button" onClick={() => setRows([...list, { category: "", returnable: false, days: null, feePct: 0, note: null }])} className={`${btnSecondary} ${btnSm}`}>+ {t("shop.ret.addCategory")}</button>
            <button
              type="button"
              disabled={rows === null || action.busy !== null}
              onClick={async () => {
                const next = await action.run("rules", () => saveReturnRules(list.filter((r) => r.category == null || r.category.trim()).map((r) => ({ ...r, category: r.category?.trim() || null }))));
                if (next) {
                  saved.setData(next);
                  setRows(null);
                }
              }}
              className={`${btnPrimary} ${btnSm}`}
            >
              {action.busy === "rules" && <Spinner />} {t("garage.action.save")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("shop.ret.days")} · {t("shop.ret.fee")}</p>
        </div>
      )}
      {action.error && <ErrorNote message={action.error} />}
    </Card>
  );
}

function MyPin() {
  const t = useT();
  const access = useAccess();
  const action = useAction();
  const [pin, setPin] = useState("");
  const [saved, setSaved] = useState(access.hasPin);
  const approver = access.can("discount");
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-primary"><KeyRound className="size-5" /></span>
        <div>
          <h3 className="text-sm font-semibold">{t("shop.pin.title")}</h3>
          <p className="text-xs text-muted-foreground">{approver ? t("shop.pin.bodyApprover") : t("shop.pin.bodyOther")}</p>
        </div>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={async (e) => { e.preventDefault(); if (await action.run("pin", () => setMyPin(pin))) { setPin(""); setSaved(true); } }}>
        <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" aria-label={t("shop.approve.pin")} className={`${inputCls} w-32! text-center font-mono tracking-[.4em]`} />
        <button type="submit" disabled={action.busy !== null || !/^\d{4,6}$/.test(pin)} className={btnSecondary}>{action.busy === "pin" && <Spinner />} {saved ? t("shop.pin.change") : t("shop.pin.set")}</button>
        {saved && <span className="self-center text-xs text-ok">{t("shop.pin.isSet")}</span>}
      </form>
      {action.error && <ErrorNote message={action.error} />}
    </Card>
  );
}
