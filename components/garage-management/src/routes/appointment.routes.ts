import { Router } from 'express';

import { authorOf, ownerWrites } from '../middleware/auth';
import * as appointments from '../services/appointments';
import { presentAppointment, presentJob } from '../services/presenters';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { appointmentInput, appointmentPatch, appointmentStatusInput, appointmentsQuery } from '../validation';

/** Mechanics can see the schedule; booking and check-in are the owner's. */
export const appointmentRouter = Router();
appointmentRouter.use(ownerWrites);

appointmentRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await appointments.listAppointments(prisma, req.garage!.id, appointmentsQuery.parse(req.query));
    ok(res, items.map(presentAppointment));
  }),
);

appointmentRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = appointmentInput.parse(req.body);
    ok(res, presentAppointment(await prisma.$transaction((tx) => appointments.createAppointment(tx, req.garage!.id, data))), 201);
  }),
);

appointmentRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentAppointment(await appointments.getAppointment(prisma, req.garage!.id, req.params.id)));
  }),
);

appointmentRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const appointment = await appointments.updateAppointment(prisma, req.garage!.id, req.params.id, appointmentPatch.parse(req.body));
    ok(res, presentAppointment(appointment));
  }),
);

appointmentRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = appointmentStatusInput.parse(req.body);
    ok(res, presentAppointment(await appointments.setAppointmentStatus(prisma, req.garage!.id, req.params.id, status)));
  }),
);

/** Opens the job card. Repeat calls return the same one (200). */
appointmentRouter.post(
  '/:id/check-in',
  asyncHandler(async (req, res) => {
    const { appointment, job, created } = await prisma.$transaction((tx) => appointments.checkIn(tx, req.garage!, req.params.id, authorOf(req)));
    ok(res, { appointment: presentAppointment(appointment), job: presentJob(job) }, created ? 201 : 200);
  }),
);
