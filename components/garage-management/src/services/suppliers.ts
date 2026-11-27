/**
 * Where parts come from. A part can name its usual supplier, and a stock
 * purchase records who it came from and the unit cost, so each supplier shows
 * what the garage has bought from them and what it spent.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { supplierInput, supplierPatch } from '../validation';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export async function listSuppliers(db: Db, garageId: string, opts: { q?: string; includeInactive: boolean }) {
  const where: Prisma.SupplierWhereInput = {
    garageId,
    ...(opts.includeInactive ? {} : { active: true }),
    ...(opts.q ? { OR: [{ name: contains(opts.q) }, { contactName: contains(opts.q) }, { phone: contains(opts.q) }] } : {}),
  };
  const suppliers = await db.supplier.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { parts: true } } }, take: 200 });
  // Spend per supplier in one query rather than one per row.
  const spend = suppliers.length
    ? await db.$queryRaw<{ supplier_id: string; spend: Prisma.Decimal; last: Date }[]>`
        SELECT "supplier_id", SUM("quantity_change" * COALESCE("unit_cost", 0)) AS spend, MAX("created_at") AS last
        FROM "stock_movements"
        WHERE "garage_id" = ${garageId} AND "reason" = 'PURCHASE' AND "supplier_id" IS NOT NULL
        GROUP BY "supplier_id"`
    : [];
  const bySupplier = new Map(spend.map((row) => [row.supplier_id, row]));
  return suppliers.map((s) => ({
    supplier: s,
    totalSpend: Number(bySupplier.get(s.id)?.spend ?? 0),
    lastPurchaseAt: bySupplier.get(s.id)?.last ?? null,
  }));
}

export async function getSupplier(db: Db, garageId: string, id: string) {
  const supplier = await db.supplier.findFirst({ where: { id, garageId }, include: { _count: { select: { parts: true } } } });
  if (!supplier) throw notFound('Supplier');
  return supplier;
}

export async function supplierDetail(db: Db, garageId: string, id: string) {
  const supplier = await getSupplier(db, garageId, id);
  const [parts, purchases] = await Promise.all([
    db.part.findMany({ where: { garageId, supplierId: id }, orderBy: { name: 'asc' } }),
    db.stockMovement.findMany({
      where: { garageId, supplierId: id, reason: 'PURCHASE' },
      include: { part: { select: { name: true, sku: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  const totalSpend = purchases.reduce((sum, m) => sum + m.quantityChange.toNumber() * (m.unitCost?.toNumber() ?? 0), 0);
  return { supplier, parts, purchases, totalSpend: Math.round(totalSpend * 100) / 100 };
}

export function createSupplier(db: Db, garageId: string, data: z.infer<typeof supplierInput>) {
  return db.supplier.create({ data: { ...data, garageId }, include: { _count: { select: { parts: true } } } });
}

export async function updateSupplier(db: Db, garageId: string, id: string, data: z.infer<typeof supplierPatch>) {
  await getSupplier(db, garageId, id);
  return db.supplier.update({ where: { id }, data, include: { _count: { select: { parts: true } } } });
}
