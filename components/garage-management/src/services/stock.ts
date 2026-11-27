/**
 * Stock-keeping around the parts list: where things are kept (locations),
 * counting the shelves (stocktakes), and buying more (purchase orders).
 *
 * Every change to a quantity goes through inventory.move, so a part's history
 * still adds up to its current stock.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { locationInput, locationPatch, purchaseOrderInput, purchaseOrderPatch, receiveInput, stockCountInput } from '../validation';
import * as inventory from './inventory';
import { D, assertSupplier, takeNumber } from './shared';

// ─── Locations ──────────────────────────────────────────────────────────────

export function listLocations(db: Db, garageId: string, includeInactive: boolean) {
  return db.stockLocation.findMany({
    where: { garageId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { name: 'asc' },
    include: { _count: { select: { parts: true, assets: true, held: true } } },
  });
}

async function assertNameFree(db: Db, garageId: string, name: string, exceptId?: string) {
  const clash = await db.stockLocation.findFirst({
    where: { garageId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw conflict(`There is already a location called ${name}`);
}

export async function createLocation(db: Db, garageId: string, data: z.infer<typeof locationInput>) {
  await assertNameFree(db, garageId, data.name);
  return db.stockLocation.create({ data: { ...data, garageId } });
}

export async function updateLocation(db: Db, garageId: string, id: string, data: z.infer<typeof locationPatch>) {
  const found = await db.stockLocation.findFirst({ where: { id, garageId } });
  if (!found) throw notFound('Location');
  if (data.name) await assertNameFree(db, garageId, data.name, id);
  return db.stockLocation.update({ where: { id }, data });
}

// ─── Stocktake ──────────────────────────────────────────────────────────────

/**
 * Record a count and correct stock to match. Each counted part whose
 * quantity differs gets a COUNT movement for the difference; every counted
 * line is kept, so the count shows what was expected as well as what was found.
 */
export async function createStockCount(db: Prisma.TransactionClient, garageId: string, data: z.infer<typeof stockCountInput>, countedBy: string | null) {
  const ids = data.lines.map((l) => l.partId);
  if (new Set(ids).size !== ids.length) throw conflict('Each part can only be counted once per stocktake');
  const parts = await db.part.findMany({ where: { id: { in: ids }, garageId } });
  if (parts.length !== ids.length) throw notFound('Part');
  const byId = new Map(parts.map((p) => [p.id, p]));

  const count = await db.stockCount.create({ data: { garageId, note: data.note ?? null, countedBy } });
  for (const line of data.lines) {
    const part = byId.get(line.partId)!;
    const counted = D(line.counted);
    await db.stockCountLine.create({ data: { countId: count.id, partId: part.id, expected: part.stockQty, counted } });
    const diff = counted.sub(part.stockQty);
    if (!diff.isZero()) await inventory.move(db, part, diff, 'COUNT', { note: `Stocktake: counted ${counted.toNumber()}, expected ${part.stockQty.toNumber()}` });
  }
  return getStockCount(db, garageId, count.id);
}

type CountWithLines = Prisma.StockCountGetPayload<{ include: { lines: { include: { part: true } } } }>;

export async function getStockCount(db: Db, garageId: string, id: string): Promise<CountWithLines> {
  const count = await db.stockCount.findFirst({ where: { id, garageId }, include: { lines: { include: { part: true } } } });
  if (!count) throw notFound('Stocktake');
  return count;
}

export async function listStockCounts(db: Db, garageId: string, limit: number, offset: number) {
  const where = { garageId };
  const [items, total] = await Promise.all([
    db.stockCount.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { lines: { include: { part: true } } } }),
    db.stockCount.count({ where }),
  ]);
  return { items, total };
}

// ─── Purchase orders ────────────────────────────────────────────────────────

const orderInclude = { supplier: true, lines: { include: { part: true }, orderBy: [{ part: { name: 'asc' as const } }, { id: 'asc' as const }] } };
export type OrderWithLines = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;

async function assertParts(db: Db, garageId: string, lines: { partId: string }[]) {
  const ids = [...new Set(lines.map((l) => l.partId))];
  if (ids.length !== lines.length) throw conflict('A part can only appear once on an order');
  const found = await db.part.count({ where: { id: { in: ids }, garageId } });
  if (found !== ids.length) throw notFound('Part');
}

export async function listOrders(db: Db, garageId: string, status: string | undefined, limit: number, offset: number) {
  const where: Prisma.PurchaseOrderWhereInput = { garageId, ...(status ? { status: status as never } : {}) };
  const [items, total] = await Promise.all([
    db.purchaseOrder.findMany({ where, orderBy: { number: 'desc' }, take: limit, skip: offset, include: orderInclude }),
    db.purchaseOrder.count({ where }),
  ]);
  return { items, total };
}

