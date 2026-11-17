"use client";

/**
 * The counter. Scan or search parts into a cart (price, line discount, serial
 * numbers, core deposits), take payment (one method, split, or on account),
 * and print a receipt or VAT tax invoice. A cart can be held for later or
 * written up as a quotation. Below: today's sales (reprint, return, void),
 * held sales, quotations and a warranty lookup.
 *
 * What the role can't do alone (a big discount, a refund, a void) opens a
 * manager-PIN prompt; the server decides, this screen just asks.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Ban, FileText, Minus, PauseCircle, Plus, Printer, RotateCcw, ScanBarcode, Search, ShieldCheck, Trash2, Wallet } from "lucide-react";

import { Badge, Card, CardHeader, Chip, Empty, ErrorNote, Field, Loading, Panel, Segmented, Spinner, btnDanger, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import {
  cancelDraft,
  createSale,
  getMyDrawer,
  getPart,
  listAccounts,
  listDrafts,
  listSales,
  lookupPart,
  lookupWarranty,
  cancelCredit,
  exchangeSale,
  findCredit,
  listCredits,
  PartsApiError,
  type StoreCredit,
  returnSale,
  saveDraft,
  voidSale,
  type Account,
  type Draft,
  type Part,
  type SaleMethod,
  type Sale,
  type SaleLineInput,
  type Shop,
} from "@/lib/partsApi";

import { useAccess, useApproval } from "./access";
import { PartPicker } from "./common";
import { printCredit, printQuote, printSale } from "./print";

type CartLine = {
  key: string;
  part: Part | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number | null;
  serials: string[];
  coreReturned: boolean;
};

// The browser's own date (Sri Lanka at the counter), not UTC.
const today = () => new Date().toLocaleDateString("en-CA");
const cents = (n: number) => Math.round(n * 100);
const SINGLE: SaleMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "ACCOUNT", "VOUCHER", "OTHER"];
/** How money goes back: VOUCHER is store credit. */
const REFUNDS: SaleMethod[] = ["CASH", "CARD", "BANK_TRANSFER", "VOUCHER", "ACCOUNT", "OTHER"];

/** Splits `total` cents over `weights`, the last share taking the rounding (as the server does). */
function allocate(total: number, weights: number[]) {
  const w = weights.reduce((a, b) => a + b, 0);
  if (!w || !total) return weights.map(() => 0);
  const out = weights.map((x) => Math.round((total * x) / w));
  out[out.length - 1] = total - out.slice(0, -1).reduce((a, b) => a + b, 0);
  return out;
}

/** The sale as the server will price it, in cents: VAT per line after both discounts; core deposits untaxed. */
function price(cart: CartLine[], saleDiscount: number, shopRate: number) {
  const lines = cart.flatMap((l) => {
    const main = { net: cents(l.unitPrice) * l.quantity - cents(l.discount), gross: cents(l.unitPrice) * l.quantity, rate: l.part ? (l.part.taxRate ?? shopRate) : (l.taxRate ?? shopRate), core: false };
    const core = l.part?.coreCharge && !l.coreReturned ? [{ net: cents(l.part.coreCharge) * l.quantity, gross: cents(l.part.coreCharge) * l.quantity, rate: 0, core: true }] : [];
    return [main, ...core];
  });
  const sd = cents(saleDiscount);
  const share = allocate(sd, lines.map((l) => (l.core ? 0 : Math.max(0, l.net))));
  const tax = lines.reduce((s, l, k) => s + Math.round(((l.net - share[k]) * l.rate) / 100), 0);
  const subtotal = lines.reduce((s, l) => s + l.gross, 0);
  const discount = cart.reduce((s, l) => s + cents(l.discount), 0) + sd;
  const goods = lines.filter((l) => !l.core).reduce((s, l) => s + l.net, 0);
  return { subtotal: subtotal / 100, discount: discount / 100, tax: tax / 100, total: (subtotal - discount + tax) / 100, cores: lines.filter((l) => l.core).reduce((s, l) => s + l.gross, 0) / 100, overDiscount: sd > goods };
}

const lineInput = (l: CartLine): SaleLineInput =>
  l.part
    ? { partId: l.part.id, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, ...(l.part.serialized ? { serialNumbers: l.serials.map((s) => s.trim()).filter(Boolean) } : {}), coreReturned: l.coreReturned }
    : { description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, ...(l.taxRate != null ? { taxRate: l.taxRate } : {}) };

const newLine = (p: Part): CartLine => ({ key: `${p.id}-${Date.now()}`, part: p, description: p.name, quantity: 1, unitPrice: p.retailPrice, discount: 0, taxRate: null, serials: [""], coreReturned: false });

