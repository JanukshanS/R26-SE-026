/**
 * The garage's tools and equipment: lifts, scanners, jacks, compressors, hand
 * tools. Each asset knows where it lives, who has it out, its condition and
 * when it is next due a service; every change leaves a line in its log.
 */
import { Asset, AssetCondition, AssetLogType, Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { assetCheckInInput, assetCheckOutInput, assetInput, assetPatch, assetServiceInput } from '../validation';
import { assertLocation, dateOnlyToDate, garageToday } from './shared';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });
const DAY_MS = 86_400_000;

/** Days from `from` (YYYY-MM-DD) to a date column. Negative = overdue. */
export function daysUntil(due: Date | null, today = garageToday()): number | null {
  if (!due) return null;
  return Math.round((due.getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) / DAY_MS);
}

export type AssetRow = Prisma.AssetGetPayload<{ include: { location: true; heldBy: true } }>;
const include = { location: true, heldBy: true };

export async function listAssets(db: Db, garageId: string, opts: { q?: string; category?: string; status?: string; includeInactive: boolean }): Promise<AssetRow[]> {
  const where: Prisma.AssetWhereInput = {
    garageId,
    ...(opts.includeInactive ? {} : { active: true }),
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.status === 'out' ? { heldById: { not: null } } : {}),
    ...(opts.status === 'available' ? { heldById: null, condition: { not: 'RETIRED' } } : {}),
    ...(opts.status === 'attention' ? { condition: 'NEEDS_REPAIR' } : {}),
    ...(opts.q ? { OR: [{ name: contains(opts.q) }, { tag: contains(opts.q) }, { serialNo: contains(opts.q) }, { category: contains(opts.q) }] } : {}),
  };
  const rows = await db.asset.findMany({ where, orderBy: { name: 'asc' }, include, take: 500 });
  if (opts.status !== 'due') return rows;
  // "Due": service date is within two weeks or already past.
  return rows.filter((a) => {
    const d = daysUntil(a.nextServiceDue);
    return d != null && d <= 14;
  });
}

export async function getAsset(db: Db, garageId: string, id: string): Promise<AssetRow> {
  const asset = await db.asset.findFirst({ where: { id, garageId }, include });
  if (!asset) throw notFound('Asset');
  return asset;
}

async function assertTagFree(db: Db, garageId: string, tag: string | null | undefined, exceptId?: string) {
  if (!tag) return;
  const clash = await db.asset.findFirst({ where: { garageId, tag, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { name: true } });
  if (clash) throw conflict(`Asset number ${tag} is already used by ${clash.name}`);
}

const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * DAY_MS);

export async function createAsset(db: Db, garageId: string, data: z.infer<typeof assetInput>) {
  await assertLocation(db, garageId, data.locationId);
  const tag = data.tag?.trim() || null;
  await assertTagFree(db, garageId, tag);
  const nextDue = data.nextServiceDue ? dateOnlyToDate(data.nextServiceDue) : data.serviceIntervalDays ? addDays(data.purchaseDate ?? garageToday(), data.serviceIntervalDays) : null;
  const asset = await db.asset.create({
    data: {
      garageId,
      name: data.name,
      tag,
      category: data.category ?? null,
      serialNo: data.serialNo ?? null,
      purchaseDate: dateOnlyToDate(data.purchaseDate),
      cost: data.cost,
      locationId: data.locationId ?? null,
      condition: data.condition,
      serviceIntervalDays: data.serviceIntervalDays ?? null,
      nextServiceDue: nextDue,
      warrantyUntil: dateOnlyToDate(data.warrantyUntil),
      note: data.note ?? null,
    },
  });
  return getAsset(db, garageId, asset.id);
}

