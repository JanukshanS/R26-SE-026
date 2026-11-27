"use client";

/**
 * How the shop is doing. Sales: revenue (counter and trade), profit, payment
 * methods, VAT by rate, each cashier, top parts and garages. Stock: value by
 * category and dead stock. Who owes: accounts and suppliers by how late.
 */
import { useState } from "react";
import { Archive, Package, Percent, Receipt, TrendingUp, Truck, Wallet } from "lucide-react";

import { BarChart, Card, CardHeader, ChartEmpty, Chip, Donut, Empty, ErrorNote, Kpi, Legend, Loading, Segmented, useLoad, useMoney, useShortMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { getAgeingReport, getShopReport, getStockReport, type SaleMethod, type Shop } from "@/lib/partsApi";

import { AgeingBar } from "./Payables";
import { printStatement } from "./print";

const local = (d: Date) => d.toLocaleDateString("en-CA");
const METHOD_COLOR: Record<SaleMethod, string> = { CASH: "#16a36a", CARD: "#2f6feb", BANK_TRANSFER: "#8b5cf6", OTHER: "#a0938a", ACCOUNT: "#ec5500", VOUCHER: "#d4a017" };

export default function ShopReports({ shop }: { shop: Shop }) {
  const t = useT();
  const [view, setView] = useState<"sales" | "stock" | "ageing">("sales");
  return (
    <div className="space-y-6">
      <Segmented value={view} onChange={setView} options={[{ value: "sales", label: t("shop.rep.salesTab") }, { value: "stock", label: t("shop.rep.stockTab") }, { value: "ageing", label: t("shop.rep.ageingTab") }]} />
      {view === "sales" ? <SalesReport shop={shop} /> : view === "stock" ? <StockReport shop={shop} /> : <AgeingReport shop={shop} />}
    </div>
  );
}

function range(kind: "month" | "last" | "30"): [string, string] {
  const now = new Date();
  if (kind === "month") return [local(new Date(now.getFullYear(), now.getMonth(), 1)), local(now)];
  if (kind === "last") return [local(new Date(now.getFullYear(), now.getMonth() - 1, 1)), local(new Date(now.getFullYear(), now.getMonth(), 0))];
  return [local(new Date(now.getTime() - 29 * 86_400_000)), local(now)];
}

function SalesReport({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const short = useShortMoney();
  const { formatDate } = useI18n();
  const [kind, setKind] = useState<"month" | "last" | "30">("month");
  const [from, to] = range(kind);
  const r = useLoad(() => getShopReport(from, to), [from, to]);
  const cur = shop.currency;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Chip on={kind === "month"} onClick={() => setKind("month")}>{t("shop.rep.thisMonth")}</Chip>
        <Chip on={kind === "last"} onClick={() => setKind("last")}>{t("shop.rep.lastMonth")}</Chip>
        <Chip on={kind === "30"} onClick={() => setKind("30")}>{t("shop.rep.last30")}</Chip>
      </div>
      {r.error ? (
        <ErrorNote message={r.error} onRetry={r.reload} />
      ) : !r.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi tone="brand" icon={TrendingUp} value={money(r.data.totals.revenue, cur)} label={t("shop.rep.revenue")} />
            <Kpi tone="info" icon={Receipt} value={money(r.data.totals.counter, cur)} label={t("shop.rep.counter", { count: r.data.totals.sales })} />
            <Kpi tone="vio" icon={Truck} value={money(r.data.totals.trade, cur)} label={t("shop.rep.trade", { count: r.data.totals.garageOrders })} />
            <Kpi tone="ok" icon={Percent} value={money(r.data.totals.grossProfit, cur)} label={t("shop.rep.profit")} delta={r.data.totals.margin != null ? t("shop.rep.margin", { pct: r.data.totals.margin }) : undefined} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title={t("shop.rep.byDay")} sub={`${formatDate(`${r.data.from}T12:00:00Z`, { day: "numeric", month: "short" })} – ${formatDate(`${r.data.to}T12:00:00Z`, { day: "numeric", month: "short" })}`} />
              <ChartEmpty show={r.data.totals.revenue === 0} message={t("shop.rep.noSales")}>
                <BarChart
                  labels={r.data.days.map((d) => formatDate(`${d.date}T12:00:00Z`, { day: "numeric" }))}
                  series={[
                    { name: t("shop.rep.counterShort"), color: "#ec5500", values: r.data.days.map((d) => d.counter) },
                    { name: t("shop.rep.tradeShort"), color: "#8b5cf6", values: r.data.days.map((d) => d.trade) },
                  ]}
                  format={(n) => short(n, cur)}
                />
                <Legend series={[{ name: t("shop.rep.counterShort"), color: "#ec5500" }, { name: t("shop.rep.tradeShort"), color: "#8b5cf6" }]} />
              </ChartEmpty>
            </Card>
            <Card>
              <CardHeader title={t("shop.rep.payments")} />
              {r.data.paymentMethods.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("shop.rep.noSales")}</p>
              ) : (
                <div className="flex items-center gap-5">
                  <Donut parts={r.data.paymentMethods.map((m) => ({ value: m.total, color: METHOD_COLOR[m.method] }))} size={110} />
                  <ul className="space-y-1.5 text-sm">
                    {r.data.paymentMethods.map((m) => (
                      <li key={m.method} className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: METHOD_COLOR[m.method] }} />
                        <span className="flex-1">{t(`shop.method.${m.method}`)}</span>
                        <span className="tabular-nums">{money(m.total, cur)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <dl className="mt-5 space-y-1 border-t border-border pt-3 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("shop.rep.cost")}</dt><dd className="tabular-nums">{money(r.data.totals.cost, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("shop.rep.tax")}</dt><dd className="tabular-nums">{money(r.data.totals.tax, cur)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">{t("shop.rep.refunds")}</dt><dd className="tabular-nums">{money(r.data.totals.refunds, cur)}</dd></div>
                {r.data.totals.voided > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("shop.rep.voided")}</dt><dd className="tabular-nums">{r.data.totals.voided}</dd></div>}
              </dl>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title={t("shop.rep.topParts")} />
              {r.data.topParts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("shop.rep.noSales")}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">{t("parts.field.part")}</th><th className="pb-2 text-right font-medium">{t("garage.field.qty")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.revenue")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.profitShort")}</th></tr></thead>
                  <tbody>
                    {r.data.topParts.map((p) => (
                      <tr key={p.partId} className="border-t border-border">
                        <td className="py-2"><span className="block font-medium">{p.name}</span><span className="block font-mono text-xs text-muted-foreground">{p.sku}</span></td>
                        <td className="py-2 text-right tabular-nums">{p.quantity}</td>
                        <td className="py-2 text-right tabular-nums">{money(p.revenue, cur)}</td>
                        <td className={`py-2 text-right tabular-nums ${p.profit < 0 ? "text-bad" : "text-ok"}`}>{money(p.profit, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <CardHeader title={t("shop.rep.topGarages")} />
              {r.data.topGarages.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("shop.rep.noTrade")}</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {r.data.topGarages.map((g) => (
                    <li key={g.name} className="flex items-center gap-2 py-2.5">
                      <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                      <span className="text-xs text-muted-foreground">{t("parts.garages.orders", { count: g.orders })}</span>
                      <span className="w-28 text-right tabular-nums">{money(g.total, cur)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title={t("shop.rep.vat")} sub={t("shop.rep.vatSub")} />
              {r.data.vat.length === 0 ? <p className="text-sm text-muted-foreground">{t("shop.rep.noSales")}</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">{t("shop.rep.rate")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.taxable")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.vatAmount")}</th></tr></thead>
                  <tbody>
                    {r.data.vat.map((v) => (
                      <tr key={v.rate} className="border-t border-border"><td className="py-2">{v.rate === 0 ? t("shop.rep.exempt") : `${v.rate}%`}</td><td className="py-2 text-right tabular-nums">{money(v.taxable, cur)}</td><td className="py-2 text-right tabular-nums">{money(v.tax, cur)}</td></tr>
                    ))}
                    <tr className="border-t border-border font-semibold"><td className="py-2">{t("garage.invoice.total")}</td><td className="py-2 text-right tabular-nums">{money(r.data.vat.reduce((s, v) => s + v.taxable, 0), cur)}</td><td className="py-2 text-right tabular-nums">{money(r.data.vat.reduce((s, v) => s + v.tax, 0), cur)}</td></tr>
                  </tbody>
                </table>
              )}
            </Card>
            <Card>
              <CardHeader title={t("shop.rep.cashiers")} />
              {r.data.cashiers.length === 0 ? <p className="text-sm text-muted-foreground">{t("shop.rep.noSales")}</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">{t("shop.cash.who")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.salesN")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.revenue")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.discounts")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.voidsRefunds")}</th></tr></thead>
                  <tbody>
                    {r.data.cashiers.map((c) => (
                      <tr key={c.name} className="border-t border-border">
                        <td className="py-2 font-medium">{c.name}</td>
                        <td className="py-2 text-right tabular-nums">{c.sales}</td>
                        <td className="py-2 text-right tabular-nums">{money(c.total, cur)}</td>
                        <td className="py-2 text-right tabular-nums">{money(c.discounts, cur)}</td>
                        <td className={`py-2 text-right tabular-nums ${c.voids || c.refunds ? "text-warn" : "text-muted-foreground"}`}>{c.voids} · {money(c.refunds, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StockReport({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const [days, setDays] = useState(90);
  const r = useLoad(() => getStockReport(days), [days]);
  const cur = shop.currency;
  if (r.error) return <ErrorNote message={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Kpi tone="brand" icon={Package} value={money(d.totals.cost, cur)} label={t("shop.rep.stockCost")} />
        <Kpi tone="info" icon={TrendingUp} value={money(d.totals.retail, cur)} label={t("shop.rep.stockRetail")} />
        <Kpi tone="vio" icon={Receipt} value={d.totals.lines} label={t("shop.rep.stockLines")} />
        <Kpi tone="bad" icon={Archive} value={money(d.totals.deadValue, cur)} label={t("shop.rep.deadValue", { n: d.totals.deadLines })} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t("shop.rep.byCategory")} />
          {d.categories.length === 0 ? <p className="text-sm text-muted-foreground">{t("shop.rep.noStock")}</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">{t("shop.inv.category")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.stockLines")}</th><th className="pb-2 text-right font-medium">{t("shop.rep.atCost")}</th><th className="pb-2 text-right font-medium">%</th></tr></thead>
              <tbody>
                {d.categories.map((c) => (
                  <tr key={c.category ?? "-"} className="border-t border-border">
                    <td className="py-2">{c.category ?? t("shop.rep.uncategorised")}</td>
                    <td className="py-2 text-right tabular-nums">{c.lines}</td>
                    <td className="py-2 text-right tabular-nums">{money(c.cost, cur)}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{c.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <CardHeader title={t("shop.rep.dead")} sub={t("shop.rep.deadSub", { days })} action={<span className="flex gap-1.5">{[30, 90, 180, 365].map((n) => <Chip key={n} on={days === n} onClick={() => setDays(n)}>{n}d</Chip>)}</span>} />
          {d.dead.length === 0 ? <Empty title={t("shop.rep.noDead")} /> : (
            <ul className="divide-y divide-border text-sm">
              {d.dead.map((p) => (
                <li key={p.partId} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.name}</span><span className="block font-mono text-xs text-muted-foreground">{p.sku}{p.location && ` · ${p.location}`}</span></span>
                  <span className="text-xs text-muted-foreground">{p.lastSoldAt ? t("shop.rep.lastSold", { date: formatDate(p.lastSoldAt, { day: "numeric", month: "short", year: "numeric" }) }) : t("shop.rep.neverSold")}</span>
                  <span className="w-12 text-right tabular-nums">{p.stockQty}</span>
                  <span className="w-28 text-right tabular-nums">{money(p.value, cur)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function AgeingReport({ shop }: { shop: Shop }) {
  const t = useT();
  const money = useMoney();
  const r = useLoad(getAgeingReport, []);
  const cur = shop.currency;
  if (r.error) return <ErrorNote message={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const sum = (xs: { balance: number }[]) => xs.reduce((s, x) => s + Math.max(0, x.balance), 0);
  const table = (title: string, rows: (typeof r.data.receivables[number] | typeof r.data.payables[number])[], empty: string) => (
    <Card className="overflow-x-auto">
      <CardHeader
        title={title}
        sub={money(sum(rows), cur)}
        action={rows.length > 0 && <button type="button" onClick={() => printStatement(shop, t, { title, party: { name: shop.name }, rows: rows.map((x) => ({ date: new Date().toISOString(), what: x.name, amount: x.overdue, balance: x.balance })), balance: sum(rows) })} className="text-xs font-medium text-primary">{t("shop.sale.print")}</button>}
      />
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground"><tr><th className="pb-2 font-medium">{t("shop.acc.who")}</th><th className="pb-2 text-right font-medium">{t("shop.acc.balance")}</th><th className="min-w-[240px] pb-2 pl-4 font-medium">{t("shop.pay.ageing")}</th></tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className="border-t border-border">
                <td className="py-2"><span className="block font-medium">{x.name}</span>{x.phone && <span className="block text-xs text-muted-foreground">{x.phone}</span>}</td>
                <td className={`py-2 text-right font-semibold tabular-nums ${x.overdue > 0 ? "text-bad" : ""}`}>{money(x.balance, cur)}</td>
                <td className="py-2 pl-4"><AgeingBar a={x} currency={cur} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <Kpi tone="info" icon={Wallet} value={money(sum(r.data.receivables), cur)} label={t("shop.rep.owedToYou")} />
        <Kpi tone="vio" icon={Truck} value={money(sum(r.data.payables), cur)} label={t("shop.rep.youOwe")} />
      </div>
      {table(t("shop.rep.receivables"), r.data.receivables, t("shop.rep.nothingOwed"))}
      {table(t("shop.rep.payables"), r.data.payables, t("shop.rep.nothingOwing"))}
    </div>
  );
}
