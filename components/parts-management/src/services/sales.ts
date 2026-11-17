/**
 * The counter: sales to walk-in and account customers, returns, voids, held
 * sales and quotations, and warranty lookups.
 *
 * Pricing (priceSale), the same for a sale, a held sale and a quote:
 *   each line at its price (the part's retail price unless overridden) less
 *   its own discount; then the discount off the whole sale, spread over the
 *   lines by value; then VAT per line at the part's rate (or the shop's).
 *   A part with a core charge adds a deposit line unless the old unit came
 *   back. A serialized part takes one serial number per unit, one line each.
 *
 * Discounts: how far below list price the sale goes (line discounts, lower
 * prices and the sale discount together), as a percent of the list value.
 * Past the shop's limit it needs a manager: their own role, or their PIN.
 *
 * Payment: split across methods, adding up to the total. ACCOUNT charges the
 * chosen trade or customer account, within its credit. Payments go to the
 * cashier's open drawer.
 *
 * Returns refund what was actually paid for those units (after discounts,
 * with their VAT), restock unless damaged, and never more than was sold. A
 * void takes the whole sale back: stock, account charge and cash.
 */
import { Part, PaymentMethod, Prisma, SaleLineKind, Shop } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { draftInput, draftsQuery, exchangeInput, returnInput, saleInput, salesQuery, voidInput } from '../validation';
import { drawerFor } from './cash';
import { cashOut, issueCredit, redeem, restore } from './credits';
import { assertQuantity, move, moveSellable } from './inventory';
import { checkReturn } from './rules';
import { D, addDays, dayStart, money, takeNumber } from './shared';
import { Actor, approval, audit } from './staff';
import { creditAvailable, getAccount } from './trade';

export const SALE_DETAIL = {
  items: { orderBy: { line: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  returns: { orderBy: { createdAt: 'asc' } },
  account: { select: { id: true, kind: true, garageName: true } },
} satisfies Prisma.SaleInclude;
export type SaleDetail = Prisma.SaleGetPayload<{ include: typeof SALE_DETAIL }>;

const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), D(0));

/** Splits `total` over `weights` to the cent; the last share takes the rounding. */
export function allocate(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  const w = sum(weights);
  if (w.isZero() || total.isZero()) return weights.map(() => D(0));
  const out = weights.map((x) => money(total.mul(x).div(w)));
  const last = out.length - 1;
  out[last] = total.minus(sum(out.slice(0, last)));
  return out;
}

export async function getSale(db: Db, shopId: string, id: string) {
  const sale = await db.sale.findFirst({ where: { id, shopId }, include: SALE_DETAIL });
  if (!sale) throw notFound('Sale');
  return sale;
}

export function listSales(db: Db, shopId: string, q: z.infer<typeof salesQuery>) {
  const contains = q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined;
  return db.sale.findMany({
    where: {
      shopId,
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lt: dayStart(addDays(q.to, 1)) } : {}) } } : {}),
      ...(contains ? { OR: [{ customerName: contains }, { customerPhone: contains }, { plate: contains }, ...(/^\d+$/.test(q.q!) ? [{ number: Number(q.q) }] : [])] } : {}),
    },
    include: SALE_DETAIL,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

// ─── Pricing ────────────────────────────────────────────────────────────────

type LineInput = z.infer<typeof saleInput>['items'][number];

export interface PricedLine {
  kind: SaleLineKind;
  part: Part | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  listPrice: Prisma.Decimal;
  discount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  tax: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  serialNumber: string | null;
  warrantyUntil: Date | null;
  /** Take it from here (otherwise the default location first). */
  locationId: string | null;
}

const addMonths = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
};

