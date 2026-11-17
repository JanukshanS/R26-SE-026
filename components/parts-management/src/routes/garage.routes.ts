import { Router } from 'express';

import { platesOf } from '../services/kadunaVehicles';
import * as orders from '../services/orders';
import {
  presentAccountSummary,
  presentCataloguePart,
  presentEntry,
  presentGarageOrder,
  presentPickup,
  presentPublicShop,
} from '../services/presenters';
import * as trade from '../services/trade';
import { asyncHandler, notFound, ok } from '../utils/http';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';
import * as v from '../validation';

/**
 * A garage's side: finding shops, its trade accounts with them, and its part
 * orders. Mounted at /api/v1/garage behind requireGarage + garageOwnerWrites
 * (mechanics can look, only the owner orders and spends).
 */
export const garageRouter = Router();

garageRouter.get(
  '/shops',
  asyncHandler(async (req, res) => {
    const q = v.directoryQuery.parse(req.query);
    const rows = await orders.directory(prisma, req.garage!.garageId, { q: q.q, linkedOnly: q.linked === 'true' });
    ok(res, rows.map((r) => ({ ...presentPublicShop(r.shop), partCount: r.partCount, account: r.account ? presentAccountSummary(r.account) : null })));
  }),
);

garageRouter.get(
  '/shops/:id',
  asyncHandler(async (req, res) => {
    const { shop, account } = await orders.shopForGarage(prisma, req.garage!.garageId, req.params.id);
    ok(res, { ...presentPublicShop(shop), account: account ? presentAccountSummary(account) : null });
  }),
);

garageRouter.get(
  '/shops/:id/catalogue',
  asyncHandler(async (req, res) => {
    const { vehicle, parts } = await orders.catalogue(prisma, req.garage!.garageId, req.params.id, v.catalogueQuery.parse(req.query));
    ok(res, { vehicle, parts: parts.map(presentCataloguePart) });
  }),
);

garageRouter.put(
  '/shops/:id/link',
  asyncHandler(async (req, res) => {
    const account = await trade.link(prisma, req.params.id, req.garage!);
    ok(res, presentAccountSummary(await orders.accountSummary(prisma, account)));
  }),
);

garageRouter.delete(
  '/shops/:id/link',
  asyncHandler(async (req, res) => {
    await trade.unlink(prisma, req.params.id, req.garage!.garageId);
    ok(res, { linked: false });
  }),
);

garageRouter.get(
  '/shops/:id/statement',
  asyncHandler(async (req, res) => {
    const account = await prisma.tradeAccount.findUnique({ where: { shopId_garageId: { shopId: req.params.id, garageId: req.garage!.garageId } } });
    if (!account) throw notFound('Trade account');
    const st = await trade.statement(prisma, account);
    ok(res, { ...presentAccountSummary(await orders.accountSummary(prisma, account)), overdue: st.overdue.toNumber(), entries: st.lines.map((l) => presentEntry(l.entry, l.order, l.balance)) });
  }),
);

garageRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    ok(res, (await orders.listGarageOrders(prisma, req.garage!.garageId, v.ordersQuery.parse(req.query))).map(presentGarageOrder));
  }),
);

garageRouter.get(
  '/orders/pickup-options',
  asyncHandler(async (req, res) => {
    ok(res, await orders.pickupOptions(req.garage!, v.pickupOptionsQuery.parse(req.query).jobCardId, req.authToken));
  }),
);

garageRouter.post(
  '/orders',
  asyncHandler(async (req, res) => {
    ok(res, presentGarageOrder(await orders.createOrder(req.garage!, v.orderInput.parse(req.body), req.authToken)), 201);
  }),
);

garageRouter.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentGarageOrder(await orders.getGarageOrder(prisma, req.garage!.garageId, req.params.id)));
  }),
);

garageRouter.post(
  '/orders/:id/accept',
  asyncHandler(async (req, res) => {
    ok(res, presentGarageOrder(await orders.acceptQuote(prisma, req.garage!.garageId, req.params.id)));
  }),
);

garageRouter.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res) => {
    ok(res, presentGarageOrder(await orders.cancelOrder(prisma, req.garage!.garageId, req.params.id)));
  }),
);

garageRouter.put(
  '/orders/:id/pickup',
  asyncHandler(async (req, res) => {
    ok(res, presentGarageOrder(await orders.changePickup(prisma, req.garage!, req.params.id, v.pickupPatch.parse(req.body), req.authToken)));
  }),
);

// ─── Collectors: any signed-in account ──────────────────────────────────────

export const pickupsRouter = Router();

pickupsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    let plates: string[] = [];
    try {
      plates = await platesOf(req.authToken);
    } catch (err) {
      // Mechanic pickups still show if the vehicle lookup is down.
      logger.warn(`Plate lookup failed: ${(err as Error).message}`);
    }
    const mine = new Set(plates);
    const rows = await orders.pickupsFor(prisma, req.userId!, plates);
    ok(res, rows.map((o) => presentPickup(o, o.pickupBy === 'VEHICLE_OWNER' && o.pickupPlate && mine.has(o.pickupPlate) ? 'VEHICLE_OWNER' : 'MECHANIC')));
  }),
);
