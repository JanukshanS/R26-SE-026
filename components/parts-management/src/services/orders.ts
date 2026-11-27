/**
 * Garages ordering parts from a shop, usually for one job. The flow is on the
 * GarageOrder model. Who does what:
 *
 *   garage owner   orders (catalogue parts at the trade price, or a free-text
 *                  request the shop prices), accepts a quote, cancels, and
 *                  chooses delivery or who collects: a mechanic of the garage
 *                  or the car's owner (found through their registered plate)
 *   the shop       prices, declines, marks it ready, and hands it over against
 *                  the receiving side's 6-digit code
 *   collector      sees the pickup (shop, parts, code) in their own Kaduna app
 *
 * Payment is settled when the order is confirmed: on account when the
 * garage's trade account has the credit for it, otherwise paid on handover.
 * Handover takes the parts out of stock, charges the account (if on account),
 * and puts the parts on the garage's job at the price paid. That last step
 * talks to the garage service and is retried until it goes through.
 */
import { GarageOrder, PaymentMethod, Prisma, Shop } from '@prisma/client';
import { z } from 'zod';

import { GarageContext } from '../middleware/auth';
import { DomainError, conflict, notFound } from '../utils/http';
import { logger } from '../utils/logger';
import { Db, prisma } from '../utils/prisma';
import { catalogueQuery, orderInput, ordersQuery, pickupPatch, quoteInput } from '../validation';
import { drawerFor } from './cash';
import { garages, GarageJob } from './garageClient';
import { fitsWhere, moveSellable, searchWhere } from './inventory';
import { vehicleLookup } from './kadunaVehicles';
import { D, compactPlate, money, newHandoverCode, takeNumber } from './shared';
import { Actor, audit } from './staff';
import { OPEN_ORDER, balanceOf, creditAvailable } from './trade';

export const ORDER_DETAIL = { items: { orderBy: { line: 'asc' } }, shop: true, account: true } satisfies Prisma.GarageOrderInclude;
export type OrderDetail = Prisma.GarageOrderGetPayload<{ include: typeof ORDER_DETAIL }>;

const FINISHED_JOB = ['CLOSED', 'CANCELLED'];
const tradePrice = (p: { tradePrice: Prisma.Decimal | null; retailPrice: Prisma.Decimal }) => p.tradePrice ?? p.retailPrice;
const orderTotal = (items: { available: boolean; unitPrice: Prisma.Decimal | null; quantity: Prisma.Decimal }[]) =>
  money(items.filter((i) => i.available).reduce((s, i) => s.plus((i.unitPrice ?? D(0)).mul(i.quantity)), D(0)));
const label = (o: { number: number }, shop: { name: string }) => `${shop.name} order #${o.number}`;

/** A note on the garage job's timeline. Never fails the order over it. */
async function jobNote(o: Pick<GarageOrder, 'garageId' | 'jobCardId'>, note: string) {
  if (!o.jobCardId) return;
  try {
    await garages().note(o.garageId, o.jobCardId, note);
  } catch (err) {
    logger.warn(`Job note failed: ${(err as Error).message}`);
  }
}

// ─── What the garage sees of shops ──────────────────────────────────────────