export async function priceSale(db: Db, shop: Shop, input: { items: LineInput[]; discount: number }, opts: { needSerials: boolean; now?: Date }) {
  const now = opts.now ?? new Date();
  const ids = input.items.map((i) => i.partId).filter((x): x is string => Boolean(x));
  const parts = ids.length ? await db.part.findMany({ where: { shopId: shop.id, id: { in: ids } } }) : [];
  const byId = new Map(parts.map((p) => [p.id, p]));
  const kitIds = parts.filter((p) => p.isKit).map((p) => p.id);
  const kitCosts = new Map<string, Prisma.Decimal>();
  if (kitIds.length) {
    for (const c of await db.kitComponent.findMany({ where: { kitId: { in: kitIds } }, include: { component: { select: { costPrice: true } } } })) {
      kitCosts.set(c.kitId, (kitCosts.get(c.kitId) ?? D(0)).plus(c.component.costPrice.mul(c.quantity)));
    }
  }
  const lines: Omit<PricedLine, 'tax'>[] = [];

  for (const i of input.items) {
    const qty = D(i.quantity);
    if (!i.partId) {
      if (!i.description) throw new DomainError(422, 'Describe each item, or pick it from stock');
      if (i.unitPrice == null) throw new DomainError(422, `Price "${i.description}"`);
      const price = D(i.unitPrice);
      if (D(i.discount).gt(price.mul(qty))) throw new DomainError(422, `The discount on ${i.description} is more than the line`);
      lines.push({ kind: 'OTHER', part: null, description: i.description, quantity: qty, unitPrice: price, listPrice: price, discount: money(D(i.discount)), taxRate: D(i.taxRate ?? shop.taxRate), unitCost: D(0), serialNumber: null, warrantyUntil: null, locationId: null });
      continue;
    }
    const p = byId.get(i.partId);
    if (!p) throw notFound('Part');
    if (!p.active) throw conflict(`${p.name} is no longer sold`);
    assertQuantity(p.isKit ? { ...p, fractional: false } : p, qty);
    const price = D(i.unitPrice ?? p.retailPrice);
    const discount = money(D(i.discount));
    if (discount.gt(price.mul(qty))) throw new DomainError(422, `The discount on ${p.name} is more than the line`);
    const unitCost = p.isKit ? money(kitCosts.get(p.id) ?? D(0)) : p.costPrice;
    const base = { kind: 'PART' as const, part: p, description: p.name, unitPrice: price, listPrice: p.retailPrice, taxRate: p.taxRate ?? shop.taxRate, unitCost, warrantyUntil: p.warrantyMonths ? addMonths(now, p.warrantyMonths) : null, locationId: i.locationId ?? null };

    if (p.serialized && opts.needSerials) {
      const serials = (i.serialNumbers ?? []).map((s) => s.toUpperCase());
      if (!qty.isInteger() || serials.length !== qty.toNumber()) throw new DomainError(422, `Enter the serial number of each ${p.name} (${qty.toString()})`, 'SERIALS_REQUIRED');
      if (new Set(serials).size !== serials.length) throw new DomainError(422, `The same serial number is entered twice for ${p.name}`);
      const sold = await db.saleItem.findFirst({ where: { serialNumber: { in: serials }, partId: p.id, sale: { shopId: shop.id, voidedAt: null }, returnedQty: 0 }, select: { serialNumber: true } });
      if (sold) throw conflict(`Serial ${sold.serialNumber} of ${p.name} has already been sold`);
      const shares = allocate(discount, serials.map(() => D(1)));
      serials.forEach((serial, k) => lines.push({ ...base, quantity: D(1), discount: shares[k], serialNumber: serial }));
    } else {
      lines.push({ ...base, quantity: qty, discount, serialNumber: null });
    }
    if (p.coreCharge?.gt(0) && !i.coreReturned) {
      lines.push({ kind: 'CORE', part: null, description: `Core deposit: ${p.name}`, quantity: qty, unitPrice: p.coreCharge, listPrice: p.coreCharge, discount: D(0), taxRate: D(0), unitCost: D(0), serialNumber: null, warrantyUntil: null, locationId: null });
    }
  }

  const net = lines.map((l) => l.unitPrice.mul(l.quantity).minus(l.discount));
  const goods = lines.map((l, k) => (l.kind === 'CORE' ? D(0) : net[k]));
  const saleDiscount = money(D(input.discount));
  if (saleDiscount.gt(sum(goods))) throw new DomainError(422, 'The discount is more than the sale');
  const share = allocate(saleDiscount, goods);
  const priced: PricedLine[] = lines.map((l, k) => ({ ...l, tax: money(net[k].minus(share[k]).mul(l.taxRate).div(100)) }));

  const subtotal = money(sum(lines.map((l) => l.unitPrice.mul(l.quantity))));
  const discount = money(sum(lines.map((l) => l.discount)).plus(saleDiscount));
  const tax = sum(priced.map((l) => l.tax));
  const total = subtotal.minus(discount).plus(tax);

  // How far below list price, as a percent of the list value.
  const listValue = sum(lines.filter((l) => l.kind !== 'CORE').map((l) => l.listPrice.mul(l.quantity)));
  const below = sum(lines.map((l, k) => (l.kind === 'CORE' ? D(0) : Prisma.Decimal.max(0, l.listPrice.mul(l.quantity).minus(net[k]))))).plus(saleDiscount);
  const discountPct = listValue.isZero() ? D(0) : below.div(listValue).mul(100);

  return { lines: priced, subtotal, discount, tax, total, discountPct };
}

