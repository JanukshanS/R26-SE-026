/**
 * Customer-owned parts the garage is holding: a customer brings their own
 * battery or brake pads to be fitted, or parts are set aside for a job. They
 * are never counted in the garage's own stock, priced or invoiced as stock.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { heldInput, heldPatch } from '../validation';
import { D, assertCustomer, assertLocation, assertVehicle } from './shared';

const include = { customer: true, vehicle: true, jobCard: true, location: true };
export type HeldRow = Prisma.HeldItemGetPayload<{ include: typeof include }>;

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export function listHeld(db: Db, garageId: string, opts: { status?: string; q?: string }): Promise<HeldRow[]> {
  const where: Prisma.HeldItemWhereInput = {
    garageId,
    ...(opts.status === 'open' || !opts.status ? { status: 'HELD' } : { status: opts.status as never }),
    ...(opts.q ? { OR: [{ name: contains(opts.q) }, { note: contains(opts.q) }, { customer: { name: contains(opts.q) } }, { vehicle: { plate: contains(opts.q) } }] } : {}),
  };
  return db.heldItem.findMany({ where, orderBy: { receivedAt: 'desc' }, include, take: 300 });
}

export async function getHeld(db: Db, garageId: string, id: string): Promise<HeldRow> {
  const row = await db.heldItem.findFirst({ where: { id, garageId }, include });
  if (!row) throw notFound('Held part');
  return row;
}

async function assertJob(db: Db, garageId: string, jobCardId: string | null | undefined) {
  if (!jobCardId) return;
  const found = await db.jobCard.findFirst({ where: { id: jobCardId, garageId }, select: { id: true } });
  if (!found) throw notFound('Job card');
}

export async function createHeld(db: Db, garageId: string, data: z.infer<typeof heldInput>) {
  await assertCustomer(db, garageId, data.customerId);
  await assertVehicle(db, garageId, data.vehicleId);
  await assertJob(db, garageId, data.jobCardId);
  await assertLocation(db, garageId, data.locationId);
  const row = await db.heldItem.create({ data: { ...data, quantity: D(data.quantity), garageId } });
  return getHeld(db, garageId, row.id);
}

export async function updateHeld(db: Db, garageId: string, id: string, data: z.infer<typeof heldPatch>) {
  const before = await getHeld(db, garageId, id);
  if (before.status !== 'HELD' && data.status === undefined) throw conflict('This part has already been closed out');
  if (data.customerId !== undefined) await assertCustomer(db, garageId, data.customerId);
  if (data.vehicleId !== undefined) await assertVehicle(db, garageId, data.vehicleId);
  if (data.jobCardId !== undefined) await assertJob(db, garageId, data.jobCardId);
  if (data.locationId !== undefined) await assertLocation(db, garageId, data.locationId);
  const { quantity, status, ...rest } = data;
  await db.heldItem.update({
    where: { id },
    data: {
      ...rest,
      ...(quantity !== undefined ? { quantity: D(quantity) } : {}),
      ...(status !== undefined ? { status, closedAt: status === 'HELD' ? null : (before.closedAt ?? new Date()) } : {}),
    },
  });
  return getHeld(db, garageId, id);
}