export async function directory(db: Db, garageId: string, opts: { q?: string; linkedOnly?: boolean }) {
  const contains = opts.q ? { contains: opts.q, mode: 'insensitive' as const } : undefined;
  const shops = await db.shop.findMany({
    where: {
      active: true,
      ...(contains ? { OR: [{ name: contains }, { city: contains }, { address: contains }] } : {}),
      ...(opts.linkedOnly ? { accounts: { some: { garageId, linked: true } } } : {}),
    },
    include: { accounts: { where: { garageId } }, _count: { select: { parts: { where: { active: true, listed: true } } } } },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return Promise.all(shops.map(async ({ accounts, _count, ...s }) => ({ shop: s, partCount: _count.parts, account: accounts[0] ? await accountSummary(db, accounts[0]) : null })));
}

/** The garage's view of its account at a shop. */
export async function accountSummary(db: Db, a: Prisma.TradeAccountGetPayload<object>) {
  const balance = await balanceOf(db, a.id);
  const available = await creditAvailable(db, a);
  return { id: a.id, linked: a.linked, creditLimit: a.creditLimit, paymentDays: a.paymentDays, onHold: a.onHold, balance, available };
}

export async function shopForGarage(db: Db, garageId: string, shopId: string) {
  const shop = await db.shop.findFirst({ where: { id: shopId, active: true }, include: { accounts: { where: { garageId } } } });
  if (!shop) throw notFound('Parts shop');
  const { accounts, ...s } = shop;
  return { shop: s, account: accounts[0] ? await accountSummary(db, accounts[0]) : null };
}

/** The shop's online catalogue at trade prices, optionally only what fits a car. */
export async function catalogue(db: Db, garageId: string, shopId: string, q: z.infer<typeof catalogueQuery>) {
  await shopForGarage(db, garageId, shopId);
  let vehicle: { make?: string | null; model?: string | null; year?: number | null } = { make: q.make, model: q.model, year: q.year };
  if (q.jobCardId) {
    const job = await garages().job(garageId, q.jobCardId);
    if (!job) throw notFound('Job card');
    if (job.vehicle?.make || job.vehicle?.model) vehicle = { make: job.vehicle.make, model: job.vehicle.model, year: job.vehicle.year };
  }
  const filters: Prisma.PartWhereInput[] = [];
  if (q.q) filters.push(searchWhere(q.q));
  const fits = fitsWhere(vehicle);
  if (fits) filters.push(fits);
  const parts = await db.part.findMany({
    where: { shopId, active: true, listed: true, ...(filters.length ? { AND: filters } : {}) },
    include: { fitments: true },
    orderBy: { name: 'asc' },
    take: 200,
  });
  return { vehicle: fits ? vehicle : null, parts };
}

// ─── Delivery or who collects ───────────────────────────────────────────────

type Fulfil = z.infer<typeof pickupPatch>;

async function resolveFulfilment(shop: Shop, g: GarageContext, job: GarageJob | null, f: Fulfil, token: string | undefined) {
  const none = { pickupBy: null, pickupStaffId: null, pickupUserId: null, pickupName: null, pickupPhone: null, pickupPlate: null };
  if (f.fulfilment === 'DELIVERY') {
    if (!shop.delivers) throw conflict(`${shop.name} doesn't deliver. Choose a pickup instead`);
    const deliveryAddress = f.deliveryAddress || g.address;
    if (!deliveryAddress) throw new DomainError(422, 'Add a delivery address (or save one in your garage settings)');
    return { fulfilment: 'DELIVERY' as const, deliveryAddress, ...none };
  }
  if (f.pickupBy === 'MECHANIC') {
    if (!f.pickupStaffId) throw new DomainError(422, 'Choose the mechanic who will collect it');
    const member = (await garages().staff(g.garageId)).find((s) => s.id === f.pickupStaffId);
    if (!member) throw notFound('Mechanic');
    if (!member.active) throw conflict(`${member.name} is no longer active`);
    if (!member.userId) throw conflict(`${member.name} hasn't joined with their invite code yet, so they can't see the pickup`);
    return { fulfilment: 'PICKUP' as const, deliveryAddress: null, ...none, pickupBy: 'MECHANIC' as const, pickupStaffId: member.id, pickupUserId: member.userId, pickupName: member.name, pickupPhone: member.phone };
  }
  if (f.pickupBy === 'VEHICLE_OWNER') {
    if (!job) throw new DomainError(422, 'The vehicle owner can only collect parts ordered for a job');
    const plate = compactPlate(job.vehicle?.plate);
    if (!plate) throw conflict("This job's vehicle has no plate, so its owner can't be found");
    if ((await vehicleLookup().plateRegistered(plate, token)) === false) {
      throw conflict(`No Kaduna account has registered ${job.vehicle!.plate}. Choose a mechanic, or ask the owner to add the car in their Kaduna app`);
    }
    return { fulfilment: 'PICKUP' as const, deliveryAddress: null, ...none, pickupBy: 'VEHICLE_OWNER' as const, pickupPlate: plate };
  }
  throw new DomainError(422, 'Choose who collects it: a mechanic or the vehicle owner');
}

export async function pickupOptions(g: GarageContext, jobCardId: string | undefined, token: string | undefined) {
  const staff = await garages().staff(g.garageId);
  let vehicleOwner: { plate: string; registered: boolean | null } | null = null;
  if (jobCardId) {
    const job = await garages().job(g.garageId, jobCardId);
    if (!job) throw notFound('Job card');
    if (job.vehicle?.plate) vehicleOwner = { plate: job.vehicle.plate, registered: await vehicleLookup().plateRegistered(compactPlate(job.vehicle.plate)!, token) };
  }
  return {
    mechanics: staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, joined: s.userId !== null })),
    vehicleOwner,
  };
}

