/**
 * Buying stock: the shop's suppliers, purchase orders and receiving.
 *
 *   DRAFT → ORDERED → PARTLY_RECEIVED → RECEIVED      (CANCELLED before any is received)
 *
 * Receiving puts stock on the shelf at the price actually paid and updates
 * the part's cost to the weighted average of what was there and what came in,
 * so profit stays honest when prices move. Freight, duty and clearing for a
 * delivery are spread over its lines by value and added to their cost (landed
 * cost). The supplier's invoice for it can be recorded at the same time.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { purchaseInput, purchasePatch, purchasesQuery, receiveInput, supplierInput, supplierPatch } from '../validation';
import { move } from './inventory';
import { addBill, supplierBalances } from './payables';
import { D, money, takeNumber } from './shared';
import { Actor, audit } from './staff';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

// ─── Suppliers ──────────────────────────────────────────────────────────────

export async function listSuppliers(db: Db, shopId: string, opts: { q?: string; includeInactive: boolean }) {
  const suppliers = await db.supplier.findMany({
    where: { shopId, ...(opts.includeInactive ? {} : { active: true }), ...(opts.q ? { OR: [{ name: contains(opts.q) }, { contactName: contains(opts.q) }, { phone: contains(opts.q) }] } : {}) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { parts: true } } },
    take: 200,
  });
  const open = await db.purchaseOrder.groupBy({ by: ['supplierId'], where: { shopId, status: { in: ['ORDERED', 'PARTLY_RECEIVED'] } }, _count: { _all: true } });
  const openBy = new Map(open.map((o) => [o.supplierId, o._count._all]));
  const owed = await supplierBalances(db, suppliers.map((s) => s.id));
  return suppliers.map((s) => ({ supplier: s, parts: s._count.parts, openOrders: openBy.get(s.id) ?? 0, balance: owed.get(s.id) ?? D(0) }));
}

export function createSupplier(db: Db, shopId: string, data: z.infer<typeof supplierInput>) {
  return db.supplier.create({ data: { ...data, shopId } });
}

export async function updateSupplier(db: Db, shopId: string, id: string, data: z.infer<typeof supplierPatch>) {
  const s = await db.supplier.findFirst({ where: { id, shopId }, select: { id: true } });
  if (!s) throw notFound('Supplier');
  return db.supplier.update({ where: { id }, data });
}

// ─── Purchase orders ────────────────────────────────────────────────────────

export const PURCHASE_DETAIL = { supplier: true, items: { orderBy: { line: 'asc' }, include: { part: { select: { id: true, sku: true, name: true, unit: true, stockQty: true } } } } } satisfies Prisma.PurchaseOrderInclude;

export async function getPurchase(db: Db, shopId: string, id: string) {
  const po = await db.purchaseOrder.findFirst({ where: { id, shopId }, include: PURCHASE_DETAIL });
  if (!po) throw notFound('Purchase order');
  return po;
}

export function listPurchases(db: Db, shopId: string, q: z.infer<typeof purchasesQuery>) {
  return db.purchaseOrder.findMany({
    where: { shopId, ...(q.status ? { status: q.status } : {}), ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
    include: PURCHASE_DETAIL,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

async function lines(db: Db, shopId: string, items: z.infer<typeof purchaseInput>['items']) {
  const parts = await db.part.findMany({ where: { shopId, id: { in: items.map((i) => i.partId) } } });
  const byId = new Map(parts.map((p) => [p.id, p]));
  return items.map((i, line) => {
    const p = byId.get(i.partId);
    if (!p) throw notFound('Part');
    if (p.isKit) throw new DomainError(422, `${p.name} is a kit: order its parts instead`);
    // Ordered in the purchase unit (a drum, a box) when the part has one: quantity and cost are per that unit.
    return { line, partId: p.id, quantity: D(i.quantity), unitCost: D(i.unitCost ?? p.costPrice.mul(p.purchaseFactor).toDecimalPlaces(2)), purchaseUnit: p.purchaseUnit, unitFactor: p.purchaseFactor };
  });
}

export async function createPurchase(db: Prisma.TransactionClient, shopId: string, data: z.infer<typeof purchaseInput>) {
  const supplier = await db.supplier.findFirst({ where: { id: data.supplierId, shopId } });
  if (!supplier) throw notFound('Supplier');
  const po = await db.purchaseOrder.create({
    data: {
      shopId,
      number: await takeNumber(db, shopId, 'purchase'),
      supplierId: supplier.id,
      expectedAt: data.expectedAt ? new Date(data.expectedAt) : null,
      note: data.note ?? null,
      items: { create: await lines(db, shopId, data.items) },
    },
  });
  return getPurchase(db, shopId, po.id);
}

export async function updatePurchase(db: Prisma.TransactionClient, shopId: string, id: string, data: z.infer<typeof purchasePatch>) {
  const po = await getPurchase(db, shopId, id);
  if (po.status !== 'DRAFT') throw conflict(`PO #${po.number} has been sent; only drafts can be edited`);
  if (data.supplierId) {
    const s = await db.supplier.findFirst({ where: { id: data.supplierId, shopId }, select: { id: true } });
    if (!s) throw notFound('Supplier');
  }
  await db.purchaseOrder.update({
    where: { id },
    data: {
      ...(data.supplierId ? { supplierId: data.supplierId } : {}),
      ...(data.expectedAt !== undefined ? { expectedAt: data.expectedAt ? new Date(data.expectedAt) : null } : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    },
  });
  if (data.items) {
    await db.purchaseOrderItem.deleteMany({ where: { purchaseId: id } });
    await db.purchaseOrderItem.createMany({ data: (await lines(db, shopId, data.items)).map((l) => ({ ...l, purchaseId: id })) });
  }
  return getPurchase(db, shopId, id);
}

export async function placePurchase(db: Db, shopId: string, id: string) {
  const po = await getPurchase(db, shopId, id);
  if (po.status !== 'DRAFT') throw conflict(`PO #${po.number} is already ${po.status.toLowerCase().replace('_', ' ')}`);
  await db.purchaseOrder.update({ where: { id }, data: { status: 'ORDERED', orderedAt: new Date() } });
  return getPurchase(db, shopId, id);
}

export async function cancelPurchase(db: Db, shopId: string, id: string) {
  const po = await getPurchase(db, shopId, id);
  if (!['DRAFT', 'ORDERED'].includes(po.status) || po.items.some((i) => !i.receivedQty.isZero())) throw conflict(`PO #${po.number} can't be cancelled once stock has been received`);
  await db.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  return getPurchase(db, shopId, id);
}

/** Books in what arrived. More than ordered is allowed (it happens); it's all recorded. */
export async function receive(db: Prisma.TransactionClient, shopId: string, actor: Actor, id: string, data: z.infer<typeof receiveInput>) {
  const po = await getPurchase(db, shopId, id);
  if (po.status === 'DRAFT') throw conflict('Send the order before receiving against it');
  if (po.status === 'RECEIVED' || po.status === 'CANCELLED') throw conflict(`PO #${po.number} is ${po.status.toLowerCase()}`);
  const byId = new Map(po.items.map((i) => [i.id, i]));
  const lines = data.items.filter((r) => r.quantity > 0).map((r) => {
    const item = byId.get(r.itemId);
    if (!item) throw notFound('Purchase order line');
    const qty = D(r.quantity);
    return { item, qty, cost: r.unitCost != null ? D(r.unitCost) : item.unitCost, locationId: r.locationId ?? undefined, factor: item.unitFactor };
  });
  if (!lines.length) throw new DomainError(422, 'Enter what arrived');

  // Landed cost: the delivery's extra costs, spread by value, into each unit.
  const value = lines.reduce((t, l) => t.plus(l.cost.mul(l.qty)), D(0));
  const extra = money(D(data.extraCosts));
  let received = D(0);
  for (const l of lines) {
    const share = value.isZero() ? extra.div(lines.length) : extra.mul(l.cost.mul(l.qty)).div(value);
    const landed = l.cost.plus(share.div(l.qty));
    received = received.plus(l.cost.mul(l.qty));
    const part = await db.part.findUniqueOrThrow({ where: { id: l.item.partId } });
    // Into stock in selling units: a drum of 208 L is 208 L at a 208th of its cost each.
    const units = l.qty.mul(l.factor);
    const unitCost = landed.div(l.factor);
    // Weighted average cost of what's on the shelf after this delivery.
    const onHand = Prisma.Decimal.max(part.stockQty, 0);
    const avg = onHand.plus(units).isZero() ? unitCost : onHand.mul(part.costPrice).plus(units.mul(unitCost)).div(onHand.plus(units));
    const per = l.factor.equals(1) ? '' : ` (${l.qty.toString()} ${l.item.purchaseUnit ?? 'packs'} of ${l.factor.toString()})`;
    await move(db, part, units, 'PURCHASE', { unitCost: money(unitCost), purchaseId: po.id, note: `PO #${po.number}${per}${extra.gt(0) ? ' (with freight and duty)' : ''}`, byName: actor.name, locationId: l.locationId });
    await db.part.update({ where: { id: part.id }, data: { costPrice: money(avg) } });
    await db.purchaseOrderItem.update({ where: { id: l.item.id }, data: { receivedQty: l.item.receivedQty.plus(l.qty), unitCost: l.cost } });
  }
  const after = await db.purchaseOrderItem.findMany({ where: { purchaseId: id } });
  const done = after.every((i) => i.receivedQty.gte(i.quantity));
  await db.purchaseOrder.update({ where: { id }, data: { status: done ? 'RECEIVED' : 'PARTLY_RECEIVED', ...(done ? { receivedAt: new Date() } : {}), ...(data.note ? { note: [po.note, data.note].filter(Boolean).join('\n') } : {}) } });
  await audit(db, shopId, actor, 'purchase.receive', `Received ${lines.length} line(s) on PO #${po.number} from ${po.supplier.name}: ${money(received).toFixed(2)}${extra.gt(0) ? ` + ${extra.toFixed(2)} freight and duty` : ''}`, { entity: 'purchase', entityId: po.id, amount: money(received.plus(extra)) });
  if (data.bill) {
    await addBill(db, shopId, actor, po.supplierId, { ...data.bill, amount: data.bill.amount ?? money(received.plus(extra)).toNumber(), purchaseId: po.id });
  }
  return getPurchase(db, shopId, id);
}

