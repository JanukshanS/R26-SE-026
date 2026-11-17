/**
 * The shop's parts and where their stock is.
 *
 * Stock sits at locations (a shelf or bin, the back store, a van): PartStock
 * holds the quantity per location and Part.stockQty is always their sum. Each
 * part has a default location, where new stock goes and the counter takes
 * from first.
 *
 * Stock only moves through `move` (in or out) and `transfer` (between two
 * locations). Both update the quantities in the same transaction and write a
 * StockMovement per location touched, so the shelves and the history never
 * disagree. Taking stock out never goes below zero, at any location.
 *
 * Fitment: a part lists the vehicles it fits (make, model, year range), or is
 * universal. Searching by vehicle returns universal parts plus parts with a
 * fitment that covers it.
 *
 * Kits hold no stock of their own: selling one takes its components out
 * (moveSellable), and how many can be sold is what the components allow.
 * A sealed pack (a 4 L bottle) can be opened into its loose part (litres)
 * with breakBulk. Parts sold by measure (fractional) take any quantity;
 * everything else is sold in whole units.
 */
import { Part, Prisma, StockReason } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { adjustInput, breakInput, fitmentInput, kitInput, locationInput, locationPatch, partInput, partPatch, partsQuery, specInput, transferInput } from '../validation';
import { D } from './shared';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export type Vehicle = { make?: string | null; model?: string | null; year?: number | null };

/** Parts that fit a vehicle: universal ones, or a fitment covering make/model/year. */
export function fitsWhere(v: Vehicle): Prisma.PartWhereInput | undefined {
  if (!v.make && !v.model) return undefined;
  const fitment: Prisma.PartFitmentWhereInput = {
    ...(v.make ? { make: { equals: v.make, mode: 'insensitive' } } : {}),
    ...(v.model ? { model: { equals: v.model, mode: 'insensitive' } } : {}),
    ...(v.year
      ? { AND: [{ OR: [{ yearFrom: null }, { yearFrom: { lte: v.year } }] }, { OR: [{ yearTo: null }, { yearTo: { gte: v.year } }] }] }
      : {}),
  };
  return { OR: [{ universal: true }, { fitments: { some: fitment } }] };
}

export function searchWhere(q: string): Prisma.PartWhereInput {
  const lower = q.toLowerCase();
  return {
    OR: [
      { name: contains(q) },
      { sku: contains(q) },
      { brand: contains(q) },
      { oemNumber: contains(q) },
      { partNumber: contains(q) },
      { barcode: q },
      { crossRefs: { has: q.toUpperCase() } },
      { category: contains(q) },
      { description: contains(q) },
      { tags: { has: lower } },
      { specsText: { contains: lower } },
    ],
  };
}

// ─── Locations ──────────────────────────────────────────────────────────────

export const MAIN = 'Main';

/** The shop's location with this name, made if it doesn't exist yet. */
export async function locationNamed(db: Db, shopId: string, name: string) {
  const n = name.trim() || MAIN;
  const found = await db.location.findUnique({ where: { shopId_name: { shopId, name: n } } });
  if (found) return found;
  return db.location.upsert({ where: { shopId_name: { shopId, name: n } }, create: { shopId, name: n }, update: {} });
}

export async function getLocation(db: Db, shopId: string, id: string) {
  const l = await db.location.findFirst({ where: { id, shopId } });
  if (!l) throw notFound('Location');
  return l;
}

