/**
 * Cash drawers. Each person opens their own drawer with a float and closes it
 * with a count. While it's open, every payment they take (any method), every
 * refund they give and every payout they make is booked to it, so at close:
 *
 *   expected cash = float + cash sales − cash refunds + cash account payments
 *                   + cash garage handovers − cash paid to suppliers
 *                   + pay-ins − pay-outs
 *
 * and the difference to the count is the over or short. Card and transfer
 * totals for the same drawer are listed for checking against the terminal.
 *
 * A shop can insist on it: with requireCashSession, cash can't be taken by
 * someone without an open drawer.
 */
import { CashSession, PaymentMethod, Prisma, Shop } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { cashMovementInput, closeSessionInput, openSessionInput, sessionsQuery } from '../validation';
import { D, addDays, dayStart, money, takeNumber } from './shared';
import { Actor, audit, can } from './staff';

export const openSessionOf = (db: Db, shopId: string, userId: string) => db.cashSession.findFirst({ where: { shopId, userId, status: 'OPEN' } });

/**
 * The drawer a payment taken by `actor` goes to: their open one, if any.
 * Refuses cash with no open drawer when the shop requires one.
 */
export async function drawerFor(db: Db, shop: Shop, actor: Actor, takesCash: boolean): Promise<string | null> {
  const s = await openSessionOf(db, shop.id, actor.userId);
  if (!s && takesCash && shop.requireCashSession) throw new DomainError(409, 'Open your cash drawer before taking cash', 'DRAWER_CLOSED');
  return s?.id ?? null;
}

export async function getSession(db: Db, shopId: string, id: string) {
  const s = await db.cashSession.findFirst({ where: { id, shopId }, include: { movements: { orderBy: { createdAt: 'asc' } } } });
  if (!s) throw notFound('Cash drawer');
  return s;
}

function assertMine(s: CashSession, actor: Actor) {
  if (s.userId !== actor.userId && !can(actor, 'cash')) throw new DomainError(403, "That's someone else's drawer", 'FORBIDDEN');
}

export async function openSession(db: Prisma.TransactionClient, shop: Shop, actor: Actor, data: z.infer<typeof openSessionInput>) {
  if (await openSessionOf(db, shop.id, actor.userId)) throw conflict('Your drawer is already open');
  const s = await db.cashSession.create({
    data: { shopId: shop.id, number: await takeNumber(db, shop.id, 'session'), userId: actor.userId, userName: actor.name, openingFloat: money(D(data.openingFloat)), note: data.note ?? null },
  });
  await audit(db, shop.id, actor, 'cash.open', `Opened drawer #${s.number} with a float of ${money(D(data.openingFloat)).toFixed(2)}`, { entity: 'cash', entityId: s.id, amount: data.openingFloat });
  return getSession(db, shop.id, s.id);
}

export async function addMovement(db: Db, shop: Shop, actor: Actor, id: string, data: z.infer<typeof cashMovementInput>) {
  const s = await getSession(db, shop.id, id);
  assertMine(s, actor);
  if (s.status !== 'OPEN') throw conflict('That drawer is closed');
  await db.cashMovement.create({ data: { sessionId: s.id, kind: data.kind, amount: money(D(data.amount)), reason: data.reason, byName: actor.name } });
  await audit(db, shop.id, actor, data.kind === 'PAY_IN' ? 'cash.in' : 'cash.out', `${data.kind === 'PAY_IN' ? 'Paid in' : 'Paid out'} ${money(D(data.amount)).toFixed(2)}, drawer #${s.number}: ${data.reason}`, { entity: 'cash', entityId: s.id, amount: data.amount });
  return getSession(db, shop.id, id);
}

const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), D(0));