export async function getOrder(db: Db, garageId: string, id: string): Promise<OrderWithLines> {
  const order = await db.purchaseOrder.findFirst({ where: { id, garageId }, include: orderInclude });
  if (!order) throw notFound('Purchase order');
  return order;
}

export async function createOrder(db: Prisma.TransactionClient, garageId: string, data: z.infer<typeof purchaseOrderInput>) {
  await assertSupplier(db, garageId, data.supplierId);
  await assertParts(db, garageId, data.lines);
  const number = await takeNumber(db, garageId, 'purchase');
  const order = await db.purchaseOrder.create({
    data: {
      garageId,
      number,
      supplierId: data.supplierId,
      note: data.note ?? null,
      lines: { create: data.lines.map((l) => ({ partId: l.partId, quantity: D(l.quantity), unitCost: D(l.unitCost) })) },
    },
  });
  return getOrder(db, garageId, order.id);
}

export async function updateOrder(db: Prisma.TransactionClient, garageId: string, id: string, data: z.infer<typeof purchaseOrderPatch>) {
  const order = await getOrder(db, garageId, id);
  if (order.status !== 'DRAFT') throw conflict('Only a draft order can be edited');
  if (data.lines) {
    await assertParts(db, garageId, data.lines);
    await db.purchaseOrderLine.deleteMany({ where: { orderId: id } });
    await db.purchaseOrderLine.createMany({ data: data.lines.map((l) => ({ orderId: id, partId: l.partId, quantity: D(l.quantity), unitCost: D(l.unitCost) })) });
  }
  if (data.note !== undefined) await db.purchaseOrder.update({ where: { id }, data: { note: data.note } });
  return getOrder(db, garageId, id);
}

/** Send the order: from here it can be received but no longer edited. */
export async function placeOrder(db: Db, garageId: string, id: string) {
  const order = await getOrder(db, garageId, id);
  if (order.status !== 'DRAFT') throw conflict('This order has already been placed');
  if (order.lines.length === 0) throw conflict('Add at least one line first');
  await db.purchaseOrder.update({ where: { id }, data: { status: 'ORDERED', orderedAt: new Date() } });
  return getOrder(db, garageId, id);
}

export async function cancelOrder(db: Db, garageId: string, id: string) {
  const order = await getOrder(db, garageId, id);
  if (order.status === 'CANCELLED') return order;
  if (order.status === 'RECEIVED' || order.status === 'PARTLY_RECEIVED') throw conflict('Stock has already been received against this order');
  await db.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  return getOrder(db, garageId, id);
}

/**
 * Goods in. Each delivered quantity is booked into stock as a PURCHASE from the
 * order's supplier at the order's price (which also updates the part's cost),
 * and the order moves to partly or fully received.
 */
export async function receiveOrder(db: Prisma.TransactionClient, garageId: string, id: string, data: z.infer<typeof receiveInput>) {
  const order = await getOrder(db, garageId, id);
  if (order.status !== 'ORDERED' && order.status !== 'PARTLY_RECEIVED') throw conflict(order.status === 'DRAFT' ? 'Place the order before receiving it' : 'This order is closed');
  const lineIds = data.lines.map((l) => l.lineId);
  if (new Set(lineIds).size !== lineIds.length) throw conflict('Each line can only appear once per delivery');

  for (const item of data.lines) {
    const line = order.lines.find((l) => l.id === item.lineId);
    if (!line) throw notFound('Order line');
    const outstanding = line.quantity.sub(line.receivedQty);
    if (D(item.quantity).gt(outstanding)) throw conflict(`Only ${outstanding.toNumber()} of ${line.part.name} still to arrive`);
    await inventory.adjustStock(db, garageId, line.partId, {
      quantityChange: item.quantity,
      reason: 'PURCHASE',
      supplierId: order.supplierId,
      unitCost: line.unitCost.toNumber(),
      note: data.note ?? `Order PO-${order.number}`,
    });
    await db.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: { increment: D(item.quantity) } } });
  }

  const fresh = await db.purchaseOrderLine.findMany({ where: { orderId: id } });
  const complete = fresh.every((l) => l.receivedQty.gte(l.quantity));
  await db.purchaseOrder.update({ where: { id }, data: complete ? { status: 'RECEIVED', receivedAt: new Date() } : { status: 'PARTLY_RECEIVED' } });
  return getOrder(db, garageId, id);
}