/**
 * What to reorder: active parts at or below their reorder level, with how
 * many to buy (the reorder quantity, or enough to get back above the level)
 * less what's already on order, grouped by usual supplier.
 */
export async function reorderList(db: Db, shopId: string) {
  const low = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "parts" WHERE "shop_id" = ${shopId} AND "active" AND NOT "is_kit" AND "stock_qty" <= "reorder_level"`;
  if (!low.length) return [];
  const parts = await db.part.findMany({ where: { id: { in: low.map((r) => r.id) } }, include: { supplier: true }, orderBy: { name: 'asc' } });
  const onOrder = await db.purchaseOrderItem.findMany({
    where: { partId: { in: parts.map((p) => p.id) }, purchase: { status: { in: ['DRAFT', 'ORDERED', 'PARTLY_RECEIVED'] } } },
    select: { partId: true, quantity: true, receivedQty: true, unitFactor: true },
  });
  // In selling units.
  const pending = new Map<string, Prisma.Decimal>();
  for (const o of onOrder) pending.set(o.partId, (pending.get(o.partId) ?? D(0)).plus(o.quantity.minus(o.receivedQty).mul(o.unitFactor)));
  const groups = new Map<string, { supplier: (typeof parts)[number]['supplier']; lines: { part: (typeof parts)[number]; suggested: number; onOrder: number }[] }>();
  for (const p of parts) {
    const already = pending.get(p.id) ?? D(0);
    const target = p.reorderQty.gt(0) ? p.reorderQty : p.reorderLevel.minus(p.stockQty).plus(1);
    const suggested = Prisma.Decimal.max(target.minus(already), 0);
    const key = p.supplierId ?? '';
    if (!groups.has(key)) groups.set(key, { supplier: p.supplier, lines: [] });
    // Suggested in what it's bought in: 520 L is 3 drums of 208.
    groups.get(key)!.lines.push({ part: p, suggested: Math.ceil(suggested.div(p.purchaseFactor).toNumber()), onOrder: already.toNumber() });
  }
  return [...groups.values()];
}
