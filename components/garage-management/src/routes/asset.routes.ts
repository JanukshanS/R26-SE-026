import { Router } from 'express';

import * as assets from '../services/assets';
import { presentAsset, presentAssetLog } from '../services/presenters';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { assetCheckInInput, assetCheckOutInput, assetInput, assetPatch, assetServiceInput, assetsQuery } from '../validation';

/** Owner only (mounted behind ownerOnly). */
export const assetRouter = Router();

const out = (a: assets.AssetRow) => presentAsset(a, assets.daysUntil(a.nextServiceDue));

assetRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = assetsQuery.parse(req.query);
    const rows = await assets.listAssets(prisma, req.garage!.id, { q: q.q, category: q.category, status: q.status, includeInactive: q.includeInactive === 'true' });
    ok(res, rows.map(out));
  }),
);
assetRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, out(await assets.createAsset(prisma, req.garage!.id, assetInput.parse(req.body))), 201);
  }),
);
assetRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, out(await assets.getAsset(prisma, req.garage!.id, req.params.id)));
  }),
);
assetRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, out(await assets.updateAsset(prisma, req.garage!.id, req.params.id, assetPatch.parse(req.body))));
  }),
);
assetRouter.post(
  '/:id/check-out',
  asyncHandler(async (req, res) => {
    const data = assetCheckOutInput.parse(req.body);
    ok(res, out(await prisma.$transaction((tx) => assets.checkOut(tx, req.garage!.id, req.params.id, data))));
  }),
);
assetRouter.post(
  '/:id/check-in',
  asyncHandler(async (req, res) => {
    const data = assetCheckInInput.parse(req.body);
    ok(res, out(await prisma.$transaction((tx) => assets.checkIn(tx, req.garage!.id, req.params.id, data))));
  }),
);
assetRouter.post(
  '/:id/service',
  asyncHandler(async (req, res) => {
    const data = assetServiceInput.parse(req.body);
    ok(res, out(await prisma.$transaction((tx) => assets.recordService(tx, req.garage!.id, req.params.id, data))));
  }),
);
assetRouter.get(
  '/:id/log',
  asyncHandler(async (req, res) => {
    ok(res, (await assets.listLogs(prisma, req.garage!.id, req.params.id)).map(presentAssetLog));
  }),
);