/** Everything booked to a drawer, and the cash that should be in it. */
export async function summary(db: Db, s: CashSession & { movements: { kind: 'PAY_IN' | 'PAY_OUT'; amount: Prisma.Decimal }[] }) {
  const [payments, returns, entries, orders, supplier, creditOuts] = await Promise.all([
    db.salePayment.findMany({ where: { cashSessionId: s.id }, include: { sale: { select: { id: true, discount: true, voidedAt: true } } } }),
    db.saleReturn.findMany({ where: { cashSessionId: s.id } }),
    db.accountEntry.findMany({ where: { cashSessionId: s.id, kind: 'PAYMENT' } }),
    db.garageOrder.findMany({ where: { cashSessionId: s.id }, include: { items: true } }),
    db.supplierEntry.findMany({ where: { cashSessionId: s.id, kind: 'PAYMENT' } }),
    db.storeCreditEntry.findMany({ where: { cashSessionId: s.id, kind: 'CASH_OUT' } }),
  ]);
  const cash = (m: PaymentMethod | null) => m === 'CASH';
  const orderTotal = (o: (typeof orders)[number]) => sum(o.items.filter((i) => i.available).map((i) => (i.unitPrice ?? D(0)).mul(i.quantity)));

  const cashSales = sum(payments.filter((p) => cash(p.method)).map((p) => p.amount));
  // Refunds in cash, including store credit paid out in cash (an exchange's leftover).
  const cashRefunds = sum(returns.filter((r) => cash(r.refundMethod)).map((r) => r.total)).plus(sum(creditOuts.filter((e) => cash(e.method)).map((e) => e.amount.negated())));
  const accountPayments = sum(entries.filter((e) => cash(e.method)).map((e) => e.amount.negated()));
  const handovers = sum(orders.filter((o) => cash(o.paymentMethod)).map(orderTotal));
  const supplierPayments = sum(supplier.filter((e) => cash(e.method)).map((e) => e.amount.negated()));
  const payIns = sum(s.movements.filter((m) => m.kind === 'PAY_IN').map((m) => m.amount));
  const payOuts = sum(s.movements.filter((m) => m.kind === 'PAY_OUT').map((m) => m.amount));
  const expected = money(s.openingFloat.plus(cashSales).minus(cashRefunds).plus(accountPayments).plus(handovers).minus(supplierPayments).plus(payIns).minus(payOuts));

  // Every method, for checking card and transfer totals against the bank.
  const byMethod = new Map<string, Prisma.Decimal>();
  const add = (m: PaymentMethod | null, amt: Prisma.Decimal) => m && byMethod.set(m, (byMethod.get(m) ?? D(0)).plus(amt));
  for (const p of payments) add(p.method, p.amount);
  for (const e of entries) add(e.method, e.amount.negated());
  for (const o of orders) add(o.paymentMethod, orderTotal(o));
  for (const r of returns) add(r.refundMethod, r.total.negated());
  for (const e of creditOuts) add(e.method, e.amount);

  const sales = new Map(payments.map((p) => [p.sale.id, p.sale]));
  return {
    expected,
    lines: { openingFloat: s.openingFloat, cashSales, cashRefunds, accountPayments, handovers, supplierPayments, payIns, payOuts },
    byMethod: [...byMethod.entries()].map(([method, total]) => ({ method: method as PaymentMethod, total: money(total) })),
    counts: {
      sales: sales.size,
      voided: [...sales.values()].filter((x) => x.voidedAt).length,
      returns: returns.length,
      discounts: money(sum([...sales.values()].map((x) => x.discount))),
    },
  };
}

export async function closeSession(db: Prisma.TransactionClient, shop: Shop, actor: Actor, id: string, data: z.infer<typeof closeSessionInput>) {
  const s = await getSession(db, shop.id, id);
  assertMine(s, actor);
  if (s.status !== 'OPEN') throw conflict('That drawer is already closed');
  const { expected } = await summary(db, s);
  const counted = money(D(data.countedCash));
  await db.cashSession.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date(), closedByName: actor.name, expectedCash: expected, countedCash: counted, note: [s.note, data.note].filter(Boolean).join('\n') || null } });
  const diff = counted.minus(expected);
  const how = diff.isZero() ? 'balanced' : diff.gt(0) ? `${diff.toFixed(2)} over` : `${diff.negated().toFixed(2)} short`;
  await audit(db, shop.id, actor, 'cash.close', `Closed drawer #${s.number} (${s.userName}): counted ${counted.toFixed(2)}, expected ${expected.toFixed(2)}, ${how}`, { entity: 'cash', entityId: s.id, amount: diff });
  return getSession(db, shop.id, id);
}

export function listSessions(db: Db, shopId: string, actor: Actor, q: z.infer<typeof sessionsQuery>) {
  return db.cashSession.findMany({
    where: {
      shopId,
      ...(can(actor, 'cash') ? {} : { userId: actor.userId }),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { openedAt: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lt: dayStart(addDays(q.to, 1)) } : {}) } } : {}),
    },
    include: { movements: true },
    orderBy: { openedAt: 'desc' },
    take: 100,
  });
}

export { assertMine as assertDrawerAccess };