// ─── Sales ──────────────────────────────────────────────────────────────────

async function accountForCredit(db: Db, shopId: string, accountId: string | null | undefined, amount: Prisma.Decimal) {
  if (!accountId) throw new DomainError(422, 'Choose the account to charge');
  const account = await getAccount(db, shopId, accountId);
  if (account.onHold) throw conflict(`${account.garageName}'s account is on hold`);
  if (account.creditLimit.lte(0)) throw conflict(`${account.garageName} has no credit limit: take payment instead`);
  const available = await creditAvailable(db, account);
  if (available == null) throw conflict(`${account.garageName} has overdue bills: take payment instead`);
  if (available.lt(amount)) throw conflict(`Only ${money(Prisma.Decimal.max(available, 0)).toFixed(2)} of credit left on ${account.garageName}'s account`);
  return account;
}

type SaleOptions = {
  /** Warranty replacements: the price is a warranty decision, not a discount. */
  skipDiscountCheck?: boolean;
  /** An exchange: the sale whose items came back. */
  exchangeOfId?: string;
  /** Stamped on each line instead of the part's own warranty (a warranty replacement keeps the original's). */
  warrantyUntil?: Date | null;
  stockReason?: 'SALE' | 'WARRANTY';
};

export async function createSale(db: Prisma.TransactionClient, shop: Shop, actor: Actor, data: z.infer<typeof saleInput>, opts: SaleOptions = {}) {
  const priced = await priceSale(db, shop, data, { needSerials: true });
  const approvedBy = !opts.skipDiscountCheck && priced.discountPct.gt(shop.maxDiscountPct) ? await approval(db, shop, actor, 'discount', data.approvalPin) : null;

  if (data.taxInvoice) {
    if (!shop.vatNumber) throw conflict('Add your VAT number in the shop settings to issue tax invoices');
    if (!data.customerName) throw new DomainError(422, "A tax invoice needs the buyer's name");
  }

  const payments = data.payments ?? (priced.total.gt(0) ? [{ method: data.paymentMethod!, amount: priced.total.toNumber(), reference: null }] : []);
  const paid = money(sum(payments.map((p) => D(p.amount))));
  if (!paid.equals(priced.total)) throw new DomainError(422, `The payments add up to ${paid.toFixed(2)} but the total is ${priced.total.toFixed(2)}`);
  const byMethod = (m: PaymentMethod) => sum(payments.filter((p) => p.method === m).map((p) => D(p.amount)));
  const cashDue = byMethod('CASH');
  if (data.tendered != null && cashDue.gt(0) && D(data.tendered).lt(cashDue)) throw new DomainError(422, 'Cash handed over is less than the cash due');
  const onAccount = byMethod('ACCOUNT');
  const account = onAccount.gt(0) ? await accountForCredit(db, shop.id, data.accountId, onAccount) : data.accountId ? await getAccount(db, shop.id, data.accountId) : null;

  const draft = data.draftId ? await db.saleDraft.findFirst({ where: { id: data.draftId, shopId: shop.id } }) : null;
  if (data.draftId && (!draft || draft.status !== 'OPEN')) throw conflict('That held sale or quote has already been completed or cancelled');

  const drawer = await drawerFor(db, shop, actor, cashDue.gt(0));
  const number = await takeNumber(db, shop.id, 'sale');
  const sale = await db.sale.create({
    data: {
      shopId: shop.id,
      number,
      customerName: data.customerName ?? account?.garageName ?? null,
      customerPhone: data.customerPhone ?? account?.garagePhone ?? null,
      customerAddress: data.customerAddress ?? null,
      customerVatNo: data.customerVatNo ?? null,
      plate: data.plate ?? null,
      accountId: account?.id ?? null,
      taxInvoice: data.taxInvoice,
      subtotal: priced.subtotal,
      discount: priced.discount,
      tax: priced.tax,
      total: priced.total,
      tendered: data.tendered == null || !cashDue.gt(0) ? null : D(data.tendered),
      note: data.note ?? null,
      cashierUserId: actor.userId,
      cashierName: actor.name,
      approvedByName: approvedBy,
      draftId: draft?.id ?? null,
      exchangeOfId: opts.exchangeOfId ?? null,
      items: {
        create: priced.lines.map((l, line) => ({
          line,
          kind: l.kind,
          partId: l.part?.id ?? null,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          listPrice: l.listPrice,
          discount: l.discount,
          taxRate: l.taxRate,
          tax: l.tax,
          unitCost: l.unitCost,
          serialNumber: l.serialNumber,
          warrantyUntil: opts.warrantyUntil !== undefined && l.part ? opts.warrantyUntil : l.warrantyUntil,
        })),
      },
      payments: { create: payments.map((p) => ({ method: p.method, amount: money(D(p.amount)), reference: p.method === 'VOUCHER' ? (p.reference ?? '').trim().toUpperCase() : p.reference ?? null, cashSessionId: drawer })) },
    },
  });
  for (const p of payments.filter((x) => x.method === 'VOUCHER')) await redeem(db, shop.id, p.reference, money(D(p.amount)), sale.id, actor.name);
  for (const l of priced.lines) if (l.part) await moveSellable(db, l.part, l.quantity.negated(), opts.stockReason ?? 'SALE', { saleId: sale.id, note: `Sale #${number}`, byName: actor.name, locationId: l.locationId });
  if (account && onAccount.gt(0)) {
    await db.accountEntry.create({ data: { accountId: account.id, kind: 'CHARGE', amount: onAccount, saleId: sale.id, note: `Counter sale #${number}`, byName: actor.name } });
  }
  if (draft) await db.saleDraft.update({ where: { id: draft.id }, data: { status: 'CONVERTED', saleId: sale.id } });

  const extras = [approvedBy ? `discount ${priced.discountPct.toFixed(1)}% approved by ${approvedBy}` : null, onAccount.gt(0) ? `${onAccount.toFixed(2)} on ${account!.garageName}'s account` : null].filter(Boolean);
  await audit(db, shop.id, actor, 'sale', `Sale #${number}, ${priced.total.toFixed(2)}${extras.length ? ` (${extras.join('; ')})` : ''}`, { entity: 'sale', entityId: sale.id, amount: priced.total });
  return getSale(db, shop.id, sale.id);
}

