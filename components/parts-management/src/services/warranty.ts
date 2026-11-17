/**
 * Warranty claims, both sides of them.
 *
 * The customer's side: a part comes back faulty. The claim records what was
 * sold, when, and whether it's still covered. The outcome is one of:
 *   REPLACE  a new unit from stock, free or with a pro-rata charge (when the
 *            part has free months and they've passed), keeping the original
 *            warranty end date;
 *   REFUND   the unit is taken back and refunded (rules and fees don't apply);
 *   REPAIR   fixed and returned;
 *   REJECT   not covered (misuse, out of warranty), with the reason.
 * Replacing and refunding are a manager's call, like any refund.
 *
 * The shop's side: the faulty unit goes back to the supplier (PENDING) until
 * they CREDIT the shop (on the supplier's ledger), send a REPLACEMENT (into
 * stock), or REJECT it. So the shop sees what suppliers still owe it.
 */
import { Prisma, Shop } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { claimInput, claimsQuery, resolveClaimInput, supplierClaimInput } from '../validation';
import { move } from './inventory';
import { createReturn, createSale } from './sales';
import { D, money, takeNumber } from './shared';
import { Actor, approval, audit } from './staff';

export const CLAIM_DETAIL = { part: { select: { id: true, sku: true, name: true, retailPrice: true, costPrice: true, warrantyMonths: true, warrantyFreeMonths: true, supplierId: true, serialized: true } } } satisfies Prisma.WarrantyClaimInclude;
export type ClaimDetail = Prisma.WarrantyClaimGetPayload<{ include: typeof CLAIM_DETAIL }>;

const monthsBetween = (a: Date, b: Date) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);

/**
 * What a replacement should cost the customer: nothing within the free
 * months (or all of a covered warranty without them), then the share of the
 * warranty used up; the full price when not covered.
 */
export function suggestedCharge(c: ClaimDetail, now = new Date()) {
  const p = c.part;
  if (!p) return D(0);
  if (!c.covered) return p.retailPrice;
  if (p.warrantyFreeMonths == null || !p.warrantyMonths || !c.soldAt) return D(0);
  const used = Math.max(0, monthsBetween(c.soldAt, now));
  if (used <= p.warrantyFreeMonths) return D(0);
  return money(Prisma.Decimal.min(p.retailPrice, p.retailPrice.mul(used).div(p.warrantyMonths)));
}

export async function getClaim(db: Db, shopId: string, id: string) {
  const c = await db.warrantyClaim.findFirst({ where: { id, shopId }, include: CLAIM_DETAIL });
  if (!c) throw notFound('Warranty claim');
  return c;
}

