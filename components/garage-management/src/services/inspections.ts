/**
 * Digital vehicle inspections. A mechanic works through a checklist on the
 * job, marks each point OK / needs attention / urgent, and prices the work
 * they recommend. Sending the report puts every priced item in front of the
 * customer, on the tracking link, to approve or decline. Approved work is then
 * added to the job as a labour line with one tap.
 *
 *   item.approval:  null (nothing to decide) → PENDING (sent) → APPROVED | DECLINED
 *
 * Changing the price of an item already decided puts it back to PENDING, so
 * the customer never ends up approving one price and paying another.
 */
import { CheckResult, Garage, InspectionItem, Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { inspectionItemInput, inspectionItemPatch } from '../validation';
import { addItem, addUpdate, Author, FINISHED, getJob } from './jobCards';
import { D, emit } from './shared';

/** A 25-point check that suits most cars brought into a Sri Lankan workshop. */
export const STANDARD_CHECKLIST: Record<string, string[]> = {
  'Under the hood': ['Engine oil level and condition', 'Coolant level', 'Brake fluid', 'Battery and terminals', 'Drive belts', 'Air filter', 'Hoses and leaks'],
  Brakes: ['Front brake pads', 'Rear brakes', 'Brake discs', 'Handbrake'],
  'Tyres and wheels': ['Tyre tread depth', 'Tyre pressure', 'Spare tyre', 'Wheel alignment'],
  'Steering and suspension': ['Shock absorbers', 'Steering play', 'Suspension bushes and links'],
  'Lights and electrical': ['Headlights', 'Brake lights and indicators', 'Horn', 'Wipers and washers'],
  Underbody: ['Exhaust system', 'Oil leaks', 'CV boots'],
};

const NEEDS_WORK: CheckResult[] = ['ATTENTION', 'URGENT'];
const ITEMS = { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } satisfies Prisma.InspectionInclude;

export async function getInspection(db: Db, garageId: string, jobId: string) {
  const job = await getJob(db, garageId, jobId);
  return db.inspection.findUnique({ where: { jobCardId: job.id }, include: ITEMS });
}

async function requireInspection(db: Db, garageId: string, jobId: string, opts: { editable?: boolean } = {}) {
  const job = await getJob(db, garageId, jobId);
  const inspection = await db.inspection.findUnique({ where: { jobCardId: job.id }, include: ITEMS });
  if (!inspection) throw notFound('Inspection');
  if (opts.editable && FINISHED.includes(job.status)) throw conflict(`Job #${job.number} is ${job.status.toLowerCase()}`);
  return { job, inspection };
}

function findItem(items: InspectionItem[], itemId: string) {
  const item = items.find((i) => i.id === itemId);
  if (!item) throw notFound('Inspection item');
  return item;
}

export async function createInspection(db: Prisma.TransactionClient, garageId: string, jobId: string, template: 'STANDARD' | 'BLANK') {
  const job = await getJob(db, garageId, jobId);
  if (FINISHED.includes(job.status)) throw conflict(`Job #${job.number} is ${job.status.toLowerCase()}`);
  if (job.inspection) throw conflict(`Job #${job.number} already has an inspection`);
  const items =
    template === 'STANDARD'
      ? Object.entries(STANDARD_CHECKLIST).flatMap(([category, names]) => names.map((name) => ({ category, name })))
      : [];
  return db.inspection.create({
    data: { garageId, jobCardId: job.id, items: { create: items.map((item, sortOrder) => ({ ...item, sortOrder })) } },
    include: ITEMS,
  });
}

export async function updateInspection(db: Db, garageId: string, jobId: string, data: { summary?: string | null }) {
  const { inspection } = await requireInspection(db, garageId, jobId, { editable: true });
  return db.inspection.update({ where: { id: inspection.id }, data, include: ITEMS });
}

export async function addInspectionItem(db: Db, garageId: string, jobId: string, data: z.infer<typeof inspectionItemInput>) {
  const { inspection } = await requireInspection(db, garageId, jobId, { editable: true });
  const last = inspection.items.reduce((max, i) => Math.max(max, i.sortOrder), -1);
  const priced = data.estimate != null && data.estimate > 0 && NEEDS_WORK.includes(data.result);
  await db.inspectionItem.create({
    data: {
      inspectionId: inspection.id,
      category: data.category,
      name: data.name,
      result: data.result,
      note: data.note ?? null,
      estimate: data.estimate != null ? D(data.estimate) : null,
      // Added after the report went out: goes straight to the customer.
      approval: priced && inspection.status === 'SENT' ? 'PENDING' : null,
      sortOrder: last + 1,
    },
  });
  return db.inspection.findUniqueOrThrow({ where: { id: inspection.id }, include: ITEMS });
}

export async function updateInspectionItem(
  db: Prisma.TransactionClient,
  garageId: string,
  jobId: string,
  itemId: string,
  data: z.infer<typeof inspectionItemPatch>,
  author: Author,
) {
  const { job, inspection } = await requireInspection(db, garageId, jobId, { editable: true });
  const item = findItem(inspection.items, itemId);
  const changes: Prisma.InspectionItemUpdateInput = {};
  if (data.result !== undefined) changes.result = data.result;
  if (data.note !== undefined) changes.note = data.note;

  const priceChanged = data.estimate !== undefined && !(item.estimate == null ? data.estimate == null : data.estimate != null && item.estimate.eq(data.estimate));
  if (priceChanged) {
    if (item.jobItemId) throw conflict('This work is already on the job. Change the job line instead');
    changes.estimate = data.estimate != null ? D(data.estimate) : null;
  }

  const result = data.result ?? item.result;
  const estimate = data.estimate !== undefined ? data.estimate : item.estimate?.toNumber() ?? null;
  const askable = estimate != null && estimate > 0 && NEEDS_WORK.includes(result);

  if (data.approval !== undefined && data.approval !== item.approval) {
    // Staff recording the customer's answer, for example given over the phone.
    if (item.jobItemId && data.approval !== 'APPROVED') throw conflict('This work is already on the job. Remove the line first');
    if (data.approval !== 'PENDING' && !askable) throw conflict('Only priced items that need work can be approved or declined');
    changes.approval = data.approval;
    changes.decidedAt = data.approval === 'PENDING' ? null : new Date();
    if (data.approval !== 'PENDING') {
      await addUpdate(db, job.id, {
        note: `${data.approval === 'APPROVED' ? 'Approved' : 'Declined'}: ${item.name} (recorded by the workshop)`,
        author,
        public: true,
      });
    }
  } else if (!askable) {
    // Nothing left to decide once an item is fine again or has no price.
    if (item.approval && !item.jobItemId) {
      changes.approval = null;
      changes.decidedAt = null;
    }
  } else if (inspection.status === 'SENT' && (priceChanged || item.approval == null)) {
    changes.approval = 'PENDING';
    changes.decidedAt = null;
  }

  await db.inspectionItem.update({ where: { id: item.id }, data: changes });
  return db.inspection.findUniqueOrThrow({ where: { id: inspection.id }, include: ITEMS });
}

/** Everything not checked yet is fine: one tap instead of twenty after the problem points are marked. */
export async function markRestOk(db: Db, garageId: string, jobId: string) {
  const { inspection } = await requireInspection(db, garageId, jobId, { editable: true });
  await db.inspectionItem.updateMany({ where: { inspectionId: inspection.id, result: 'NOT_CHECKED' }, data: { result: 'OK' } });
  return db.inspection.findUniqueOrThrow({ where: { id: inspection.id }, include: ITEMS });
}

/**
 * The inspection work queue: every job still in the workshop with where its
 * inspection stands, so a mechanic can see what to inspect next and the
 * owner can see what's waiting on customers. Recently finished jobs with an
 * inspection stay for a week so the outcome can still be looked up.
 */
export async function inspectionBoard(db: Db, garageId: string, mechanicId?: string) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const jobs = await db.jobCard.findMany({
    where: {
      garageId,
      ...(mechanicId ? { mechanicId } : {}),
      OR: [{ status: { notIn: FINISHED } }, { inspection: { isNot: null }, updatedAt: { gte: weekAgo }, status: 'CLOSED' }],
    },
    include: {
      customer: true,
      vehicle: true,
      mechanic: true,
      inspection: { select: { id: true, status: true, sentAt: true, updatedAt: true, items: { select: { result: true, approval: true, jobItemId: true } } } },
    },
    orderBy: { number: 'desc' },
    take: 200,
  });
  return jobs.map(({ inspection, ...job }) => {
    const items = inspection?.items ?? [];
    return {
      job,
      inspection: inspection
        ? {
            id: inspection.id,
            status: inspection.status,
            sentAt: inspection.sentAt,
            updatedAt: inspection.updatedAt,
            total: items.length,
            checked: items.filter((i) => i.result !== 'NOT_CHECKED').length,
            attention: items.filter((i) => i.result === 'ATTENTION').length,
            urgent: items.filter((i) => i.result === 'URGENT').length,
            pendingApproval: items.filter((i) => i.approval === 'PENDING').length,
            approvedToAdd: items.filter((i) => i.approval === 'APPROVED' && !i.jobItemId).length,
            declined: items.filter((i) => i.approval === 'DECLINED').length,
          }
        : null,
    };
  });
}

