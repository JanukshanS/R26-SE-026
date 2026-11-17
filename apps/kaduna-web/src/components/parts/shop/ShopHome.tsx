"use client";

/** The shop's home screen: today, what needs doing, stock and money owed. */
import { AlertTriangle, ArrowRight, Boxes, ClipboardList, PackageCheck, Receipt, ScanBarcode, Truck, Wallet } from "lucide-react";

import { Card, CardHeader, ErrorNote, Kpi, LIVE_MS, Loading, btnPrimary, btnSecondary, btnSm, useLiveLoad, useMoney } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { getShopDashboard, type Shop } from "@/lib/partsApi";

import { OrderStatusBadge } from "../shared";

export type ShopTab = "overview" | "sale" | "cash" | "warranty" | "inventory" | "stocktake" | "purchases" | "payables" | "orders" | "accounts" | "reports" | "staff" | "activity" | "shop";

export default function ShopHome({ shop, onGo }: { shop: Shop; onGo: (tab: ShopTab, hash?: string) => void }) {
  const t = useT();
  const money = useMoney();
  const { formatDate } = useI18n();
  const d = useLiveLoad(getShopDashboard, [], () => LIVE_MS.active * 2);

  if (d.error && !d.data) return <ErrorNote message={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const x = d.data;
  const todo = [
    { n: x.orders.toPrice, label: t("shop.home.toPrice"), icon: ClipboardList, tab: "orders" as ShopTab },
    { n: x.orders.toPrepare, label: t("shop.home.toPrepare"), icon: PackageCheck, tab: "orders" as ShopTab },
    { n: x.orders.ready, label: t("shop.home.ready"), icon: Truck, tab: "orders" as ShopTab },
    { n: x.stock.lowStock, label: t("shop.home.lowStock"), icon: AlertTriangle, tab: "purchases" as ShopTab },
    { n: x.accounts.overdue > 0 ? 1 : 0, label: t("shop.home.overdue", { amount: money(x.accounts.overdue, shop.currency) }), icon: Wallet, tab: "accounts" as ShopTab },
    { n: x.suppliers.overdue > 0 ? 1 : 0, label: t("shop.home.billsLate", { amount: money(x.suppliers.overdue, shop.currency) }), icon: Truck, tab: "payables" as ShopTab },
  ].filter((i) => i.n > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onGo("sale")} className={btnPrimary}><ScanBarcode /> {t("shop.home.newSale")}</button>
        <button type="button" onClick={() => onGo("inventory")} className={btnSecondary}><Boxes /> {t("shop.home.stock")}</button>
        <button type="button" onClick={() => onGo("purchases")} className={btnSecondary}><Truck /> {t("shop.home.reorder")}</button>
        <button type="button" onClick={() => onGo("cash")} className={btnSecondary}><Wallet /> {t("shop.tab.cash")}</button>
        {x.drawers.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{t("shop.home.drawersOpen", { names: x.drawers.map((d) => d.userName).join(", ") })}</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi tone="brand" icon={Receipt} value={money(x.today.salesTotal, shop.currency)} label={t("shop.home.salesToday", { count: x.today.sales })} />
        <Kpi tone="vio" icon={Truck} value={money(x.today.garageOrdersTotal, shop.currency)} label={t("shop.home.tradeToday")} />
        <Kpi tone="info" icon={Wallet} value={money(x.accounts.receivable, shop.currency)} label={t("shop.home.receivable")} delta={x.accounts.overdue > 0 ? t("shop.home.overdueShort", { amount: money(x.accounts.overdue, shop.currency) }) : undefined} />
        <Kpi tone="ok" icon={Boxes} value={money(x.stock.value, shop.currency)} label={t("shop.home.stockValue", { lines: x.stock.lines })} />
        <Kpi tone="bad" icon={Truck} value={money(x.suppliers.payable, shop.currency)} label={t("shop.home.payable")} delta={x.suppliers.overdue > 0 ? t("shop.home.overdueShort", { amount: money(x.suppliers.overdue, shop.currency) }) : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title={t("shop.home.todo")} />
          {todo.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("shop.home.allClear")}</p>
          ) : (
            <ul className="-mx-2 space-y-1">
              {todo.map((i) => (
                <li key={i.label}>
                  <button type="button" onClick={() => onGo(i.tab)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-canvas">
                    <span className="grid size-9 place-items-center rounded-xl bg-warn-soft text-warn"><i.icon className="size-[18px]" /></span>
                    <span className="flex-1 text-sm font-medium">{i.label}</span>
                    {i.tab !== "accounts" && <span className="font-display font-bold tabular-nums">{i.n}</span>}
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t("shop.home.recentOrders")} action={<button type="button" onClick={() => onGo("orders")} className={`${btnSecondary} ${btnSm}`}>{t("shop.home.all")}</button>} />
          {x.recentOrders.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("shop.home.noOrders")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {x.recentOrders.map((o) => (
                <li key={o.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{o.garageName}</span> · {t("parts.order.number", { n: o.number })}</span>
                  <OrderStatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t("shop.home.recentSales")} action={<button type="button" onClick={() => onGo("sale")} className={`${btnSecondary} ${btnSm}`}>{t("shop.home.all")}</button>} />
          {x.recentSales.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t("shop.home.noSales")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {x.recentSales.map((s) => (
                <li key={s.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 truncate">#{s.number}{s.customerName && ` · ${s.customerName}`}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(s.createdAt, { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="w-28 text-right font-medium tabular-nums">{money(s.total, shop.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
