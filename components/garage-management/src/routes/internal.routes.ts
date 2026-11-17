/**
 * The internal API, for other Kaduna services on the private network: today
 * the parts service, which needs a garage's mechanics (with their Kaduna
 * account, to show them a pickup), a job's details, and to write back to the
 * job (timeline notes, and the parts once handed over).
 *
 * Server to server only: every call carries the shared secret in
 * X-Internal-Token (INTERNAL_API_TOKEN). With no secret configured the whole
 * API is off. Caddy also refuses /internal from outside.
 */
import { timingSafeEqual } from 'node:crypto';

import { NextFunction, Request, Response, Router } from 'express';

import { config } from '../config';
import * as jobs from '../services/jobCards';
import { D } from '../services/shared';
import { asyncHandler, notFound, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { internalNoteInput, internalPartsInput } from '../validation';

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInternal(req: Request, res: Response, next: NextFunction): void {
  const given = req.header('x-internal-token') ?? '';
  if (!config.internalToken || !sameSecret(given, config.internalToken)) {
    res.status(401).json({ success: false, error: 'Internal API: missing or wrong X-Internal-Token', timestamp: new Date().toISOString() });
    return;
  }
  next();
}

export const internalRouter = Router();
internalRouter.use(requireInternal);

internalRouter.get(
  '/garages/:garageId/staff',
  asyncHandler(async (req, res) => {
    const staff = await prisma.staffMember.findMany({ where: { garageId: req.params.garageId }, orderBy: { name: 'asc' } });
    ok(res, staff.map((s) => ({ id: s.id, name: s.name, phone: s.phone, active: s.active, userId: s.userId })));
  }),
);

async function jobOf(garageId: string, jobId: string) {
  const job = await prisma.jobCard.findFirst({ where: { id: jobId, garageId }, include: { vehicle: true, invoices: { select: { status: true } } } });
  if (!job) throw notFound('Job card');
  return job;
}

const editable = (job: Awaited<ReturnType<typeof jobOf>>) => !jobs.FINISHED.includes(job.status) && !job.invoices.some((i) => i.status !== 'VOID');

internalRouter.get(
  '/garages/:garageId/job-cards/:jobId',
  asyncHandler(async (req, res) => {
    const job = await jobOf(req.params.garageId, req.params.jobId);
    ok(res, {
      id: job.id,
      number: job.number,
      status: job.status,
      editable: editable(job),
      vehicle: job.vehicle ? { plate: job.vehicle.plate, make: job.vehicle.make, model: job.vehicle.model, year: job.vehicle.year } : null,
    });
  }),
);

internalRouter.post(
  '/garages/:garageId/job-cards/:jobId/notes',
  asyncHandler(async (req, res) => {
    const { note } = internalNoteInput.parse(req.body);
    const job = await jobOf(req.params.garageId, req.params.jobId);
    await jobs.addUpdate(prisma, job.id, { note, public: false, author: null });
    ok(res, { added: true });
  }),
);

/** Received parts onto the job, at the price paid, if it can still take lines; the note goes on either way. */
internalRouter.post(
  '/garages/:garageId/job-cards/:jobId/parts',
  asyncHandler(async (req, res) => {
    const { lines, note } = internalPartsInput.parse(req.body);
    const job = await jobOf(req.params.garageId, req.params.jobId);
    const added = editable(job);
    await prisma.$transaction(async (tx) => {
      if (added) {
        await tx.jobItem.createMany({ data: lines.map((l) => ({ jobCardId: job.id, kind: 'PART' as const, description: l.description, quantity: D(l.quantity), unitPrice: D(l.unitPrice) })) });
      }
      await jobs.addUpdate(tx, job.id, { note: added ? `${note}; parts added to the job` : `${note}. The job can't take new lines, so add them yourself if needed`, public: false, author: null });
    });
    ok(res, { added });
  }),
);