// ─── Garage side ────────────────────────────────────────────────────────────

export async function createOrder(g: GarageContext, data: z.infer<typeof orderInput>, token: string | undefined) {
  const shop = await prisma.shop.findFirst({ where: { id: data.shopId, active: true } });
  if (!shop) throw notFound('Parts shop');
  const account = await prisma.tradeAccount.findUnique({ where: { shopId_garageId: { shopId: shop.id, garageId: g.garageId } } });
  if (!account?.linked) throw conflict(`Add ${shop.name} to your sellers first`);

  // Everything from the garage service first, so the transaction below is local.
  let job: GarageJob | null = null;
  if (data.jobCardId) {
    job = await garages().job(g.garageId, data.jobCardId);
    if (!job) throw notFound('Job card');
    if (FINISHED_JOB.includes(job.status)) throw conflict(`Job #${job.number} is ${job.status.toLowerCase()}`);
  }
  const fulfilment = await resolveFulfilment(shop, g, job, data, token);

  const order = await prisma.$transaction(async (tx) => {
    const ids = data.items.map((i) => i.partId).filter((x): x is string => Boolean(x));
    const parts = ids.length ? await tx.part.findMany({ where: { id: { in: ids }, shopId: shop.id } }) : [];
    const byId = new Map(parts.map((p) => [p.id, p]));
    const items = data.items.map((i) => {
      if (i.partId) {
        const p = byId.get(i.partId);
        if (!p) throw notFound('Catalogue part');
        if (!p.active || !p.listed) throw conflict(`${p.name} is no longer sold by ${shop.name}`);
        return { partId: p.id, description: p.name, partNumber: p.partNumber ?? p.oemNumber, quantity: D(i.quantity), unitPrice: tradePrice(p) };
      }
      if (!i.description) throw new DomainError(422, 'Describe each part you need, or pick it from the catalogue');
      return { partId: null, description: i.description, partNumber: i.partNumber ?? null, quantity: D(i.quantity), unitPrice: null };
    });
    // Updating the account keeps the garage's details on it current.
    await tx.tradeAccount.update({ where: { id: account.id }, data: { garageName: g.name, garagePhone: g.phone, garageAddress: g.address } });
    return tx.garageOrder.create({
      data: {
        shopId: shop.id,
        accountId: account.id,
        garageId: g.garageId,
        number: await takeNumber(tx, shop.id, 'order'),
        jobCardId: job?.id ?? null,
        jobNumber: job?.number ?? null,
        vehiclePlate: job?.vehicle?.plate ?? null,
        vehicleMake: job?.vehicle?.make ?? null,
        vehicleModel: job?.vehicle?.model ?? null,
        vehicleYear: job?.vehicle?.year ?? null,
        ...fulfilment,
        note: data.note ?? null,
        handoverCode: newHandoverCode(),
        items: { create: items.map((i, line) => ({ ...i, line })) },
      },
      include: ORDER_DETAIL,
    });
  });
  await jobNote(order, `Parts ordered from ${label(order, shop)}`);
  return order;
}

