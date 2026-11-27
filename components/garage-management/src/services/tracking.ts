/**
 * What customers see, without signing in.
 *
 * The tracking link carries a 128-bit random token, and that token is the
 * only key: it shows one job, says nothing about the garage's other work, and
 * the owner can reset it to revoke a link. Personal details are trimmed to
 * what the customer already knows (first names, their own car).
 *
 * Drivers who came through Kaduna also get a short status for their dispatch
 * jobs in the Kaduna app. Dispatch incidents carry no owner, so anyone signed
 * in who knows an incident id could ask; that summary is therefore limited to
 * status and the garage's public contact: no prices, no token, no approvals.
 */
import { Prisma } from '@prisma/client';

import { notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { presentItem } from './presenters';

const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? null;
const num = (d: Prisma.Decimal | null | undefined) => (d == null ? null : d.toNumber());

export async function jobByToken(db: Db, token: string) {
  const job = await db.jobCard.findUnique({
    where: { trackingToken: token },
    include: {
      garage: true,
      customer: true,
      vehicle: true,
      mechanic: true,
      items: { orderBy: { createdAt: 'asc' } },
      invoices: { orderBy: { issuedAt: 'desc' } },
      updates: { where: { public: true }, orderBy: { createdAt: 'desc' }, take: 50 },
      inspection: { include: { items: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } },
    },
  });
  if (!job || job.status === 'CANCELLED') throw notFound('Job');
  return job;
}

export function presentTracking(job: Awaited<ReturnType<typeof jobByToken>>) {
  const g = job.garage;
  const subtotal = job.items.reduce((sum, i) => sum.add(i.quantity.mul(i.unitPrice)), new Prisma.Decimal(0));
  const invoice = job.invoices.find((inv) => inv.status !== 'VOID') ?? null;
  const shared = job.inspection?.status === 'SENT' ? job.inspection : null;
  return {
    garage: {
      name: g.name,
      phone: g.phone,
      address: g.address,
      logoUrl: g.logoUrl,
      brandColor: g.brandColor,
      currency: g.currency,
      taxRate: num(g.taxRate),
    },
    job: {
      number: job.number,
      status: job.status,
      source: job.source,
      complaint: job.complaint,
      diagnosis: job.diagnosis,
      promisedAt: job.promisedAt,
      createdAt: job.createdAt,
      closedAt: job.closedAt,
      customerName: firstName(job.customer?.name),
      mechanicName: firstName(job.mechanic?.name),
      vehicle: job.vehicle ? { plate: job.vehicle.plate, make: job.vehicle.make, model: job.vehicle.model, year: job.vehicle.year } : null,
    },
    items: job.items.map((i) => {
      const { kind, description, quantity, unitPrice, lineTotal } = presentItem(i);
      return { kind, description, quantity, unitPrice, lineTotal };
    }),
    subtotal: subtotal.toDecimalPlaces(2).toNumber(),
    invoice: invoice
      ? { number: invoice.number, status: invoice.status, subtotal: num(invoice.subtotal), tax: num(invoice.tax), total: num(invoice.total), issuedAt: invoice.issuedAt, paidAt: invoice.paidAt }
      : null,
    updates: job.updates.map((u) => ({ id: u.id, status: u.status, note: u.note, author: u.author === 'Customer' ? 'You' : firstName(u.author), createdAt: u.createdAt })),
    inspection: shared
      ? {
          summary: shared.summary,
          sentAt: shared.sentAt,
          items: shared.items
            .filter((i) => i.result !== 'NOT_CHECKED')
            .map((i) => ({
              id: i.id,
              category: i.category,
              name: i.name,
              result: i.result,
              note: i.note,
              estimate: num(i.estimate),
              approval: i.approval,
              inJob: Boolean(i.jobItemId),
            })),
        }
      : null,
  };
}

/** Status of the job cards opened from these Kaduna incidents, across garages. */
export async function repairsForIncidents(db: Db, incidentIds: string[]) {
  const jobs = await db.jobCard.findMany({
    where: { dispatchIncidentId: { in: incidentIds }, status: { not: 'CANCELLED' } },
    include: {
      garage: { select: { name: true, phone: true, address: true } },
      updates: { where: { public: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      inspection: { select: { status: true, items: { select: { approval: true } } } },
    },
  });
  return jobs.map((j) => ({
    incidentId: j.dispatchIncidentId!,
    garage: j.garage,
    jobNumber: j.number,
    status: j.status,
    promisedAt: j.promisedAt,
    updatedAt: j.updatedAt,
    lastUpdate: j.updates[0] ? { status: j.updates[0].status, note: j.updates[0].note, createdAt: j.updates[0].createdAt } : null,
    approvalsWaiting: j.inspection?.status === 'SENT' ? j.inspection.items.filter((i) => i.approval === 'PENDING').length : 0,
  }));
}
