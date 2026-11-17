/**
 * Accounts: who buys from the shop on credit.
 *
 * GARAGE accounts open when a garage adds the shop from the directory, with no
 * credit (everything paid on handover). CUSTOMER accounts are the shop's own:
 * a fleet, a local mechanic, a regular. Either way the shop sets a credit limit
 * and payment days. Orders handed over and counter sales on account go on the
 * ledger as a CHARGE; the shop records PAYMENTs and ADJUSTMENTs (credit notes,
 * returns, voids). The balance is the ledger's sum: what they owe.
 *
 * Overdue: charges older than the payment days that the payments since haven't
 * covered (payments settle the oldest charges first).
 */
import { Prisma, TradeAccount } from '@prisma/client';
import { z } from 'zod';

import { GarageContext } from '../middleware/auth';
import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { DomainError } from '../utils/http';
import { accountPatch, adjustmentInput, customerAccountInput, paymentInput } from '../validation';
import { D, age, money } from './shared';
import { Actor, audit } from './staff';

export const OPEN_ORDER: ('REQUESTED' | 'QUOTED' | 'CONFIRMED' | 'READY')[] = ['REQUESTED', 'QUOTED', 'CONFIRMED', 'READY'];

/** Balances for many accounts in one query. */
export async function balances(db: Db, accountIds: string[]) {
  if (!accountIds.length) return new Map<string, Prisma.Decimal>();
  const rows = await db.accountEntry.groupBy({ by: ['accountId'], where: { accountId: { in: accountIds } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.accountId, r._sum.amount ?? D(0)]));
}

export async function balanceOf(db: Db, accountId: string) {
  return (await balances(db, [accountId])).get(accountId) ?? D(0);
}

/** What the garage still owes past its payment days. */
export async function overdueOf(db: Db, account: TradeAccount, now = new Date()) {
  const entries = await db.accountEntry.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'asc' } });
  let credit = entries.filter((e) => e.amount.lt(0)).reduce((s, e) => s.plus(e.amount.negated()), D(0));
  const cutoff = now.getTime() - account.paymentDays * 86_400_000;
  let overdue = D(0);
  let oldestOverdue: Date | null = null;
  for (const e of entries.filter((x) => x.amount.gt(0))) {
    const covered = Prisma.Decimal.min(credit, e.amount);
    credit = credit.minus(covered);
    const left = e.amount.minus(covered);
    if (left.gt(0) && e.createdAt.getTime() < cutoff) {
      overdue = overdue.plus(left);
      oldestOverdue ??= e.createdAt;
    }
  }
  return { overdue: money(overdue), oldestOverdue };
}

/** Ageing of what the account owes: each charge is due its payment days after it was made. */
export async function ageingOf(db: Db, account: TradeAccount, now = new Date()) {
  const entries = await db.accountEntry.findMany({ where: { accountId: account.id } });
  const credits = entries.filter((e) => e.amount.lt(0)).reduce((s, e) => s.plus(e.amount.negated()), D(0));
  const charges = entries.filter((e) => e.amount.gt(0)).map((e) => ({ amount: e.amount, due: new Date(e.createdAt.getTime() + account.paymentDays * 86_400_000) }));
  return age(charges, credits, now);
}

/** Opens (or reopens) the account when a garage adds the shop; refreshes the garage's details. */
export async function link(db: Db, shopId: string, g: GarageContext) {
  const shop = await db.shop.findFirst({ where: { id: shopId, active: true }, select: { id: true } });
  if (!shop) throw notFound('Parts shop');
  return db.tradeAccount.upsert({
    where: { shopId_garageId: { shopId, garageId: g.garageId } },
    create: { shopId, garageId: g.garageId, garageName: g.name, garagePhone: g.phone, garageAddress: g.address },
    update: { linked: true, garageName: g.name, garagePhone: g.phone, garageAddress: g.address },
  });
}

export async function unlink(db: Db, shopId: string, garageId: string) {
  const account = await db.tradeAccount.findUnique({ where: { shopId_garageId: { shopId, garageId } } });
  if (!account) return;
  const open = await db.garageOrder.count({ where: { accountId: account.id, status: { in: OPEN_ORDER } } });
  if (open > 0) throw conflict('Finish or cancel the open orders with this shop first');
  // The account and its history stay; the shop just drops off the garage's list.
  await db.tradeAccount.update({ where: { id: account.id }, data: { linked: false } });
}

export async function listAccounts(db: Db, shopId: string) {
  const accounts = await db.tradeAccount.findMany({ where: { shopId }, orderBy: [{ kind: 'asc' }, { garageName: 'asc' }] });
  const bal = await balances(db, accounts.map((a) => a.id));
  const open = await db.garageOrder.groupBy({ by: ['accountId'], where: { shopId, status: { in: OPEN_ORDER } }, _count: { _all: true } });
  const last = await db.garageOrder.groupBy({ by: ['accountId'], where: { shopId }, _max: { createdAt: true }, _count: { _all: true } });
  const openBy = new Map(open.map((o) => [o.accountId, o._count._all]));
  const lastBy = new Map(last.map((o) => [o.accountId, o]));
  return Promise.all(
    accounts.map(async (a) => ({
      account: a,
      balance: bal.get(a.id) ?? D(0),
      ...(await overdueOf(db, a)),
      openOrders: openBy.get(a.id) ?? 0,
      orders: lastBy.get(a.id)?._count._all ?? 0,
      lastOrderAt: lastBy.get(a.id)?._max.createdAt ?? null,
    })),
  );
}