export function listClaims(db: Db, shopId: string, q: z.infer<typeof claimsQuery>) {
  return db.warrantyClaim.findMany({
    where: { shopId, ...(q.status ? { status: q.status } : {}), ...(q.supplier ? { supplierStatus: q.supplier } : {}) },
    include: CLAIM_DETAIL,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function openClaim(db: Prisma.TransactionClient, shop: Shop, actor: Actor, data: z.infer<typeof claimInput>) {
  const item = data.saleItemId
    ? await db.saleItem.findFirst({ where: { id: data.saleItemId, sale: { shopId: shop.id } }, include: { sale: true } })
    : await db.saleItem.findFirst({ where: { serialNumber: { equals: data.serialNumber!, mode: 'insensitive' }, sale: { shopId: shop.id, voidedAt: null } }, include: { sale: true }, orderBy: { sale: { createdAt: 'desc' } } });
  if (!item) throw notFound('That sale');
  if (!item.partId) throw new DomainError(422, 'Only parts from stock can be claimed under warranty');
  const open = await db.warrantyClaim.findFirst({ where: { shopId: shop.id, saleItemId: item.id, status: 'OPEN' }, select: { number: true } });
  if (open) throw conflict(`Claim #${open.number} for this item is still open`);
  const now = new Date();
  const covered = Boolean(item.warrantyUntil && item.warrantyUntil > now && !item.sale.voidedAt && item.returnedQty.lt(item.quantity));
  const c = await db.warrantyClaim.create({
    data: {
      shopId: shop.id,
      number: await takeNumber(db, shop.id, 'claim'),
      saleId: item.saleId,
      saleItemId: item.id,
      partId: item.partId,
      serialNumber: item.serialNumber,
      customerName: item.sale.customerName,
      customerPhone: data.customerPhone ?? item.sale.customerPhone,
      fault: data.fault,
      soldAt: item.sale.createdAt,
      warrantyUntil: item.warrantyUntil,
      covered,
      createdByName: actor.name,
    },
  });
  await audit(db, shop.id, actor, 'warranty.claim', `Warranty claim #${c.number}: ${item.description}${item.serialNumber ? ` (${item.serialNumber})` : ''} from sale #${item.sale.number}, ${covered ? 'covered' : 'not covered'}: ${data.fault}`, { entity: 'claim', entityId: c.id });
  return getClaim(db, shop.id, c.id);
}

export async function resolveClaim(db: Prisma.TransactionClient, shop: Shop, actor: Actor, id: string, data: z.infer<typeof resolveClaimInput>) {
  const c = await getClaim(db, shop.id, id);
  if (c.status !== 'OPEN') throw conflict(`Claim #${c.number} is already ${c.status.toLowerCase()}`);
  const done = { resolvedByName: actor.name, resolvedAt: new Date(), outcomeNote: data.note ?? null };

  if (data.outcome === 'REPLACE') {
    const approvedBy = await approval(db, shop, actor, 'refund', data.approvalPin);
    if (!c.part) throw conflict('The part is no longer in the catalogue');
    const charge = money(D(data.charge ?? suggestedCharge(c).toNumber()));
    if (charge.gt(0) && !data.paymentMethod) throw new DomainError(422, `Charge ${charge.toFixed(2)}: choose how it's paid`);
    const sale = await createSale(
      db, shop, actor,
      {
        items: [{ partId: c.part.id, quantity: 1, unitPrice: charge.toNumber(), discount: 0, coreReturned: true, locationId: data.locationId ?? null, ...(c.part.serialized ? { serialNumbers: data.serialNumber ? [data.serialNumber] : [] } : {}) }],
        discount: 0,
        payments: charge.gt(0) ? [{ method: data.paymentMethod!, amount: charge.toNumber(), reference: null }] : [],
        customerName: c.customerName,
        customerPhone: c.customerPhone,
        taxInvoice: false,
        note: `Warranty replacement, claim #${c.number}`,
      },
      { skipDiscountCheck: true, warrantyUntil: c.warrantyUntil, stockReason: 'WARRANTY' },
    );
    await db.warrantyClaim.update({ where: { id }, data: { ...done, status: 'REPLACED', charged: charge, replacementSaleId: sale.id } });
    await audit(db, shop.id, actor, 'warranty.replace', `Claim #${c.number}: replaced ${c.part.name}${charge.gt(0) ? ` for ${charge.toFixed(2)} (pro rata)` : ' free'}, sale #${sale.number}${approvedBy ? `, approved by ${approvedBy}` : ''}`, { entity: 'claim', entityId: id, amount: charge });
  } else if (data.outcome === 'REFUND') {
    if (!c.saleId || !c.saleItemId) throw conflict('No sale to refund');
    await createReturn(db, shop, actor, c.saleId, {
      items: [{ saleItemId: c.saleItemId, quantity: 1, restock: false }],
      refundMethod: data.refundMethod ?? 'CASH',
      reason: `Warranty claim #${c.number}`,
      override: true,
      waiveFee: true,
      approvalPin: data.approvalPin,
    });
    const ret = await db.saleReturn.findFirst({ where: { saleId: c.saleId }, orderBy: { createdAt: 'desc' } });
    await db.warrantyClaim.update({ where: { id }, data: { ...done, status: 'REFUNDED', refundReturnId: ret?.id ?? null } });
  } else {
    const status = data.outcome === 'REPAIR' ? 'REPAIRED' : 'REJECTED';
    if (status === 'REJECTED' && !data.note) throw new DomainError(422, 'Say why the claim is rejected');
    await db.warrantyClaim.update({ where: { id }, data: { ...done, status } });
    await audit(db, shop.id, actor, 'warranty.close', `Claim #${c.number}: ${status.toLowerCase()}${data.note ? `: ${data.note}` : ''}`, { entity: 'claim', entityId: id });
  }
  return getClaim(db, shop.id, id);
}

export async function supplierClaim(db: Prisma.TransactionClient, shop: Shop, actor: Actor, id: string, data: z.infer<typeof supplierClaimInput>) {
  const c = await getClaim(db, shop.id, id);
  const note = data.note ?? null;
  if (data.action === 'SEND') {
    if (c.supplierStatus !== 'NONE' && c.supplierStatus !== 'REJECTED') throw conflict(`Claim #${c.number} is already with the supplier`);
    const supplierId = data.supplierId ?? c.part?.supplierId;
    if (!supplierId) throw new DomainError(422, 'Choose the supplier to claim from');
    const supplier = await db.supplier.findFirst({ where: { id: supplierId, shopId: shop.id } });
    if (!supplier) throw notFound('Supplier');
    await db.warrantyClaim.update({ where: { id }, data: { supplierId, supplierStatus: 'PENDING', sentAt: new Date(), supplierNote: note } });
    await audit(db, shop.id, actor, 'warranty.supplier', `Claim #${c.number}: faulty unit sent to ${supplier.name}`, { entity: 'claim', entityId: id });
    return getClaim(db, shop.id, id);
  }
  if (c.supplierStatus !== 'PENDING' || !c.supplierId) throw conflict(`Claim #${c.number} isn't waiting on a supplier`);
  const supplier = await db.supplier.findUniqueOrThrow({ where: { id: c.supplierId } });
  if (data.action === 'CREDITED') {
    const amount = money(D(data.amount ?? c.part?.costPrice.toNumber() ?? 0));
    if (amount.gt(0)) {
      await db.supplierEntry.create({ data: { shopId: shop.id, supplierId: supplier.id, kind: 'RETURN', amount: amount.negated(), note: `Warranty claim #${c.number}${c.serialNumber ? ` (${c.serialNumber})` : ''}`, byName: actor.name } });
    }
    await db.warrantyClaim.update({ where: { id }, data: { supplierStatus: 'CREDITED', supplierCredit: amount, supplierNote: note } });
    await audit(db, shop.id, actor, 'warranty.supplier', `Claim #${c.number}: ${supplier.name} credited ${amount.toFixed(2)}`, { entity: 'claim', entityId: id, amount });
  } else if (data.action === 'REPLACED') {
    if (!c.partId) throw conflict('The part is no longer in the catalogue');
    const part = await db.part.findUniqueOrThrow({ where: { id: c.partId } });
    await move(db, part, D(1), 'WARRANTY', { unitCost: part.costPrice, locationId: data.locationId ?? undefined, note: `Replacement from ${supplier.name}, claim #${c.number}`, byName: actor.name });
    await db.warrantyClaim.update({ where: { id }, data: { supplierStatus: 'REPLACED', supplierNote: note } });
    await audit(db, shop.id, actor, 'warranty.supplier', `Claim #${c.number}: ${supplier.name} sent a replacement ${part.name}`, { entity: 'claim', entityId: id });
  } else {
    await db.warrantyClaim.update({ where: { id }, data: { supplierStatus: 'REJECTED', supplierNote: note } });
    await audit(db, shop.id, actor, 'warranty.supplier', `Claim #${c.number}: ${supplier.name} rejected it${note ? `: ${note}` : ''}`, { entity: 'claim', entityId: id });
  }
  return getClaim(db, shop.id, id);
}