/** Every location with what's in it: parts, units and value at cost. */
export async function listLocations(db: Db, shopId: string) {
  const [locations, totals] = await Promise.all([
    db.location.findMany({ where: { shopId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
    db.$queryRaw<{ location_id: string; parts: bigint; units: Prisma.Decimal | null; value: Prisma.Decimal | null }[]>`
      SELECT s."location_id", COUNT(*) FILTER (WHERE s."qty" > 0) AS parts, SUM(s."qty") AS units, SUM(s."qty" * p."cost_price") AS value
      FROM "part_stock" s JOIN "parts" p ON p."id" = s."part_id"
      WHERE p."shop_id" = ${shopId} AND p."active"
      GROUP BY s."location_id"`,
  ]);
  const by = new Map(totals.map((t) => [t.location_id, t]));
  return locations.map((l) => ({ location: l, parts: Number(by.get(l.id)?.parts ?? 0), units: by.get(l.id)?.units ?? D(0), value: by.get(l.id)?.value ?? D(0) }));
}

export async function createLocation(db: Db, shopId: string, data: z.infer<typeof locationInput>) {
  const exists = await db.location.findUnique({ where: { shopId_name: { shopId, name: data.name } } });
  if (exists) throw conflict(`There's already a location called ${data.name}`);
  return db.location.create({ data: { shopId, name: data.name, note: data.note ?? null } });
}

export async function updateLocation(db: Db, shopId: string, id: string, data: z.infer<typeof locationPatch>) {
  await getLocation(db, shopId, id);
  if (data.active === false) {
    const held = await db.partStock.count({ where: { locationId: id, qty: { not: 0 } } });
    if (held) throw conflict('Move the stock out of this location first');
    const defaults = await db.part.count({ where: { defaultLocationId: id, active: true } });
    if (defaults) throw conflict(`${defaults} parts use this as their default location: give them another one first`);
  }
  return db.location.update({ where: { id }, data });
}

// ─── Parts ──────────────────────────────────────────────────────────────────

const KIT = { include: { component: { select: { id: true, sku: true, name: true, unit: true, stockQty: true, costPrice: true, retailPrice: true } } }, orderBy: { id: 'asc' } } satisfies Prisma.Part$kitComponentsArgs;
export const PART_LIST = { fitments: true, defaultLocation: true, kitComponents: KIT } satisfies Prisma.PartInclude;
export const PART_DETAIL = {
  fitments: true,
  kitComponents: KIT,
  breaksInto: { select: { id: true, sku: true, name: true, unit: true, stockQty: true } },
  openedFrom: { select: { id: true, sku: true, name: true, unit: true, stockQty: true, breaksIntoQty: true } },
  supplier: true,
  defaultLocation: true,
  stock: { include: { location: true }, orderBy: { location: { name: 'asc' } } },
  files: { where: { status: 'READY' }, orderBy: [{ primary: 'desc' }, { createdAt: 'asc' }] },
  substitutes: { include: { substitute: { include: { defaultLocation: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PartInclude;
export type PartDetail = Prisma.PartGetPayload<{ include: typeof PART_DETAIL }>;

export async function listParts(db: Db, shopId: string, opts: z.infer<typeof partsQuery>) {
  const filters: Prisma.PartWhereInput[] = [];
  if (opts.q) filters.push(searchWhere(opts.q));
  const fits = fitsWhere(opts);
  if (fits) filters.push(fits);
  const where: Prisma.PartWhereInput = {
    shopId,
    ...(opts.includeInactive === 'true' ? {} : { active: true }),
    ...(opts.category ? { category: { equals: opts.category, mode: 'insensitive' } } : {}),
    ...(opts.tag ? { tags: { has: opts.tag.toLowerCase() } } : {}),
    ...(opts.locationId ? { stock: { some: { locationId: opts.locationId, qty: { gt: 0 } } } } : {}),
    ...(filters.length ? { AND: filters } : {}),
  };
  if (opts.lowStock === 'true') {
    // Compared column to column, so done in SQL.
    const low = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "parts" WHERE "shop_id" = ${shopId} AND "active" AND NOT "is_kit" AND "stock_qty" <= "reorder_level"`;
    where.id = { in: low.map((r) => r.id) };
  }
  const [items, total] = await Promise.all([
    db.part.findMany({ where, include: PART_LIST, orderBy: { name: 'asc' }, take: opts.limit, skip: opts.offset }),
    db.part.count({ where }),
  ]);
  return { items, total };
}

export async function getPart(db: Db, shopId: string, id: string) {
  const part = await db.part.findFirst({ where: { id, shopId }, include: PART_DETAIL });
  if (!part) throw notFound('Part');
  return part;
}

/** On open purchase orders and not yet received. */
export async function onOrder(db: Db, partId: string) {
  const items = await db.purchaseOrderItem.findMany({ where: { partId, purchase: { status: { in: ['ORDERED', 'PARTLY_RECEIVED'] } } }, select: { quantity: true, receivedQty: true, unitFactor: true } });
  return items.reduce((s, i) => s.plus(Prisma.Decimal.max(i.quantity.minus(i.receivedQty), 0).mul(i.unitFactor)), D(0));
}

/** How many kits the components on the shelf make. */
export const kitAvailable = (components: { quantity: Prisma.Decimal; component: { stockQty: Prisma.Decimal } }[]) =>
  components.length ? Prisma.Decimal.max(0, components.map((c) => c.component.stockQty.div(c.quantity).floor()).reduce((a, b) => Prisma.Decimal.min(a, b))) : D(0);

/** Whole units only, unless the part is sold by measure. */
export function assertQuantity(part: Pick<Part, 'name' | 'unit' | 'fractional'>, qty: Prisma.Decimal) {
  if (!part.fractional && !qty.isInteger()) throw new DomainError(422, `${part.name} is sold in whole ${part.unit}: mark it "sold by measure" to sell part of one`);
}

export async function partDetail(db: Db, shopId: string, id: string) {
  const part = await getPart(db, shopId, id);
  const [movements, ordered] = await Promise.all([db.stockMovement.findMany({ where: { partId: id }, orderBy: { createdAt: 'desc' }, take: 200 }), onOrder(db, id)]);
  return { part, movements, onOrder: ordered };
}

/** Barcode scan or typed code at the counter: an exact barcode, SKU, OEM or part number. */
export async function lookup(db: Db, shopId: string, code: string) {
  const c = code.trim();
  return db.part.findFirst({
    where: { shopId, active: true, OR: [{ barcode: c }, { sku: { equals: c, mode: 'insensitive' } }, { oemNumber: { equals: c, mode: 'insensitive' } }, { partNumber: { equals: c, mode: 'insensitive' } }, { crossRefs: { has: c.toUpperCase() } }] },
    include: PART_LIST,
  });
}

async function assertSupplier(db: Db, shopId: string, supplierId: string | null | undefined) {
  if (!supplierId) return;
  const s = await db.supplier.findFirst({ where: { id: supplierId, shopId }, select: { id: true } });
  if (!s) throw notFound('Supplier');
}

const fitmentRows = (fitments: z.infer<typeof fitmentInput>[]) =>
  fitments.map((f) => ({ make: f.make, model: f.model, yearFrom: f.yearFrom ?? null, yearTo: f.yearTo ?? null, note: f.note ?? null }));

const normRefs = (refs: string[] | undefined) => (refs ? [...new Set(refs.map((r) => r.toUpperCase()))] : undefined);
export const normTags = (tags: string[] | undefined) => (tags ? [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))] : undefined);

/** Specs cleaned up, and the one-line text they're searched by. */
export function normSpecs(specs: z.infer<typeof specInput>[] | undefined) {
  if (!specs) return undefined;
  const clean = specs.map((s) => ({ name: s.name.trim(), value: s.value.trim() })).filter((s) => s.name && s.value);
  return { specs: clean, specsText: clean.map((s) => `${s.name}: ${s.value}`).join('; ').toLowerCase() };
}

/** The default location from an id or a name (made if new); none given: Main. */
async function defaultLocationFor(db: Db, shopId: string, data: { defaultLocationId?: string | null; location?: string | null }) {
  if (data.defaultLocationId) return (await getLocation(db, shopId, data.defaultLocationId)).id;
  return (await locationNamed(db, shopId, data.location ?? MAIN)).id;
}

export async function createPart(db: Prisma.TransactionClient, shopId: string, data: z.infer<typeof partInput>, byName?: string) {
  await assertSupplier(db, shopId, data.supplierId);
  const { openingStock, fitments, crossRefs, costPrice, retailPrice, tradePrice, reorderLevel, reorderQty, taxRate, coreCharge, location, defaultLocationId, tags, specs, quickQtys, purchaseFactor, breaksIntoId, breaksIntoQty, ...rest } = data;
  const locationId = await defaultLocationFor(db, shopId, { defaultLocationId, location });
  await assertBreaksInto(db, shopId, null, breaksIntoId, breaksIntoQty);
  const part = await db.part.create({
    data: {
      ...rest,
      shopId,
      defaultLocationId: locationId,
      crossRefs: normRefs(crossRefs) ?? [],
      tags: normTags(tags) ?? [],
      ...(normSpecs(specs) ?? {}),
      costPrice: D(costPrice ?? 0),
      retailPrice: D(retailPrice),
      tradePrice: tradePrice == null ? null : D(tradePrice),
      reorderLevel: D(reorderLevel ?? 0),
      reorderQty: D(reorderQty ?? 0),
      taxRate: taxRate == null ? null : D(taxRate),
      coreCharge: coreCharge == null || coreCharge === 0 ? null : D(coreCharge),
      quickQtys: quickQtys ?? [],
      purchaseFactor: D(purchaseFactor ?? 1),
      breaksIntoId: breaksIntoId ?? null,
      breaksIntoQty: breaksIntoId && breaksIntoQty ? D(breaksIntoQty) : null,
      fitments: { create: fitmentRows(fitments) },
      stock: { create: { locationId, qty: 0 } },
    },
  });
  if (openingStock > 0) await move(db, part, D(openingStock), 'OPENING', { unitCost: part.costPrice, byName });
  return getPart(db, shopId, part.id);
}

export async function updatePart(db: Db, shopId: string, id: string, data: z.infer<typeof partPatch>) {
  await getPart(db, shopId, id);
  await assertSupplier(db, shopId, data.supplierId);
  const { costPrice, retailPrice, tradePrice, reorderLevel, reorderQty, crossRefs, taxRate, coreCharge, location, defaultLocationId, tags, specs, quickQtys, purchaseFactor, breaksIntoId, breaksIntoQty, ...rest } = data;
  if (breaksIntoId !== undefined || breaksIntoQty !== undefined) {
    const cur = await db.part.findUniqueOrThrow({ where: { id }, select: { breaksIntoId: true, breaksIntoQty: true } });
    await assertBreaksInto(db, shopId, id, breaksIntoId === undefined ? cur.breaksIntoId : breaksIntoId, breaksIntoQty === undefined ? cur.breaksIntoQty?.toNumber() : breaksIntoQty);
  }
  const newDefault = location !== undefined || defaultLocationId !== undefined ? await defaultLocationFor(db, shopId, { defaultLocationId, location }) : undefined;
  if (newDefault) await db.partStock.upsert({ where: { partId_locationId: { partId: id, locationId: newDefault } }, create: { partId: id, locationId: newDefault, qty: 0 }, update: {} });
  await db.part.update({
    where: { id },
    data: {
      ...rest,
      ...(newDefault ? { defaultLocationId: newDefault } : {}),
      ...(crossRefs !== undefined ? { crossRefs: normRefs(crossRefs) } : {}),
      ...(tags !== undefined ? { tags: normTags(tags) } : {}),
      ...(specs !== undefined ? normSpecs(specs) : {}),
      ...(costPrice !== undefined ? { costPrice: D(costPrice) } : {}),
      ...(retailPrice !== undefined ? { retailPrice: D(retailPrice) } : {}),
      ...(tradePrice !== undefined ? { tradePrice: tradePrice == null ? null : D(tradePrice) } : {}),
      ...(reorderLevel !== undefined ? { reorderLevel: D(reorderLevel) } : {}),
      ...(reorderQty !== undefined ? { reorderQty: D(reorderQty) } : {}),
      ...(taxRate !== undefined ? { taxRate: taxRate == null ? null : D(taxRate) } : {}),
      ...(coreCharge !== undefined ? { coreCharge: coreCharge == null || coreCharge === 0 ? null : D(coreCharge) } : {}),
      ...(quickQtys !== undefined ? { quickQtys } : {}),
      ...(purchaseFactor !== undefined ? { purchaseFactor: D(purchaseFactor) } : {}),
      ...(breaksIntoId !== undefined ? { breaksIntoId: breaksIntoId ?? null, ...(breaksIntoId ? {} : { breaksIntoQty: null }) } : {}),
      ...(breaksIntoQty !== undefined && breaksIntoId !== null ? { breaksIntoQty: breaksIntoQty == null ? null : D(breaksIntoQty) } : {}),
    },
  });
  return getPart(db, shopId, id);
}

async function assertBreaksInto(db: Db, shopId: string, id: string | null, into: string | null | undefined, qty: number | null | undefined) {
  if (!into) return;
  if (into === id) throw new DomainError(422, "A pack can't open into itself");
  const loose = await db.part.findFirst({ where: { id: into, shopId }, select: { id: true, isKit: true } });
  if (!loose) throw notFound('Loose part');
  if (loose.isKit) throw new DomainError(422, "A pack can't open into a kit");
  if (!qty) throw new DomainError(422, 'Say how many of the loose part one pack makes');
}

export async function replaceFitments(db: Prisma.TransactionClient, shopId: string, id: string, fitments: z.infer<typeof fitmentInput>[]) {
  await getPart(db, shopId, id);
  await db.partFitment.deleteMany({ where: { partId: id } });
  await db.partFitment.createMany({ data: fitmentRows(fitments).map((f) => ({ ...f, partId: id })) });
  return getPart(db, shopId, id);
}

// ─── Moving stock ───────────────────────────────────────────────────────────

type Refs = {
  unitCost?: Prisma.Decimal | null;
  saleId?: string;
  returnId?: string;
  purchaseId?: string;
  orderId?: string;
  countId?: string;
  supplierReturnId?: string;
  note?: string | null;
  byName?: string | null;
  /** In: where it goes (default location if left out). Out: only from here (otherwise default first, then the fullest). */
  locationId?: string | null;
};
type MovablePart = Pick<Part, 'id' | 'shopId' | 'name' | 'costPrice' | 'defaultLocationId'>;

async function writeMovement(db: Db, part: MovablePart, change: Prisma.Decimal, reason: StockReason, refs: Refs, location: { id: string; name: string }) {
  await db.stockMovement.create({
    data: {
      shopId: part.shopId,
      partId: part.id,
      quantityChange: change,
      reason,
      unitCost: refs.unitCost ?? part.costPrice,
      saleId: refs.saleId,
      returnId: refs.returnId,
      purchaseId: refs.purchaseId,
      orderId: refs.orderId,
      countId: refs.countId,
      supplierReturnId: refs.supplierReturnId,
      note: refs.note ?? null,
      byName: refs.byName ?? null,
      locationId: location.id,
      locationName: location.name,
    },
  });
}

/**
 * Moves stock by `change` (+ in, − out) and records why, per location. Out
 * fails rather than go below zero anywhere. Returns where it moved.
 */
export async function move(db: Db, part: MovablePart, change: Prisma.Decimal, reason: StockReason, refs: Refs = {}): Promise<{ locationId: string; qty: Prisma.Decimal }[]> {
  if (change.isZero()) return [];
  if (change.gt(0)) {
    const loc = refs.locationId ? await getLocation(db, part.shopId, refs.locationId) : await db.location.findUniqueOrThrow({ where: { id: part.defaultLocationId } });
    await db.$executeRaw`
      INSERT INTO "part_stock" ("part_id", "location_id", "qty", "updated_at") VALUES (${part.id}, ${loc.id}, ${change}, now())
      ON CONFLICT ("part_id", "location_id") DO UPDATE SET "qty" = "part_stock"."qty" + ${change}, "updated_at" = now()`;
    await db.$executeRaw`UPDATE "parts" SET "stock_qty" = "stock_qty" + ${change}, "updated_at" = now() WHERE "id" = ${part.id}`;
    await writeMovement(db, part, change, reason, refs, loc);
    return [{ locationId: loc.id, qty: change }];
  }

  // Out: lock this part's stock rows, then take from the default location first, then the fullest.
  const rows = await db.$queryRaw<{ location_id: string; qty: Prisma.Decimal; name: string }[]>`
    SELECT s."location_id", s."qty", l."name" FROM "part_stock" s JOIN "locations" l ON l."id" = s."location_id"
    WHERE s."part_id" = ${part.id} ORDER BY s."location_id" FOR UPDATE OF s`;
  const need = change.negated();
  const usable = refs.locationId ? rows.filter((r) => r.location_id === refs.locationId) : rows;
  const have = usable.reduce((s, r) => s.plus(Prisma.Decimal.max(r.qty, 0)), D(0));
  if (have.lt(need)) {
    const where = refs.locationId ? ` at ${usable[0]?.name ?? 'that location'}` : '';
    throw conflict(`Only ${have.toString()} of ${part.name} in stock${where}`);
  }
  const order = [...usable].sort((a, b) => (a.location_id === part.defaultLocationId ? -1 : b.location_id === part.defaultLocationId ? 1 : b.qty.comparedTo(a.qty)));
  let left = need;
  const moved: { locationId: string; qty: Prisma.Decimal }[] = [];
  for (const r of order) {
    if (left.isZero()) break;
    const take = Prisma.Decimal.min(left, Prisma.Decimal.max(r.qty, 0));
    if (take.isZero()) continue;
    await db.$executeRaw`UPDATE "part_stock" SET "qty" = "qty" - ${take}, "updated_at" = now() WHERE "part_id" = ${part.id} AND "location_id" = ${r.location_id}`;
    await writeMovement(db, part, take.negated(), reason, refs, { id: r.location_id, name: r.name });
    moved.push({ locationId: r.location_id, qty: take.negated() });
    left = left.minus(take);
  }
  const updated = await db.$executeRaw`UPDATE "parts" SET "stock_qty" = "stock_qty" - ${need}, "updated_at" = now() WHERE "id" = ${part.id} AND "stock_qty" - ${need} >= 0`;
  if (updated === 0) throw conflict(`Only ${have.toString()} of ${part.name} in stock`);
  return moved;
}

/**
 * Moves stock of something sold: a kit moves each of its components (kit
 * quantity × component quantity), anything else moves itself.
 */
export async function moveSellable(db: Db, part: MovablePart & { isKit: boolean }, change: Prisma.Decimal, reason: StockReason, refs: Refs = {}) {
  if (!part.isKit) return move(db, part, change, reason, refs);
  const components = await db.kitComponent.findMany({ where: { kitId: part.id }, include: { component: true } });
  const moved: { locationId: string; qty: Prisma.Decimal }[] = [];
  for (const c of components) {
    moved.push(...(await move(db, c.component, change.mul(c.quantity), reason, { ...refs, locationId: change.gt(0) ? undefined : refs.locationId, note: [refs.note, `in kit ${part.name}`].filter(Boolean).join(', ') })));
  }
  return moved;
}

/** A kit's cost: its components' costs. */
export async function kitCost(db: Db, kitId: string) {
  const components = await db.kitComponent.findMany({ where: { kitId }, include: { component: { select: { costPrice: true } } } });
  return components.reduce((s, c) => s.plus(c.component.costPrice.mul(c.quantity)), D(0));
}

/** Makes a part a kit of these components (or changes them). A kit holds no stock of its own. */
export async function setKit(db: Prisma.TransactionClient, shopId: string, id: string, data: z.infer<typeof kitInput>) {
  const part = await getPart(db, shopId, id);
  if (!part.isKit && !part.stockQty.isZero()) throw conflict(`Take ${part.name}'s own stock out first: a kit's stock is its components`);
  const ids = data.components.map((c) => c.partId);
  if (ids.includes(id)) throw new DomainError(422, "A kit can't contain itself");
  if (new Set(ids).size !== ids.length) throw new DomainError(422, 'Each component once, with its quantity');
  const parts = await db.part.findMany({ where: { shopId, id: { in: ids } }, select: { id: true, isKit: true, name: true } });
  if (parts.length !== ids.length) throw notFound('Component part');
  const nested = parts.find((p) => p.isKit);
  if (nested) throw new DomainError(422, `${nested.name} is a kit itself: put its parts in instead`);
  await db.kitComponent.deleteMany({ where: { kitId: id } });
  await db.kitComponent.createMany({ data: data.components.map((c) => ({ kitId: id, componentId: c.partId, quantity: D(c.quantity) })) });
  await db.part.update({ where: { id }, data: { isKit: true, serialized: false, fractional: false } });
  return getPart(db, shopId, id);
}

/** Turns a kit back into an ordinary part. */
export async function unsetKit(db: Prisma.TransactionClient, shopId: string, id: string) {
  await getPart(db, shopId, id);
  await db.kitComponent.deleteMany({ where: { kitId: id } });
  await db.part.update({ where: { id }, data: { isKit: false } });
  return getPart(db, shopId, id);
}

/**
 * Opens sealed packs into the loose part: one 4 L bottle out, 4 L in. The
 * loose stock comes in at the pack's cost shared out, averaged with what's
 * already loose.
 */
export async function breakBulk(db: Prisma.TransactionClient, shopId: string, id: string, data: z.infer<typeof breakInput>, byName?: string) {
  const pack = await getPart(db, shopId, id);
  if (!pack.breaksIntoId || !pack.breaksIntoQty) throw new DomainError(422, `${pack.name} isn't set up to be opened into a loose part`);
  const loose = await db.part.findUniqueOrThrow({ where: { id: pack.breaksIntoId } });
  const packs = D(data.quantity);
  const added = packs.mul(pack.breaksIntoQty);
  const unitCost = pack.costPrice.div(pack.breaksIntoQty);
  const onHand = Prisma.Decimal.max(loose.stockQty, 0);
  const avg = onHand.plus(added).isZero() ? unitCost : onHand.mul(loose.costPrice).plus(added.mul(unitCost)).div(onHand.plus(added));
  const note = `Opened ${packs.toString()} × ${pack.name} into ${added.toString()} ${loose.unit} of ${loose.name}`;
  await move(db, pack, packs.negated(), 'BREAK_BULK', { locationId: data.locationId ?? undefined, note, byName });
  await move(db, loose, added, 'BREAK_BULK', { unitCost, locationId: data.intoLocationId ?? undefined, note, byName });
  await db.part.update({ where: { id: loose.id }, data: { costPrice: avg.toDecimalPlaces(2) } });
  return { pack: await getPart(db, shopId, id), loose: await getPart(db, shopId, loose.id), note };
}

/** Moves stock from one location to another: the total doesn't change. */
export async function transfer(db: Prisma.TransactionClient, shopId: string, id: string, data: z.infer<typeof transferInput>, byName?: string) {
  const part = await getPart(db, shopId, id);
  if (data.fromLocationId === data.toLocationId) throw new DomainError(422, 'Pick two different locations');
  const to = await getLocation(db, shopId, data.toLocationId);
  if (!to.active) throw conflict(`${to.name} is no longer in use`);
  const qty = D(data.quantity);
  const note = data.note ?? null;
  await move(db, part, qty.negated(), 'MOVE', { locationId: data.fromLocationId, note, byName });
  await move(db, part, qty, 'MOVE', { locationId: to.id, note, byName });
  return getPart(db, shopId, id);
}

export async function adjust(db: Prisma.TransactionClient, shopId: string, id: string, data: z.infer<typeof adjustInput>, byName?: string) {
  const part = await getPart(db, shopId, id);
  if (part.isKit) throw new DomainError(422, "A kit holds no stock of its own: adjust its components");
  const locationId = data.locationId ?? part.defaultLocationId;
  const here = part.stock.find((s) => s.locationId === locationId)?.qty ?? D(0);
  const change = data.change != null ? D(data.change) : D(data.countedQty!).minus(here);
  if (data.reason === 'DAMAGED' && !change.lt(0)) throw new DomainError(422, 'Damaged stock is taken out: use a negative change');
  await move(db, part, change, data.reason, { note: data.note ?? (data.countedQty != null ? `Counted ${data.countedQty}` : null), byName, locationId });
  return { part: await getPart(db, shopId, id), change };
}

export async function categories(db: Db, shopId: string) {
  const rows = await db.part.groupBy({ by: ['category'], where: { shopId, active: true, category: { not: null } }, _count: { _all: true }, orderBy: { category: 'asc' } });
  return rows.map((r) => ({ category: r.category!, parts: r._count._all }));
}

export async function tags(db: Db, shopId: string) {
  const rows = await db.$queryRaw<{ tag: string; parts: bigint }[]>`
    SELECT t AS tag, COUNT(*) AS parts FROM "parts", unnest("tags") AS t WHERE "shop_id" = ${shopId} AND "active" GROUP BY t ORDER BY parts DESC, t`;
  return rows.map((r) => ({ tag: r.tag, parts: Number(r.parts) }));
}

// ─── Substitutes ────────────────────────────────────────────────────────────

export async function addSubstitute(db: Prisma.TransactionClient, shopId: string, id: string, otherId: string, note: string | null | undefined) {
  if (id === otherId) throw new DomainError(422, "A part can't stand in for itself");
  await getPart(db, shopId, id);
  await getPart(db, shopId, otherId);
  for (const [a, b] of [[id, otherId], [otherId, id]]) {
    await db.partSubstitute.upsert({ where: { partId_substituteId: { partId: a, substituteId: b } }, create: { partId: a, substituteId: b, note: note ?? null }, update: { note: note ?? null } });
  }
  return getPart(db, shopId, id);
}

export async function removeSubstitute(db: Prisma.TransactionClient, shopId: string, id: string, otherId: string) {
  await getPart(db, shopId, id);
  await db.partSubstitute.deleteMany({ where: { OR: [{ partId: id, substituteId: otherId }, { partId: otherId, substituteId: id }] } });
  return getPart(db, shopId, id);
}

// ─── Trade in one part ──────────────────────────────────────────────────────

/** Who bought it and who sold it to the shop: counter sales, garage orders, purchase orders, and each supplier's prices. */
export async function partTrade(db: Db, shopId: string, id: string, withCost: boolean) {
  await getPart(db, shopId, id);
  const [sales, orders, purchases] = await Promise.all([
    db.saleItem.findMany({ where: { partId: id, sale: { shopId } }, include: { sale: { select: { id: true, number: true, createdAt: true, customerName: true, plate: true, voidedAt: true, cashierName: true } } }, orderBy: { sale: { createdAt: 'desc' } }, take: 100 }),
    db.garageOrderItem.findMany({ where: { partId: id, order: { shopId } }, include: { order: { select: { id: true, number: true, status: true, createdAt: true, completedAt: true, account: { select: { garageName: true } } } } }, orderBy: { order: { createdAt: 'desc' } }, take: 100 }),
    withCost
      ? db.purchaseOrderItem.findMany({ where: { partId: id, purchase: { shopId } }, include: { purchase: { select: { id: true, number: true, status: true, createdAt: true, receivedAt: true, supplier: { select: { id: true, name: true } } } } }, orderBy: { purchase: { createdAt: 'desc' } }, take: 100 })
      : Promise.resolve([]),
  ]);
  const suppliers = new Map<string, { id: string; name: string; lastCost: Prisma.Decimal; bestCost: Prisma.Decimal; lastAt: Date; bought: Prisma.Decimal }>();
  for (const p of [...purchases].reverse()) {
    const s = p.purchase.supplier;
    const prev = suppliers.get(s.id);
    suppliers.set(s.id, {
      id: s.id,
      name: s.name,
      lastCost: p.unitCost,
      bestCost: prev ? Prisma.Decimal.min(prev.bestCost, p.unitCost) : p.unitCost,
      lastAt: p.purchase.createdAt,
      bought: (prev?.bought ?? D(0)).plus(p.receivedQty),
    });
  }
  return { sales, orders, purchases, suppliers: [...suppliers.values()].sort((a, b) => a.lastCost.comparedTo(b.lastCost)) };
}