export function listGarageOrders(db: Db, garageId: string, q: z.infer<typeof ordersQuery>) {
  return db.garageOrder.findMany({
    where: {
      garageId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.jobCardId ? { jobCardId: q.jobCardId } : {}),
      ...(q.open === 'true' ? { status: { in: OPEN_ORDER } } : {}),
    },
    include: ORDER_DETAIL,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getGarageOrder(db: Db, garageId: string, id: string) {
  const order = await db.garageOrder.findFirst({ where: { id, garageId }, include: ORDER_DETAIL });
  if (!order) throw notFound('Part order');
  return order;
}

function assertStatus(o: { status: string; number: number }, allowed: string[], action: string) {
  if (!allowed.includes(o.status)) throw conflict(`Order #${o.number} is ${o.status.toLowerCase()} and can't be ${action}`);
}

/** On account if the credit covers it, otherwise paid on handover. */
async function termsFor(db: Db, order: OrderDetail) {
  const room = await creditAvailable(db, order.account);
  return room !== null && room.gte(orderTotal(order.items)) ? ('ACCOUNT' as const) : ('ON_HANDOVER' as const);
}

export async function acceptQuote(db: Db, garageId: string, id: string) {
  const order = await getGarageOrder(db, garageId, id);
  assertStatus(order, ['QUOTED'], 'accepted');
  await db.garageOrder.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), paymentTerms: await termsFor(db, order) } });
  await jobNote(order, `Quote accepted: ${label(order, order.shop)}`);
  return getGarageOrder(db, garageId, id);
}

export async function cancelOrder(db: Db, garageId: string, id: string) {
  const order = await getGarageOrder(db, garageId, id);
  assertStatus(order, OPEN_ORDER, 'cancelled');
  await db.garageOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
  await jobNote(order, `Cancelled ${label(order, order.shop)}`);
  return getGarageOrder(db, garageId, id);
}

export async function changePickup(db: Db, g: GarageContext, id: string, data: Fulfil, token: string | undefined) {
  const order = await getGarageOrder(db, g.garageId, id);
  assertStatus(order, OPEN_ORDER, 'changed');
  const job = order.jobCardId ? await garages().job(g.garageId, order.jobCardId) : null;
  await db.garageOrder.update({ where: { id }, data: await resolveFulfilment(order.shop, g, job, data, token) });
  return getGarageOrder(db, g.garageId, id);
}

// ─── Shop side ──────────────────────────────────────────────────────────────

