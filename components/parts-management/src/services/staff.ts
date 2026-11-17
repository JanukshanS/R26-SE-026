/**
 * Who works at the shop and what each of them may do.
 *
 *   OWNER        the account that set the shop up: everything.
 *   MANAGER      everything but staff and the shop's settings.
 *   CASHIER      the counter: sales, held sales and quotes, taking payments,
 *                handing garage orders over, their own cash drawer.
 *   STOREKEEPER  the stockroom: parts, stock counts, purchasing, receiving.
 *
 * The owner adds staff by email. They get in by signing in to Kaduna with that
 * email; their account id is filled in the first time.
 *
 * Approvals: a cashier can't give a discount past the shop's limit, void a
 * sale or refund on their own. A manager (or the owner) standing next to them
 * types their PIN, and the approver's name goes on the record.
 *
 * Everything that matters is written to the audit trail with who did it.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { Prisma, Shop, ShopStaff, StaffRole } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { auditQuery, staffInput, staffPatch } from '../validation';
import { addDays, dayStart } from './shared';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const PERMISSIONS = [
  'sell', // ring up sales, hold sales, write quotes
  'discount', // discounts past the shop's limit
  'void', // void a sale
  'refund', // returns and refunds
  'catalogue', // add and edit parts, prices, import, labels
  'stock', // adjust stock, stocktakes
  'cost', // see cost prices and margins
  'purchasing', // suppliers, purchase orders, receiving, bills, supplier payments and returns
  'accounts', // account terms, customer accounts, credit notes
  'payments', // take a payment on an account
  'orders', // garage orders
  'reports', // dashboard numbers, reports, activity log
  'cash', // everyone's cash drawers, pay in and out
  'settings', // the shop's settings
  'staff', // add and change staff
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type Role = 'OWNER' | StaffRole;

const ALL = [...PERMISSIONS];
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== 'staff' && p !== 'settings'),
  CASHIER: ['sell', 'payments', 'orders'],
  STOREKEEPER: ['catalogue', 'stock', 'cost', 'purchasing', 'orders'],
};

export interface Actor {
  userId: string;
  name: string;
  role: Role;
  staffId: string | null;
  permissions: Permission[];
}

export const can = (a: Actor | undefined, p: Permission) => Boolean(a?.permissions.includes(p));

const roleName: Record<Role, string> = { OWNER: 'Owner', MANAGER: 'Manager', CASHIER: 'Cashier', STOREKEEPER: 'Storekeeper' };

export function assertCan(a: Actor | undefined, ...any: Permission[]) {
  if (!any.some((p) => can(a, p))) throw new DomainError(403, `A ${roleName[a?.role ?? 'CASHIER'].toLowerCase()} can't do that. Ask the owner or a manager`, 'FORBIDDEN');
}

const SEEN_EVERY_MS = 5 * 60_000;

/**
 * The shop the caller works at, and as whom. The shop they own comes first;
 * otherwise an active staff place, matched on their account or (the first
 * time) their sign-in email.
 */