/** What each unit of each line actually cost the customer: after both discounts, with its VAT. */
function paidPerUnit(sale: SaleDetail) {
  const net = sale.items.map((i) => i.unitPrice.mul(i.quantity).minus(i.discount));
  const saleDiscount = sale.discount.minus(sum(sale.items.map((i) => i.discount)));
  const share = allocate(Prisma.Decimal.max(saleDiscount, 0), sale.items.map((i, k) => (i.kind === 'CORE' ? D(0) : net[k])));
  return new Map(sale.items.map((i, k) => [i.id, net[k].minus(share[k]).plus(i.tax).div(i.quantity)]));
}

type ReturnOptions = { skipApproval?: boolean; label?: string };

/**
 * Takes items back: checks the shop's return rules (an override needs the
 * owner or a manager), keeps any restocking fee, refunds the rest by the
 * chosen method (VOUCHER issues store credit), and restocks unless damaged.
 */
async function takeBack(db: Prisma.TransactionClient, shop: Shop, actor: Actor, saleId: string, data: z.infer<typeof returnInput>, opts: ReturnOptions = {}) {
  let approvedBy = opts.skipApproval ? null : await approval(db, shop, actor, 'refund', data.approvalPin);
  const sale = await getSale(db, shop.id, saleId);
  if (sale.voidedAt) throw conflict('This sale was voided');
  if (data.refundMethod === 'ACCOUNT' && !sale.accountId) throw new DomainError(422, "This sale wasn't charged to an account");
  const byId = new Map(sale.items.map((i) => [i.id, i]));

  const rules = await checkReturn(
    db,
    shop.id,
    sale.createdAt,
    data.items.map((r) => {
      const item = byId.get(r.saleItemId);
      if (!item) throw notFound('Sale line');
      return { saleItemId: item.id, description: item.description, partId: item.partId };
    }),
  );
  if (rules.problems.length && !data.override) throw new DomainError(409, `${rules.problems.join('; ')}. The owner or a manager can override this`, 'RETURN_RULE');
  // Overriding a rule or waiving a fee is a manager's call, even inside an exchange.
  if ((rules.problems.length && data.override) || (data.waiveFee && rules.feePct.size)) approvedBy = (await approval(db, shop, actor, 'refund', data.approvalPin)) ?? approvedBy;

  const perUnit = paidPerUnit(sale);
  const out: { saleItemId: string; description: string; quantity: number; unitPrice: number; refund: number; fee: number; restock: boolean }[] = [];
  let total = D(0);
  let fee = D(0);
  for (const r of data.items) {
    const item = byId.get(r.saleItemId)!;
    const qty = D(r.quantity);
    if (item.returnedQty.plus(qty).gt(item.quantity)) throw conflict(`Only ${item.quantity.minus(item.returnedQty).toString()} of ${item.description} can still be returned`);
    await db.saleItem.update({ where: { id: item.id }, data: { returnedQty: item.returnedQty.plus(qty) } });
    const refund = money(perUnit.get(item.id)!.mul(qty));
    const lineFee = data.waiveFee ? D(0) : money(refund.mul(rules.feePct.get(item.id) ?? D(0)).div(100));
    total = total.plus(refund);
    fee = fee.plus(lineFee);
    out.push({ saleItemId: item.id, description: item.description, quantity: r.quantity, unitPrice: item.unitPrice.toNumber(), refund: refund.minus(lineFee).toNumber(), fee: lineFee.toNumber(), restock: r.restock });
  }
  // Rounding never gives back more than was paid.
  const left = sale.total.minus(sum(sale.returns.map((x) => x.total.plus(x.fee))));
  total = Prisma.Decimal.min(money(total), left);
  const refund = Prisma.Decimal.max(total.minus(fee), 0);

  const drawer = await drawerFor(db, shop, actor, data.refundMethod === 'CASH' && refund.gt(0));
  const number = await takeNumber(db, shop.id, 'return');
  const ret = await db.saleReturn.create({
    data: {
      shopId: shop.id, saleId, number, lines: out, total: refund, fee, overridden: rules.problems.length > 0, refundMethod: data.refundMethod,
      reason: data.reason ?? null, byName: actor.name, approvedByName: approvedBy, cashSessionId: data.refundMethod === 'CASH' ? drawer : null,
    },
  });
  if (data.refundMethod === 'ACCOUNT' && refund.gt(0)) {
    await db.accountEntry.create({ data: { accountId: sale.accountId!, kind: 'ADJUSTMENT', amount: refund.negated(), saleId, note: `Return #${number} from sale #${sale.number}`, byName: actor.name } });
  }
  const credit = data.refundMethod === 'VOUCHER' && refund.gt(0)
    ? await issueCredit(db, shop.id, actor, refund, { customerName: sale.customerName, customerPhone: sale.customerPhone, note: `${opts.label ?? 'Return'} #${number} from sale #${sale.number}`, returnId: ret.id })
    : null;
  if (credit) await db.saleReturn.update({ where: { id: ret.id }, data: { storeCreditId: credit.id } });
  for (const r of data.items) {
    const item = byId.get(r.saleItemId)!;
    if (!item.partId || !r.restock) continue;
    const part = await db.part.findUnique({ where: { id: item.partId } });
    if (part) await moveSellable(db, part, D(r.quantity), 'RETURN', { unitCost: part.isKit ? undefined : item.unitCost, saleId, returnId: ret.id, note: `Return #${number} (sale #${sale.number})`, byName: actor.name });
  }
  const how = data.refundMethod === 'VOUCHER' ? `as store credit ${credit?.code ?? ''}`.trim() : `by ${data.refundMethod.toLowerCase().replace('_', ' ')}`;
  await audit(
    db, shop.id, actor, 'sale.return',
    `${opts.label ?? 'Return'} #${number} from sale #${sale.number}: ${refund.toFixed(2)} refunded ${how}${fee.gt(0) ? `, ${fee.toFixed(2)} restocking fee kept` : ''}${rules.problems.length ? ' (return rules overridden)' : ''}${approvedBy ? `, approved by ${approvedBy}` : ''}`,
    { entity: 'sale', entityId: saleId, amount: refund },
  );
  return { ret, credit, refund, sale };
}

