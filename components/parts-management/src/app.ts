/**
 * Builds the Express app. Kept apart from index.ts so tests can create it
 * without opening a port, and can swap in their own authentication.
 *
 *   /api/v1/shop/*      the caller's own parts shop (set it up with PUT /shop)
 *   /api/v1/garage/*    a garage owner or mechanic: shops, accounts, orders
 *   /api/v1/pickups     anyone collecting parts (a mechanic, a car owner)
 *   /api/v1/me          the shop the caller runs or works at, and their role
 *   /api/v1/public/*    no sign-in: shops and listed parts for kaduna.lk
 */
import cors from 'cors';
import express, { RequestHandler } from 'express';
import helmet from 'helmet';

import { authenticate, garageOwnerWrites, requireGarage } from './middleware/auth';
import { garageRouter, pickupsRouter } from './routes/garage.routes';
import { publicRouter } from './routes/public.routes';
import { shopRouter } from './routes/shop.routes';
import { hasPin, resolveShop } from './services/staff';
import { localFilesRouter } from './services/storage';
import { asyncHandler, errorHandler, ok } from './utils/http';
import { prisma } from './utils/prisma';

export function createApp(opts: { authenticate?: RequestHandler } = {}) {
  const signIn = opts.authenticate ?? authenticate;
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors());
  // The local file store's signed upload and download links: raw bodies, no
  // sign-in (the signed token is the permission), so ahead of the JSON parser.
  app.use('/api/v1/files', localFilesRouter);
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ success: true, data: { service: 'parts-management', status: 'healthy', database: 'connected' }, timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ success: false, error: 'Database connection failed', timestamp: new Date().toISOString() });
    }
  });

  // No sign-in: what kaduna.lk shows the public.
  app.use('/api/v1/public', publicRouter);

  const v1 = express.Router();
  v1.use(signIn);
  v1.get(
    '/me',
    asyncHandler(async (req, res) => {
      const found = await resolveShop(prisma, { userId: req.userId!, email: req.userEmail, name: req.userName });
      ok(
        res,
        found
          ? { shop: { id: found.shop.id, name: found.shop.name }, role: found.actor.role, name: found.actor.name, permissions: found.actor.permissions, hasPin: await hasPin(prisma, found.shop, found.actor) }
          : { shop: null, role: null, name: req.userName ?? null, permissions: [], hasPin: false },
      );
    }),
  );
  v1.use('/shop', shopRouter);
  v1.use('/pickups', pickupsRouter);
  v1.use('/garage', requireGarage, garageOwnerWrites, garageRouter);
  app.use('/api/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found', timestamp: new Date().toISOString() });
  });
  app.use(errorHandler);
  return app;
}
