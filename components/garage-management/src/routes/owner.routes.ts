import { Router } from 'express';

import * as booking from '../services/booking';
import { compactPlate, vehicleLookup } from '../services/kadunaVehicles';
import * as owner from '../services/ownerVisits';
import { DomainError, asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { garageDirectoryQuery, ownerBookingInput, slotsQuery } from '../validation';
import { limitBookings } from './booking.routes';

/**
 * The signed-in vehicle owner (any Kaduna account): their cars at garages,
 * and booking a garage from their dashboard. Mounted at /api/v1/my.
 */
export const ownerRouter = Router();

ownerRouter.get(
  '/visits',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    ok(res, await owner.visitsFor(prisma, await vehicleLookup().vehiclesOf(req.authToken)));
  }),
);

ownerRouter.get(
  '/garages',
  asyncHandler(async (req, res) => {
    ok(res, await owner.garageDirectory(prisma, garageDirectoryQuery.parse(req.query).q));
  }),
);

ownerRouter.get(
  '/garages/:id',
  asyncHandler(async (req, res) => {
    ok(res, booking.presentBookingPage(await owner.bookableGarage(prisma, req.params.id)));
  }),
);

ownerRouter.get(
  '/garages/:id/slots',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const garage = await owner.bookableGarage(prisma, req.params.id);
    const { from, days } = slotsQuery.parse(req.query);
    ok(res, await booking.computeSlots(prisma, garage, booking.readSettings(garage), from, days));
  }),
);

ownerRouter.post(
  '/garages/:id/book',
  limitBookings,
  asyncHandler(async (req, res) => {
    const input = ownerBookingInput.parse(req.body);
    // Only for the caller's own car, so a booking can't be pushed into someone else's dashboard.
    const plates = (await vehicleLookup().vehiclesOf(req.authToken)).map((v) => v.plate);
    if (!plates.includes(compactPlate(input.plate)!)) throw new DomainError(403, 'Add this vehicle to your Kaduna account first');
    const garage = await owner.bookableGarage(prisma, req.params.id);
    const created = await prisma.$transaction((tx) => booking.book(tx, garage, input));
    const full = await booking.appointmentByToken(prisma, created.publicToken!);
    ok(res, { token: created.publicToken, booking: booking.presentPublicAppointment(full) }, 201);
  }),
);
