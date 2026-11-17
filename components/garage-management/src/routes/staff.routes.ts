import { Router } from 'express';

import * as staff from '../services/staff';
import { presentGarage, presentStaff } from '../services/presenters';
import { asyncHandler, conflict, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { joinInput, staffInput, staffPatch } from '../validation';

/** Owner only (mounted behind ownerOnly). */
export const staffRouter = Router();

staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const members = await staff.listStaff(prisma, req.garage!.id);
    ok(res, members.map((m) => presentStaff(m, { withInvite: true })));
  }),
);

staffRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const member = await staff.createStaff(prisma, req.garage!.id, staffInput.parse(req.body));
    ok(res, presentStaff(member, { withInvite: true }), 201);
  }),
);

staffRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const member = await staff.updateStaff(prisma, req.garage!.id, req.params.id, staffPatch.parse(req.body));
    ok(res, presentStaff(member, { withInvite: true }));
  }),
);

staffRouter.post(
  '/:id/invite',
  asyncHandler(async (req, res) => {
    ok(res, presentStaff(await staff.resetInvite(prisma, req.garage!.id, req.params.id), { withInvite: true }));
  }),
);

/**
 * Who the caller is to the garage service, before any garage is required:
 * OWNER (garage may still be null, before setup), MECHANIC, or null.
 */
export const meRouter = Router();

meRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (req.providerId) {
      const garage = await prisma.garage.findUnique({ where: { providerId: req.providerId } });
      ok(res, { role: 'OWNER', garage: garage ? presentGarage(garage) : null, staff: null });
      return;
    }
    const member = req.userId ? await prisma.staffMember.findUnique({ where: { userId: req.userId }, include: { garage: true } }) : null;
    if (member?.active) {
      ok(res, { role: 'MECHANIC', garage: presentGarage(member.garage), staff: presentStaff(member) });
      return;
    }
    ok(res, { role: null, garage: null, staff: null });
  }),
);

/** A mechanic links their own Kaduna account to a garage with the owner's invite code. */
export const joinRouter = Router();

joinRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { code } = joinInput.parse(req.body);
    if (req.providerId) throw conflict('This account runs its own garage. Sign in with your own account to join as a mechanic');
    const member = await prisma.$transaction((tx) => staff.joinGarage(tx, req.userId!, code));
    ok(res, { role: 'MECHANIC', garage: presentGarage(member.garage), staff: presentStaff(member) });
  }),
);
