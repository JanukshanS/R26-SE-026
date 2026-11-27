/**
 * Job cards: the work done on one vehicle visit, from check-in to hand-over.
 *
 *   OPEN → IN_PROGRESS ⇄ WAITING_PARTS
 *              ↓
 *            READY → CLOSED          (any state before CLOSED can be CANCELLED)
 *
 * Lines can only change while the job is still open for work and has no live
 * invoice, so an invoice always matches the job it was issued for.
 *
 * Every status change also writes a JobUpdate, which is the job's timeline
 * and what the customer follows on the tracking link.
 */
import { Garage, JobStatus, Prisma } from '@prisma/client';
import { z } from 'zod';

import { DomainError, conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { jobCardInput, jobCardPatch, jobItemInput, listJobsQuery } from '../validation';
import { fetchIncident } from './dispatchClient';
import { consume, getPart, giveBack } from './inventory';
import { D, assertCustomer, assertMechanic, assertVehicle, emit, newTrackingToken, normalisePlate, takeNumber } from './shared';

export const DETAIL = {
  customer: true,
  vehicle: true,
  mechanic: true,
  items: { orderBy: { createdAt: 'asc' } },
  invoices: { orderBy: { issuedAt: 'desc' } },
  updates: { orderBy: { createdAt: 'desc' }, take: 100 },
  inspection: { include: { items: true } },
} satisfies Prisma.JobCardInclude;

export const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  OPEN: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['WAITING_PARTS', 'READY', 'CANCELLED'],
  WAITING_PARTS: ['IN_PROGRESS', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Handing the car back and calling a job off are the owner's decisions. */
export const OWNER_ONLY_STATUSES: JobStatus[] = ['CLOSED', 'CANCELLED'];

export const FINISHED: JobStatus[] = ['CLOSED', 'CANCELLED'];

/** Who did something, for the timeline. null reads as "the workshop". */
export type Author = string | null;

export async function getJob(db: Db, garageId: string, id: string) {
  const job = await db.jobCard.findFirst({ where: { id, garageId }, include: DETAIL });
  if (!job) throw notFound('Job card');
  return job;
}

export async function listJobs(
  db: Db,
  garageId: string,
  opts: z.infer<typeof listJobsQuery> & { mechanicId?: string },
  limit: number,
  offset: number,
) {
  const q = opts.q;
  const contains = q ? { contains: q, mode: 'insensitive' as const } : undefined;
  const where: Prisma.JobCardWhereInput = {
    garageId,
    ...(opts.status ? { status: opts.status } : opts.active === 'true' ? { status: { notIn: ['CLOSED', 'CANCELLED'] } } : {}),
    ...(opts.customerId ? { customerId: opts.customerId } : {}),
    ...(opts.vehicleId ? { vehicleId: opts.vehicleId } : {}),
    ...(opts.mechanicId ? { mechanicId: opts.mechanicId } : {}),
    ...(q
      ? {
          OR: [
            ...(/^\d+$/.test(q) ? [{ number: Number(q) }] : []),
            { complaint: contains },
            { vehicle: { plate: { contains: normalisePlate(q) ?? q, mode: 'insensitive' } } },
            { customer: { name: contains } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    db.jobCard.findMany({ where, include: { customer: true, vehicle: true, mechanic: true }, orderBy: { number: 'desc' }, take: limit, skip: offset }),
    db.jobCard.count({ where }),
  ]);
  return { items, total };
}

export async function addUpdate(db: Db, jobCardId: string, data: { status?: JobStatus | null; note?: string | null; author?: Author; public?: boolean }) {
  return db.jobUpdate.create({
    data: { jobCardId, status: data.status ?? null, note: data.note ?? null, author: data.author ?? null, public: data.public ?? true },
  });
}

export async function createJob(db: Prisma.TransactionClient, garage: Garage, data: z.infer<typeof jobCardInput>, author: Author = null) {
  await assertCustomer(db, garage.id, data.customerId);
  await assertVehicle(db, garage.id, data.vehicleId);
  await assertMechanic(db, garage.id, data.mechanicId);
  const number = await takeNumber(db, garage.id, 'job');
  const job = await db.jobCard.create({
    data: {
      ...data,
      promisedAt: data.promisedAt ? new Date(data.promisedAt) : null,
      garageId: garage.id,
      number,
      trackingToken: newTrackingToken(),
    },
  });
  await addUpdate(db, job.id, { status: 'OPEN', author });
  await emit(db, garage.id, 'job_card.opened', { jobCardId: job.id, number, source: job.source });
  return getJob(db, garage.id, job.id);
}

export async function updateJob(db: Db, garageId: string, id: string, data: z.infer<typeof jobCardPatch>) {
  const job = await getJob(db, garageId, id);
  if (FINISHED.includes(job.status)) throw conflict(`Job #${job.number} is ${job.status.toLowerCase()} and can't be changed`);
  if (data.customerId !== undefined) await assertCustomer(db, garageId, data.customerId);
  if (data.vehicleId !== undefined) await assertVehicle(db, garageId, data.vehicleId);
  if (data.mechanicId !== undefined) await assertMechanic(db, garageId, data.mechanicId);
  const { promisedAt, ...rest } = data;
  return db.jobCard.update({
    where: { id },
    data: { ...rest, ...(promisedAt !== undefined ? { promisedAt: promisedAt ? new Date(promisedAt) : null } : {}) },
    include: DETAIL,
  });
}

export async function changeStatus(db: Prisma.TransactionClient, garageId: string, id: string, next: JobStatus, author: Author = null) {
  const job = await getJob(db, garageId, id);
  if (job.status === next) return job;
  if (!TRANSITIONS[job.status].includes(next)) {
    throw conflict(`A ${label(job.status)} job can't be moved to ${label(next)}`);
  }
  const live = job.invoices.find((inv) => inv.status !== 'VOID');
  if (next === 'CANCELLED') {
    if (live) throw conflict(live.status === 'PAID' ? 'This job has a paid invoice and cannot be cancelled' : 'Void the invoice before cancelling the job');
    // Parts that were taken from stock for this job go back on the shelf.
    for (const item of job.items) {
      if (!item.partId) continue;
      const part = await db.part.findUnique({ where: { id: item.partId } });
      if (part) await giveBack(db, part, item.quantity, job.id, `Job #${job.number} cancelled`);
    }
  }
  await db.jobCard.update({ where: { id }, data: { status: next, closedAt: next === 'CLOSED' ? new Date() : null } });
  await addUpdate(db, id, { status: next, author });
  if (next === 'CLOSED') {
    await emit(db, garageId, 'job_card.closed', {
      jobCardId: job.id,
      number: job.number,
      vehicle: job.vehicle ? { plate: job.vehicle.plate, make: job.vehicle.make, model: job.vehicle.model } : null,
      odometerIn: job.odometerIn,
      dispatchIncidentId: job.dispatchIncidentId,
      items: job.items.map((i) => ({ kind: i.kind, description: i.description, quantity: i.quantity.toNumber() })),
    });
  }
  return getJob(db, garageId, id);
}

async function assertEditable(db: Db, garageId: string, id: string) {
  const job = await getJob(db, garageId, id);
  if (FINISHED.includes(job.status)) throw conflict(`Job #${job.number} is ${job.status.toLowerCase()} and can't be changed`);
  if (job.invoices.some((inv) => inv.status !== 'VOID')) throw conflict('This job has been invoiced. Void the invoice to change its lines');
  return job;
}

/** Adds a line and returns the job with the new line's id. */
export async function addItem(db: Prisma.TransactionClient, garage: Garage, jobId: string, data: z.infer<typeof jobItemInput>) {
  const job = await assertEditable(db, garage.id, jobId);
  const quantity = D(data.quantity);
  let description = data.description ?? '';
  let unitPrice = data.unitPrice != null ? D(data.unitPrice) : null;

  if (data.partId) {
    const part = await getPart(db, garage.id, data.partId);
    if (!part.active) throw conflict(`${part.name} is no longer stocked`);
    description ||= part.name;
    unitPrice ??= part.unitPrice;
    await consume(db, part, quantity, job.id);
  } else if (data.kind === 'LABOUR') {
    unitPrice ??= garage.labourRate;
  }
  if (!description) throw new DomainError(422, 'Describe the work or choose a part');

  const item = await db.jobItem.create({
    data: { jobCardId: job.id, kind: data.kind, description, quantity, unitPrice: unitPrice ?? 0, partId: data.partId ?? null },
  });
  return { job: await getJob(db, garage.id, job.id), itemId: item.id };
}

export async function removeItem(db: Prisma.TransactionClient, garageId: string, jobId: string, itemId: string) {
  const job = await assertEditable(db, garageId, jobId);
  const item = job.items.find((i) => i.id === itemId);
  if (!item) throw notFound('Job line');
  if (item.partId) {
    const part = await db.part.findUnique({ where: { id: item.partId } });
    if (part) await giveBack(db, part, item.quantity, job.id, `Removed from job #${job.number}`);
  }
  // An inspection item that became this line can be added again.
  await db.inspectionItem.updateMany({ where: { jobItemId: itemId }, data: { jobItemId: null } });
  await db.jobItem.delete({ where: { id: itemId } });
  return getJob(db, garageId, job.id);
}

/** A note on the job's timeline; public ones show on the customer's tracking link. */
export async function postUpdate(db: Db, garageId: string, jobId: string, data: { note: string; public: boolean }, author: Author) {
  const job = await getJob(db, garageId, jobId);
  await addUpdate(db, job.id, { note: data.note, public: data.public, author });
  return getJob(db, garageId, job.id);
}

/** A new tracking token, so a link that was shared too widely stops working. */
export async function resetTracking(db: Db, garageId: string, jobId: string) {
  const job = await getJob(db, garageId, jobId);
  return db.jobCard.update({ where: { id: job.id }, data: { trackingToken: newTrackingToken() }, include: DETAIL });
}

/**
 * Turn a Kaduna dispatch job this provider was sent to into a job card.
 * Safe to repeat: the same incident always returns the same job card.
 */
export async function createFromDispatch(db: Prisma.TransactionClient, garage: Garage, incidentId: string, authorization: string) {
  const existing = await db.jobCard.findFirst({ where: { garageId: garage.id, dispatchIncidentId: incidentId }, include: DETAIL });
  if (existing) return { job: existing, created: false };

  const incident = await fetchIncident(incidentId, authorization);
  if (incident.assignedProviderId !== garage.providerId) throw new DomainError(403, 'That Kaduna job was not assigned to you');

  // A plate the garage already knows means a returning vehicle: attach the job
  // to it (and its history) rather than creating a duplicate.
  const plate = normalisePlate(incident.registrationNo);
  const known = plate ? await db.vehicle.findFirst({ where: { garageId: garage.id, plate } }) : null;
  const vehicle =
    known ??
    (plate || incident.vehicleMake || incident.vehicleModel
      ? await db.vehicle.create({
          data: { garageId: garage.id, plate, make: incident.vehicleMake ?? null, model: incident.vehicleModel ?? null, year: incident.vehicleYear ?? null },
        })
      : null);
  const service = incident.triageResponse?.predictedServiceType?.replace(/_/g, ' ').toLowerCase();
  const complaint = [incident.description, service ? `Kaduna diagnosis: ${service}` : null].filter(Boolean).join('\n') || null;

  const number = await takeNumber(db, garage.id, 'job');
  const job = await db.jobCard.create({
    data: {
      garageId: garage.id,
      number,
      source: 'KADUNA_DISPATCH',
      dispatchIncidentId: incidentId,
      vehicleId: vehicle?.id ?? null,
      customerId: known?.customerId ?? null,
      complaint,
      trackingToken: newTrackingToken(),
    },
  });
  await addUpdate(db, job.id, { status: 'OPEN', note: 'Brought in through Kaduna' });
  await emit(db, garage.id, 'job_card.opened', { jobCardId: job.id, number, source: job.source, dispatchIncidentId: incidentId });
  return { job: await getJob(db, garage.id, job.id), created: true };
}

const label = (s: JobStatus) => s.toLowerCase().replace('_', ' ');
