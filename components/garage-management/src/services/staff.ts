/**
 * Mechanics. The owner adds a mechanic and gets an invite code; the mechanic
 * signs in to Kaduna with their own account and enters the code, which links
 * that account to the garage (see requireGarage in middleware/auth.ts).
 * A code works once. The owner can issue a new one, or switch a mechanic off,
 * which stops them signing in to the garage straight away.
 */
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, DomainError, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { staffInput, staffPatch } from '../validation';
import { emit, newInviteCode } from './shared';

export function listStaff(db: Db, garageId: string) {
  return db.staffMember.findMany({ where: { garageId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
}

export async function getStaff(db: Db, garageId: string, id: string) {
  const member = await db.staffMember.findFirst({ where: { id, garageId } });
  if (!member) throw notFound('Mechanic');
  return member;
}

/** Invite codes are unique across all garages; retry on the rare collision. */
async function withFreshCode<T>(attempt: (code: string) => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt(newInviteCode());
    } catch (err) {
      const clash = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!clash || i >= 4) throw err;
    }
  }
}

export function createStaff(db: Db, garageId: string, data: z.infer<typeof staffInput>) {
  return withFreshCode((inviteCode) => db.staffMember.create({ data: { ...data, garageId, inviteCode } }));
}

export async function updateStaff(db: Db, garageId: string, id: string, data: z.infer<typeof staffPatch>) {
  await getStaff(db, garageId, id);
  return db.staffMember.update({ where: { id }, data });
}

/**
 * A new code, and the old account unlinked: for a mechanic who changed phone or
 * account, or a code that went to the wrong person.
 */
export async function resetInvite(db: Db, garageId: string, id: string) {
  await getStaff(db, garageId, id);
  return withFreshCode((inviteCode) => db.staffMember.update({ where: { id }, data: { inviteCode, userId: null, joinedAt: null } }));
}

export async function joinGarage(db: Prisma.TransactionClient, userId: string, code: string) {
  if (await db.staffMember.findUnique({ where: { userId }, select: { id: true } })) {
    throw conflict('This account already belongs to a garage');
  }
  const member = await db.staffMember.findUnique({ where: { inviteCode: code } });
  if (!member || !member.active) throw new DomainError(404, "That invite code isn't valid. Ask the garage owner for a new one");
  const joined = await db.staffMember.update({
    where: { id: member.id },
    data: { userId, joinedAt: new Date(), inviteCode: null },
    include: { garage: true },
  });
  await emit(db, member.garageId, 'staff.joined', { staffId: member.id });
  return joined;
}
