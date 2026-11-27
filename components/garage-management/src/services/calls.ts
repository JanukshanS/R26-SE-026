/**
 * Calls customers place to garages through Kaduna. Each tap on "Call" in the
 * app or on the website is logged before the phone dialler opens, so the
 * admin dashboard can show how many calls (leads) the platform sends each
 * garage, and to how many different people.
 */
import { Prisma } from '@prisma/client';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { isListed } from './ownerVisits';

// The same person tapping Call again within this window is the same call
// (a redial, or a double tap), not a new lead.
const REPEAT_WINDOW_MS = 2 * 60_000;

export async function recordCall(db: Db, userId: string, garageId: string, source: 'app' | 'web') {
  const garage = await db.garage.findUnique({ where: { id: garageId } });
  // Only listed garages can be called through Kaduna; others look like they don't exist.
  if (!garage || !isListed(garage)) throw notFound('Garage');
  if (!garage.phone) throw conflict('This garage has no phone number listed');

  const recent = await db.garageCall.findFirst({
    where: { garageId, userId, createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
  });
  const call = recent ?? (await db.garageCall.create({ data: { garageId, userId, source, phone: garage.phone } }));
  return { id: call.id, garageId, garageName: garage.name, phone: garage.phone, counted: !recent, createdAt: call.createdAt };
}

const DAY_MS = 86_400_000;

/** Calls between two instants: totals, per garage, per day (UTC) and the most recent ones. */
export async function callStats(db: Db, from: Date, to: Date) {
  const where: Prisma.GarageCallWhereInput = { createdAt: { gte: from, lt: to } };
  const [total, callers, byGarage, recent] = await Promise.all([
    db.garageCall.count({ where }),
    db.garageCall.findMany({ where, distinct: ['userId'], select: { userId: true } }),
    db.garageCall.groupBy({ by: ['garageId'], where, _count: { _all: true }, _max: { createdAt: true } }),
    db.garageCall.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50, include: { garage: { select: { name: true } } } }),
  ]);
  const garages = byGarage.length
    ? await db.garage.findMany({ where: { id: { in: byGarage.map((g) => g.garageId) } }, select: { id: true, name: true, phone: true, address: true } })
    : [];
  const garageById = new Map(garages.map((g) => [g.id, g]));

  const days = await db.$queryRaw<{ day: Date; calls: bigint }[]>`
    SELECT date_trunc('day', "created_at") AS day, COUNT(*) AS calls
    FROM "garage_calls" WHERE "created_at" >= ${from} AND "created_at" < ${to}
    GROUP BY 1 ORDER BY 1`;
  const perDay = new Map(days.map((d) => [d.day.toISOString().slice(0, 10), Number(d.calls)]));
  const byDay: { date: string; calls: number }[] = [];
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t < to.getTime(); t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    byDay.push({ date, calls: perDay.get(date) ?? 0 });
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    total,
    uniqueCallers: callers.length,
    garagesCalled: byGarage.length,
    byGarage: byGarage
      .map((g) => ({
        garageId: g.garageId,
        name: garageById.get(g.garageId)?.name ?? null,
        phone: garageById.get(g.garageId)?.phone ?? null,
        address: garageById.get(g.garageId)?.address ?? null,
        calls: g._count._all,
        lastCallAt: g._max.createdAt,
      }))
      .sort((a, b) => b.calls - a.calls),
    byDay,
    recent: recent.map((c) => ({ id: c.id, garageId: c.garageId, garageName: c.garage.name, userId: c.userId, source: c.source, phone: c.phone, createdAt: c.createdAt })),
  };
}
