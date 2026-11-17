import { Router } from 'express';

import * as inspections from '../services/inspections';
import { garageDirectory } from '../services/ownerVisits';
import { jobByToken, presentTracking, repairsForIncidents } from '../services/tracking';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { decisionInput, garageDirectoryQuery, repairsQuery } from '../validation';

/** No sign-in: the tracking token in the path is the key (see services/tracking.ts). */
export const publicRouter = Router();

publicRouter.get(
  '/track/:token',
  asyncHandler(async (req, res) => {
    // Never cached: the page is polled for live progress.
    res.set('Cache-Control', 'no-store');
    ok(res, presentTracking(await jobByToken(prisma, req.params.token)));
  }),
);

publicRouter.post(
  '/track/:token/inspection/items/:itemId',
  asyncHandler(async (req, res) => {
    const { decision } = decisionInput.parse(req.body);
    const job = await jobByToken(prisma, req.params.token);
    await prisma.$transaction((tx) => inspections.decide(tx, job.id, req.params.itemId, decision));
    ok(res, presentTracking(await jobByToken(prisma, req.params.token)));
  }),
);

/**
 * The public garage directory on kaduna.lk: garages that take online bookings
 * and chose to be listed. Contact details and the booking link only.
 */
publicRouter.get(
  '/garages',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    ok(res, await garageDirectory(prisma, garageDirectoryQuery.parse(req.query).q));
  }),
);

/** Any signed-in Kaduna user: status only, for their dispatch jobs (mounted after authenticate). */
export const repairsRouter = Router();

repairsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { incidentIds } = repairsQuery.parse(req.query);
    const ids = [...new Set(incidentIds.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, 50);
    ok(res, await repairsForIncidents(prisma, ids));
  }),
);
