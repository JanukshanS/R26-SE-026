"use client";

/**
 * Credit accounts: garages that buy through Kaduna, and the shop's own
 * customers (a fleet, a local mechanic, a regular). What each owes and how
 * late; per account, the credit terms, payments and credit notes, the
 * statement (printable), and its sales and orders.
 */
import { useEffect, useState } from "react";
import { Banknote, FileText, Phone, Printer, UserPlus, Users, Wallet, Warehouse } from "lucide-react";

import { Badge, Card, CardHeader, Chip, Empty, ErrorNote, Field, Kpi, Loading, Panel, Segmented, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { createCustomerAccount, getAccount, listAccounts, recordAdjustment, recordPayment, updateAccount, type Account, type AccountDetail, type AccountEntry, type PaymentMethod, type Shop } from "@/lib/partsApi";

import { useAccess } from "./access";
import { MethodChips } from "./common";
import { AgeingBar } from "./Payables";
import { printStatement } from "./print";

export default function Accounts({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const access = useAccess();
  const list = useLoad(listAccounts, []);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<"ALL" | "GARAGE" | "CUSTOMER">("ALL");
  const cur = shop.currency;

  if (list.error) return <ErrorNote message={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const owed = list.data.reduce((s, a) => s + Math.max(0, a.balance), 0);
  const overdue = list.data.reduce((s, a) => s + a.overdue, 0);
  const rows = list.data.filter((a) => kind === "ALL" || a.kind === kind);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="info" icon={Wallet} value={money(owed, cur)} label={t("shop.acc.owed")} />
        <Kpi tone="bad" icon={Wallet} value={money(overdue, cur)} label={t("shop.acc.overdue")} />
        <Kpi tone="vio" icon={Warehouse} value={list.data.filter((a) => a.kind === "GARAGE" && a.linked).length} label={t("shop.acc.garages")} />
        <Kpi tone="brand" icon={Users} value={list.data.filter((a) => a.kind === "CUSTOMER").length} label={t("shop.acc.customers")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={kind === "ALL"} onClick={() => setKind("ALL")}>{t("shop.acc.all")}</Chip>
        <Chip on={kind === "GARAGE"} onClick={() => setKind("GARAGE")}>{t("shop.acc.kind.GARAGE")}</Chip>
        <Chip on={kind === "CUSTOMER"} onClick={() => setKind("CUSTOMER")}>{t("shop.acc.kind.CUSTOMER")}</Chip>
        {access.can("accounts") && <button type="button" onClick={() => setAdding(true)} className={`${btnPrimary} ${btnSm} ml-auto`}><UserPlus /> {t("shop.acc.addCustomer")}</button>}
      </div>
      {rows.length === 0 ? (
        <Empty title={t("shop.acc.emptyTitle")} body={t("shop.acc.emptyBody")} />
      ) : (
        <Card className="overflow-x-auto p-0!">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">{t("shop.acc.who")}</th>
                <th className="px-3 py-3 font-medium">{t("shop.acc.terms")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("shop.acc.balance")}</th>
                <th className="px-3 py-3 text-right font-medium">{t("shop.acc.overdueCol")}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={`border-t border-border ${a.linked ? "" : "opacity-60"}`}>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2 font-medium">{a.name} <Badge tone={a.kind === "GARAGE" ? "vio" : "info"} dot={false}>{t(`shop.acc.kind.${a.kind}`)}</Badge></span>
                    <span className="block text-xs text-muted-foreground">
                      {a.kind === "GARAGE" ? t("parts.garages.orders", { count: a.orders }) : a.phone ?? ""}
                      {a.lastOrderAt && ` · ${t("parts.garages.last", { date: formatDate(a.lastOrderAt, { day: "numeric", month: "short" }) })}`}
                      {!a.linked && ` · ${t("shop.acc.unlinked")}`}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {a.creditLimit > 0 ? t("shop.acc.creditTerms", { amount: money(a.creditLimit, cur), days: a.paymentDays }) : t("shop.acc.cashOnly")}
                    {a.onHold && <> <Badge tone="bad" dot={false}>{t("shop.acc.hold")}</Badge></>}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{money(a.balance, cur)}</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${a.overdue > 0 ? "font-semibold text-bad" : "text-muted-foreground"}`}>{money(a.overdue, cur)}</td>
                  <td className="px-5 py-3 text-right"><button type="button" onClick={() => setOpen(a.id)} className={`${btnSecondary} ${btnSm}`}><FileText /> {t("parts.account.statement")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <AccountPanel shop={shop} id={open} onClose={() => setOpen(null)} onChanged={list.reload} />
      <NewCustomer open={adding} onClose={() => setAdding(false)} onCreated={(a) => { setAdding(false); list.reload(); setOpen(a.id); }} />
    </div>
  );
}

function NewCustomer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (a: AccountDetail) => void }) {
  const t = useT();
  const action = useAction();
  return (
    <Panel open={open} onClose={onClose} title={t("shop.acc.addCustomer")} description={t("shop.acc.addCustomerBody")}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const a = await action.run("add", () =>
            createCustomerAccount({
              name: String(f.get("name") ?? "").trim(),
              phone: String(f.get("phone") ?? "").trim() || null,
              address: String(f.get("address") ?? "").trim() || null,
              creditLimit: Number(f.get("creditLimit")) || 0,
              paymentDays: Number(f.get("paymentDays")) || 30,
            })
          );
          if (a) onCreated(a);
        }}
      >
        <Field label={t("garage.field.name")}><input name="name" required maxLength={160} placeholder={t("shop.acc.namePlaceholder")} className={inputCls} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("garage.field.phone")}><input name="phone" maxLength={40} className={inputCls} /></Field>
          <Field label={t("parts.shop.address")}><input name="address" maxLength={500} className={inputCls} /></Field>
          <Field label={t("shop.acc.limit")} hint={t("shop.acc.limitHint")}><input name="creditLimit" type="number" min={0} step="0.01" defaultValue="0" className={inputCls} /></Field>
          <Field label={t("shop.acc.days")}><input name="paymentDays" type="number" min={0} max={180} defaultValue="30" className={inputCls} /></Field>
        </div>
        {action.error && <ErrorNote message={action.error} />}
        <button type="submit" disabled={action.busy !== null} className={btnPrimary}>{action.busy === "add" ? <Spinner /> : <UserPlus />} {t("shop.acc.addCustomer")}</button>
      </form>
    </Panel>
  );
}

const entryText = (e: AccountEntry, t: ReturnType<typeof useT>) =>
  [
    t(`parts.entry.${e.kind}`),
    e.order ? t("parts.order.number", { n: e.order.number }) : null,
    e.order?.plate,
    e.sale ? t("shop.acc.saleN", { n: e.sale.number }) : null,
    e.method ? t(`garage.method.${e.method}`) : null,
    e.reference,
    e.note,
  ]
    .filter(Boolean)
    .join(" · ");

function AccountPanel({ shop, id, onClose, onChanged }: { shop: Shop; id: string | null; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const access = useAccess();
  const action = useAction();
  const acc = useLoad(() => (id ? getAccount(id) : Promise.resolve(null)), [id]);
  const modes = [...(access.can("payments") ? (["payment"] as const) : []), ...(access.can("accounts") ? (["adjustment", "terms"] as const) : [])];
  const [mode, setMode] = useState<"payment" | "adjustment" | "terms">(modes[0] ?? "payment");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [terms, setTerms] = useState({ creditLimit: "", paymentDays: "", onHold: false, name: "", phone: "", address: "" });
  const a = acc.data;
  const cur = shop.currency;

  useEffect(() => {
    if (a) setTerms({ creditLimit: String(a.creditLimit), paymentDays: String(a.paymentDays), onHold: a.onHold, name: a.name, phone: a.phone ?? "", address: a.address ?? "" });
  }, [a]);

  async function save(fn: () => Promise<AccountDetail>) {
    const next = await action.run("save", fn);
    if (next) {
      acc.setData(next);
      setAmount("");
      setReference("");
      setNote("");
      onChanged();
    }
  }

  return (
    <Panel wide open={id !== null} onClose={onClose} title={a?.name ?? t("garage.loading")} description={a ? <><Badge tone={a.kind === "GARAGE" ? "vio" : "info"} dot={false}>{t(`shop.acc.kind.${a.kind}`)}</Badge>{a.address && <span>{a.address}</span>}</> : undefined}>
      {acc.error ? (
        <ErrorNote message={acc.error} onRetry={acc.reload} />
      ) : !a ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.acc.balance")}</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{money(a.balance, cur)}</p></Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.acc.overdueCol")}</p><p className={`mt-1 font-display text-xl font-bold tabular-nums ${a.overdue > 0 ? "text-bad" : ""}`}>{money(a.overdue, cur)}</p>{a.oldestOverdue && <p className="text-[11px] text-muted-foreground">{t("shop.acc.since", { date: formatDate(a.oldestOverdue, { day: "numeric", month: "short" }) })}</p>}</Card>
            <Card className="p-4"><p className="text-xs text-muted-foreground">{t("shop.acc.limit")}</p><p className="mt-1 font-display text-xl font-bold tabular-nums">{a.creditLimit > 0 ? money(a.creditLimit, cur) : "—"}</p></Card>
          </div>
          <Card className="p-4"><AgeingBar a={a.ageing} currency={cur} /></Card>
          <div className="flex flex-wrap gap-2">
            {a.phone && <a href={`tel:${a.phone}`} className={`${btnSecondary} ${btnSm}`}><Phone /> {a.phone}</a>}
            <button
              type="button"
              onClick={() =>
                printStatement(shop, t, {
                  title: t("shop.acc.statementTitle"),
                  party: { name: a.name, phone: a.phone, address: a.address },
                  rows: a.entries.map((e) => ({ date: e.createdAt, what: entryText(e, t), amount: e.amount, balance: e.balance })),
                  balance: a.balance,
                  ageing: a.ageing,
                })
              }
              className={`${btnSecondary} ${btnSm}`}
            >
              <Printer /> {t("shop.acc.printStatement")}
            </button>
          </div>

          {modes.length > 0 && (
            <Card className="space-y-3 p-5">
              <Segmented value={mode} onChange={setMode} options={modes.map((m) => ({ value: m, label: t(m === "payment" ? "shop.acc.payment" : m === "adjustment" ? "shop.acc.adjustment" : "shop.acc.termsTab") }))} />
              {mode === "terms" ? (
                <>
                  {a.kind === "CUSTOMER" && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label={t("garage.field.name")}><input value={terms.name} onChange={(e) => setTerms({ ...terms, name: e.target.value })} maxLength={160} className={inputCls} /></Field>
                      <Field label={t("garage.field.phone")}><input value={terms.phone} onChange={(e) => setTerms({ ...terms, phone: e.target.value })} maxLength={40} className={inputCls} /></Field>
                      <Field label={t("parts.shop.address")}><input value={terms.address} onChange={(e) => setTerms({ ...terms, address: e.target.value })} maxLength={500} className={inputCls} /></Field>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t("shop.acc.limit")} hint={t("shop.acc.limitHint")}><input type="number" min={0} step="0.01" value={terms.creditLimit} onChange={(e) => setTerms({ ...terms, creditLimit: e.target.value })} className={inputCls} /></Field>
                    <Field label={t("shop.acc.days")}><input type="number" min={0} max={180} value={terms.paymentDays} onChange={(e) => setTerms({ ...terms, paymentDays: e.target.value })} className={inputCls} /></Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={terms.onHold} onChange={(e) => setTerms({ ...terms, onHold: e.target.checked })} className="size-4 accent-primary" /> {t("shop.acc.holdLabel")}</label>
                  <button
                    type="button"
                    disabled={action.busy !== null || (a.kind === "CUSTOMER" && !terms.name.trim())}
                    onClick={() =>
                      save(() =>
                        updateAccount(a.id, {
                          creditLimit: Number(terms.creditLimit) || 0,
                          paymentDays: Number(terms.paymentDays) || 0,
                          onHold: terms.onHold,
                          ...(a.kind === "CUSTOMER" ? { name: terms.name.trim(), phone: terms.phone.trim() || null, address: terms.address.trim() || null } : {}),
                        })
                      )
                    }
                    className={btnPrimary}
                  >
                    {action.busy === "save" && <Spinner />} {t("garage.action.save")}
                  </button>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={mode === "payment" ? t("shop.acc.received") : t("shop.acc.adjustBy")} hint={mode === "adjustment" ? t("shop.acc.adjustHint") : undefined}>
                      <input type="number" step="0.01" min={mode === "payment" ? 0 : undefined} value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
                    </Field>
                    {mode === "payment" && <Field label={t("shop.acc.reference")}><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className={inputCls} /></Field>}
                  </div>
                  {mode === "payment" && <Field label={t("shop.sale.method")}><MethodChips value={method} onChange={setMethod} /></Field>}
                  <Field label={t("shop.acc.note")}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputCls} /></Field>
                  <button
                    type="button"
                    disabled={action.busy !== null || !Number(amount) || (mode === "adjustment" && !note.trim())}
                    onClick={() =>
                      save(() =>
                        mode === "payment"
                          ? recordPayment(a.id, { amount: Number(amount), method, reference: reference.trim() || null, note: note.trim() || null })
                          : recordAdjustment(a.id, { amount: Number(amount), note: note.trim() })
                      )
                    }
                    className={btnPrimary}
                  >
                    {action.busy === "save" ? <Spinner /> : <Banknote />} {mode === "payment" ? t("shop.acc.recordPayment") : t("shop.acc.recordAdjustment")}
                  </button>
                </>
              )}
              {action.error && <ErrorNote message={action.error} />}
            </Card>
          )}

          <Card className="p-0!">
            <div className="px-5 pt-4"><CardHeader title={t("parts.account.statement")} /></div>
            {a.entries.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">{t("parts.account.noEntries")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {a.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{entryText(e, t)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{formatDate(e.createdAt, { day: "numeric", month: "short", year: "numeric" })}{e.byName && ` · ${e.byName}`}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block tabular-nums ${e.amount < 0 ? "text-ok" : ""}`}>{money(e.amount, cur)}</span>
                      <span className="block text-xs tabular-nums text-muted-foreground">{money(e.balance, cur)}</span>
                    </span>
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

export type { Account };
