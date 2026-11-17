/**
 * Builds the Express app. Kept apart from index.ts so tests can create it
 * without opening a port, and can swap in their own authentication.
 *
 *   /api/v1/public/*     no sign-in: customer tracking and booking links
 *   /api/v1/me, /repairs, /staff/join, /garage, /my
 *                        signed in, no garage needed yet
 *   everything else      signed in and acting for a garage, as OWNER or
 *                        MECHANIC (see middleware/auth.ts for who may do what)
 */
import cors from 'cors';
import express, { RequestHandler } from 'express';
import helmet from 'helmet';

import { authenticate, ownerOnly, ownerWrites, requireGarage, requireProviderAccount } from './middleware/auth';
import { appointmentRouter } from './routes/appointment.routes';
import { bookingSettingsRouter, publicBookingRouter } from './routes/booking.routes';
import { customerRouter, vehicleRouter } from './routes/customer.routes';
import { garageRouter } from './routes/garage.routes';
import { dashboardRouter, invoiceRouter } from './routes/invoice.routes';
import { inspectionRouter, jobRouter } from './routes/job.routes';
import { partRouter } from './routes/part.routes';
import { internalRouter } from './routes/internal.routes';
import { ownerRouter } from './routes/owner.routes';
import { publicRouter, repairsRouter } from './routes/public.routes';
import { reportRouter } from './routes/report.routes';
import { joinRouter, meRouter, staffRouter } from './routes/staff.routes';
import { supplierRouter } from './routes/supplier.routes';
import { errorHandler } from './utils/http';
import { prisma } from './utils/prisma';

export function createApp(opts: { authenticate?: RequestHandler } = {}) {
  const signIn = opts.authenticate ?? authenticate;
  const app = express();
  // Behind Caddy: take the client address from X-Forwarded-For (used to rate-limit public bookings).
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors());
  // Room for a garage logo sent as a data: URL.
  app.use(express.json({ limit: '512kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ success: true, data: { service: 'garage-management', status: 'healthy', database: 'connected' }, timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ success: false, error: 'Database connection failed', timestamp: new Date().toISOString() });
    }
  });

  // Other Kaduna services only (shared secret); blocked at the edge by Caddy.
  app.use('/internal/v1', internalRouter);

  app.use('/api/v1/public', publicRouter);
  app.use('/api/v1/public', publicBookingRouter);

  const v1 = express.Router();
  v1.use(signIn);
  v1.use('/me', meRouter);
  v1.use('/repairs', repairsRouter);
  v1.use('/staff/join', joinRouter);
  v1.use('/my', ownerRouter);
  v1.use('/garage', requireProviderAccount, garageRouter);
  // Everything below acts for the caller's garage.
  v1.use(requireGarage);
  v1.use('/job-cards', jobRouter);
  v1.use('/inspections', inspectionRouter);
  v1.use('/parts', ownerWrites, partRouter);
  v1.use('/appointments', appointmentRouter);
  v1.use('/dashboard', ownerOnly, dashboardRouter);
  v1.use('/customers', ownerOnly, customerRouter);
  v1.use('/vehicles', ownerOnly, vehicleRouter);
  v1.use('/invoices', ownerOnly, invoiceRouter);
  v1.use('/staff', ownerOnly, staffRouter);
  v1.use('/suppliers', ownerOnly, supplierRouter);
  v1.use('/reports', ownerOnly, reportRouter);
  v1.use('/booking-settings', ownerOnly, bookingSettingsRouter);
  app.use('/api/v1', v1);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Not found', timestamp: new Date().toISOString() });
  });
  app.use(errorHandler);
  return app;
}