export default function CounterSale({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const access = useAccess();
  const action = useAction();
  const { approve, prompt } = useApproval();
  const cur = shop.currency;

  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [method, setMethod] = useState<SaleMethod | "SPLIT">("CASH");
  const [split, setSplit] = useState<{ method: SaleMethod; amount: string; reference: string }[]>([{ method: "CASH", amount: "", reference: "" }, { method: "CARD", amount: "", reference: "" }]);
  const [tendered, setTendered] = useState("");
  const [accountId, setAccountId] = useState("");
  const [voucher, setVoucher] = useState("");
  const [voucherInfo, setVoucherInfo] = useState<StoreCredit | string | null>(null);
  const [customer, setCustomer] = useState({ name: "", phone: "", plate: "", address: "", vatNo: "" });
  const [taxInvoice, setTaxInvoice] = useState(false);
  const [extra, setExtra] = useState({ description: "", price: "" });
  const [draftId, setDraftId] = useState<string | null>(null);
  const [last, setLast] = useState<Sale | null>(null);
  const [viewing, setViewing] = useState<Sale | null>(null);
  const [list, setList] = useState<"today" | "held" | "quotes" | "warranty" | "credit">("today");

  const sales = useLoad(() => listSales({ from: today() }), []);
  const drafts = useLoad(() => listDrafts(), []);
  const drawer = useLoad(getMyDrawer, []);
  const accounts = useLoad(() => listAccounts().catch(() => [] as Account[]), []);

  const est = useMemo(() => price(cart, Number(discount) || 0, shop.taxRate), [cart, discount, shop.taxRate]);
  const usesAccount = method === "ACCOUNT" || (method === "SPLIT" && split.some((p) => p.method === "ACCOUNT"));
  const cashDue = method === "CASH" ? est.total : method === "SPLIT" ? split.filter((p) => p.method === "CASH").reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0;
  const splitTotal = split.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const splitLeft = Math.round((est.total - splitTotal) * 100) / 100;
  const cash = Number(tendered) || 0;
  const short = cashDue > 0 && tendered !== "" && cash < cashDue;
  const serialsMissing = cart.some((l) => l.part?.serialized && l.serials.filter((s) => s.trim()).length !== l.quantity);
  const noDrawer = shop.requireCashSession && cashDue > 0 && drawer.data === null && !drawer.loading;
  const blocked =
    cart.length === 0 || short || serialsMissing || est.overDiscount || (method === "SPLIT" && splitLeft !== 0) || (usesAccount && !accountId) || (taxInvoice && !customer.name.trim()) || noDrawer || (method === "VOUCHER" && !voucher.trim()) || (method === "SPLIT" && split.some((p) => p.method === "VOUCHER" && Number(p.amount) > 0 && !p.reference.trim()));

  // Out of stock: offer the parts linked as substitutes.
  const [instead, setInstead] = useState<{ part: Part; subs: Part[] } | null>(null);
  const addPart = (p: Part) => {
    if (p.stockQty <= 0) {
      getPart(p.id).then(
        (full) => setInstead(full.substitutes.length ? { part: p, subs: full.substitutes.map((s) => s.part) } : null),
        () => setInstead(null)
      );
    } else setInstead((x) => (x?.part.id === p.id ? null : x));
    addToCart(p);
  };
  const addToCart = (p: Part) =>
    setCart((c) => {
      const same = c.find((l) => l.part?.id === p.id);
      if (same) return c.map((l) => (l === same ? { ...l, quantity: l.quantity + 1, serials: [...l.serials, ""] } : l));
      return [...c, newLine(p)];
    });
  const patch = (key: string, next: Partial<CartLine>) => setCart((c) => c.map((x) => (x.key === key ? { ...x, ...next } : x)));
  const setQty = (l: CartLine, q: number) => patch(l.key, { quantity: q, serials: Array.from({ length: q }, (_, i) => l.serials[i] ?? "") });

  function reset() {
    setCart([]);
    setDiscount("");
    setTendered("");
    setAccountId("");
    setCustomer({ name: "", phone: "", plate: "", address: "", vatNo: "" });
    setTaxInvoice(false);
    setDraftId(null);
    setMethod("CASH");
    setVoucher("");
    setVoucherInfo(null);
    setSplit([{ method: "CASH", amount: "", reference: "" }, { method: "CARD", amount: "", reference: "" }]);
  }

  const customerInput = () => ({
    customerName: customer.name.trim() || null,
    customerPhone: customer.phone.trim() || null,
    plate: customer.plate.trim() || null,
    customerAddress: customer.address.trim() || null,
    customerVatNo: customer.vatNo.trim() || null,
  });

  async function complete() {
    const sale = await action.run("sale", () =>
      approve((pin) =>
        createSale({
          items: cart.map(lineInput),
          discount: Number(discount) || 0,
          ...(method === "SPLIT"
            ? { payments: split.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), reference: p.reference.trim() || null })) }
            : method === "VOUCHER"
              ? { payments: [{ method: "VOUCHER" as const, amount: est.total, reference: voucher.trim() }] }
              : { paymentMethod: method }),
          tendered: cashDue > 0 && tendered !== "" ? cash : null,
          accountId: usesAccount ? accountId : null,
          taxInvoice,
          ...customerInput(),
          draftId,
          approvalPin: pin ?? null,
        })
      )
    );
    if (!sale) return;
    setLast(sale);
    reset();
    sales.reload();
    drafts.reload();
    drawer.reload();
    accounts.reload();
  }

  async function hold(kind: "HELD" | "QUOTE") {
    const d = await action.run(kind, () => saveDraft({ kind, items: cart.map(lineInput), discount: Number(discount) || 0, accountId: accountId || null, ...customerInput() }));
    if (!d) return;
    if (kind === "QUOTE") printQuote(shop, d, t);
    reset();
    drafts.reload();
    setList(kind === "QUOTE" ? "quotes" : "held");
  }

  async function resume(d: Draft) {
    const lines = await action.run("resume", async () => {
      const ids = [...new Set(d.items.map((i) => i.partId).filter((x): x is string => Boolean(x)))];
      const parts = new Map((await Promise.all(ids.map((id) => getPart(id)))).map((p) => [p.id, p as Part]));
      return d.items.map((i, k): CartLine => {
        const p = i.partId ? parts.get(i.partId) ?? null : null;
        return { key: `${d.id}-${k}`, part: p, description: p?.name ?? i.description ?? "", quantity: i.quantity, unitPrice: i.unitPrice ?? p?.retailPrice ?? 0, discount: i.discount ?? 0, taxRate: i.taxRate ?? null, serials: Array.from({ length: i.quantity }, () => ""), coreReturned: Boolean(i.coreReturned) };
      });
    });
    if (!lines) return;
    setCart(lines);
    setDiscount(d.discountInput ? String(d.discountInput) : "");
    setCustomer({ name: d.customerName ?? "", phone: d.customerPhone ?? "", plate: d.plate ?? "", address: d.customerAddress ?? "", vatNo: d.customerVatNo ?? "" });
    setAccountId(d.accountId ?? "");
    setDraftId(d.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const pickable = (accounts.data ?? []).filter((a) => a.creditLimit > 0 && !a.onHold);

  return (
    <div className="space-y-6">
      {prompt}
      {noDrawer && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
          <span>{t("shop.sale.drawerNeeded")}</span>
          <a href="#cash" className={`${btnSecondary} ${btnSm}`}><Wallet /> {t("shop.cash.open")}</a>
        </div>
      )}
      {draftId && (
        <div className="flex items-center justify-between rounded-2xl bg-info-soft px-4 py-2.5 text-sm text-info">
          <span>{t("shop.sale.resumed")}</span>
          <button type="button" onClick={reset} className={`${btnSecondary} ${btnSm}`}>{t("shop.sale.clear")}</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <Card className="space-y-4">
          <PartPicker
            autoFocus
            onPick={addPart}
            placeholder={t("shop.sale.scan")}
            onCode={async (code) => {
              const p = await lookupPart(code).catch(() => null);
              if (p) addPart(p);
              return Boolean(p);
            }}
          />
          {instead && (
            <div className="space-y-2 rounded-2xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
              <p>{t("shop.sale.outOfStock", { name: instead.part.name })}</p>
              <div className="flex flex-wrap gap-2">
                {instead.subs.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    disabled={s.stockQty <= 0}
                    onClick={() => {
                      setCart((c) => c.filter((l) => l.part?.id !== instead.part.id));
                      addToCart(s);
                      setInstead(null);
                    }}
                    className={`${btnSecondary} ${btnSm}`}
                  >
                    {s.name}{s.brand && ` · ${s.brand}`} · {t("shop.stockShort", { n: s.stockQty })} · {money(s.retailPrice, cur)}
                  </button>
                ))}
                <button type="button" onClick={() => setInstead(null)} className="text-xs text-muted-foreground underline">{t("shop.sale.keepIt")}</button>
              </div>
            </div>
          )}
          {cart.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <ScanBarcode className="size-8" />
              {t("shop.sale.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {cart.map((l) => (
                <li key={l.key} className="space-y-2 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.description}</span>
                      {l.part && (
                        <span className={`block text-xs ${l.part.stockQty < l.quantity ? "text-bad" : "text-muted-foreground"}`}>
                          {l.part.sku}{l.part.location && ` · ${l.part.location}`} · {t("shop.stockShort", { n: l.part.stockQty })}
                          {l.part.warrantyMonths ? ` · ${t("shop.sale.warrantyMonths", { n: l.part.warrantyMonths })}` : ""}
                        </span>
                      )}
                    </span>
                    {l.part?.fractional ? (
                      <span className="inline-flex items-center gap-1">
                        <input type="number" min={0.01} step="any" value={l.quantity} onChange={(e) => patch(l.key, { quantity: Math.max(0, Number(e.target.value) || 0) })} aria-label={t("garage.field.qty")} className={`${inputCls} w-20! py-1.5! text-right`} />
                        <span className="text-xs text-muted-foreground">{l.part.unit}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-lg border border-border">
                        <button type="button" aria-label={t("shop.sale.less")} onClick={() => setQty(l, Math.max(1, l.quantity - 1))} className="grid size-8 place-items-center"><Minus className="size-4" /></button>
                        <input type="number" min={1} step={1} value={l.quantity} onChange={(e) => setQty(l, Math.max(1, Math.round(Number(e.target.value) || 1)))} aria-label={t("garage.field.qty")} className="w-10 bg-transparent text-center tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                        <button type="button" aria-label={t("shop.sale.more")} onClick={() => setQty(l, l.quantity + 1)} className="grid size-8 place-items-center"><Plus className="size-4" /></button>
                      </span>
                    )}
                    <input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => patch(l.key, { unitPrice: Number(e.target.value) || 0 })} aria-label={t("parts.field.unitPrice")} className={`${inputCls} w-28! py-1.5! text-right`} />
                    <input type="number" min={0} step="0.01" value={l.discount || ""} placeholder={t("shop.sale.lineDiscount")} onChange={(e) => patch(l.key, { discount: Number(e.target.value) || 0 })} aria-label={t("shop.sale.lineDiscount")} className={`${inputCls} w-24! py-1.5! text-right`} />
                    <span className="w-28 text-right font-medium tabular-nums">{money(l.unitPrice * l.quantity - l.discount, cur)}</span>
                    <button type="button" aria-label={t("garage.action.remove")} onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-bad-soft hover:text-bad"><Trash2 className="size-4" /></button>
                  </div>
                  {l.part?.fractional && l.part.quickQtys.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pl-1">
                      {l.part.quickQtys.map((q) => (
                        <button key={q} type="button" onClick={() => patch(l.key, { quantity: q })} className={`rounded-lg border px-2 py-0.5 text-xs ${l.quantity === q ? "border-primary bg-brand-soft text-primary" : "border-border text-muted-foreground hover:bg-canvas"}`}>
                          {q} {l.part!.unit}
                        </button>
                      ))}
                    </div>
                  )}
                  {l.part?.isKit && <p className="pl-1 text-xs text-muted-foreground">{t("shop.kit.contains", { list: l.part.kitComponents.map((c) => `${c.quantity} × ${c.name}`).join(", ") })}</p>}
                  {l.part?.serialized && (
                    <div className="flex flex-wrap items-center gap-2 pl-1">
                      <span className="text-xs text-muted-foreground">{t("shop.sale.serials")}</span>
                      {l.serials.map((s, i) => (
                        <input key={i} value={s} onChange={(e) => patch(l.key, { serials: l.serials.map((x, k) => (k === i ? e.target.value.toUpperCase() : x)) })} placeholder={`#${i + 1}`} maxLength={80} className={`${inputCls} w-36! py-1! font-mono text-xs ${s.trim() ? "" : "border-warn!"}`} />
                      ))}
                    </div>
                  )}
                  {l.part?.coreCharge ? (
                    <label className="flex items-center gap-2 pl-1 text-xs text-muted-foreground">
                      <input type="checkbox" checked={l.coreReturned} onChange={(e) => patch(l.key, { coreReturned: e.target.checked })} className="size-4 accent-primary" />
                      {l.coreReturned ? t("shop.sale.coreBack") : t("shop.sale.coreDeposit", { amount: money(l.part.coreCharge * l.quantity, cur) })}
                    </label>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <Field label={t("shop.sale.otherItem")} className="min-w-[200px] flex-1">
              <input value={extra.description} onChange={(e) => setExtra({ ...extra, description: e.target.value })} placeholder={t("shop.sale.otherPlaceholder")} maxLength={200} className={inputCls} />
            </Field>
            <Field label={t("parts.field.price")} className="w-32">
              <input type="number" min={0} step="0.01" value={extra.price} onChange={(e) => setExtra({ ...extra, price: e.target.value })} className={inputCls} />
            </Field>
            <button
              type="button"
              disabled={!extra.description.trim() || extra.price === ""}
              onClick={() => {
                setCart((c) => [...c, { key: `x-${Date.now()}`, part: null, description: extra.description.trim(), quantity: 1, unitPrice: Number(extra.price) || 0, discount: 0, taxRate: null, serials: [], coreReturned: false }]);
                setExtra({ description: "", price: "" });
              }}
              className={btnSecondary}
            >
              <Plus /> {t("parts.action.add")}
            </button>
          </div>
        </Card>

        <Card className="space-y-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">{t("garage.invoice.subtotal")}</span><span className="tabular-nums">{money(est.subtotal, cur)}</span></div>
            {est.cores > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>{t("shop.sale.coresIncluded")}</span><span className="tabular-nums">{money(est.cores, cur)}</span></div>}
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{t("shop.sale.saleDiscount")}</span>
              <input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" className={`${inputCls} w-28! py-1.5! text-right ${est.overDiscount ? "border-bad!" : ""}`} />
            </div>
            {est.discount > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>{t("shop.sale.discountTotal")}</span><span className="tabular-nums">−{money(est.discount, cur)}</span></div>}
            {est.tax > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t("shop.sale.tax")}</span><span className="tabular-nums">{money(est.tax, cur)}</span></div>}
            <div className="flex justify-between border-t border-border pt-2 font-display text-2xl font-bold"><span>{t("garage.invoice.total")}</span><span className="tabular-nums">{money(est.total, cur)}</span></div>
            {!access.can("discount") && <p className="text-[11px] text-muted-foreground">{t("shop.sale.discountLimit", { pct: shop.maxDiscountPct })}</p>}
          </div>

          <Field label={t("shop.sale.method")}>
            <div className="flex flex-wrap gap-2">
              {SINGLE.map((m) => <Chip key={m} on={method === m} onClick={() => setMethod(m)}>{t(`shop.method.${m}`)}</Chip>)}
              <Chip on={method === "SPLIT"} onClick={() => setMethod("SPLIT")}>{t("shop.method.SPLIT")}</Chip>
            </div>
          </Field>

          {method === "SPLIT" && (
            <div className="space-y-2">
              {split.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={p.method} onChange={(e) => setSplit(split.map((x, k) => (k === i ? { ...x, method: e.target.value as SaleMethod } : x)))} className={`${inputCls} w-36! py-1.5!`}>
                    {SINGLE.map((m) => <option key={m} value={m}>{t(`shop.method.${m}`)}</option>)}
                  </select>
                  <input type="number" min={0} step="0.01" value={p.amount} onChange={(e) => setSplit(split.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} placeholder="0.00" className={`${inputCls} py-1.5! text-right`} />
                  {p.method !== "CASH" && p.method !== "ACCOUNT" && <input value={p.reference} onChange={(e) => setSplit(split.map((x, k) => (k === i ? { ...x, reference: e.target.value.toUpperCase() } : x)))} placeholder={p.method === "VOUCHER" ? t("shop.credit.code") : t("shop.sale.ref")} maxLength={80} className={`${inputCls} w-28! py-1.5! ${p.method === "VOUCHER" ? "font-mono" : ""}`} />}
                  {split.length > 1 && <button type="button" aria-label={t("garage.action.remove")} onClick={() => setSplit(split.filter((_, k) => k !== i))} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-bad"><Trash2 className="size-4" /></button>}
                </div>
              ))}
              <div className="flex items-center justify-between text-xs">
                {split.length < 5 ? <button type="button" onClick={() => setSplit([...split, { method: "CARD", amount: splitLeft > 0 ? String(splitLeft) : "", reference: "" }])} className="font-medium text-primary">+ {t("shop.sale.addPayment")}</button> : <span />}
                <span className={splitLeft === 0 ? "text-ok" : "text-warn"}>{splitLeft === 0 ? t("shop.sale.splitOk") : t("shop.sale.splitLeft", { amount: money(splitLeft, cur) })}</span>
              </div>
            </div>
          )}

          {usesAccount && (
            <Field label={t("shop.sale.account")} hint={pickable.length === 0 ? t("shop.sale.noAccounts") : undefined}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                <option value="">{t("shop.sale.pickAccount")}</option>
                {pickable.map((a) => (
                  <option key={a.id} value={a.id}>{a.name} · {t("shop.sale.creditLeft", { amount: money(Math.max(0, a.creditLimit - a.balance), cur) })}{a.overdue > 0 ? ` · ${t("shop.acc.overdueCol")}` : ""}</option>
                ))}
              </select>
            </Field>
          )}

          {method === "VOUCHER" && (
            <Field label={t("shop.credit.code")} hint={typeof voucherInfo === "string" ? voucherInfo : voucherInfo ? t("shop.credit.has", { amount: money(voucherInfo.balance, cur), status: t(`shop.credit.status.${voucherInfo.status}`) }) : t("shop.credit.codeHint")}>
              <div className="flex gap-2">
                <input value={voucher} onChange={(e) => { setVoucher(e.target.value.toUpperCase()); setVoucherInfo(null); }} placeholder="SC-XXXXXX" maxLength={20} className={`${inputCls} font-mono`} />
                <button type="button" disabled={!voucher.trim()} onClick={async () => setVoucherInfo(await findCredit(voucher).catch((e: Error) => e.message))} className={`${btnSecondary} ${btnSm}`}>{t("shop.credit.check")}</button>
              </div>
            </Field>
          )}
          {cashDue > 0 && (
            <Field label={t("shop.sale.tendered")} hint={tendered !== "" && !short ? t("shop.sale.changeIs", { amount: money(cash - cashDue, cur) }) : undefined}>
              <input type="number" min={0} step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} className={`${inputCls} ${short ? "border-bad!" : ""}`} />
            </Field>
          )}

          <details className="text-sm" open={taxInvoice}>
            <summary className="cursor-pointer text-muted-foreground">{t("shop.sale.customer")}</summary>
            <div className="mt-3 grid gap-3">
              <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder={t("shop.sale.customerName")} maxLength={160} className={`${inputCls} ${taxInvoice && !customer.name.trim() ? "border-warn!" : ""}`} />
              <div className="grid grid-cols-2 gap-3">
                <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder={t("garage.field.phone")} maxLength={40} className={inputCls} />
                <input value={customer.plate} onChange={(e) => setCustomer({ ...customer, plate: e.target.value })} placeholder={t("shop.sale.plate")} maxLength={20} className={`${inputCls} font-mono uppercase`} />
              </div>
              {shop.vatNumber && (
                <label className="flex items-center gap-2"><input type="checkbox" checked={taxInvoice} onChange={(e) => setTaxInvoice(e.target.checked)} className="size-4 accent-primary" /> {t("shop.sale.taxInvoice")}</label>
              )}
              {taxInvoice && (
                <>
                  <input value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} placeholder={t("shop.sale.customerAddress")} maxLength={500} className={inputCls} />
                  <input value={customer.vatNo} onChange={(e) => setCustomer({ ...customer, vatNo: e.target.value })} placeholder={t("shop.sale.customerVat")} maxLength={40} className={inputCls} />
                </>
              )}
            </div>
          </details>

          {serialsMissing && <p className="text-xs text-warn">{t("shop.sale.serialsMissing")}</p>}
          {action.error && <ErrorNote message={action.error} />}
          <button type="button" disabled={action.busy !== null || blocked} onClick={complete} className={`${btnPrimary} w-full py-3!`}>
            {action.busy === "sale" && <Spinner />} {t("shop.sale.complete", { total: money(est.total, cur) })}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={action.busy !== null || cart.length === 0} onClick={() => hold("HELD")} className={`${btnSecondary} ${btnSm}`}>{action.busy === "HELD" ? <Spinner /> : <PauseCircle />} {t("shop.sale.hold")}</button>
            <button type="button" disabled={action.busy !== null || cart.length === 0} onClick={() => hold("QUOTE")} className={`${btnSecondary} ${btnSm}`}>{action.busy === "QUOTE" ? <Spinner /> : <FileText />} {t("shop.sale.quote")}</button>
          </div>
          {last && (
            <div className="flex items-center justify-between rounded-2xl bg-ok-soft px-4 py-3 text-sm text-ok">
              <span>{t("shop.sale.done", { n: last.number })}{last.change ? ` · ${t("shop.sale.changeIs", { amount: money(last.change, cur) })}` : ""}</span>
              <button type="button" onClick={() => printSale(shop, last, t)} className={`${btnSecondary} ${btnSm}`}><Printer /> {last.taxInvoice ? t("shop.sale.printInvoice") : t("shop.sale.print")}</button>
            </div>
          )}
        </Card>
      </div>

      <Card className="space-y-4">
        <Segmented
          value={list}
          onChange={setList}
          options={[
            { value: "today", label: t("shop.sale.today") },
            { value: "held", label: `${t("shop.sale.held")} (${drafts.data?.filter((d) => d.kind === "HELD").length ?? 0})` },
            { value: "quotes", label: `${t("shop.sale.quotes")} (${drafts.data?.filter((d) => d.kind === "QUOTE").length ?? 0})` },
            { value: "warranty", label: t("shop.sale.warranty") },
            { value: "credit", label: t("shop.credit.tab") },
          ]}
        />
        {list === "today" ? (
          sales.error ? <ErrorNote message={sales.error} onRetry={sales.reload} /> : !sales.data ? <Loading /> : sales.data.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("shop.home.noSales")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {sales.data.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setViewing(s)} className={`flex w-full items-center gap-3 py-2.5 text-left hover:bg-canvas ${s.voided ? "opacity-60" : ""}`}>
                    <span className="w-14 font-mono text-muted-foreground">#{s.number}</span>
                    <span className="min-w-0 flex-1 truncate">{s.items.map((i) => i.description).join(", ")}</span>
                    {s.voided && <Badge tone="bad" dot={false}>{t("shop.sale.voided")}</Badge>}
                    {s.refunded > 0 && <Badge tone="warn" dot={false}>{t("shop.sale.returned")}</Badge>}
                    {s.taxInvoice && <Badge tone="info" dot={false}>{t("shop.sale.taxInvoiceShort")}</Badge>}
                    <span className="hidden text-xs text-muted-foreground sm:inline">{s.cashierName}</span>
                    <span className="text-xs text-muted-foreground">{t(`shop.method.${s.paymentMethod}`)}</span>
                    <span className="w-28 text-right font-medium tabular-nums">{money(s.total, cur)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : list === "warranty" ? (
          <WarrantyLookup />
        ) : list === "credit" ? (
          <CreditList shop={shop} />
        ) : (
          <DraftList shop={shop} kind={list === "held" ? "HELD" : "QUOTE"} drafts={drafts.data} error={drafts.error} onResume={resume} onChanged={drafts.reload} />
        )}
      </Card>

      <SalePanel shop={shop} sale={viewing} onClose={() => setViewing(null)} onChanged={(s) => { setViewing(s); sales.reload(); drawer.reload(); }} />
    </div>
  );
}

function DraftList({ shop, kind, drafts, error, onResume, onChanged }: { shop: Shop; kind: "HELD" | "QUOTE"; drafts: Draft[] | null; error: string | null; onResume: (d: Draft) => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  if (error) return <ErrorNote message={error} onRetry={onChanged} />;
  if (!drafts) return <Loading />;
  const rows = drafts.filter((d) => d.kind === kind);
  if (!rows.length) return <p className="py-4 text-center text-sm text-muted-foreground">{kind === "HELD" ? t("shop.sale.noHeld") : t("shop.sale.noQuotes")}</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {rows.map((d) => {
        const expired = d.validUntil != null && new Date(d.validUntil).getTime() < Date.now();
        return (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="w-14 font-mono text-muted-foreground">{d.number ? `Q${d.number}` : "—"}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{d.customerName ?? d.lines.map((l) => l.description).join(", ")}</span>
              <span className="block text-xs text-muted-foreground">
                {d.createdByName} · {formatDate(d.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {d.validUntil && ` · ${t("shop.quote.validUntil", { date: formatDate(d.validUntil, { day: "numeric", month: "short" }) })}`}
              </span>
            </span>
            {expired && <Badge tone="warn" dot={false}>{t("shop.quote.expired")}</Badge>}
            <span className="w-28 text-right font-medium tabular-nums">{money(d.total, shop.currency)}</span>
            <span className="flex gap-1.5">
              {kind === "QUOTE" && <button type="button" onClick={() => printQuote(shop, d, t)} className={`${btnSecondary} ${btnSm}`} aria-label={t("shop.sale.print")}><Printer /></button>}
              <button type="button" onClick={() => onResume(d)} className={`${btnSecondary} ${btnSm}`}>{kind === "QUOTE" ? t("shop.quote.toSale") : t("shop.sale.resume")}</button>
              <button type="button" disabled={action.busy !== null} onClick={async () => (await action.run(d.id, () => cancelDraft(d.id))) && onChanged()} className={`${btnSecondary} ${btnSm}`} aria-label={t("garage.action.remove")}>{action.busy === d.id ? <Spinner /> : <Trash2 />}</button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CreditList({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const access = useAccess();
  const action = useAction();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StoreCredit["status"] | "">("ACTIVE");
  const list = useLoad(() => listCredits({ q: q.trim() || undefined, status: status || undefined }), [q, status]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("shop.credit.search")} className={`${inputCls} pl-9`} />
        </div>
        {(["ACTIVE", "USED", "CANCELLED", ""] as const).map((s) => <Chip key={s || "all"} on={status === s} onClick={() => setStatus(s)}>{s ? t(`shop.credit.status.${s}`) : t("shop.count.filterAll")}</Chip>)}
      </div>
      {action.error && <ErrorNote message={action.error} />}
      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("shop.credit.none")}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {list.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="w-28 font-mono font-medium">{c.code}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.customerName ?? "—"}{c.customerPhone && ` · ${c.customerPhone}`}</span>
                <span className="block truncate text-xs text-muted-foreground">{formatDate(c.createdAt, { day: "numeric", month: "short", year: "numeric" })}{c.note && ` · ${c.note}`}</span>
              </span>
              <Badge tone={c.status === "ACTIVE" ? "ok" : "gray"} dot={false}>{t(`shop.credit.status.${c.status}`)}</Badge>
              <span className="w-32 text-right tabular-nums">{money(c.balance, shop.currency)}<span className="block text-xs text-muted-foreground">{t("shop.credit.of", { amount: money(c.amount, shop.currency) })}</span></span>
              <span className="flex gap-1.5">
                {c.status === "ACTIVE" && <button type="button" onClick={() => printCredit(shop, c, t)} className={`${btnSecondary} ${btnSm}`} aria-label={t("shop.credit.print")}><Printer /></button>}
                {c.status === "ACTIVE" && access.can("refund") && (
                  <button
                    type="button"
                    disabled={action.busy !== null}
                    onClick={async () => {
                      const note = window.prompt(t("shop.credit.cancelWhy"));
                      if (note?.trim() && (await action.run(c.id, () => cancelCredit(c.id, note.trim())))) list.reload();
                    }}
                    className={`${btnSecondary} ${btnSm}`}
                  >
                    {t("shop.credit.cancel")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WarrantyLookup() {
  const t = useT();
  const { formatDate } = useI18n();
  const [q, setQ] = useState("");
  const action = useAction();
  const [hits, setHits] = useState<Awaited<ReturnType<typeof lookupWarranty>> | null>(null);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (q.trim()) setHits((await action.run("w", () => lookupWarranty(q.trim()))) ?? null); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("shop.sale.warrantyPlaceholder")} className={inputCls} />
        <button type="submit" disabled={!q.trim() || action.busy !== null} className={btnSecondary}>{action.busy ? <Spinner /> : <ShieldCheck />} {t("shop.sale.warrantyFind")}</button>
      </form>
      {action.error && <ErrorNote message={action.error} />}
      {hits && (hits.length === 0 ? <Empty title={t("shop.sale.warrantyNone")} /> : (
        <ul className="divide-y divide-border text-sm">
          {hits.map((h) => (
            <li key={h.item.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{h.item.description}{h.item.serialNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{h.item.serialNumber}</span>}</span>
                <span className="block text-xs text-muted-foreground">{t("shop.sale.receipt")} #{h.sale.number} · {formatDate(h.sale.createdAt, { day: "numeric", month: "short", year: "numeric" })}{h.sale.customerName && ` · ${h.sale.customerName}`}</span>
              </span>
              {h.warrantyUntil && <span className="text-xs text-muted-foreground">{t("shop.sale.until", { date: formatDate(h.warrantyUntil, { day: "numeric", month: "short", year: "numeric" }) })}</span>}
              <Badge tone={h.covered ? "ok" : "gray"} dot={false}>{h.covered ? t("shop.sale.covered") : h.sale.voided || h.item.returnedQty >= h.item.quantity ? t("shop.sale.returned") : t("shop.sale.expired")}</Badge>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

function SalePanel({ shop, sale, onClose, onChanged }: { shop: Shop; sale: Sale | null; onClose: () => void; onChanged: (s: Sale) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const { approve, prompt } = useApproval();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  const [method, setMethod] = useState<SaleMethod>("CASH");
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [mode, setMode] = useState<"return" | "exchange">("return");
  const [swap, setSwap] = useState<{ part: Part; quantity: number }[]>([]);
  const [balanceTo, setBalanceTo] = useState<SaleMethod>("VOUCHER");
  const [ruleBlock, setRuleBlock] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [waiveFee, setWaiveFee] = useState(false);
  const [done, setDone] = useState<{ credit: StoreCredit | null; note: string | null; sale?: Sale } | null>(null);
  const chosen = Object.entries(qty).filter(([, n]) => n > 0);
  const cur = shop.currency;
  const reset = () => {
    setQty({});
    setReason("");
    setSwap([]);
    setRuleBlock(null);
    setOverride(false);
    setWaiveFee(false);
  };

  useEffect(() => {
    reset();
    setDone(null);
    setMode("return");
    setBalanceTo("VOUCHER");
    setVoiding(false);
    setReason("");
    setMethod(sale?.account ? "ACCOUNT" : sale?.payments[0]?.method === "ACCOUNT" ? "ACCOUNT" : "CASH");
  }, [sale?.id, sale?.account, sale?.payments]);

  return (
    <Panel open={sale !== null} onClose={onClose} title={sale ? `${sale.taxInvoice ? t("shop.print.taxInvoice") : t("shop.sale.receipt")} #${sale.number}` : ""} description={sale ? `${formatDate(sale.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${sale.cashierName ? ` · ${sale.cashierName}` : ""}` : undefined}>
      {prompt}
      {sale && (
        <>
          {sale.voided && <div className="rounded-2xl bg-bad-soft px-4 py-3 text-sm text-bad">{t("shop.sale.voidedBy", { name: sale.voided.by ?? "", reason: sale.voided.reason ?? "" })}</div>}
          <Card className="p-5">
            <ul className="divide-y divide-border text-sm">
              {sale.items.map((i) => {
                const left = i.quantity - i.returnedQty;
                return (
                  <li key={i.id} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{i.description}{i.returnedQty > 0 && <span className="ml-1 text-xs text-warn">({t("shop.sale.returnedN", { n: i.returnedQty })})</span>}</span>
                      {(i.serialNumber || i.discount > 0) && <span className="block text-xs text-muted-foreground">{[i.serialNumber, i.discount > 0 ? `−${money(i.discount, cur)}` : null].filter(Boolean).join(" · ")}</span>}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{i.quantity} × {money(i.unitPrice, cur)}</span>
                    {left > 0 && !sale.voided && (
                      <input type="number" min={0} max={left} value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: Math.min(left, Math.max(0, Number(e.target.value) || 0)) })} placeholder="0" aria-label={t("shop.sale.returnQty")} className={`${inputCls} w-16! py-1! text-right`} />
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
              {sale.discount > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("shop.sale.discountTotal")}</span><span>−{money(sale.discount, cur)}</span></div>}
              {sale.tax > 0 && <div className="flex justify-between text-muted-foreground"><span>{t("shop.sale.tax")}</span><span>{money(sale.tax, cur)}</span></div>}
              <div className="flex justify-between font-semibold"><span>{t("garage.invoice.total")}</span><span>{money(sale.total, cur)}</span></div>
              {sale.payments.map((p, k) => <div key={k} className="flex justify-between text-xs text-muted-foreground"><span>{t(`shop.method.${p.method}`)}{p.reference && ` · ${p.reference}`}{p.method === "ACCOUNT" && sale.account && ` · ${sale.account.name}`}</span><span>{money(p.amount, cur)}</span></div>)}
              {sale.refunded > 0 && <div className="flex justify-between text-warn"><span>{t("shop.sale.refunded")}</span><span>−{money(sale.refunded, cur)}</span></div>}
              {sale.approvedByName && <p className="text-xs text-muted-foreground">{t("shop.sale.approvedBy", { name: sale.approvedByName })}</p>}
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => printSale(shop, sale, t)} className={btnSecondary}><Printer /> {sale.taxInvoice ? t("shop.sale.printInvoice") : t("shop.sale.print")}</button>
            {!sale.voided && sale.returns.length === 0 && <button type="button" onClick={() => setVoiding(!voiding)} className={btnDanger}><Ban /> {t("shop.sale.void")}</button>}
          </div>

          {voiding && (
            <Card className="space-y-3 p-5">
              <h3 className="font-semibold">{t("shop.sale.voidTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("shop.sale.voidBody")}</p>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("shop.sale.reasonRequired")} maxLength={500} className={inputCls} />
              {action.error && <ErrorNote message={action.error} />}
              <button
                type="button"
                disabled={action.busy !== null || !reason.trim()}
                onClick={async () => {
                  const s = await action.run("void", () => approve((pin) => voidSale(sale.id, { reason: reason.trim(), approvalPin: pin ?? null })));
                  if (s) onChanged(s);
                }}
                className={btnDanger}
              >
                {action.busy === "void" ? <Spinner /> : <Ban />} {t("shop.sale.voidConfirm")}
              </button>
            </Card>
          )}

          {chosen.length > 0 && (
            <Card className="space-y-3 p-5">
              <Segmented value={mode} onChange={setMode} options={[{ value: "return", label: t("shop.sale.returnTitle") }, { value: "exchange", label: t("shop.ex.title") }]} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="size-4 accent-primary" /> {t("shop.sale.restock")}
              </label>
              {mode === "return" ? (
                <Field label={t("shop.sale.refundBy")}>
                  <div className="flex flex-wrap gap-2">
                    {REFUNDS.filter((m) => m !== "ACCOUNT" || sale.account).map((m) => <Chip key={m} on={method === m} onClick={() => setMethod(m)}>{t(`shop.method.${m}`)}</Chip>)}
                  </div>
                </Field>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">{t("shop.ex.hint")}</p>
                  <PartPicker onPick={(p) => setSwap((x) => (x.some((l) => l.part.id === p.id) ? x : [...x, { part: p, quantity: 1 }]))} placeholder={t("shop.ex.pick")} />
                  {swap.length > 0 && (
                    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                      {swap.map((l) => (
                        <li key={l.part.id} className="flex items-center gap-2 px-3 py-2">
                          <span className="min-w-0 flex-1 truncate">{l.part.name}<span className="block text-xs text-muted-foreground">{t("shop.stockShort", { n: l.part.stockQty })}</span></span>
                          <input type="number" min={l.part.fractional ? 0.01 : 1} step={l.part.fractional ? "any" : 1} value={l.quantity} onChange={(e) => setSwap(swap.map((x) => (x.part.id === l.part.id ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x)))} aria-label={t("garage.field.qty")} className={`${inputCls} w-20! py-1! text-right`} />
                          <span className="w-24 text-right tabular-nums">{money(l.part.retailPrice * l.quantity, cur)}</span>
                          <button type="button" aria-label={t("garage.action.remove")} onClick={() => setSwap(swap.filter((x) => x.part.id !== l.part.id))} className="text-muted-foreground hover:text-bad"><Trash2 className="size-4" /></button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Field label={t("shop.ex.payBy")}>
                    <div className="flex flex-wrap gap-2">{SINGLE.filter((m) => m !== "VOUCHER" && (m !== "ACCOUNT" || sale.account)).map((m) => <Chip key={m} on={method === m} onClick={() => setMethod(m)}>{t(`shop.method.${m}`)}</Chip>)}</div>
                  </Field>
                  <Field label={t("shop.ex.leftover")}>
                    <div className="flex flex-wrap gap-2">{REFUNDS.filter((m) => m !== "ACCOUNT" || sale.account).map((m) => <Chip key={m} on={balanceTo === m} onClick={() => setBalanceTo(m)}>{t(`shop.method.${m}`)}</Chip>)}</div>
                  </Field>
                </div>
              )}
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("shop.sale.reason")} maxLength={500} className={inputCls} />
              {ruleBlock && (
                <div className="space-y-2 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-sm">
                  <p>{ruleBlock}</p>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="size-4 accent-primary" /> {t("shop.ret.override")}</label>
                </div>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={waiveFee} onChange={(e) => setWaiveFee(e.target.checked)} className="size-4 accent-primary" /> {t("shop.ret.waiveFee")}</label>
              {action.error && !ruleBlock && <ErrorNote message={action.error} />}
              <button
                type="button"
                disabled={action.busy !== null || (mode === "exchange" && !swap.some((l) => l.quantity > 0)) || (Boolean(ruleBlock) && !override)}
                onClick={async () => {
                  const items = chosen.map(([saleItemId, quantity]) => ({ saleItemId, quantity, restock }));
                  const watch = async <T,>(fn: () => Promise<T>) => {
                    try {
                      return await fn();
                    } catch (err) {
                      if (err instanceof PartsApiError && err.code === "RETURN_RULE") setRuleBlock(err.message);
                      throw err;
                    }
                  };
                  if (mode === "return") {
                    const s = await action.run("return", () =>
                      watch(() => approve((pin) => returnSale(sale.id, { items, refundMethod: method, reason: reason.trim() || null, override, waiveFee, approvalPin: pin ?? null })))
                    );
                    if (!s) return;
                    const issued = s.returns[s.returns.length - 1]?.storeCreditId;
                    if (issued) setDone({ credit: (await listCredits({ status: "ACTIVE" }).catch(() => [])).find((c) => c.id === issued) ?? null, note: null });
                    reset();
                    onChanged(s);
                  } else {
                    const x = await action.run("exchange", () =>
                      watch(() =>
                        approve((pin) =>
                          exchangeSale(sale.id, {
                            returnItems: items,
                            items: swap.filter((l) => l.quantity > 0).map((l) => ({ partId: l.part.id, quantity: l.quantity })),
                            paymentMethod: method === "VOUCHER" ? "CASH" : method,
                            balanceTo,
                            reason: reason.trim() || null,
                            override,
                            waiveFee,
                            approvalPin: pin ?? null,
                          })
                        )
                      )
                    );
                    if (!x) return;
                    setDone({
                      credit: x.credit && x.credit.balance > 0 ? x.credit : null,
                      note: t("shop.ex.done", { back: money(x.returned, cur), n: x.sale.number, due: money(x.due, cur), refunded: money(x.refunded, cur) }),
                      sale: x.sale,
                    });
                    reset();
                    onChanged(x.original);
                  }
                }}
                className={btnPrimary}
              >
                {action.busy ? <Spinner /> : mode === "return" ? <RotateCcw /> : <ArrowRightLeft />} {mode === "return" ? t("shop.sale.doReturn") : t("shop.ex.go")}
              </button>
            </Card>
          )}
          {done && (
            <div className="space-y-2 rounded-2xl bg-ok-soft px-4 py-3 text-sm text-ok">
              {done.note && <p>{done.note}</p>}
              {done.credit && <p className="font-medium">{t("shop.credit.issued", { code: done.credit.code, amount: money(done.credit.balance, cur) })}</p>}
              <div className="flex flex-wrap gap-2">
                {done.credit && <button type="button" onClick={() => printCredit(shop, done.credit!, t)} className={`${btnSecondary} ${btnSm}`}><Printer /> {t("shop.credit.print")}</button>}
                {done.sale && <button type="button" onClick={() => printSale(shop, done.sale!, t)} className={`${btnSecondary} ${btnSm}`}><Printer /> {t("shop.ex.printNew")}</button>}
              </div>
            </div>
          )}
          {!sale.voided && sale.returns.length === 0 && chosen.length === 0 && !voiding && <Empty title={t("shop.sale.returnHint")} />}
          {sale.returns.length > 0 && (
            <Card className="p-5">
              <CardHeader title={t("shop.sale.returnsTitle")} />
              <ul className="divide-y divide-border text-sm">
                {sale.returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2">
                    <span>
                      #{r.number} · {t(`shop.method.${r.refundMethod}`)}{r.byName && ` · ${r.byName}`}{r.approvedByName && ` (${t("shop.sale.approvedBy", { name: r.approvedByName })})`}
                      {r.fee > 0 && <span className="text-xs text-muted-foreground"> · {t("shop.ret.feeKept", { amount: money(r.fee, cur) })}</span>}
                      {r.overridden && <span className="text-xs text-warn"> · {t("shop.ret.overridden")}</span>}
                      {r.reason && <span className="block text-xs text-muted-foreground">{r.reason}</span>}
                    </span>
                    <span className="tabular-nums">{money(r.total, cur)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Panel>
  );
}
