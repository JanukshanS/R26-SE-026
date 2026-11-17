import { Router } from 'express';

import { presentLocation, presentOrder, presentStockCount } from '../services/presenters';
import * as stock from '../services/stock';
import { asyncHandler, ok, page, pageParams } from '../utils/http';
import { prisma } from '../utils/prisma';
import { locationInput, locationPatch, purchaseOrderInput, purchaseOrderPatch, purchaseOrdersQuery, receiveInput, stockCountInput } from '../validation';

/** Owner only (mounted behind ownerOnly). */
export const locationRouter = Router();

locationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await stock.listLocations(prisma, req.garage!.id, req.query.includeInactive === 'true');
    ok(res, rows.map(presentLocation));
  }),
);
locationRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, presentLocation(await stock.createLocation(prisma, req.garage!.id, locationInput.parse(req.body))), 201);
  }),
);
locationRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentLocation(await stock.updateLocation(prisma, req.garage!.id, req.params.id, locationPatch.parse(req.body))));
  }),
);

export const stockCountRouter = Router();

stockCountRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const { items, total } = await stock.listStockCounts(prisma, req.garage!.id, limit, offset);
    ok(res, page(items.map(presentStockCount), total, limit, offset));
  }),
);
stockCountRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = stockCountInput.parse(req.body);
    const count = await prisma.$transaction((tx) => stock.createStockCount(tx, req.garage!.id, data, req.staff?.name ?? null));
    ok(res, presentStockCount(count), 201);
  }),
);
stockCountRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentStockCount(await stock.getStockCount(prisma, req.garage!.id, req.params.id)));
  }),
);

export const purchaseOrderRouter = Router();

purchaseOrderRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const { status } = purchaseOrdersQuery.parse(req.query);
    const { items, total } = await stock.listOrders(prisma, req.garage!.id, status, limit, offset);
    ok(res, page(items.map(presentOrder), total, limit, offset));
  }),
);
purchaseOrderRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = purchaseOrderInput.parse(req.body);
    ok(res, presentOrder(await prisma.$transaction((tx) => stock.createOrder(tx, req.garage!.id, data))), 201);
  }),
);
purchaseOrderRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentOrder(await stock.getOrder(prisma, req.garage!.id, req.params.id)));
  }),
);
purchaseOrderRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = purchaseOrderPatch.parse(req.body);
    ok(res, presentOrder(await prisma.$transaction((tx) => stock.updateOrder(tx, req.garage!.id, req.params.id, data))));
  }),
);
purchaseOrderRouter.post(
  '/:id/place',
  asyncHandler(async (req, res) => {
    ok(res, presentOrder(await stock.placeOrder(prisma, req.garage!.id, req.params.id)));
  }),
);
purchaseOrderRouter.post(
  '/:id/receive',
  asyncHandler(async (req, res) => {
    const data = receiveInput.parse(req.body);
    ok(res, presentOrder(await prisma.$transaction((tx) => stock.receiveOrder(tx, req.garage!.id, req.params.id, data))));
  }),
);
purchaseOrderRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    ok(res, presentOrder(await stock.cancelOrder(prisma, req.garage!.id, req.params.id)));
  }),
);