export async function createReturn(db: Prisma.TransactionClient, shop: Shop, actor: Actor, saleId: string, data: z.infer<typeof returnInput>) {
  await takeBack(db, shop, actor, saleId, data);
  return getSale(db, shop.id, saleId);
}

/**
 * An exchange in one go: what comes back becomes store credit, which pays for
 * what the customer takes instead. They pay any difference; if what came back
 * is worth more, the rest stays as store credit or is refunded (a refund in
 * money needs the owner or a manager, as for any refund).
 */
export async function exchange(db: Prisma.TransactionClient, shop: Shop, actor: Actor, saleId: string, data: z.infer<typeof exchangeInput>) {
  const { ret, credit, refund, sale: original } = await takeBack(
    db, shop, actor, saleId,
    { items: data.returnItems, refundMethod: 'VOUCHER', reason: data.reason ?? 'Exchange', override: data.override, waiveFee: data.waiveFee, approvalPin: data.approvalPin },
    { skipApproval: true, label: 'Exchange' },
  );
  const priced = await priceSale(db, shop, { items: data.items, discount: data.discount }, { needSerials: true });
  const use = Prisma.Decimal.min(refund, priced.total);
  const rest = priced.total.minus(use);
  const extra = rest.gt(0) ? data.payments ?? (data.paymentMethod ? [{ method: data.paymentMethod, amount: rest.toNumber(), reference: null }] : null) : [];
  if (!extra) throw new DomainError(422, `The new items cost ${rest.toFixed(2)} more: choose how that's paid`, 'DIFFERENCE_DUE');
  const sale = await createSale(
    db, shop, actor,
    {
      items: data.items,
      discount: data.discount,
      payments: [...(use.gt(0) ? [{ method: 'VOUCHER' as const, amount: use.toNumber(), reference: credit!.code }] : []), ...extra],
      tendered: data.tendered,
      accountId: original.accountId,
      customerName: original.customerName,
      customerPhone: original.customerPhone,
      plate: original.plate,
      taxInvoice: false,
      note: `Exchange for sale #${original.number}`,
      approvalPin: data.approvalPin,
    },
    { exchangeOfId: saleId },
  );
  await db.saleReturn.update({ where: { id: ret.id }, data: { reason: `Exchanged for sale #${sale.number}` } });

  // What came back was worth more: keep it as credit, or pay it out.
  const leftover = refund.minus(use);
  let paidOut = D(0);
  if (leftover.gt(0) && data.balanceTo !== 'VOUCHER') {
    await approval(db, shop, actor, 'refund', data.approvalPin);
    if (data.balanceTo === 'ACCOUNT') {
      if (!original.accountId) throw new DomainError(422, "The original sale wasn't on an account");
      await db.accountEntry.create({ data: { accountId: original.accountId, kind: 'ADJUSTMENT', amount: leftover.negated(), saleId, note: `Exchange: rest of return #${ret.number}`, byName: actor.name } });
    }
    const drawer = await drawerFor(db, shop, actor, data.balanceTo === 'CASH');
    await cashOut(db, credit!.id, leftover, data.balanceTo, data.balanceTo === 'CASH' ? drawer : null, actor.name);
    paidOut = leftover;
  }
  await audit(
    db, shop.id, actor, 'sale.exchange',
    `Exchange on sale #${original.number}: ${refund.toFixed(2)} back, new sale #${sale.number} ${priced.total.toFixed(2)}${rest.gt(0) ? `, ${rest.toFixed(2)} paid` : ''}${leftover.gt(0) ? (paidOut.gt(0) ? `, ${leftover.toFixed(2)} refunded` : `, ${leftover.toFixed(2)} left as store credit ${credit!.code}`) : ''}`,
    { entity: 'sale', entityId: sale.id, amount: priced.total.minus(refund) },
  );
  return {
    original: await getSale(db, shop.id, saleId),
    sale,
    credit: credit ? await db.storeCredit.findUniqueOrThrow({ where: { id: credit.id }, include: { entries: { orderBy: { createdAt: 'asc' } } } }) : null,
    returned: refund,
    due: rest,
    refunded: paidOut,
  };
}

