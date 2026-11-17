"use client";

/**
 * What the shop owes its suppliers: each supplier's balance and how late it
 * is, their statement (bills, payments, credits), recording a bill or a
 * payment, and sending stock back to them.
 */
import { useState } from "react";
import { Banknote, FileText, Plus, Printer, Truck, Undo2, Wallet } from "lucide-react";

import { Card, CardHeader, Empty, ErrorNote, Field, Kpi, Loading, Panel, Segmented, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import {
  addSupplierBill,
  adjustSupplier,
  getSupplierStatement,
  listPayables,
  listSupplierReturns,
  listSuppliers,
  paySupplier,
  returnToSupplier,
  type Ageing,
  type Part,
  type PaymentMethod,
  type Shop,
  type SupplierStatement,
} from "@/lib/partsApi";

import { MethodChips, PartPicker } from "./common";
import { printStatement } from "./print";

export function AgeingBar({ a, currency }: { a: Pick<Ageing, "current" | "d1_30" | "d31_60" | "d61_90" | "d90plus">; currency: string }) {
  const t = useT();
  const money = useMoney();
  const cells: [string, number, string][] = [
    [t("shop.age.current"), a.current, "text-muted-foreground"],
    ["1–30", a.d1_30, "text-warn"],
    ["31–60", a.d31_60, "text-warn"],
    ["61–90", a.d61_90, "text-bad"],
    ["90+", a.d90plus, "text-bad"],
  ];
  return (
    <div className="grid grid-cols-5 gap-1 text-right text-xs">
      {cells.map(([label, v, tone]) => (
        <div key={label}><span className="block text-[10px] text-muted-foreground">{label}</span><span className={`block tabular-nums ${v ? `font-medium ${tone}` : "text-muted-foreground/60"}`}>{v ? money(v, currency).replace(`${currency} `, "") : "—"}</span></div>
      ))}
    </div>
  );
}

export default function Payables({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [view, setView] = useState<"owed" | "returns">("owed");
  const owed = useLoad(listPayables, []);
  const returns = useLoad(() => listSupplierReturns(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [newReturn, setNewReturn] = useState(false);
  const cur = shop.currency;

  const total = (owed.data ?? []).reduce((s, r) => s + Math.max(0, r.balance), 0);
  const late = (owed.data ?? []).reduce((s, r) => s + r.ageing.overdue, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Kpi tone="info" icon={Wallet} value={money(total, cur)} label={t("shop.pay.owed")} />
        <Kpi tone="bad" icon={Wallet} value={money(late, cur)} label={t("shop.pay.late")} />
        <Kpi tone="vio" icon={Truck} value={owed.data?.filter((r) => r.balance > 0).length ?? 0} label={t("shop.pay.suppliers")} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} options={[{ value: "owed", label: t("shop.pay.owedTab") }, { value: "returns", label: t("shop.pay.returnsTab") }]} />
        <div className="flex gap-2">
          <SupplierPick label={t("shop.pay.openStatement")} onPick={setOpen} />
          <button type="button" onClick={() => setNewReturn(true)} className={`${btnSecondary} ${btnSm}`}><Undo2 /> {t("shop.pay.newReturn")}</button>
        </div>
      </div>

      {view === "owed" ? (
        owed.error ? <ErrorNote message={owed.error} onRetry={owed.reload} /> : !owed.data ? <Loading /> : owed.data.length === 0 ? (
          <Empty title={t("shop.pay.emptyTitle")} body={t("shop.pay.emptyBody")} />
        ) : (
          <Card className="overflow-x-auto p-0!">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="px-5 py-3 font-medium">{t("shop.pur.supplier")}</th><th className="px-3 py-3 text-right font-medium">{t("shop.acc.balance")}</th><th className="min-w-[260px] px-3 py-3 font-medium">{t("shop.pay.ageing")}</th><th className="px-5 py-3" /></tr>
              </thead>
              <tbody>
                {owed.data.map((r) => (
                  <tr key={r.supplier.id} className="border-t border-border">
                    <td className="px-5 py-3"><span className="block font-medium">{r.supplier.name}</span><span className="block text-xs text-muted-foreground">{t("shop.pay.terms", { days: r.supplier.paymentDays })}</span></td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${r.balance < 0 ? "text-ok" : ""}`}>{money(r.balance, cur)}</td>
                    <td className="px-3 py-3"><AgeingBar a={r.ageing} currency={cur} /></td>
                    <td className="px-5 py-3 text-right"><button type="button" onClick={() => setOpen(r.supplier.id)} className={`${btnSecondary} ${btnSm}`}><FileText /> {t("parts.account.statement")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : returns.error ? <ErrorNote message={returns.error} onRetry={returns.reload} /> : !returns.data ? <Loading /> : returns.data.length === 0 ? (
        <Empty title={t("shop.pay.noReturns")} />
      ) : (
        <Card className="p-0!">
          <ul className="divide-y divide-border text-sm">
            {returns.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-10 font-mono text-muted-foreground">#{r.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{r.supplier.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}{r.reason && ` · ${r.reason}`} · {formatDate(r.createdAt, { day: "numeric", month: "short" })}{r.byName && ` · ${r.byName}`}</span>
                </span>
                <span className="tabular-nums">{money(r.total, cur)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <StatementPanel shop={shop} id={open} onClose={() => setOpen(null)} onChanged={owed.reload} />
      <ReturnPanel shop={shop} open={newReturn} onClose={() => setNewReturn(false)} onDone={() => { setNewReturn(false); returns.reload(); owed.reload(); setView("returns"); }} />
    </div>
  );
}

function SupplierPick({ label, onPick }: { label: string; onPick: (id: string) => void }) {
  const suppliers = useLoad(() => listSuppliers(), []);
  return (
    <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} className={`${inputCls} w-auto! py-1.5! text-sm`} aria-label={label}>
      <option value="">{label}</option>
      {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

function StatementPanel({ shop, id, onClose, onChanged }: { shop: Shop; id: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const st = useLoad(() => (id ? getSupplierStatement(id) : Promise.resolve(null)), [id]);
  const [mode, setMode] = useState<"bill" | "payment" | "adjustment">("bill");
  const [form, setForm] = useState({ reference: "", amount: "", billDate: "", dueDate: "", note: "" });
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const s = st.data;
  const cur = shop.currency;

  async function save(fn: () => Promise<SupplierStatement>) {
    const next = await action.run("save", fn);
    if (next) {
      st.setData(next);
      setForm({ reference: "", amount: "", billDate: "", dueDate: "", note: "" });
      onChanged();
    }
  }

  const describe = (e: SupplierStatement["entries"][number]) =>
    [t(`shop.pay.entry.${e.kind}`), e.reference, e.purchase?.number ? t("shop.pur.po", { n: e.purchase.number }) : null, e.dueDate && e.kind === "BILL" ? t("shop.pay.due", { date: formatDate(e.dueDate, { day: "numeric", month: "short" }) }) : null, e.note].filter(Boolean).join(" · ");

  return (
    <Panel wide open={id !== null} onClose={onClose} title={s?.supplier.name ?? t("garage.loading")} description={s?.supplier.phone ?? undefined}>
      {st.error ? <ErrorNote message={st.error} onRetry={st.reload} /> : !s ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.pay.balance")}</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{money(s.balance, cur)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.pay.late")}</p><p className={`mt-1 font-display text-xl font-bold tabular-nums ${s.ageing.overdue ? "text-bad" : ""}`}>{money(s.ageing.overdue, cur)}</p></Card>
          </div>
          <Card className="p-4"><AgeingBar a={s.ageing} currency={cur} /></Card>

          <Card className="space-y-3 p-5">
            <Segmented value={mode} onChange={setMode} options={[{ value: "bill", label: t("shop.pay.bill") }, { value: "payment", label: t("shop.pay.payment") }, { value: "adjustment", label: t("shop.acc.adjustment") }]} />
            <div className="grid gap-3 sm:grid-cols-2">
              {mode !== "adjustment" && <Field label={mode === "bill" ? t("shop.pay.invoiceNo") : t("shop.acc.reference")}><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} maxLength={80} className={inputCls} /></Field>}
              <Field label={t("shop.print.amount")} hint={mode === "adjustment" ? t("shop.pay.adjustHint") : undefined}><input type="number" step="0.01" min={mode === "adjustment" ? undefined : 0} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} /></Field>
              {mode === "bill" && (
                <>
                  <Field label={t("shop.pay.billDate")}><input type="date" value={form.billDate} onChange={(e) => setForm({ ...form, billDate: e.target.value })} className={inputCls} /></Field>
                  <Field label={t("shop.pay.dueDate")} hint={t("shop.pay.dueHint", { days: s.supplier.paymentDays })}><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls} /></Field>
                </>
              )}
            </div>
            {mode === "payment" && <Field label={t("shop.sale.method")}><MethodChips value={method} onChange={setMethod} /></Field>}
            <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("shop.acc.note")} maxLength={500} className={inputCls} />
            {action.error && <ErrorNote message={action.error} />}
            <button
              type="button"
              disabled={action.busy !== null || !Number(form.amount) || (mode === "bill" && !form.reference.trim()) || (mode === "adjustment" && !form.note.trim())}
              onClick={() =>
                save(() =>
                  mode === "bill"
                    ? addSupplierBill(s.supplier.id, { reference: form.reference.trim(), amount: Number(form.amount), billDate: form.billDate || undefined, dueDate: form.dueDate || null, note: form.note.trim() || null })
                    : mode === "payment"
                      ? paySupplier(s.supplier.id, { amount: Number(form.amount), method, reference: form.reference.trim() || null, note: form.note.trim() || null })
                      : adjustSupplier(s.supplier.id, { amount: Number(form.amount), note: form.note.trim() })
                )
              }
              className={btnPrimary}
            >
              {action.busy === "save" ? <Spinner /> : mode === "payment" ? <Banknote /> : <Plus />} {t(`shop.pay.record.${mode}`)}
            </button>
          </Card>

          <Card className="p-0!">
            <div className="flex items-center justify-between px-5 pt-4">
              <CardHeader title={t("parts.account.statement")} />
              <button
                type="button"
                onClick={() =>
                  printStatement(shop, t, {
                    title: t("shop.pay.statementTitle"),
                    party: { name: s.supplier.name, phone: s.supplier.phone, address: s.supplier.address },
                    rows: s.entries.map((e) => ({ date: e.billDate ?? e.createdAt, what: describe(e), amount: e.amount, balance: e.balance })),
                    balance: s.balance,
                    ageing: s.ageing,
                  })
                }
                className={`${btnSecondary} ${btnSm}`}
              >
                <Printer /> {t("shop.sale.print")}
              </button>
            </div>
            {s.entries.length === 0 ? <p className="px-5 pb-5 text-sm text-muted-foreground">{t("parts.account.noEntries")}</p> : (
              <ul className="divide-y divide-border text-sm">
                {s.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{describe(e)}</span>
                      <span className="block text-xs text-muted-foreground">{formatDate(e.billDate ?? e.createdAt, { day: "numeric", month: "short", year: "numeric" })}{e.method && ` · ${t(`garage.method.${e.method}`)}`}{e.byName && ` · ${e.byName}`}</span>
                    </span>
                    <span className="shrink-0 text-right"><span className={`block tabular-nums ${e.amount < 0 ? "text-ok" : ""}`}>{money(e.amount, cur)}</span><span className="block text-xs tabular-nums text-muted-foreground">{money(e.balance, cur)}</span></span>
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

function ReturnPanel({ shop, open, onClose, onDone }: { shop: Shop; open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const money = useMoney();
  const action = useAction();
  const suppliers = useLoad(() => listSuppliers(), []);
  const [supplierId, setSupplierId] = useState("");
  const [lines, setLines] = useState<{ part: Part; quantity: number }[]>([]);
  const [reason, setReason] = useState("");
  const total = lines.reduce((s, l) => s + (l.part.costPrice ?? 0) * l.quantity, 0);

  return (
    <Panel open={open} onClose={onClose} title={t("shop.pay.newReturn")} description={t("shop.pay.returnBody")}>
      <Field label={t("shop.pur.supplier")}>
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={inputCls}>
          <option value="">{t("shop.pur.pickSupplier")}</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <PartPicker onPick={(p) => setLines((ls) => (ls.some((l) => l.part.id === p.id) ? ls : [...ls, { part: p, quantity: 1 }]))} />
      {lines.length > 0 && (
        <Card className="p-4">
          <ul className="divide-y divide-border text-sm">
            {lines.map((l) => (
              <li key={l.part.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{l.part.name}<span className="block text-xs text-muted-foreground">{t("shop.stockShort", { n: l.part.stockQty })}</span></span>
                <input type="number" min={1} max={l.part.stockQty} value={l.quantity} onChange={(e) => setLines(lines.map((x) => (x.part.id === l.part.id ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))} className={`${inputCls} w-20! py-1! text-right`} />
                <button type="button" onClick={() => setLines(lines.filter((x) => x.part.id !== l.part.id))} className="text-xs text-muted-foreground hover:text-bad">{t("garage.action.remove")}</button>
              </li>
            ))}
          </ul>
          {total > 0 && <p className="mt-2 text-right text-sm">{t("shop.pay.creditAtCost", { amount: money(total, shop.currency) })}</p>}
        </Card>
      )}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("shop.pay.returnReason")} maxLength={500} className={inputCls} />
      {action.error && <ErrorNote message={action.error} />}
      <button
        type="button"
        disabled={action.busy !== null || !supplierId || lines.length === 0}
        onClick={async () => {
          const r = await action.run("ret", () => returnToSupplier({ supplierId, items: lines.map((l) => ({ partId: l.part.id, quantity: l.quantity })), reason: reason.trim() || null }));
          if (r) {
            setLines([]);
            setReason("");
            onDone();
          }
        }}
        className={btnPrimary}
      >
        {action.busy === "ret" ? <Spinner /> : <Undo2 />} {t("shop.pay.sendBack")}
      </button>
    </Panel>
  );
}
