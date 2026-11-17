import { Router } from 'express';

import { presentGarage } from '../services/presenters';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { garageInput } from '../validation';

export const garageRouter = Router();

garageRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // null (not 404) before setup: "no garage yet" is a normal state the
    // client shows a setup form for, not an error.
    const garage = await prisma.garage.findUnique({ where: { providerId: req.providerId! } });
    ok(res, garage ? presentGarage(garage) : null);
  }),
);

/** Creates the caller's garage on first save and updates it afterwards. One garage per provider. */
garageRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const data = garageInput.parse(req.body);
    const providerId = req.providerId!;
    const existed = await prisma.garage.findUnique({ where: { providerId }, select: { id: true } });
    const garage = await prisma.garage.upsert({ where: { providerId }, create: { ...data, providerId }, update: data });
    ok(res, presentGarage(garage), existed ? 200 : 201);
  }),
);
