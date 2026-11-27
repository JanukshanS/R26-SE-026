"use client";

/**
 * The cash drawer: open it with a float, see what should be in it as the day
 * goes, pay cash in or out, then count it and close. The close prints the
 * end-of-day (Z) report with the over or short. Owners and managers see every
 * drawer; everyone else their own.
 */
import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Printer, Wallet } from "lucide-react";

import { Badge, Card, CardHeader, Empty, ErrorNote, Field, Kpi, Loading, Panel, Segmented, Spinner, btnPrimary, btnSecondary, btnSm, inputCls, useAction, useLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { closeDrawer, getDrawer, getMyDrawer, listDrawers, moveDrawerCash, openDrawer, type CashSession, type Shop } from "@/lib/partsApi";

import { useAccess } from "./access";
import { printZReport } from "./print";

export default function CashDrawer({ shop }: { shop: Shop }) {
  const t = useT();
  const access = useAccess();
  const mine = useLoad(getMyDrawer, []);
  const history = useLoad(() => listDrawers(), []);
  const [viewing, setViewing] = useState<string | null>(null);
  const refresh = () => {
    mine.reload();
    history.reload();
  };

  return (
    <div className="space-y-6">
      {mine.error ? <ErrorNote message={mine.error} onRetry={mine.reload} /> : mine.loading && !mine.data ? <Loading /> : mine.data ? (
        <OpenDrawer shop={shop} s={mine.data} canMove={access.can("cash")} onChanged={(s) => { mine.setData(s.status === "OPEN" ? s : null); history.reload(); if (s.status === "CLOSED") printZReport(shop, s, t); }} />
      ) : (
        <StartDrawer onOpened={refresh} />
      )}

      <Card className="p-0!">
        <div className="px-5 pt-4"><CardHeader title={access.can("cash") ? t("shop.cash.allDrawers") : t("shop.cash.myDrawers")} /></div>
        {history.error ? <div className="p-5"><ErrorNote message={history.error} onRetry={history.reload} /></div> : !history.data ? <Loading /> : history.data.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">{t("shop.cash.none")}</p>
        ) : (
          <SessionTable shop={shop} rows={history.data} onOpen={setViewing} />
        )}
      </Card>
      <SessionPanel shop={shop} id={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function StartDrawer({ onOpened }: { onOpened: () => void }) {
  const t = useT();
  const action = useAction();
  const [float, setFloat] = useState("");
  return (
    <Card className="max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-primary"><Wallet className="size-5" /></span>
        <div><h2 className="font-display text-lg font-bold">{t("shop.cash.startTitle")}</h2><p className="text-sm text-muted-foreground">{t("shop.cash.startBody")}</p></div>
      </div>
      <Field label={t("shop.cash.float")} hint={t("shop.cash.floatHint")}><input type="number" min={0} step="0.01" value={float} onChange={(e) => setFloat(e.target.value)} className={inputCls} autoFocus /></Field>
      {action.error && <ErrorNote message={action.error} />}
      <button type="button" disabled={action.busy !== null || float === ""} onClick={async () => (await action.run("open", () => openDrawer({ openingFloat: Number(float) || 0 }))) && onOpened()} className={btnPrimary}>
        {action.busy === "open" ? <Spinner /> : <Wallet />} {t("shop.cash.open")}
      </button>
    </Card>
  );
}

function OpenDrawer({ shop, s, canMove, onChanged }: { shop: Shop; s: CashSession; canMove: boolean; onChanged: (s: CashSession) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const action = useAction();
  const [mode, setMode] = useState<"count" | "move">("count");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [move, setMove] = useState({ kind: "PAY_OUT" as "PAY_IN" | "PAY_OUT", amount: "", reason: "" });
  const sum = s.summary!;
  const cur = shop.currency;
  const diff = counted === "" ? null : Math.round(((Number(counted) || 0) - (s.expectedCash ?? 0)) * 100) / 100;
  const row = (label: string, v: number, sign: "+" | "−" | "" = "") => v !== 0 && <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{sign}{money(v, cur)}</span></div>;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Kpi tone="brand" icon={Wallet} value={money(s.expectedCash ?? 0, cur)} label={t("shop.cash.expected")} />
          <Kpi tone="info" icon={ArrowDownToLine} value={money(sum.cashSales, cur)} label={t("shop.cash.cashSalesN", { n: sum.sales })} />
          <Kpi tone="vio" icon={ArrowUpFromLine} value={money(sum.cashRefunds + sum.payOuts + sum.supplierPayments, cur)} label={t("shop.cash.out")} />
        </div>
        <Card className="space-y-1.5 text-sm">
          <CardHeader title={t("shop.cash.drawerN", { n: s.number })} sub={t("shop.cash.openedAt", { name: s.userName, time: formatDate(s.openedAt, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) })} />
          {row(t("shop.cash.float"), sum.openingFloat)}
          {row(t("shop.cash.cashSales"), sum.cashSales, "+")}
          {row(t("shop.cash.cashRefunds"), sum.cashRefunds, "−")}
          {row(t("shop.cash.accountPayments"), sum.accountPayments, "+")}
          {row(t("shop.cash.handovers"), sum.handovers, "+")}
          {row(t("shop.cash.supplierPayments"), sum.supplierPayments, "−")}
          {row(t("shop.cash.payIns"), sum.payIns, "+")}
          {row(t("shop.cash.payOuts"), sum.payOuts, "−")}
          <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>{t("shop.cash.expected")}</span><span className="tabular-nums">{money(s.expectedCash ?? 0, cur)}</span></div>
          {sum.byMethod.filter((m) => m.method !== "CASH").length > 0 && (
            <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
              <p className="font-medium">{t("shop.cash.otherMethods")}</p>
              {sum.byMethod.filter((m) => m.method !== "CASH").map((m) => <div key={m.method} className="flex justify-between"><span>{t(`shop.method.${m.method}`)}</span><span className="tabular-nums">{money(m.total, cur)}</span></div>)}
            </div>
          )}
        </Card>
        {s.movements.length > 0 && (
          <Card className="p-0!">
            <div className="px-5 pt-4"><CardHeader title={t("shop.cash.movements")} /></div>
            <ul className="divide-y divide-border text-sm">
              {s.movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-5 py-2.5">
                  <span><span className="block">{m.reason}</span><span className="block text-xs text-muted-foreground">{m.byName} · {formatDate(m.createdAt, { hour: "2-digit", minute: "2-digit" })}</span></span>
                  <span className={`tabular-nums ${m.kind === "PAY_OUT" ? "text-bad" : "text-ok"}`}>{m.kind === "PAY_OUT" ? "−" : "+"}{money(m.amount, cur)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card className="space-y-4 self-start">
        {canMove && <Segmented value={mode} onChange={setMode} options={[{ value: "count", label: t("shop.cash.close") }, { value: "move", label: t("shop.cash.inOut") }]} />}
        {mode === "count" ? (
          <>
            <Field label={t("shop.cash.counted")} hint={t("shop.cash.countHint")}><input type="number" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} className={inputCls} /></Field>
            {diff !== null && (
              <div className={`rounded-xl px-4 py-3 text-sm font-medium ${diff === 0 ? "bg-ok-soft text-ok" : diff < 0 ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn"}`}>
                {diff === 0 ? t("shop.cash.balanced") : diff < 0 ? t("shop.cash.shortBy", { amount: money(-diff, cur) }) : t("shop.cash.overBy", { amount: money(diff, cur) })}
              </div>
            )}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("shop.cash.notePlaceholder")} maxLength={500} className={inputCls} />
            {action.error && <ErrorNote message={action.error} />}
            <button type="button" disabled={action.busy !== null || counted === ""} onClick={async () => { const done = await action.run("close", () => closeDrawer(s.id, { countedCash: Number(counted) || 0, note: note.trim() || null })); if (done) onChanged(done); }} className={`${btnPrimary} w-full`}>
              {action.busy === "close" ? <Spinner /> : <Lock />} {t("shop.cash.closePrint")}
            </button>
          </>
        ) : (
          <>
            <Segmented value={move.kind} onChange={(kind) => setMove({ ...move, kind })} options={[{ value: "PAY_OUT", label: t("shop.cash.payOut") }, { value: "PAY_IN", label: t("shop.cash.payIn") }]} />
            <Field label={t("shop.print.amount")}><input type="number" min={0} step="0.01" value={move.amount} onChange={(e) => setMove({ ...move, amount: e.target.value })} className={inputCls} /></Field>
            <Field label={t("shop.cash.reason")}><input value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder={t("shop.cash.reasonPlaceholder")} maxLength={200} className={inputCls} /></Field>
            {action.error && <ErrorNote message={action.error} />}
            <button
              type="button"
              disabled={action.busy !== null || !Number(move.amount) || !move.reason.trim()}
              onClick={async () => {
                const next = await action.run("move", () => moveDrawerCash(s.id, { kind: move.kind, amount: Number(move.amount), reason: move.reason.trim() }));
                if (next) {
                  setMove({ ...move, amount: "", reason: "" });
                  onChanged(next);
                }
              }}
              className={`${btnPrimary} w-full`}
            >
              {action.busy === "move" ? <Spinner /> : move.kind === "PAY_OUT" ? <ArrowUpFromLine /> : <ArrowDownToLine />} {move.kind === "PAY_OUT" ? t("shop.cash.payOut") : t("shop.cash.payIn")}
            </button>
          </>
        )}
        <button type="button" onClick={() => printZReport(shop, s, t)} className={`${btnSecondary} ${btnSm} w-full`}><Printer /> {t("shop.cash.printX")}</button>
      </Card>
    </div>
  );
}

function SessionTable({ shop, rows, onOpen }: { shop: Shop; rows: CashSession[]; onOpen: (id: string) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">{t("shop.cash.who")}</th>
            <th className="px-3 py-2 font-medium">{t("shop.cash.when")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("shop.cash.expected")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("shop.cash.counted")}</th>
            <th className="px-5 py-2 text-right font-medium">{t("shop.cash.difference")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} onClick={() => onOpen(s.id)} className="cursor-pointer border-t border-border hover:bg-canvas">
              <td className="px-5 py-2.5 font-mono text-muted-foreground">{s.number}</td>
              <td className="px-3 py-2.5">{s.userName}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatDate(s.openedAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{s.status === "OPEN" && <> <Badge tone="ok" dot>{t("shop.cash.openNow")}</Badge></>}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{s.expectedCash != null ? money(s.expectedCash, shop.currency) : "—"}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{s.countedCash != null ? money(s.countedCash, shop.currency) : "—"}</td>
              <td className={`px-5 py-2.5 text-right font-medium tabular-nums ${s.difference == null ? "" : s.difference < 0 ? "text-bad" : s.difference > 0 ? "text-warn" : "text-ok"}`}>{s.difference == null ? "—" : money(s.difference, shop.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionPanel({ shop, id, onClose }: { shop: Shop; id: string | null; onClose: () => void }) {
  const t = useT();
  const money = useMoney();
  const s = useLoad(() => (id ? getDrawer(id) : Promise.resolve(null)), [id]);
  const d = s.data;
  return (
    <Panel open={id !== null} onClose={onClose} title={d ? t("shop.cash.drawerN", { n: d.number }) : t("garage.loading")} description={d?.userName}>
      {s.error ? <ErrorNote message={s.error} onRetry={s.reload} /> : !d ? <Loading /> : !d.summary ? <Empty title={t("shop.cash.none")} /> : (
        <>
          <Card className="space-y-1.5 p-5 text-sm">
            {[
              [t("shop.cash.float"), d.summary.openingFloat],
              [t("shop.cash.cashSales"), d.summary.cashSales],
              [t("shop.cash.cashRefunds"), -d.summary.cashRefunds],
              [t("shop.cash.accountPayments"), d.summary.accountPayments],
              [t("shop.cash.handovers"), d.summary.handovers],
              [t("shop.cash.supplierPayments"), -d.summary.supplierPayments],
              [t("shop.cash.payIns"), d.summary.payIns],
              [t("shop.cash.payOuts"), -d.summary.payOuts],
            ]
              .filter(([, v]) => v !== 0)
              .map(([label, v]) => <div key={label as string} className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{money(v as number, shop.currency)}</span></div>)}
            <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>{t("shop.cash.expected")}</span><span>{money(d.expectedCash ?? 0, shop.currency)}</span></div>
            {d.countedCash != null && <div className="flex justify-between"><span>{t("shop.cash.counted")}</span><span>{money(d.countedCash, shop.currency)}</span></div>}
            {d.difference != null && <div className={`flex justify-between font-semibold ${d.difference < 0 ? "text-bad" : d.difference > 0 ? "text-warn" : "text-ok"}`}><span>{t("shop.cash.difference")}</span><span>{money(d.difference, shop.currency)}</span></div>}
          </Card>
          <button type="button" onClick={() => printZReport(shop, d, t)} className={btnSecondary}><Printer /> {t("shop.cash.printZ")}</button>
        </>
      )}
    </Panel>
  );
}
