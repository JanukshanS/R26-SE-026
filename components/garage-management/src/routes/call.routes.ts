import { Router } from 'express';

import * as calls from '../services/calls';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { callInput, callStatsQuery } from '../validation';

/** Any signed-in Kaduna account: log a call to a listed garage, then dial the number returned. */
export const callRouter = Router();

callRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { garageId, source } = callInput.parse(req.body);
    const call = await calls.recordCall(prisma, req.userId!, garageId, source);
    ok(res, call, call.counted ? 201 : 200);
  }),
);

/** Kaduna administrators (mounted behind requireOps). */
export const adminRouter = Router();

const DAY_MS = 86_400_000;

adminRouter.get(
  '/garage-calls',
  asyncHandler(async (req, res) => {
    const q = callStatsQuery.parse(req.query);
    const to = q.to ? new Date(Date.parse(`${q.to}T00:00:00.000Z`) + DAY_MS) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00.000Z`) : new Date(to.getTime() - 30 * DAY_MS);
    ok(res, await calls.callStats(prisma, from, to));
  }),
);
