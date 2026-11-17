/**
 * What the shop owes its suppliers.
 *
 * Each supplier has a ledger: BILLs (their invoices, + owed, with a due date),
 * PAYMENTs (−), RETURNs (goods sent back, − as a credit) and ADJUSTMENTs. The
 * balance is the sum. Payments settle the oldest bills first, so ageing shows
 * which bills are late and by how long.
 *
 * Returns to a supplier take the stock off the shelf at what it cost and
 * credit the supplier's ledger the same.
 */
import { Prisma, Shop, Supplier } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { billInput, supplierAdjustmentInput, supplierPaymentInput, supplierReturnInput } from '../validation';
import { move } from './inventory';
import { D, addDays, age, dayStart, localDay, money, takeNumber } from './shared';
import { Actor, audit } from './staff';

async function getSupplier(db: Db, shopId: string, id: string) {
  const s = await db.supplier.findFirst({ where: { id, shopId } });
  if (!s) throw notFound('Supplier');
  return s;
}

/** Balances for many suppliers in one query: what the shop owes each. */
export async function supplierBalances(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, Prisma.Decimal>();
  const rows = await db.supplierEntry.groupBy({ by: ['supplierId'], where: { supplierId: { in: ids } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.supplierId, r._sum.amount ?? D(0)]));
}

export async function supplierAgeing(db: Db, supplier: Supplier, now = new Date()) {
  const entries = await db.supplierEntry.findMany({ where: { supplierId: supplier.id } });
  const credits = entries.filter((e) => e.amount.lt(0)).reduce((s, e) => s.plus(e.amount.negated()), D(0));
  const charges = entries
    .filter((e) => e.amount.gt(0))
    .map((e) => ({ amount: e.amount, due: e.dueDate ?? new Date((e.billDate ?? e.createdAt).getTime() + supplier.paymentDays * 86_400_000) }));
  return age(charges, credits, now);
}

/** Records a supplier's invoice. */
export async function addBill(db: Db, shopId: string, actor: Actor, supplierId: string, data: z.infer<typeof billInput>) {
  const supplier = await getSupplier(db, shopId, supplierId);
  if (data.purchaseId) {
    const po = await db.purchaseOrder.findFirst({ where: { id: data.purchaseId, shopId, supplierId }, select: { id: true } });
    if (!po) throw notFound('Purchase order from this supplier');
  }
  const dup = await db.supplierEntry.findFirst({ where: { supplierId, kind: 'BILL', reference: data.reference }, select: { id: true } });
  if (dup) throw conflict(`Bill ${data.reference} from ${supplier.name} is already recorded`);
  const billDay = data.billDate ?? localDay(new Date());
  const due = data.dueDate ?? addDays(billDay, supplier.paymentDays);
  const amount = money(D(data.amount));
  const entry = await db.supplierEntry.create({
    data: { shopId, supplierId, kind: 'BILL', amount, reference: data.reference, billDate: dayStart(billDay), dueDate: dayStart(due), purchaseId: data.purchaseId ?? null, note: data.note ?? null, byName: actor.name },
  });
  await audit(db, shopId, actor, 'supplier.bill', `Bill ${data.reference} from ${supplier.name}: ${amount.toFixed(2)}, due ${due}`, { entity: 'supplier', entityId: supplierId, amount });
  return entry;
}

export async function paySupplier(db: Db, shopId: string, actor: Actor, supplierId: string, data: z.infer<typeof supplierPaymentInput>, drawer: string | null) {
  const supplier = await getSupplier(db, shopId, supplierId);
  const amount = money(D(data.amount));
  await db.supplierEntry.create({
    data: { shopId, supplierId, kind: 'PAYMENT', amount: amount.negated(), method: data.method, reference: data.reference ?? null, note: data.note ?? null, byName: actor.name, cashSessionId: data.method === 'CASH' ? drawer : null },
  });
  await audit(db, shopId, actor, 'supplier.payment', `Paid ${supplier.name} ${amount.toFixed(2)} by ${data.method.toLowerCase().replace('_', ' ')}${data.reference ? ` (${data.reference})` : ''}`, { entity: 'supplier', entityId: supplierId, amount });
}

export async function adjustSupplier(db: Db, shopId: string, actor: Actor, supplierId: string, data: z.infer<typeof supplierAdjustmentInput>) {
  const supplier = await getSupplier(db, shopId, supplierId);
  await db.supplierEntry.create({ data: { shopId, supplierId, kind: 'ADJUSTMENT', amount: money(D(data.amount)), note: data.note, byName: actor.name } });
  await audit(db, shopId, actor, 'supplier.adjust', `${supplier.name}: ${data.amount > 0 ? 'owed' : 'credited'} ${Math.abs(data.amount).toFixed(2)}: ${data.note}`, { entity: 'supplier', entityId: supplierId, amount: data.amount });
}

