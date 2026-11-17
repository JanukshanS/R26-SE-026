import { Router } from 'express';

import { report, resolveRange } from '../services/reports';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { reportsQuery } from '../validation';

/** Owner only (mounted behind ownerOnly). */
export const reportRouter = Router();

reportRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to } = reportsQuery.parse(req.query);
    ok(res, await report(prisma, req.garage!.id, resolveRange(from, to)));
  }),
);