export async function removeInspectionItem(db: Db, garageId: string, jobId: string, itemId: string) {
  const { inspection } = await requireInspection(db, garageId, jobId, { editable: true });
  const item = findItem(inspection.items, itemId);
  if (item.jobItemId) throw conflict('This work is already on the job. Remove the line first');
  await db.inspectionItem.delete({ where: { id: item.id } });
  return db.inspection.findUniqueOrThrow({ where: { id: inspection.id }, include: ITEMS });
}

/** Share the report with the customer. Safe to send again after adding items. */
export async function sendInspection(db: Prisma.TransactionClient, garageId: string, jobId: string, author: Author) {
  const { job, inspection } = await requireInspection(db, garageId, jobId, { editable: true });
  if (!inspection.items.some((i) => i.result !== 'NOT_CHECKED')) throw conflict('Check at least one item before sending the report');
  const toAsk = inspection.items.filter((i) => i.approval == null && !i.jobItemId && i.estimate?.gt(0) && NEEDS_WORK.includes(i.result));
  if (toAsk.length) {
    await db.inspectionItem.updateMany({ where: { id: { in: toAsk.map((i) => i.id) } }, data: { approval: 'PENDING' } });
  }
  const first = inspection.status === 'DRAFT';
  await db.inspection.update({ where: { id: inspection.id }, data: { status: 'SENT', sentAt: new Date() } });
  const pending = inspection.items.filter((i) => i.approval === 'PENDING').length + toAsk.length;
  await addUpdate(db, job.id, {
    note: `${first ? 'Inspection report is ready' : 'Inspection report updated'}${pending ? `: ${pending} item${pending === 1 ? '' : 's'} need${pending === 1 ? 's' : ''} your approval` : ''}`,
    author,
    public: true,
  });
  await emit(db, garageId, 'inspection.sent', { jobCardId: job.id, inspectionId: inspection.id, pendingApproval: pending });
  return db.inspection.findUniqueOrThrow({ where: { id: inspection.id }, include: ITEMS });
}

