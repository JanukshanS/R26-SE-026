/** Helpers shared by the service modules: money, numbering and codes. */
import { randomInt } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { config } from '../config';
import { Db } from '../utils/prisma';

export const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
export const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toNumber());

const COUNTERS = {
  sale: 'next_sale_number',
  order: 'next_order_number',
  purchase: 'next_purchase_number',
  return: 'next_return_number',
  session: 'next_session_number',
  quote: 'next_quote_number',
  count: 'next_count_number',
  supplierReturn: 'next_supplier_return_number',
  barcode: 'next_barcode_number',
  claim: 'next_claim_number',
} as const;

/**
 * The next sale, order, purchase or return number for a shop, gap-free. One
 * UPDATE … RETURNING is atomic, so two tills can never get the same number.
 */
export async function takeNumber(db: Db, shopId: string, kind: keyof typeof COUNTERS): Promise<number> {
  const col = Prisma.raw(`"${COUNTERS[kind]}"`);
  const rows = await db.$queryRaw<{ n: number }[]>`UPDATE "shops" SET ${col} = ${col} + 1 WHERE "id" = ${shopId} RETURNING ${col} - 1 AS n`;
  return Number(rows[0].n);
}

/** A code the collector can read out: 6 digits. */
export const newHandoverCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Letters and digits only, so "WP-CAB-1234" and "WPCAB1234" match. */
export const compactPlate = (plate: string | null | undefined): string | null => {
  const c = (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c || null;
};

// ─── Shop time ──────────────────────────────────────────────────────────────

const offsetMs = () => config.timeZoneOffsetMinutes * 60_000;
/** "2026-11-16" (shop time) → the UTC instant its day starts. */
export const dayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - offsetMs());
export const localDay = (d: Date) => new Date(d.getTime() + offsetMs()).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ─── Ageing ─────────────────────────────────────────────────────────────────

export type Ageing = { current: Prisma.Decimal; d1_30: Prisma.Decimal; d31_60: Prisma.Decimal; d61_90: Prisma.Decimal; d90plus: Prisma.Decimal; overdue: Prisma.Decimal; oldestOverdue: Date | null };

/**
 * Splits what's still owed by how late it is. Credits (payments, credit
 * notes) settle the oldest charges first; a charge is late once its due date
 * has passed.
 */
export function age(charges: { amount: Prisma.Decimal; due: Date }[], credits: Prisma.Decimal, now = new Date()): Ageing {
  const out: Ageing = { current: D(0), d1_30: D(0), d31_60: D(0), d61_90: D(0), d90plus: D(0), overdue: D(0), oldestOverdue: null };
  let credit = credits;
  for (const c of [...charges].sort((a, b) => a.due.getTime() - b.due.getTime())) {
    const covered = Prisma.Decimal.min(credit, c.amount);
    credit = credit.minus(covered);
    const left = c.amount.minus(covered);
    if (!left.gt(0)) continue;
    const late = Math.floor((now.getTime() - c.due.getTime()) / 86_400_000);
    if (late <= 0) {
      out.current = out.current.plus(left);
      continue;
    }
    out.overdue = out.overdue.plus(left);
    out.oldestOverdue ??= c.due;
    if (late <= 30) out.d1_30 = out.d1_30.plus(left);
    else if (late <= 60) out.d31_60 = out.d31_60.plus(left);
    else if (late <= 90) out.d61_90 = out.d61_90.plus(left);
    else out.d90plus = out.d90plus.plus(left);
  }
  return out;
}

export const presentAgeing = (a: Ageing) => ({
  current: money(a.current).toNumber(),
  d1_30: money(a.d1_30).toNumber(),
  d31_60: money(a.d31_60).toNumber(),
  d61_90: money(a.d61_90).toNumber(),
  d90plus: money(a.d90plus).toNumber(),
  overdue: money(a.overdue).toNumber(),
  oldestOverdue: a.oldestOverdue,
});
