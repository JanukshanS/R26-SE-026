/** Helpers shared by the service modules: ownership checks, numbering, events and money. */
import { randomBytes, randomInt } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { Db } from '../utils/prisma';
import { notFound } from '../utils/http';

export const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);

export function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Hand out the next job or invoice number for a garage, gap-free.
 *
 * A single UPDATE ... RETURNING is atomic in Postgres, so two people creating
 * jobs at the same moment can never receive the same number, with no explicit
 * lock and no read-then-write race.
 */
export async function takeNumber(db: Db, garageId: string, kind: 'job' | 'invoice'): Promise<number> {
  const rows =
    kind === 'job'
      ? await db.$queryRaw<{ n: number }[]>`UPDATE "garages" SET "next_job_number" = "next_job_number" + 1 WHERE "id" = ${garageId} RETURNING "next_job_number" - 1 AS n`
      : await db.$queryRaw<{ n: number }[]>`UPDATE "garages" SET "next_invoice_number" = "next_invoice_number" + 1 WHERE "id" = ${garageId} RETURNING "next_invoice_number" - 1 AS n`;
  return Number(rows[0].n);
}

/** Record a domain event in the same transaction as the change (see OutboxEvent in the schema). */
export async function emit(db: Db, garageId: string, eventType: string, payload: Prisma.InputJsonObject): Promise<void> {
  await db.outboxEvent.create({ data: { garageId, eventType, payload } });
}

/** A customer or vehicle id from the request must belong to this garage; others look like they don't exist. */
export async function assertCustomer(db: Db, garageId: string, customerId: string | null | undefined): Promise<void> {
  if (!customerId) return;
  const found = await db.customer.findFirst({ where: { id: customerId, garageId }, select: { id: true } });
  if (!found) throw notFound('Customer');
}

export async function assertVehicle(db: Db, garageId: string, vehicleId: string | null | undefined): Promise<void> {
  if (!vehicleId) return;
  const found = await db.vehicle.findFirst({ where: { id: vehicleId, garageId }, select: { id: true } });
  if (!found) throw notFound('Vehicle');
}

/** 'cab 1234', 'CAB-1234' and 'cab1234' are the same car: store 'CAB-1234'. */
export function normalisePlate(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const compact = plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact) return null;
  const match = /^([A-Z]+)(\d+)$/.exec(compact);
  return match ? `${match[1]}-${match[2]}` : compact;
}

export async function assertMechanic(db: Db, garageId: string, mechanicId: string | null | undefined): Promise<void> {
  if (!mechanicId) return;
  const found = await db.staffMember.findFirst({ where: { id: mechanicId, garageId }, select: { id: true } });
  if (!found) throw notFound('Mechanic');
}

export async function assertSupplier(db: Db, garageId: string, supplierId: string | null | undefined): Promise<void> {
  if (!supplierId) return;
  const found = await db.supplier.findFirst({ where: { id: supplierId, garageId }, select: { id: true } });
  if (!found) throw notFound('Supplier');
}

/** 128 random bits for a customer tracking link: unguessable, and short enough to text. */
export const newTrackingToken = () => randomBytes(16).toString('base64url');

/** An invite code a mechanic can read out or type: no 0/O or 1/I to confuse. */
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newInviteCode = () => Array.from({ length: 8 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');
