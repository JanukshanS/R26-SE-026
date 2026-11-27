/**
 * Invoices. Issued from a finished job, with its lines copied in, so later
 * changes to prices or the job never alter an invoice already given to a
 * customer. A job has at most one live (unpaid or paid) invoice; voiding an
 * unpaid one frees the job to be edited and invoiced again.
 */
import { Garage, InvoiceStatus, PaymentMethod, Prisma } from '@prisma/client';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { getJob } from './jobCards';
import { D, emit, round2, takeNumber } from './shared';

export async function issueInvoice(db: Prisma.TransactionClient, garage: Garage, jobId: string) {
  const job = await getJob(db, garage.id, jobId);
  if (job.status !== 'READY' && job.status !== 'CLOSED') throw conflict('Mark the job ready before invoicing it');
  if (job.items.length === 0) throw conflict('Add labour or parts before invoicing');
  if (job.invoices.some((inv) => inv.status !== 'VOID')) throw conflict(`Job #${job.number} already has an invoice`);

  const lines = job.items.map((i) => ({
    kind: i.kind,
    description: i.description,
    quantity: i.quantity.toNumber(),
    unitPrice: i.unitPrice.toNumber(),
    lineTotal: round2(i.quantity.mul(i.unitPrice)).toNumber(),
  }));
  const subtotal = round2(job.items.reduce((sum, i) => sum.add(i.quantity.mul(i.unitPrice)), D(0)));
  const tax = round2(subtotal.mul(garage.taxRate).div(100));
  const number = await takeNumber(db, garage.id, 'invoice');

  const invoice = await db.invoice.create({
    data: { garageId: garage.id, jobCardId: job.id, number, lines, subtotal, tax, total: subtotal.add(tax) },
    include: { jobCard: { select: { number: true } } },
  });
  await emit(db, garage.id, 'invoice.issued', { invoiceId: invoice.id, number, jobCardId: job.id, total: invoice.total.toNumber() });
  return invoice;
}

export async function listInvoices(db: Db, garageId: string, status: InvoiceStatus | undefined, limit: number, offset: number) {
  const where: Prisma.InvoiceWhereInput = { garageId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    db.invoice.findMany({ where, include: { jobCard: { select: { number: true } } }, orderBy: { number: 'desc' }, take: limit, skip: offset }),
    db.invoice.count({ where }),
  ]);
  return { items, total };
}

export async function getInvoice(db: Db, garageId: string, id: string) {
  const invoice = await db.invoice.findFirst({ where: { id, garageId }, include: { jobCard: { select: { number: true } } } });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

export async function payInvoice(db: Prisma.TransactionClient, garageId: string, id: string, method: PaymentMethod) {
  const invoice = await getInvoice(db, garageId, id);
  if (invoice.status !== 'UNPAID') throw conflict(`Invoice #${invoice.number} is ${invoice.status.toLowerCase()}`);
  const paid = await db.invoice.update({
    where: { id },
    data: { status: 'PAID', paymentMethod: method, paidAt: new Date() },
    include: { jobCard: { select: { number: true } } },
  });
  await emit(db, garageId, 'invoice.paid', { invoiceId: id, number: paid.number, total: paid.total.toNumber(), method });
  return paid;
}

export async function voidInvoice(db: Prisma.TransactionClient, garageId: string, id: string) {
  const invoice = await getInvoice(db, garageId, id);
  // Refunds are out of scope for a simple garage system; a paid invoice stays as the record of payment.
  if (invoice.status !== 'UNPAID') throw conflict(`Only unpaid invoices can be voided`);
  const voided = await db.invoice.update({ where: { id }, data: { status: 'VOID' }, include: { jobCard: { select: { number: true } } } });
  await emit(db, garageId, 'invoice.voided', { invoiceId: id, number: voided.number });
  return voided;
}