export function listShopOrders(db: Db, shopId: string, q: z.infer<typeof ordersQuery>) {
  return db.garageOrder.findMany({
    where: { shopId, ...(q.status ? { status: q.status } : {}), ...(q.open === 'true' ? { status: { in: OPEN_ORDER } } : {}) },
    include: ORDER_DETAIL,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

export async function getShopOrder(db: Db, shopId: string, id: string) {
  const order = await db.garageOrder.findFirst({ where: { id, shopId }, include: ORDER_DETAIL });
  if (!order) throw notFound('Order');
  return order;
}

/**
 * The shop prices the order, says what it has, and can match requested lines
 * to its own stock. All catalogue lines, all available, at the trade price:
 * confirmed at once. Anything else goes to the garage as a quote.
 */
export async function quote(db: Prisma.TransactionClient, shop: Shop, id: string, data: z.infer<typeof quoteInput>) {
  const order = await getShopOrder(db, shop.id, id);
  assertStatus(order, ['REQUESTED', 'QUOTED'], 'priced');
  const given = new Map(data.items.map((i) => [i.id, i]));
  if (data.items.length !== order.items.length || order.items.some((i) => !given.has(i.id))) throw new DomainError(422, 'Price or mark every line of the order');
  if (data.items.every((i) => !i.available)) throw conflict('Nothing on this order is available. Decline it instead');

  let unchanged = true;
  for (const item of order.items) {
    const g = given.get(item.id)!;
    if (g.available && g.unitPrice == null) throw new DomainError(422, `Price "${item.description}"`);
    let partId = item.partId;
    if (g.partId && g.partId !== item.partId) {
      const p = await db.part.findFirst({ where: { id: g.partId, shopId: shop.id }, select: { id: true } });
      if (!p) throw notFound('Part');
      partId = p.id;
    }
    const price = g.available ? D(g.unitPrice!) : item.unitPrice;
    if (!g.available || !item.partId || item.unitPrice == null || !price!.equals(item.unitPrice)) unchanged = false;
    await db.garageOrderItem.update({ where: { id: item.id }, data: { available: g.available, unitPrice: price, partId } });
  }
  const now = new Date();
  const fresh = await getShopOrder(db, shop.id, id);
  const status = unchanged ? 'CONFIRMED' : 'QUOTED';
  await db.garageOrder.update({
    where: { id },
    data: {
      status,
      sellerNote: data.sellerNote ?? order.sellerNote,
      quotedAt: now,
      ...(status === 'CONFIRMED' ? { confirmedAt: now, paymentTerms: await termsFor(db, fresh) } : {}),
    },
  });
  return getShopOrder(db, shop.id, id);
}

export async function decline(db: Db, shop: Shop, id: string, sellerNote: string | null | undefined) {
  const order = await getShopOrder(db, shop.id, id);
  assertStatus(order, ['REQUESTED', 'QUOTED', 'CONFIRMED'], 'declined');
  await db.garageOrder.update({ where: { id }, data: { status: 'DECLINED', sellerNote: sellerNote ?? order.sellerNote } });
  return getShopOrder(db, shop.id, id);
}

export async function markReady(db: Db, shop: Shop, id: string) {
  const order = await getShopOrder(db, shop.id, id);
  assertStatus(order, ['CONFIRMED'], 'marked ready');
  await db.garageOrder.update({ where: { id }, data: { status: 'READY', readyAt: new Date() } });
  return getShopOrder(db, shop.id, id);
}

/**
 * The handover, against the receiving side's code: stock goes out, an
 * on-account order is charged to the garage, a pay-on-handover one records
 * how it was paid. The parts then go on the garage's job (see syncJob).
 */
export async function complete(db: Prisma.TransactionClient, shop: Shop, actor: Actor, id: string, code: string, paymentMethod: PaymentMethod | null | undefined) {
  const order = await getShopOrder(db, shop.id, id);
  assertStatus(order, ['CONFIRMED', 'READY'], 'handed over');
  if (code !== order.handoverCode) throw new DomainError(403, "That code doesn't match. Ask the collector for the code shown in their Kaduna app");
  const onAccount = order.paymentTerms === 'ACCOUNT';
  if (!onAccount && !paymentMethod) throw new DomainError(422, 'This order is paid on handover: choose how it was paid');
  if (!onAccount && paymentMethod === 'ACCOUNT') throw new DomainError(422, 'This order is paid on handover: choose cash, card or transfer');
  const drawer = onAccount ? null : await drawerFor(db, shop, actor, paymentMethod === 'CASH');

  for (const item of order.items.filter((i) => i.available && i.partId)) {
    const part = await db.part.findUnique({ where: { id: item.partId! } });
    if (part) await moveSellable(db, part, item.quantity.negated(), 'GARAGE_ORDER', { orderId: order.id, note: `${order.account.garageName}, order #${order.number}`, byName: actor.name });
  }
  const total = orderTotal(order.items);
  if (onAccount && total.gt(0)) {
    await db.accountEntry.create({ data: { accountId: order.accountId, kind: 'CHARGE', amount: total, orderId: order.id, note: `Order #${order.number}${order.jobNumber ? `, job #${order.jobNumber}` : ''}`, byName: actor.name } });
  }
  const now = new Date();
  await db.garageOrder.update({
    where: { id },
    data: {
      status: 'COMPLETED',
      completedAt: now,
      ...(onAccount ? {} : { paidAt: now, paymentMethod, cashSessionId: drawer }),
      handedOverBy: actor.name,
      jobSync: order.jobCardId ? 'PENDING' : 'NONE',
    },
  });
  await audit(db, shop.id, actor, 'order.handover', `Handed over order #${order.number} to ${order.account.garageName}: ${total.toFixed(2)} ${onAccount ? 'on account' : `paid by ${paymentMethod!.toLowerCase().replace('_', ' ')}`}`, { entity: 'order', entityId: order.id, amount: total });
  return getShopOrder(db, shop.id, id);
}

/** Puts a handed-over order's parts on the garage job. DONE, SKIPPED (job can't take lines) or still PENDING. */
export async function syncJob(db: Db, orderId: string) {
  const order = await db.garageOrder.findUnique({ where: { id: orderId }, include: ORDER_DETAIL });
  if (!order || order.jobSync !== 'PENDING' || !order.jobCardId) return;
  try {
    const lines = order.items
      .filter((i) => i.available)
      .map((i) => ({ description: i.partNumber ? `${i.description} (${i.partNumber})` : i.description, quantity: i.quantity.toNumber(), unitPrice: (i.unitPrice ?? D(0)).toNumber() }));
    const { added } = await garages().addParts(
      order.garageId,
      order.jobCardId,
      lines,
      `Received ${label(order, order.shop)}${order.paymentTerms === 'ACCOUNT' ? ' (on account)' : ''}`,
    );
    await db.garageOrder.update({ where: { id: orderId }, data: { jobSync: added ? 'DONE' : 'SKIPPED' } });
  } catch (err) {
    logger.warn(`Job sync for order ${orderId} will be retried: ${(err as Error).message}`);
  }
}

/** For the background loop: anything still waiting to reach its job. */
export async function retryJobSyncs(db: Db) {
  const pending = await db.garageOrder.findMany({ where: { jobSync: 'PENDING' }, select: { id: true }, take: 50 });
  for (const p of pending) await syncJob(db, p.id);
}

/** Shop-side status changes the garage should see on the job's timeline. */
export const noteFor = (o: OrderDetail) =>
  ({
    QUOTED: `${o.shop.name} sent a quote for order #${o.number}`,
    CONFIRMED: `${o.shop.name} confirmed order #${o.number}${o.paymentTerms === 'ACCOUNT' ? ' (on account)' : ' (pay on handover)'}`,
    READY: o.fulfilment === 'DELIVERY' ? `${label(o, o.shop)} is out for delivery` : `${label(o, o.shop)} is ready to collect`,
    DECLINED: `${o.shop.name} declined order #${o.number}${o.sellerNote ? `: ${o.sellerNote}` : ''}`,
  })[o.status as 'QUOTED' | 'CONFIRMED' | 'READY' | 'DECLINED'];

export const notifyJob = async (o: OrderDetail) => {
  const note = noteFor(o);
  if (note) await jobNote(o, note);
};

// ─── Collectors ─────────────────────────────────────────────────────────────

const RECENT_MS = 3 * 86_400_000;

/** Pickups for the signed-in person: as the mechanic named on it, or as the owner of the job's car. */
export function pickupsFor(db: Db, userId: string, plates: string[]) {
  const who: Prisma.GarageOrderWhereInput[] = [{ pickupBy: 'MECHANIC', pickupUserId: userId }];
  if (plates.length) who.push({ pickupBy: 'VEHICLE_OWNER', pickupPlate: { in: plates } });
  return db.garageOrder.findMany({
    where: {
      fulfilment: 'PICKUP',
      OR: who,
      AND: [{ OR: [{ status: { in: ['CONFIRMED', 'READY'] } }, { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - RECENT_MS) } }] }],
    },
    include: ORDER_DETAIL,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
