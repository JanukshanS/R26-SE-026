import { Router } from 'express';

import * as held from '../services/held';
import { presentHeld } from '../services/presenters';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { heldInput, heldPatch, heldQuery } from '../validation';

/** Customer parts the garage is holding. Owner only (mounted behind ownerOnly). */
export const heldRouter = Router();

heldRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = heldQuery.parse(req.query);
    ok(res, (await held.listHeld(prisma, req.garage!.id, q)).map(presentHeld));
  }),
);
heldRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, presentHeld(await held.createHeld(prisma, req.garage!.id, heldInput.parse(req.body))), 201);
  }),
);
heldRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentHeld(await held.updateHeld(prisma, req.garage!.id, req.params.id, heldPatch.parse(req.body))));
  }),
);
