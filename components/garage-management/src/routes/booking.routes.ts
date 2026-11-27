import { NextFunction, Request, Response, Router } from 'express';

import * as booking from '../services/booking';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { bookingSettingsInput, publicBookingInput, slotsQuery } from '../validation';

/** Owner only (mounted behind ownerOnly): the rules and the shareable link. */
export const bookingSettingsRouter = Router();

const ownerView = (g: Parameters<typeof booking.readSettings>[0] & { bookingToken: string | null }) => ({
  settings: booking.readSettings(g),
  token: g.bookingToken,
});

bookingSettingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, ownerView(req.garage!));
  }),
);

bookingSettingsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const garage = await booking.saveSettings(prisma, req.garage!, bookingSettingsInput.parse(req.body));
    ok(res, ownerView(garage));
  }),
);

bookingSettingsRouter.post(
  '/reset-link',
  asyncHandler(async (req, res) => {
    ok(res, ownerView(await booking.resetLink(prisma, req.garage!)));
  }),
);

/**
 * A light brake on the one public write: bookings per IP per hour. In memory,
 * so per replica; enough to stop a script filling the diary, not a WAF.
 */
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 20;
const hits = new Map<string, number[]>();
export function limitBookings(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip ?? 'unknown';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    res.status(429).json({ success: false, error: 'Too many bookings from here. Please call the garage', timestamp: new Date().toISOString() });
    return;
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}

/** No sign-in (mounted under /public): the token in the path is the key. */
export const publicBookingRouter = Router();

publicBookingRouter.get(
  '/book/:token',
  asyncHandler(async (req, res) => {
    ok(res, booking.presentBookingPage(await booking.garageByBookingToken(prisma, req.params.token)));
  }),
);

publicBookingRouter.get(
  '/book/:token/slots',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const garage = await booking.garageByBookingToken(prisma, req.params.token);
    const settings = booking.readSettings(garage);
    const { from, days } = slotsQuery.parse(req.query);
    ok(res, settings.enabled ? await booking.computeSlots(prisma, garage, settings, from, days) : []);
  }),
);

publicBookingRouter.post(
  '/book/:token',
  limitBookings,
  asyncHandler(async (req, res) => {
    const input = publicBookingInput.parse(req.body);
    const garage = await booking.garageByBookingToken(prisma, req.params.token);
    const created = await prisma.$transaction((tx) => booking.book(tx, garage, input));
    const full = await booking.appointmentByToken(prisma, created.publicToken!);
    ok(res, { token: created.publicToken, booking: booking.presentPublicAppointment(full) }, 201);
  }),
);

publicBookingRouter.get(
  '/bookings/:token',
  asyncHandler(async (req, res) => {
    ok(res, booking.presentPublicAppointment(await booking.appointmentByToken(prisma, req.params.token)));
  }),
);

publicBookingRouter.post(
  '/bookings/:token/cancel',
  asyncHandler(async (req, res) => {
    const a = await prisma.$transaction((tx) => booking.cancelByToken(tx, req.params.token));
    ok(res, booking.presentPublicAppointment(a));
  }),
);
