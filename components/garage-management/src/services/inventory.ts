/**
 * Parts and stock. stockQty only ever changes together with a StockMovement
 * row, so a part's history always adds up to its current stock.
 */
import { Part, Prisma, StockReason } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db, prisma } from '../utils/prisma';
import { partInput, partPatch, stockAdjustInput } from '../validation';
import { D, assertLocation, assertSupplier, emit } from './shared';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export async function listParts(db: Db, garageId: string, opts: { q?: string; lowStock: boolean; includeInactive: boolean; kind?: 'PART' | 'CONSUMABLE'; category?: string; locationId?: string }, limit: number, offset: number) {
  const where: Prisma.PartWhereInput = {
    garageId,
    ...(opts.includeInactive ? {} : { active: true }),
    // Compares two columns of the same row: stock at or below its own reorder level.
    ...(opts.lowStock ? { stockQty: { lte: prisma.part.fields.reorderLevel } } : {}),
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.locationId ? { locationId: opts.locationId } : {}),
    ...(opts.q ? { OR: [{ name: contains(opts.q) }, { sku: contains(opts.q) }, { brand: contains(opts.q) }, { barcode: contains(opts.q) }, { category: contains(opts.q) }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.part.findMany({ where, orderBy: { name: 'asc' }, take: limit, skip: offset }),
    db.part.count({ where }),
  ]);
  return { items, total };
}

export async function getPart(db: Db, garageId: string, id: string): Promise<Part> {
  const part = await db.part.findFirst({ where: { id, garageId } });
  if (!part) throw notFound('Part');
  return part;
}

export async function createPart(db: Prisma.TransactionClient, garageId: string, data: z.infer<typeof partInput>) {
  const { openingStock, ...fields } = data;
  await assertSupplier(db, garageId, fields.supplierId);
  await assertLocation(db, garageId, fields.locationId);
  const sku = fields.sku.toUpperCase();
  const barcode = cleanBarcode(fields.barcode);
  if (await db.part.findFirst({ where: { garageId, sku }, select: { id: true } })) throw conflict(`A part with SKU ${sku} already exists`);
  await assertBarcodeFree(db, garageId, barcode);
  const part = await db.part.create({ data: { ...fields, barcode, sku, garageId, stockQty: 0 } });
  return openingStock > 0
    ? move(db, part, D(openingStock), 'PURCHASE', { note: 'Opening stock', supplierId: part.supplierId, unitCost: part.unitCost })
    : part;
}

export async function updatePart(db: Db, garageId: string, id: string, data: z.infer<typeof partPatch>) {
  await getPart(db, garageId, id);
  if (data.supplierId !== undefined) await assertSupplier(db, garageId, data.supplierId);
  if (data.locationId !== undefined) await assertLocation(db, garageId, data.locationId);
  const patch = { ...data };
  if (data.barcode !== undefined) {
    patch.barcode = cleanBarcode(data.barcode);
    await assertBarcodeFree(db, garageId, patch.barcode, id);
  }
  return db.part.update({ where: { id }, data: patch });
}

export async function adjustStock(db: Prisma.TransactionClient, garageId: string, id: string, data: z.infer<typeof stockAdjustInput>) {
  let part = await getPart(db, garageId, id);
  const change = D(data.quantityChange);
  if (data.reason === 'WORKSHOP_USE' && !change.isNegative()) throw conflict('Workshop use takes stock out: use a negative quantity');
  if (part.stockQty.add(change).isNegative()) throw conflict(`Only ${part.stockQty.toNumber()} of ${part.name} in stock`);
  if (data.reason !== 'PURCHASE') return move(db, part, change, data.reason, { note: data.note ?? null });

  await assertSupplier(db, garageId, data.supplierId);
  // The latest purchase price becomes the part's cost, so margins stay current;
  // and the first supplier a part is bought from becomes its usual one.
  const costChanged = data.unitCost != null && !part.unitCost.eq(data.unitCost);
  const firstSupplier = !part.supplierId && data.supplierId;
  if (costChanged || firstSupplier) {
    part = await db.part.update({
      where: { id: part.id },
      data: { ...(costChanged ? { unitCost: D(data.unitCost!) } : {}), ...(firstSupplier ? { supplierId: data.supplierId } : {}) },
    });
  }
  return move(db, part, change, 'PURCHASE', {
    note: data.note ?? null,
    supplierId: data.supplierId ?? part.supplierId,
    unitCost: data.unitCost != null ? D(data.unitCost) : part.unitCost,
  });
}

export async function listMovements(db: Db, garageId: string, partId: string, limit: number, offset: number) {
  await getPart(db, garageId, partId);
  const where = { partId };
  const [items, total] = await Promise.all([
    db.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    db.stockMovement.count({ where }),
  ]);
  return { items, total };
}

/** Take parts out of stock for a job. Refuses rather than letting stock go negative. */
export async function consume(db: Prisma.TransactionClient, part: Part, quantity: Prisma.Decimal, jobCardId: string) {
  if (part.stockQty.lt(quantity)) throw conflict(`Only ${part.stockQty.toNumber()} of ${part.name} in stock`);
  // Cost at the time of use, so reports' parts cost doesn't move when prices change later.
  return move(db, part, quantity.neg(), 'JOB_USE', { jobCardId, unitCost: part.unitCost });
}

/** Put parts back when a job line is removed or the job is cancelled. */
export function giveBack(db: Prisma.TransactionClient, part: Part, quantity: Prisma.Decimal, jobCardId: string, note: string) {
  return move(db, part, quantity, 'RETURN', { jobCardId, note });
}

export async function move(
  db: Prisma.TransactionClient,
  part: Part,
  change: Prisma.Decimal,
  reason: StockReason,
  extra: { jobCardId?: string; note?: string | null; supplierId?: string | null; unitCost?: Prisma.Decimal | null },
): Promise<Part> {
  const wasLow = part.active && part.stockQty.lte(part.reorderLevel);
  // increment, not a computed absolute value, so concurrent movements cannot overwrite each other.
  const updated = await db.part.update({ where: { id: part.id }, data: { stockQty: { increment: change } } });
  await db.stockMovement.create({
    data: {
      garageId: part.garageId,
      partId: part.id,
      quantityChange: change,
      reason,
      jobCardId: extra.jobCardId ?? null,
      supplierId: extra.supplierId ?? null,
      unitCost: extra.unitCost ?? null,
      note: extra.note ?? null,
    },
  });
  if (updated.active && updated.stockQty.lte(updated.reorderLevel) && !wasLow) {
    await emit(db, part.garageId, 'stock.low', { partId: part.id, sku: part.sku, stockQty: updated.stockQty.toNumber() });
  }
  return updated;
}

const cleanBarcode = (b: string | null | undefined) => (b && b.trim() ? b.trim() : null);

async function assertBarcodeFree(db: Db, garageId: string, barcode: string | null, exceptId?: string) {
  if (!barcode) return;
  const clash = await db.part.findFirst({ where: { garageId, barcode, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { sku: true } });
  if (clash) throw conflict(`Barcode ${barcode} is already on ${clash.sku}`);
}
