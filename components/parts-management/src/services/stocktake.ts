/**
 * Stocktakes: count the shelves and put the system right, location by
 * location.
 *
 * Starting a count lists every part at every location in scope (the whole
 * shop, one category, one location, or locations whose name starts with, say,
 * "A3") with the stock expected there. Counters enter what they find, in any
 * order, as often as they like. Each entry also records the stock the system
 * showed at that location at that moment, so the shop can keep selling
 * during the count: posting changes stock by (counted − stock when counted),
 * never by comparing with a stale number.
 *
 * Posting writes a STOCKTAKE movement at each location with a difference, at
 * cost, so the loss or gain shows in the stock history and the count's
 * variance value.
 */
import { Prisma, Shop } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { countLinesInput, postCountInput, stocktakeInput } from '../validation';
import { getLocation, move } from './inventory';
import { D, takeNumber } from './shared';
import { Actor, audit } from './staff';

export const COUNT_DETAIL = {
  lines: {
    include: {
      part: { select: { id: true, sku: true, name: true, brand: true, unit: true, barcode: true, costPrice: true, stockQty: true, defaultLocationId: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: [{ location: { name: 'asc' } }, { part: { name: 'asc' } }],
  },
} satisfies Prisma.StockCountInclude;
export type CountDetail = Prisma.StockCountGetPayload<{ include: typeof COUNT_DETAIL }>;

export async function getCount(db: Db, shopId: string, id: string) {
  const c = await db.stockCount.findFirst({ where: { id, shopId }, include: COUNT_DETAIL });
  if (!c) throw notFound('Stocktake');
  return c;
}

export function listCounts(db: Db, shopId: string) {
  return db.stockCount.findMany({ where: { shopId }, include: COUNT_DETAIL, orderBy: { createdAt: 'desc' }, take: 50 });
}

export async function startCount(db: Prisma.TransactionClient, shop: Shop, actor: Actor, data: z.infer<typeof stocktakeInput>) {
  const only = data.locationId ? await getLocation(db, shop.id, data.locationId) : null;
  const rows = await db.partStock.findMany({
    where: {
      part: { shopId: shop.id, active: true, isKit: false, ...(data.category ? { category: { equals: data.category, mode: 'insensitive' } } : {}) },
      ...(only ? { locationId: only.id } : data.location ? { location: { name: { startsWith: data.location, mode: 'insensitive' } } } : {}),
    },
    select: { partId: true, locationId: true, qty: true },
  });
  if (!rows.length) throw conflict('No parts match: check the category or location');
  const open = await db.stockCount.findFirst({ where: { shopId: shop.id, status: 'OPEN' }, select: { number: true } });
  if (open) throw conflict(`Finish or cancel stocktake #${open.number} first`);
  const scope = only?.name ?? data.location ?? null;
  const count = await db.stockCount.create({
    data: {
      shopId: shop.id,
      number: await takeNumber(db, shop.id, 'count'),
      category: data.category ?? null,
      location: scope,
      note: data.note ?? null,
      createdByName: actor.name,
      lines: { create: rows.map((r) => ({ partId: r.partId, locationId: r.locationId, expectedQty: r.qty })) },
    },
  });
  await audit(db, shop.id, actor, 'stock.count', `Started stocktake #${count.number} (${rows.length} lines${data.category ? `, ${data.category}` : ''}${scope ? `, ${scope}` : ''})`, { entity: 'stocktake', entityId: count.id });
  return getCount(db, shop.id, count.id);
}

export async function enterCounts(db: Prisma.TransactionClient, shop: Shop, actor: Actor, id: string, data: z.infer<typeof countLinesInput>) {
  const count = await getCount(db, shop.id, id);
  if (count.status !== 'OPEN') throw conflict(`Stocktake #${count.number} is ${count.status.toLowerCase()}`);
  const now = new Date();
  for (const l of data.lines) {
    // Which line: the location given, or the part's line here (its default location first).
    const mine = count.lines.filter((x) => x.partId === l.partId);
    let lineId = (l.locationId ? mine.find((x) => x.locationId === l.locationId) : mine.find((x) => x.locationId === x.part.defaultLocationId) ?? mine[0])?.id;
    let where: { partId: string; locationId: string } | null = null;
    if (lineId) {
      const line = mine.find((x) => x.id === lineId)!;
      where = { partId: line.partId, locationId: line.locationId };
    } else {
      // Found somewhere the count didn't expect it: count it there too.
      const part = await db.part.findFirst({ where: { id: l.partId, shopId: shop.id }, select: { id: true, defaultLocationId: true } });
      if (!part) throw notFound('Part');
      const locationId = l.locationId ?? part.defaultLocationId;
      await getLocation(db, shop.id, locationId);
      const here = await db.partStock.findUnique({ where: { partId_locationId: { partId: part.id, locationId } } });
      lineId = (await db.stockCountLine.create({ data: { countId: id, partId: part.id, locationId, expectedQty: here?.qty ?? D(0) } })).id;
      where = { partId: part.id, locationId };
    }
    if (l.countedQty == null) {
      await db.stockCountLine.update({ where: { id: lineId }, data: { countedQty: null, stockAtCount: null, countedAt: null, countedByName: null } });
      continue;
    }
    const here = await db.partStock.findUnique({ where: { partId_locationId: where } });
    await db.stockCountLine.update({ where: { id: lineId }, data: { countedQty: D(l.countedQty), stockAtCount: here?.qty ?? D(0), countedAt: now, countedByName: actor.name } });
  }
  return getCount(db, shop.id, id);
}

export async function postCount(db: Prisma.TransactionClient, shop: Shop, actor: Actor, id: string, data: z.infer<typeof postCountInput>) {
  const count = await getCount(db, shop.id, id);
  if (count.status !== 'OPEN') throw conflict(`Stocktake #${count.number} is ${count.status.toLowerCase()}`);
  let gain = D(0);
  let loss = D(0);
  let changed = 0;
  for (const line of count.lines) {
    const part = await db.part.findUniqueOrThrow({ where: { id: line.partId } });
    const here = (await db.partStock.findUnique({ where: { partId_locationId: { partId: line.partId, locationId: line.locationId } } }))?.qty ?? D(0);
    let change: Prisma.Decimal;
    if (line.countedQty != null) change = line.countedQty.minus(line.stockAtCount ?? line.expectedQty);
    else if (data.zeroUncounted) change = here.negated();
    else continue;
    // Sold out since it was counted: never below zero.
    if (here.plus(change).lt(0)) change = here.negated();
    await db.stockCountLine.update({ where: { id: line.id }, data: { adjustment: change } });
    if (change.isZero()) continue;
    changed++;
    const value = change.mul(part.costPrice);
    if (value.gt(0)) gain = gain.plus(value);
    else loss = loss.plus(value.negated());
    await move(db, part, change, 'STOCKTAKE', { countId: id, locationId: line.locationId, note: `Stocktake #${count.number}: counted ${line.countedQty?.toString() ?? '0 (not counted)'}`, byName: actor.name });
  }
  await db.stockCount.update({ where: { id }, data: { status: 'POSTED', postedAt: new Date(), postedByName: actor.name } });
  await audit(db, shop.id, actor, 'stock.count', `Posted stocktake #${count.number}: ${changed} lines changed, +${gain.toFixed(2)} / -${loss.toFixed(2)} at cost`, { entity: 'stocktake', entityId: id, amount: gain.minus(loss) });
  return getCount(db, shop.id, id);
}

export async function cancelCount(db: Db, shop: Shop, actor: Actor, id: string) {
  const count = await getCount(db, shop.id, id);
  if (count.status !== 'OPEN') throw conflict(`Stocktake #${count.number} is ${count.status.toLowerCase()}`);
  await db.stockCount.update({ where: { id }, data: { status: 'CANCELLED' } });
  await audit(db, shop.id, actor, 'stock.count', `Cancelled stocktake #${count.number}`, { entity: 'stocktake', entityId: id });
  return getCount(db, shop.id, id);
}