export async function supplierStatement(db: Db, shopId: string, supplierId: string) {
  const supplier = await getSupplier(db, shopId, supplierId);
  const entries = await db.supplierEntry.findMany({ where: { supplierId }, orderBy: { createdAt: 'asc' }, take: 1000 });
  const poIds = entries.map((e) => e.purchaseId).filter((x): x is string => Boolean(x));
  const pos = poIds.length ? await db.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, number: true } }) : [];
  const poNumber = new Map(pos.map((p) => [p.id, p.number]));
  let running = D(0);
  const lines = entries.map((e) => {
    running = running.plus(e.amount);
    return { entry: e, purchaseNumber: e.purchaseId ? poNumber.get(e.purchaseId) ?? null : null, balance: running };
  });
  return { supplier, balance: running, ageing: await supplierAgeing(db, supplier), lines: lines.reverse() };
}

/** Every supplier the shop owes, or owed, with the ageing of what's left. */
export async function payables(db: Db, shopId: string) {
  const suppliers = await db.supplier.findMany({ where: { shopId, entries: { some: {} } }, orderBy: { name: 'asc' } });
  const bal = await supplierBalances(db, suppliers.map((s) => s.id));
  return Promise.all(suppliers.map(async (s) => ({ supplier: s, balance: bal.get(s.id) ?? D(0), ageing: await supplierAgeing(db, s) })));
}

// ─── Returns to suppliers ───────────────────────────────────────────────────

export async function returnToSupplier(db: Prisma.TransactionClient, shop: Shop, actor: Actor, data: z.infer<typeof supplierReturnInput>) {
  const supplier = await getSupplier(db, shop.id, data.supplierId);
  if (data.purchaseId) {
    const po = await db.purchaseOrder.findFirst({ where: { id: data.purchaseId, shopId: shop.id, supplierId: supplier.id }, select: { id: true } });
    if (!po) throw notFound('Purchase order from this supplier');
  }
  const parts = await db.part.findMany({ where: { shopId: shop.id, id: { in: data.items.map((i) => i.partId) } } });
  const byId = new Map(parts.map((p) => [p.id, p]));
  const number = await takeNumber(db, shop.id, 'supplierReturn');
  const lines = data.items.map((i) => {
    const p = byId.get(i.partId);
    if (!p) throw notFound('Part');
    const unitCost = D(i.unitCost ?? p.costPrice);
    return { part: p, quantity: D(i.quantity), unitCost, locationId: i.locationId ?? undefined };
  });
  const total = money(lines.reduce((s, l) => s.plus(l.unitCost.mul(l.quantity)), D(0)));
  const ret = await db.supplierReturn.create({
    data: {
      shopId: shop.id,
      number,
      supplierId: supplier.id,
      purchaseId: data.purchaseId ?? null,
      lines: lines.map((l) => ({ partId: l.part.id, sku: l.part.sku, name: l.part.name, quantity: l.quantity.toNumber(), unitCost: l.unitCost.toNumber() })),
      total,
      reason: data.reason ?? null,
      byName: actor.name,
    },
  });
  for (const l of lines) await move(db, l.part, l.quantity.negated(), 'RETURN_TO_SUPPLIER', { unitCost: l.unitCost, supplierReturnId: ret.id, purchaseId: data.purchaseId ?? undefined, note: `Sent back to ${supplier.name} (#${number})`, byName: actor.name, locationId: l.locationId });
  if (total.gt(0)) {
    await db.supplierEntry.create({ data: { shopId: shop.id, supplierId: supplier.id, kind: 'RETURN', amount: total.negated(), returnId: ret.id, purchaseId: data.purchaseId ?? null, note: `Return #${number}${data.reason ? `: ${data.reason}` : ''}`, byName: actor.name } });
  }
  await audit(db, shop.id, actor, 'supplier.return', `Sent ${lines.length} line(s) back to ${supplier.name} (#${number}), credit ${total.toFixed(2)}`, { entity: 'supplier', entityId: supplier.id, amount: total });
  return db.supplierReturn.findUniqueOrThrow({ where: { id: ret.id }, include: { supplier: { select: { id: true, name: true } } } });
}

export function listSupplierReturns(db: Db, shopId: string, supplierId?: string) {
  return db.supplierReturn.findMany({ where: { shopId, ...(supplierId ? { supplierId } : {}) }, include: { supplier: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
}