/**
 * Takes a whole sale back, as if it never happened: stock returns to the
 * shelf, an account charge is reversed, store credit used is given back, and
 * cash paid goes out of the voiding person's drawer. Not once items have been
 * returned (return the rest).
 */
export async function voidSale(db: Prisma.TransactionClient, shop: Shop, actor: Actor, saleId: string, data: z.infer<typeof voidInput>) {
  const approvedBy = await approval(db, shop, actor, 'void', data.approvalPin);
  const sale = await getSale(db, shop.id, saleId);
  if (sale.voidedAt) throw conflict('This sale is already voided');
  if (sale.returns.length) throw conflict('Items were returned from this sale: return the rest instead of voiding it');

  // Back to exactly where each item was taken from.
  const taken = await db.stockMovement.findMany({ where: { saleId, reason: { in: ['SALE', 'WARRANTY'] } } });
  for (const m of taken) {
    const part = await db.part.findUnique({ where: { id: m.partId } });
    const back = m.locationId && (await db.location.findFirst({ where: { id: m.locationId, active: true }, select: { id: true } })) ? m.locationId : undefined;
    if (part) await move(db, part, m.quantityChange.negated(), 'VOID', { unitCost: m.unitCost, saleId, note: `Sale #${sale.number} voided`, byName: actor.name, locationId: back });
  }
  const onAccount = sum(sale.payments.filter((p) => p.method === 'ACCOUNT').map((p) => p.amount));
  if (onAccount.gt(0) && sale.accountId) {
    await db.accountEntry.create({ data: { accountId: sale.accountId, kind: 'ADJUSTMENT', amount: onAccount.negated(), saleId, note: `Sale #${sale.number} voided`, byName: actor.name } });
  }
  for (const p of sale.payments.filter((x) => x.method === 'VOUCHER' && x.reference)) await restore(db, shop.id, p.reference!, p.amount, saleId, actor.name);
  const cash = sum(sale.payments.filter((p) => p.method === 'CASH').map((p) => p.amount));
  if (cash.gt(0)) {
    const drawer = await drawerFor(db, shop, actor, true);
    if (drawer) await db.cashMovement.create({ data: { sessionId: drawer, kind: 'PAY_OUT', amount: cash, reason: `Sale #${sale.number} voided`, byName: actor.name } });
  }
  await db.sale.update({ where: { id: saleId }, data: { voidedAt: new Date(), voidedByName: approvedBy ? `${actor.name} (approved by ${approvedBy})` : actor.name, voidReason: data.reason } });
  await audit(db, shop.id, actor, 'sale.void', `Voided sale #${sale.number} (${sale.total.toFixed(2)}): ${data.reason}${approvedBy ? `, approved by ${approvedBy}` : ''}`, { entity: 'sale', entityId: saleId, amount: sale.total });
  return getSale(db, shop.id, saleId);
}

