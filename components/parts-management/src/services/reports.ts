/**
 * How the shop is doing. Revenue counts counter sales (less returns, voided
 * sales left out) and garage orders handed over; profit uses the cost
 * recorded on each stock movement at the time, so later price changes don't
 * rewrite the past.
 *
 *   dashboard   today, open orders, stock, what's owed both ways, open drawers
 *   report      a date range: revenue, profit, by day, by payment method, top
 *               parts and garages, VAT by rate, and each cashier
 *   stock       stock value by category, and dead stock (nothing sold lately)
 *   ageing      what accounts owe the shop, and what the shop owes suppliers,
 *               by how late it is
 */
import { Prisma } from '@prisma/client';

import { Db } from '../utils/prisma';
import { payables } from './payables';
import { allocate } from './sales';
import { D, addDays, dayStart, localDay, presentAgeing } from './shared';
import { OPEN_ORDER, ageingOf, balances, overdueOf } from './trade';

const n = (d: Prisma.Decimal | null | undefined) => Math.round((d ?? D(0)).toNumber() * 100) / 100;
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function dashboard(db: Db, shopId: string, now = new Date()) {
  const today = localDay(now);
  const start = dayStart(today);
  const [salesToday, ordersByStatus, low, stock, accounts, recentSales, recentOrders, owed, drawers] = await Promise.all([
    db.sale.aggregate({ where: { shopId, voidedAt: null, createdAt: { gte: start } }, _sum: { total: true }, _count: { _all: true } }),
    db.garageOrder.groupBy({ by: ['status'], where: { shopId, status: { in: OPEN_ORDER } }, _count: { _all: true } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "parts" WHERE "shop_id" = ${shopId} AND "active" AND NOT "is_kit" AND "stock_qty" <= "reorder_level"`,
    db.$queryRaw<{ value: Prisma.Decimal | null; units: Prisma.Decimal | null; lines: bigint }[]>`
      SELECT SUM("stock_qty" * "cost_price") AS value, SUM("stock_qty") AS units, COUNT(*) AS lines
      FROM "parts" WHERE "shop_id" = ${shopId} AND "active" AND "stock_qty" > 0`,
    db.tradeAccount.findMany({ where: { shopId } }),
    db.sale.findMany({ where: { shopId }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, number: true, total: true, customerName: true, createdAt: true, voidedAt: true } }),
    db.garageOrder.findMany({ where: { shopId }, orderBy: { updatedAt: 'desc' }, take: 5, include: { account: { select: { garageName: true } } } }),
    payables(db, shopId),
    db.cashSession.findMany({ where: { shopId, status: 'OPEN' }, select: { userName: true, openedAt: true } }),
  ]);
  const handedToday = await db.garageOrder.findMany({ where: { shopId, status: 'COMPLETED', completedAt: { gte: start } }, include: { items: true } });
  const ordersToday = handedToday.reduce((s, o) => s + o.items.filter((i) => i.available).reduce((t, i) => t + (i.unitPrice?.toNumber() ?? 0) * i.quantity.toNumber(), 0), 0);
  const bal = await balances(db, accounts.map((a) => a.id));
  let receivable = D(0);
  let overdue = D(0);
  for (const a of accounts) {
    receivable = receivable.plus(Prisma.Decimal.max(bal.get(a.id) ?? D(0), 0));
    overdue = overdue.plus((await overdueOf(db, a, now)).overdue);
  }
  const status = Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all]));
  return {
    today: { sales: salesToday._count._all, salesTotal: n(salesToday._sum.total), garageOrdersTotal: r2(ordersToday) },
    orders: { toPrice: status.REQUESTED ?? 0, awaitingGarage: status.QUOTED ?? 0, toPrepare: status.CONFIRMED ?? 0, ready: status.READY ?? 0 },
    stock: { value: n(stock[0]?.value), units: n(stock[0]?.units), lines: Number(stock[0]?.lines ?? 0), lowStock: Number(low[0]?.n ?? 0) },
    accounts: { receivable: n(receivable), overdue: n(overdue), garages: accounts.filter((a) => a.linked && a.kind === 'GARAGE').length },
    suppliers: {
      payable: n(owed.reduce((s, x) => s.plus(Prisma.Decimal.max(x.balance, 0)), D(0))),
      overdue: n(owed.reduce((s, x) => s.plus(x.ageing.overdue), D(0))),
    },
    drawers: drawers.map((d) => ({ userName: d.userName, openedAt: d.openedAt })),
    recentSales: recentSales.map((s) => ({ id: s.id, number: s.number, total: n(s.total), customerName: s.customerName, voided: Boolean(s.voidedAt), createdAt: s.createdAt })),
    recentOrders: recentOrders.map((o) => ({ id: o.id, number: o.number, status: o.status, garageName: o.account.garageName, updatedAt: o.updatedAt })),
  };
}

export async function report(db: Db, shopId: string, from: string, to: string) {
  const start = dayStart(from);
  const end = dayStart(addDays(to, 1));
  const [sales, voided, returns, orders, moves] = await Promise.all([
    db.sale.findMany({ where: { shopId, voidedAt: null, createdAt: { gte: start, lt: end } }, include: { items: true, payments: true } }),
    db.sale.findMany({ where: { shopId, voidedAt: { not: null }, createdAt: { gte: start, lt: end } }, select: { cashierName: true, total: true } }),
    db.saleReturn.findMany({ where: { shopId, createdAt: { gte: start, lt: end } } }),
    db.garageOrder.findMany({ where: { shopId, status: 'COMPLETED', completedAt: { gte: start, lt: end } }, include: { items: true, account: { select: { garageName: true, garageId: true } } } }),
    // Cost of what went out (sales and garage orders), net of what came back or was voided.
    db.stockMovement.findMany({ where: { shopId, createdAt: { gte: start, lt: end }, reason: { in: ['SALE', 'GARAGE_ORDER', 'RETURN', 'VOID'] } }, include: { part: { select: { name: true, sku: true } } } }),
  ]);

  const counter = sales.reduce((s, x) => s + x.total.toNumber(), 0);
  const refunds = returns.reduce((s, r) => s + r.total.toNumber(), 0);
  const orderValue = (o: (typeof orders)[number]) => o.items.filter((i) => i.available).reduce((t, i) => t + (i.unitPrice?.toNumber() ?? 0) * i.quantity.toNumber(), 0);
  const trade = orders.reduce((s, o) => s + orderValue(o), 0);
  const cost = moves.reduce((s, m) => s - m.quantityChange.toNumber() * (m.unitCost?.toNumber() ?? 0), 0);

  // VAT by rate: each line's value after both discounts, less what came back.
  const vat = new Map<string, { taxable: number; tax: number }>();
  for (const s of sales) {
    const net = s.items.map((i) => i.unitPrice.mul(i.quantity).minus(i.discount));
    const saleDiscount = Prisma.Decimal.max(s.discount.minus(s.items.reduce((t, i) => t.plus(i.discount), D(0))), 0);
    const share = allocate(saleDiscount, s.items.map((i, k) => (i.kind === 'CORE' ? D(0) : net[k])));
    s.items.forEach((i, k) => {
      const kept = i.quantity.minus(i.returnedQty).div(i.quantity).toNumber();
      const key = i.taxRate.toString();
      const v = vat.get(key) ?? { taxable: 0, tax: 0 };
      vat.set(key, { taxable: v.taxable + net[k].minus(share[k]).toNumber() * kept, tax: v.tax + i.tax.toNumber() * kept });
    });
  }
  const tax = [...vat.values()].reduce((s, v) => s + v.tax, 0);
  const revenue = counter - refunds + trade;
  const netRevenue = revenue - tax;

  const days = new Map<string, { counter: number; trade: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { counter: 0, trade: 0 });
  for (const s of sales) days.get(localDay(s.createdAt))!.counter += s.total.toNumber();
  for (const r of returns) {
    const day = days.get(localDay(r.createdAt));
    if (day) day.counter -= r.total.toNumber();
  }
  for (const o of orders) days.get(localDay(o.completedAt!))!.trade += orderValue(o);

  const payments = new Map<string, { count: number; total: number }>();
  for (const p of sales.flatMap((s) => s.payments)) {
    const x = payments.get(p.method) ?? { count: 0, total: 0 };
    payments.set(p.method, { count: x.count + 1, total: x.total + p.amount.toNumber() });
  }

  const byPart = new Map<string, { name: string; sku: string; quantity: number; cost: number }>();
  for (const m of moves) {
    const p = byPart.get(m.partId) ?? { name: m.part.name, sku: m.part.sku, quantity: 0, cost: 0 };
    p.quantity -= m.quantityChange.toNumber();
    p.cost -= m.quantityChange.toNumber() * (m.unitCost?.toNumber() ?? 0);
    byPart.set(m.partId, p);
  }
  const revenueByPart = new Map<string, number>();
  for (const s of sales)
    for (const i of s.items)
      if (i.partId) revenueByPart.set(i.partId, (revenueByPart.get(i.partId) ?? 0) + i.unitPrice.mul(i.quantity).minus(i.discount).mul(i.quantity.minus(i.returnedQty)).div(i.quantity).toNumber());
  for (const o of orders) for (const i of o.items) if (i.partId && i.available) revenueByPart.set(i.partId, (revenueByPart.get(i.partId) ?? 0) + (i.unitPrice?.toNumber() ?? 0) * i.quantity.toNumber());

  const byGarage = new Map<string, { name: string; orders: number; total: number }>();
  for (const o of orders) {
    const key = o.account.garageId ?? o.accountId;
    const g = byGarage.get(key) ?? { name: o.account.garageName, orders: 0, total: 0 };
    byGarage.set(key, { ...g, orders: g.orders + 1, total: g.total + orderValue(o) });
  }

  // Each cashier: sales and their value, discounts given, voids and refunds.
  const cashiers = new Map<string, { sales: number; total: number; discounts: number; voids: number; refunds: number }>();
  const cashier = (name: string | null) => {
    const k = name ?? '—';
    const c = cashiers.get(k) ?? { sales: 0, total: 0, discounts: 0, voids: 0, refunds: 0 };
    cashiers.set(k, c);
    return c;
  };
  for (const s of sales) {
    const c = cashier(s.cashierName);
    c.sales++;
    c.total += s.total.toNumber();
    c.discounts += s.discount.toNumber();
  }
  for (const v of voided) cashier(v.cashierName).voids++;
  for (const r of returns) cashier(r.byName).refunds += r.total.toNumber();

  return {
    from,
    to,
    totals: {
      revenue: r2(revenue),
      counter: r2(counter - refunds),
      trade: r2(trade),
      refunds: r2(refunds),
      tax: r2(tax),
      cost: r2(cost),
      grossProfit: r2(netRevenue - cost),
      margin: netRevenue > 0 ? Math.round(((netRevenue - cost) / netRevenue) * 1000) / 10 : null,
      sales: sales.length,
      voided: voided.length,
      garageOrders: orders.length,
    },
    days: [...days.entries()].map(([date, v]) => ({ date, counter: r2(v.counter), trade: r2(v.trade), total: r2(v.counter + v.trade) })),
    paymentMethods: [...payments.entries()].map(([method, v]) => ({ method, count: v.count, total: r2(v.total) })),
    topParts: [...byPart.entries()]
      .map(([id, p]) => ({ partId: id, name: p.name, sku: p.sku, quantity: r2(p.quantity), revenue: r2(revenueByPart.get(id) ?? 0), profit: r2((revenueByPart.get(id) ?? 0) - p.cost) }))
      .filter((p) => p.quantity > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10),
    topGarages: [...byGarage.values()].map((g) => ({ ...g, total: r2(g.total) })).sort((a, b) => b.total - a.total).slice(0, 10),
    vat: [...vat.entries()].map(([rate, v]) => ({ rate: Number(rate), taxable: r2(v.taxable), tax: r2(v.tax) })).sort((a, b) => b.rate - a.rate),
    cashiers: [...cashiers.entries()].map(([name, c]) => ({ name, sales: c.sales, total: r2(c.total), discounts: r2(c.discounts), voids: c.voids, refunds: r2(c.refunds) })).sort((a, b) => b.total - a.total),
  };
}

/** Stock value by category, and dead stock: on the shelf, nothing sold in `deadDays`. */
export async function stockReport(db: Db, shopId: string, deadDays: number, now = new Date()) {
  const since = new Date(now.getTime() - deadDays * 86_400_000);
  const [categories, dead] = await Promise.all([
    db.$queryRaw<{ category: string | null; lines: bigint; units: Prisma.Decimal; cost: Prisma.Decimal; retail: Prisma.Decimal }[]>`
      SELECT "category", COUNT(*) AS lines, SUM("stock_qty") AS units, SUM("stock_qty" * "cost_price") AS cost, SUM("stock_qty" * "retail_price") AS retail
      FROM "parts" WHERE "shop_id" = ${shopId} AND "active" AND "stock_qty" > 0
      GROUP BY "category" ORDER BY cost DESC`,
    db.$queryRaw<{ id: string; sku: string; name: string; location: string | null; stock_qty: Prisma.Decimal; value: Prisma.Decimal; last_sold: Date | null; created_at: Date }[]>`
      SELECT p."id", p."sku", p."name", (SELECT l."name" FROM "locations" l WHERE l."id" = p."default_location_id") AS location, p."stock_qty", p."stock_qty" * p."cost_price" AS value, p."created_at",
             (SELECT MAX(m."created_at") FROM "stock_movements" m WHERE m."part_id" = p."id" AND m."reason" IN ('SALE', 'GARAGE_ORDER')) AS last_sold
      FROM "parts" p
      WHERE p."shop_id" = ${shopId} AND p."active" AND p."stock_qty" > 0 AND p."created_at" < ${since}
        AND NOT EXISTS (SELECT 1 FROM "stock_movements" m WHERE m."part_id" = p."id" AND m."reason" IN ('SALE', 'GARAGE_ORDER') AND m."created_at" >= ${since})
      ORDER BY value DESC LIMIT 200`,
  ]);
  const value = categories.reduce((s, c) => s + c.cost.toNumber(), 0);
  return {
    deadDays,
    totals: {
      cost: r2(value),
      retail: r2(categories.reduce((s, c) => s + c.retail.toNumber(), 0)),
      lines: categories.reduce((s, c) => s + Number(c.lines), 0),
      deadValue: r2(dead.reduce((s, d) => s + d.value.toNumber(), 0)),
      deadLines: dead.length,
    },
    categories: categories.map((c) => ({ category: c.category, lines: Number(c.lines), units: n(c.units), cost: n(c.cost), retail: n(c.retail), share: value > 0 ? Math.round((c.cost.toNumber() / value) * 1000) / 10 : 0 })),
    dead: dead.map((d) => ({ partId: d.id, sku: d.sku, name: d.name, location: d.location, stockQty: n(d.stock_qty), value: n(d.value), lastSoldAt: d.last_sold })),
  };
}

/** What accounts owe the shop and what the shop owes suppliers, by how late it is. */
export async function ageing(db: Db, shopId: string, now = new Date()) {
  const accounts = await db.tradeAccount.findMany({ where: { shopId }, orderBy: { garageName: 'asc' } });
  const bal = await balances(db, accounts.map((a) => a.id));
  const receivables = (
    await Promise.all(accounts.map(async (a) => ({ id: a.id, kind: a.kind, name: a.garageName, phone: a.garagePhone, balance: n(bal.get(a.id)), ...presentAgeing(await ageingOf(db, a, now)) })))
  ).filter((r) => r.balance !== 0);
  const owed = (await payables(db, shopId)).filter((p) => !p.balance.isZero());
  return {
    receivables,
    payables: owed.map((p) => ({ id: p.supplier.id, name: p.supplier.name, phone: p.supplier.phone, balance: n(p.balance), ...presentAgeing(p.ageing) })),
  };
}
