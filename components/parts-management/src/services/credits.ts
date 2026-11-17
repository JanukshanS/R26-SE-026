/**
 * Store credit: what the shop owes a walk-in customer after a return or an
 * exchange, spent later at the counter with its code (payment method VOUCHER).
 *
 * Each credit has a ledger: ISSUE (+), REDEEM (−, a sale paid with it),
 * RESTORE (+, that sale was voided), CASH_OUT (−, the balance refunded),
 * CANCEL (−). The balance is kept on the credit and never goes below zero.
 */
import { randomInt } from 'node:crypto';

import { PaymentMethod, Prisma } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { creditsQuery } from '../validation';
import { D, money } from './shared';
import { Actor, audit } from './staff';

// No 0/O or 1/I: read out over the counter.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => `SC-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

export async function issueCredit(
  db: Db,
  shopId: string,
  actor: Pick<Actor, 'userId' | 'name'>,
  amount: Prisma.Decimal,
  who: { customerName?: string | null; customerPhone?: string | null; note?: string | null; returnId?: string | null },
) {
  for (;;) {
    const code = newCode();
    if (await db.storeCredit.findUnique({ where: { shopId_code: { shopId, code } } })) continue;
    const credit = await db.storeCredit.create({
      data: {
        shopId,
        code,
        customerName: who.customerName ?? null,
        customerPhone: who.customerPhone ?? null,
        amount: money(amount),
        balance: money(amount),
        note: who.note ?? null,
        byName: actor.name,
        entries: { create: { amount: money(amount), kind: 'ISSUE', returnId: who.returnId ?? null, byName: actor.name } },
      },
    });
    await audit(db, shopId, actor, 'credit.issue', `Issued store credit ${code}: ${money(amount).toFixed(2)}${who.customerName ? ` for ${who.customerName}` : ''}`, { entity: 'credit', entityId: credit.id, amount });
    return credit;
  }
}

/** Takes `amount` off a credit for a sale. */
export async function redeem(db: Db, shopId: string, code: string | null | undefined, amount: Prisma.Decimal, saleId: string, byName: string) {
  if (!code) throw new DomainError(422, 'Enter the store credit code');
  const credit = await db.storeCredit.findUnique({ where: { shopId_code: { shopId, code: code.trim().toUpperCase() } } });
  if (!credit) throw notFound(`Store credit ${code}`);
  if (credit.status !== 'ACTIVE') throw conflict(`Store credit ${credit.code} is ${credit.status.toLowerCase()}`);
  if (credit.expiresAt && credit.expiresAt < new Date()) throw conflict(`Store credit ${credit.code} has expired`);
  const updated = await db.$executeRaw`UPDATE "store_credits" SET "balance" = "balance" - ${amount}, "status" = CASE WHEN "balance" - ${amount} = 0 THEN 'USED'::"StoreCreditStatus" ELSE "status" END WHERE "id" = ${credit.id} AND "balance" >= ${amount}`;
  if (!updated) throw conflict(`Only ${credit.balance.toFixed(2)} left on store credit ${credit.code}`);
  await db.storeCreditEntry.create({ data: { creditId: credit.id, amount: amount.negated(), kind: 'REDEEM', saleId, byName } });
  return credit;
}

/** A voided sale gives back what it took from a credit. */
export async function restore(db: Db, shopId: string, code: string, amount: Prisma.Decimal, saleId: string, byName: string) {
  const credit = await db.storeCredit.findUnique({ where: { shopId_code: { shopId, code } } });
  if (!credit) return;
  await db.storeCredit.update({ where: { id: credit.id }, data: { balance: credit.balance.plus(amount), status: credit.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' } });
  await db.storeCreditEntry.create({ data: { creditId: credit.id, amount, kind: 'RESTORE', saleId, byName } });
}

/** Pays out (part of) a credit's balance: an exchange's leftover refunded in money. */
export async function cashOut(db: Db, creditId: string, amount: Prisma.Decimal, method: PaymentMethod, drawer: string | null, byName: string) {
  const credit = await db.storeCredit.findUniqueOrThrow({ where: { id: creditId } });
  if (credit.balance.lt(amount)) throw conflict('More than the credit holds');
  const balance = credit.balance.minus(amount);
  await db.storeCredit.update({ where: { id: creditId }, data: { balance, status: balance.isZero() ? 'USED' : credit.status } });
  await db.storeCreditEntry.create({ data: { creditId, amount: amount.negated(), kind: 'CASH_OUT', method, cashSessionId: drawer, byName } });
}

export function listCredits(db: Db, shopId: string, q: z.infer<typeof creditsQuery>) {
  const contains = q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined;
  return db.storeCredit.findMany({
    where: { shopId, ...(q.status ? { status: q.status } : {}), ...(contains ? { OR: [{ code: contains }, { customerName: contains }, { customerPhone: contains }] } : {}) },
    include: { entries: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function findCredit(db: Db, shopId: string, code: string) {
  const c = await db.storeCredit.findUnique({ where: { shopId_code: { shopId, code: code.trim().toUpperCase() } }, include: { entries: { orderBy: { createdAt: 'asc' } } } });
  if (!c) throw notFound(`Store credit ${code}`);
  return c;
}

export async function cancelCredit(db: Db, shopId: string, actor: Actor, id: string, note: string) {
  const c = await db.storeCredit.findFirst({ where: { id, shopId } });
  if (!c) throw notFound('Store credit');
  if (c.status !== 'ACTIVE') throw conflict(`Store credit ${c.code} is ${c.status.toLowerCase()}`);
  await db.storeCredit.update({ where: { id }, data: { status: 'CANCELLED', balance: D(0), note: [c.note, note].filter(Boolean).join('\n') } });
  if (c.balance.gt(0)) await db.storeCreditEntry.create({ data: { creditId: id, amount: c.balance.negated(), kind: 'CANCEL', byName: actor.name } });
  await audit(db, shopId, actor, 'credit.cancel', `Cancelled store credit ${c.code} (${c.balance.toFixed(2)} left): ${note}`, { entity: 'credit', entityId: id, amount: c.balance });
  return findCredit(db, shopId, c.code);
}