// ─── Held sales and quotations ──────────────────────────────────────────────

export async function saveDraft(db: Prisma.TransactionClient, shop: Shop, actor: Actor, data: z.infer<typeof draftInput>) {
  const priced = await priceSale(db, shop, data, { needSerials: false });
  const quote = data.kind === 'QUOTE';
  const draft = await db.saleDraft.create({
    data: {
      shopId: shop.id,
      kind: data.kind,
      number: quote ? await takeNumber(db, shop.id, 'quote') : null,
      customerName: data.customerName ?? null,
      customerPhone: data.customerPhone ?? null,
      plate: data.plate ?? null,
      input: {
        items: data.items,
        discount: data.discount,
        accountId: data.accountId ?? null,
        customerAddress: data.customerAddress ?? null,
        customerVatNo: data.customerVatNo ?? null,
        note: data.note ?? null,
        lines: priced.lines.map((l) => ({ kind: l.kind, partId: l.part?.id ?? null, description: l.description, quantity: l.quantity.toNumber(), unitPrice: l.unitPrice.toNumber(), discount: l.discount.toNumber(), taxRate: l.taxRate.toNumber(), tax: l.tax.toNumber() })),
      } as Prisma.InputJsonValue,
      subtotal: priced.subtotal,
      discount: priced.discount,
      tax: priced.tax,
      total: priced.total,
      validUntil: quote ? new Date(Date.now() + data.validDays * 86_400_000) : null,
      createdByName: actor.name,
    },
  });
  if (quote) await audit(db, shop.id, actor, 'quote', `Quotation #${draft.number}, ${priced.total.toFixed(2)}${data.customerName ? ` for ${data.customerName}` : ''}`, { entity: 'quote', entityId: draft.id, amount: priced.total });
  return draft;
}

