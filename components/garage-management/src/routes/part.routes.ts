import { Router } from 'express';

import * as inventory from '../services/inventory';
import { presentMovement, presentPart } from '../services/presenters';
import { asyncHandler, ok, page, pageParams } from '../utils/http';
import { prisma } from '../utils/prisma';
import { partInput, partPatch, partsQuery, stockAdjustInput } from '../validation';

export const partRouter = Router();

partRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const query = partsQuery.parse(req.query);
    const { items, total } = await inventory.listParts(
      prisma,
      req.garage!.id,
      { q: query.q, lowStock: query.lowStock === 'true', includeInactive: query.includeInactive === 'true' },
      limit,
      offset,
    );
    ok(res, page(items.map(presentPart), total, limit, offset));
  }),
);

partRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = partInput.parse(req.body);
    const part = await prisma.$transaction((tx) => inventory.createPart(tx, req.garage!.id, data));
    ok(res, presentPart(part), 201);
  }),
);

partRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentPart(await inventory.getPart(prisma, req.garage!.id, req.params.id)));
  }),
);

partRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const part = await inventory.updatePart(prisma, req.garage!.id, req.params.id, partPatch.parse(req.body));
    ok(res, presentPart(part));
  }),
);

/** Stock received, returned to a supplier, or corrected after a count. */
partRouter.post(
  '/:id/stock',
  asyncHandler(async (req, res) => {
    const data = stockAdjustInput.parse(req.body);
    const part = await prisma.$transaction((tx) => inventory.adjustStock(tx, req.garage!.id, req.params.id, data));
    ok(res, presentPart(part));
  }),
);

partRouter.get(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const { items, total } = await inventory.listMovements(prisma, req.garage!.id, req.params.id, limit, offset);
    ok(res, page(items.map(presentMovement), total, limit, offset));
  }),
);