export async function resolveShop(db: Db, who: { userId: string; email?: string | null; name?: string | null }): Promise<{ shop: Shop; actor: Actor } | null> {
  const owned = await db.shop.findUnique({ where: { ownerUserId: who.userId } });
  if (owned) {
    const name = who.name?.trim() || owned.ownerName || 'Owner';
    if (who.name?.trim() && owned.ownerName !== who.name.trim()) await db.shop.update({ where: { id: owned.id }, data: { ownerName: who.name.trim() } });
    return { shop: owned, actor: { userId: who.userId, name, role: 'OWNER', staffId: null, permissions: ROLE_PERMISSIONS.OWNER } };
  }
  const email = who.email?.trim().toLowerCase();
  const staff = await db.shopStaff.findFirst({
    where: { active: true, OR: [{ userId: who.userId }, ...(email ? [{ userId: null, email }] : [])] },
    include: { shop: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!staff) return null;
  const now = new Date();
  if (!staff.userId || !staff.lastSeenAt || now.getTime() - staff.lastSeenAt.getTime() > SEEN_EVERY_MS) {
    await db.shopStaff.update({ where: { id: staff.id }, data: { userId: who.userId, lastSeenAt: now } });
  }
  const { shop, ...s } = staff;
  return { shop, actor: { userId: who.userId, name: s.name, role: s.role, staffId: s.id, permissions: ROLE_PERMISSIONS[s.role] } };
}

// ─── Staff ──────────────────────────────────────────────────────────────────

export const listStaff = (db: Db, shopId: string) => db.shopStaff.findMany({ where: { shopId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });

async function getStaff(db: Db, shopId: string, id: string) {
  const s = await db.shopStaff.findFirst({ where: { id, shopId } });
  if (!s) throw notFound('Staff member');
  return s;
}

export async function addStaff(db: Db, shop: Shop, actor: Actor, data: z.infer<typeof staffInput>) {
  const email = data.email.trim().toLowerCase();
  const existing = await db.shopStaff.findUnique({ where: { shopId_email: { shopId: shop.id, email } } });
  if (existing) throw conflict(`${existing.name} already works here with that email`);
  const s = await db.shopStaff.create({ data: { shopId: shop.id, email, name: data.name, phone: data.phone ?? null, role: data.role } });
  await audit(db, shop.id, actor, 'staff.add', `Added ${s.name} (${roleName[s.role]}, ${email})`, { entity: 'staff', entityId: s.id });
  return s;
}

export async function updateStaff(db: Db, shop: Shop, actor: Actor, id: string, data: z.infer<typeof staffPatch>) {
  const before = await getStaff(db, shop.id, id);
  const s = await db.shopStaff.update({ where: { id }, data });
  const changes = [
    data.role && data.role !== before.role ? `role ${roleName[before.role]} to ${roleName[data.role]}` : null,
    data.active === false && before.active ? 'removed access' : null,
    data.active === true && !before.active ? 'gave access back' : null,
  ].filter(Boolean);
  if (changes.length) await audit(db, shop.id, actor, 'staff.change', `${s.name}: ${changes.join(', ')}`, { entity: 'staff', entityId: s.id });
  return s;
}

// ─── PINs and approvals ─────────────────────────────────────────────────────

async function hashPin(pin: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pin, salt, 32)).toString('hex')}`;
}

async function pinMatches(pin: string, stored: string | null) {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const got = await scrypt(pin, Buffer.from(salt, 'hex'), 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Sets the caller's own approval PIN. */
export async function setPin(db: Db, shop: Shop, actor: Actor, pin: string) {
  const pinHash = await hashPin(pin);
  if (actor.role === 'OWNER') await db.shop.update({ where: { id: shop.id }, data: { ownerPinHash: pinHash } });
  else await db.shopStaff.update({ where: { id: actor.staffId! }, data: { pinHash } });
  await audit(db, shop.id, actor, 'staff.pin', `${actor.name} set their approval PIN`);
}

export async function hasPin(db: Db, shop: Shop, actor: Actor) {
  if (actor.role === 'OWNER') return Boolean(shop.ownerPinHash);
  const s = await db.shopStaff.findUnique({ where: { id: actor.staffId! }, select: { pinHash: true } });
  return Boolean(s?.pinHash);
}

const APPROVAL_TEXT: Partial<Record<Permission, string>> = {
  discount: 'That discount is more than you can give',
  void: 'Voiding a sale',
  refund: 'Refunds',
};

/**
 * null when the caller may do it themselves; otherwise the name of whoever
 * approved it with their PIN. Throws APPROVAL_REQUIRED (403) without a PIN, or
 * when the PIN doesn't belong to someone who may approve it.
 */
export async function approval(db: Db, shop: Shop, actor: Actor, permission: Permission, pin: string | null | undefined): Promise<string | null> {
  if (can(actor, permission)) return null;
  const what = APPROVAL_TEXT[permission] ?? 'That';
  if (!pin) throw new DomainError(403, `${what} needs a manager's approval. Ask them to enter their PIN`, 'APPROVAL_REQUIRED');
  if ((await pinMatches(pin, shop.ownerPinHash)) && ROLE_PERMISSIONS.OWNER.includes(permission)) return shop.ownerName ?? 'Owner';
  const approvers = await db.shopStaff.findMany({ where: { shopId: shop.id, active: true, pinHash: { not: null }, role: { in: (['MANAGER'] as StaffRole[]).filter((r) => ROLE_PERMISSIONS[r].includes(permission)) } } });
  for (const a of approvers) if (await pinMatches(pin, a.pinHash)) return a.name;
  throw new DomainError(403, "That PIN can't approve this", 'APPROVAL_REQUIRED');
}

// ─── Audit trail ────────────────────────────────────────────────────────────

export async function audit(
  db: Db,
  shopId: string,
  actor: Pick<Actor, 'userId' | 'name'>,
  action: string,
  summary: string,
  more: { entity?: string; entityId?: string; amount?: Prisma.Decimal | number | null } = {},
) {
  await db.auditEvent.create({
    data: {
      shopId,
      actorUserId: actor.userId,
      actorName: actor.name,
      action,
      summary,
      entity: more.entity ?? null,
      entityId: more.entityId ?? null,
      amount: more.amount == null ? null : new Prisma.Decimal(more.amount),
    },
  });
}

export function listAudit(db: Db, shopId: string, q: z.infer<typeof auditQuery>) {
  const contains = q.q ? { contains: q.q, mode: 'insensitive' as const } : undefined;
  return db.auditEvent.findMany({
    where: {
      shopId,
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: dayStart(q.from) } : {}), ...(q.to ? { lt: dayStart(addDays(q.to, 1)) } : {}) } } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(contains ? { OR: [{ summary: contains }, { actorName: contains }] } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: q.limit,
  });
}

export type StaffRow = ShopStaff;