export async function updateAsset(db: Db, garageId: string, id: string, data: z.infer<typeof assetPatch>) {
  const before = await getAsset(db, garageId, id);
  if (data.locationId !== undefined) await assertLocation(db, garageId, data.locationId);
  if (data.tag !== undefined) await assertTagFree(db, garageId, data.tag?.trim() || null, id);
  if (data.active === false && before.heldById) throw conflict('Check the asset back in before retiring it from the list');
  const { purchaseDate, nextServiceDue, warrantyUntil, tag, ...rest } = data;
  await db.asset.update({
    where: { id },
    data: {
      ...rest,
      ...(tag !== undefined ? { tag: tag?.trim() || null } : {}),
      ...(purchaseDate !== undefined ? { purchaseDate: dateOnlyToDate(purchaseDate) } : {}),
      ...(nextServiceDue !== undefined ? { nextServiceDue: dateOnlyToDate(nextServiceDue) } : {}),
      ...(warrantyUntil !== undefined ? { warrantyUntil: dateOnlyToDate(warrantyUntil) } : {}),
    },
  });
  if (data.condition && data.condition !== before.condition) await log(db, id, 'CONDITION', null, `Condition changed from ${before.condition} to ${data.condition}`);
  return getAsset(db, garageId, id);
}

function log(db: Db, assetId: string, type: AssetLogType, staffName: string | null, note: string | null) {
  return db.assetLog.create({ data: { assetId, type, staffName, note } });
}

export async function checkOut(db: Prisma.TransactionClient, garageId: string, id: string, data: z.infer<typeof assetCheckOutInput>) {
  const asset = await getAsset(db, garageId, id);
  if (!asset.active || asset.condition === 'RETIRED') throw conflict('This asset is retired');
  if (asset.condition === 'NEEDS_REPAIR') throw conflict('This asset needs repair and should not be handed out');
  if (asset.heldById) throw conflict(`Already with ${asset.heldBy?.name ?? 'someone'}`);
  const staff = await db.staffMember.findFirst({ where: { id: data.staffId, garageId, active: true } });
  if (!staff) throw notFound('Mechanic');
  // updateMany with the "still in the workshop" condition, so two people cannot both take it.
  const taken = await db.asset.updateMany({ where: { id, garageId, heldById: null }, data: { heldById: staff.id, checkedOutAt: new Date() } });
  if (taken.count === 0) throw conflict('Someone else just took this asset');
  await log(db, id, 'CHECK_OUT', staff.name, data.note ?? null);
  return getAsset(db, garageId, id);
}

export async function checkIn(db: Prisma.TransactionClient, garageId: string, id: string, data: z.infer<typeof assetCheckInInput>) {
  const asset = await getAsset(db, garageId, id);
  if (!asset.heldById) throw conflict('This asset is already in the workshop');
  await db.asset.update({ where: { id }, data: { heldById: null, checkedOutAt: null, ...(data.condition ? { condition: data.condition as AssetCondition } : {}) } });
  await log(db, id, 'CHECK_IN', asset.heldBy?.name ?? null, data.note ?? null);
  if (data.condition && data.condition !== asset.condition) await log(db, id, 'CONDITION', null, `Condition changed from ${asset.condition} to ${data.condition}`);
  return getAsset(db, garageId, id);
}

/** A service or inspection was done: logs it and sets the next due date from the interval (or the date given). */
export async function recordService(db: Prisma.TransactionClient, garageId: string, id: string, data: z.infer<typeof assetServiceInput>) {
  const asset = await getAsset(db, garageId, id);
  const next = data.nextServiceDue
    ? dateOnlyToDate(data.nextServiceDue)
    : asset.serviceIntervalDays
      ? addDays(garageToday(), asset.serviceIntervalDays)
      : asset.nextServiceDue;
  await db.asset.update({ where: { id }, data: { nextServiceDue: next, ...(data.condition ? { condition: data.condition } : {}) } });
  await log(db, id, 'SERVICE', null, data.note ?? 'Serviced');
  return getAsset(db, garageId, id);
}

export async function listLogs(db: Db, garageId: string, id: string) {
  await getAsset(db, garageId, id);
  return db.assetLog.findMany({ where: { assetId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
}

export type { Asset };