/** Approved work onto the job as a labour line at the approved price. */
export async function addApprovedToJob(db: Prisma.TransactionClient, garage: Garage, jobId: string, itemId: string) {
  const { inspection } = await requireInspection(db, garage.id, jobId, { editable: true });
  const item = findItem(inspection.items, itemId);
  if (item.approval !== 'APPROVED') throw conflict('Only approved work can be added to the job');
  if (item.jobItemId) throw conflict('This work is already on the job');
  const { itemId: jobItemId } = await addItem(db, garage, jobId, {
    kind: 'LABOUR',
    description: item.name,
    quantity: 1,
    unitPrice: item.estimate?.toNumber() ?? 0,
  });
  await db.inspectionItem.update({ where: { id: item.id }, data: { jobItemId } });
  return getJob(db, garage.id, jobId);
}

/** The customer's answer from the tracking link. They can change their mind until the work is on the job. */
export async function decide(db: Prisma.TransactionClient, jobId: string, itemId: string, decision: 'APPROVED' | 'DECLINED') {
  const inspection = await db.inspection.findUnique({ where: { jobCardId: jobId }, include: { ...ITEMS, jobCard: true } });
  if (!inspection || inspection.status !== 'SENT') throw notFound('Inspection');
  if (FINISHED.includes(inspection.jobCard.status)) throw conflict('This job is finished');
  const item = findItem(inspection.items, itemId);
  if (item.approval == null) throw conflict('Nothing to decide for this item');
  if (item.jobItemId) throw conflict('The workshop has already started this work');
  if (item.approval !== decision) {
    await db.inspectionItem.update({ where: { id: item.id }, data: { approval: decision, decidedAt: new Date() } });
    await addUpdate(db, jobId, { note: `${decision === 'APPROVED' ? 'Approved' : 'Declined'}: ${item.name}`, author: 'Customer', public: true });
    await emit(db, inspection.garageId, 'inspection.item_decided', { jobCardId: jobId, itemId: item.id, decision });
  }
  return item.id;
}