export async function getAccount(db: Db, shopId: string, id: string) {
  const account = await db.tradeAccount.findFirst({ where: { id, shopId } });
  if (!account) throw notFound('Trade account');
  return account;
}

export async function statement(db: Db, account: TradeAccount) {
  const entries = await db.accountEntry.findMany({ where: { accountId: account.id }, orderBy: { createdAt: 'asc' }, take: 1000 });
  const orderIds = entries.map((e) => e.orderId).filter((x): x is string => Boolean(x));
  const saleIds = entries.map((e) => e.saleId).filter((x): x is string => Boolean(x));
  const orders = orderIds.length ? await db.garageOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true, jobNumber: true, vehiclePlate: true } }) : [];
  const sales = saleIds.length ? await db.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, number: true } }) : [];
  const byOrder = new Map(orders.map((o) => [o.id, o]));
  const bySale = new Map(sales.map((o) => [o.id, o]));
  let running = D(0);
  const lines = entries.map((e) => {
    running = running.plus(e.amount);
    return { entry: e, order: e.orderId ? byOrder.get(e.orderId) ?? null : null, sale: e.saleId ? bySale.get(e.saleId) ?? null : null, balance: running };
  });
  return { lines: lines.reverse(), balance: running, ...(await overdueOf(db, account)) };
}

/** A credit account for someone who isn't a Kaduna garage. */
export async function createCustomer(db: Db, shopId: string, actor: Actor, data: z.infer<typeof customerAccountInput>) {
  const a = await db.tradeAccount.create({
    data: { shopId, kind: 'CUSTOMER', garageId: null, garageName: data.name, garagePhone: data.phone ?? null, garageAddress: data.address ?? null, creditLimit: D(data.creditLimit), paymentDays: data.paymentDays },
  });
  await audit(db, shopId, actor, 'account.open', `Opened a customer account for ${a.garageName} (credit ${D(data.creditLimit).toFixed(2)}, ${data.paymentDays} days)`, { entity: 'account', entityId: a.id });
  return a;
}

export async function updateTerms(db: Db, shopId: string, actor: Actor, id: string, data: z.infer<typeof accountPatch>) {
  const before = await getAccount(db, shopId, id);
  const { name, phone, address, ...terms } = data;
  if (before.kind === 'GARAGE' && (name !== undefined || phone !== undefined || address !== undefined)) throw new DomainError(422, "A garage's name and contact details come from Kaduna");
  const a = await db.tradeAccount.update({
    where: { id },
    data: {
      ...terms,
      ...(terms.creditLimit !== undefined ? { creditLimit: D(terms.creditLimit) } : {}),
      ...(name !== undefined ? { garageName: name } : {}),
      ...(phone !== undefined ? { garagePhone: phone } : {}),
      ...(address !== undefined ? { garageAddress: address } : {}),
    },
  });
  const changes = [
    !a.creditLimit.equals(before.creditLimit) ? `credit ${before.creditLimit.toFixed(2)} to ${a.creditLimit.toFixed(2)}` : null,
    a.paymentDays !== before.paymentDays ? `${before.paymentDays} to ${a.paymentDays} days` : null,
    a.onHold !== before.onHold ? (a.onHold ? 'put on hold' : 'taken off hold') : null,
  ].filter(Boolean);
  if (changes.length) await audit(db, shopId, actor, 'account.terms', `${a.garageName}: ${changes.join(', ')}`, { entity: 'account', entityId: a.id });
  return a;
}

export async function recordPayment(db: Db, shopId: string, actor: Actor, id: string, data: z.infer<typeof paymentInput>, drawer: string | null) {
  const account = await getAccount(db, shopId, id);
  const amount = money(D(data.amount));
  await db.accountEntry.create({ data: { accountId: account.id, kind: 'PAYMENT', amount: amount.negated(), method: data.method, reference: data.reference ?? null, note: data.note ?? null, byName: actor.name, cashSessionId: drawer } });
  await audit(db, shopId, actor, 'account.payment', `${account.garageName} paid ${amount.toFixed(2)} by ${data.method.toLowerCase().replace('_', ' ')}${data.reference ? ` (${data.reference})` : ''}`, { entity: 'account', entityId: account.id, amount });
  return account;
}

export async function recordAdjustment(db: Db, shopId: string, actor: Actor, id: string, data: z.infer<typeof adjustmentInput>) {
  const account = await getAccount(db, shopId, id);
  await db.accountEntry.create({ data: { accountId: account.id, kind: 'ADJUSTMENT', amount: money(D(data.amount)), note: data.note, byName: actor.name } });
  await audit(db, shopId, actor, 'account.adjust', `${account.garageName}: ${data.amount > 0 ? 'charged' : 'credited'} ${Math.abs(data.amount).toFixed(2)}: ${data.note}`, { entity: 'account', entityId: account.id, amount: data.amount });
  return account;
}

/** Room left on the account for a new order, or null when it can't take orders on account. */
export async function creditAvailable(db: Db, account: TradeAccount) {
  if (account.onHold || account.creditLimit.lte(0)) return null;
  const { overdue } = await overdueOf(db, account);
  if (overdue.gt(0)) return null;
  // Orders confirmed on account but not yet handed over also use up credit.
  const pending = await db.garageOrder.findMany({ where: { accountId: account.id, paymentTerms: 'ACCOUNT', status: { in: ['CONFIRMED', 'READY'] } }, include: { items: true } });
  const committed = pending.reduce((s, o) => s.plus(o.items.filter((i) => i.available).reduce((t, i) => t.plus((i.unitPrice ?? D(0)).mul(i.quantity)), D(0))), D(0));
  return account.creditLimit.minus(await balanceOf(db, account.id)).minus(committed);
}