export function listDrafts(db: Db, shopId: string, q: z.infer<typeof draftsQuery>) {
  return db.saleDraft.findMany({ where: { shopId, status: q.status, ...(q.kind ? { kind: q.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
}

export async function getDraft(db: Db, shopId: string, id: string) {
  const d = await db.saleDraft.findFirst({ where: { id, shopId } });
  if (!d) throw notFound('Held sale or quote');
  return d;
}

export async function cancelDraft(db: Db, shopId: string, id: string) {
  const d = await getDraft(db, shopId, id);
  if (d.status !== 'OPEN') throw conflict('Already completed or cancelled');
  return db.saleDraft.update({ where: { id }, data: { status: 'CANCELLED' } });
}

// ─── Warranty ───────────────────────────────────────────────────────────────

/** Sold items with a serial number or a warranty, by serial number or sale number. */
export function warrantyLookup(db: Db, shopId: string, q: string) {
  const asNumber = /^\d+$/.test(q) ? Number(q) : null;
  return db.saleItem.findMany({
    where: {
      sale: { shopId },
      OR: [{ serialNumber: { equals: q, mode: 'insensitive' } }, ...(asNumber ? [{ sale: { shopId, number: asNumber }, OR: [{ warrantyUntil: { not: null } }, { serialNumber: { not: null } }] }] : [])],
    },
    include: { sale: { select: { id: true, number: true, createdAt: true, customerName: true, customerPhone: true, voidedAt: true } } },
    orderBy: { sale: { createdAt: 'desc' } },
    take: 50,
  });
}
