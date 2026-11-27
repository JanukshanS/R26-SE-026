/**
 * Booked visits. A booking can name a saved customer and vehicle, or just a
 * name, phone and plate for someone new. Checking in creates whatever records
 * are missing, opens the job card and links it, and is safe to repeat.
 *
 *   BOOKED ⇄ CONFIRMED → ARRIVED (check-in)     either → CANCELLED | NO_SHOW
 */
import { AppointmentStatus, Garage, Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { appointmentInput, appointmentPatch } from '../validation';
import { Author, createJob, getJob } from './jobCards';
import { assertCustomer, assertMechanic, assertVehicle, emit, normalisePlate } from './shared';

const INCLUDE = { customer: true, vehicle: true, mechanic: true, jobCard: { select: { number: true, status: true } } } satisfies Prisma.AppointmentInclude;
const DONE: AppointmentStatus[] = ['ARRIVED', 'CANCELLED', 'NO_SHOW'];

export async function listAppointments(db: Db, garageId: string, opts: { from?: string; to?: string; status?: AppointmentStatus }) {
  return db.appointment.findMany({
    where: {
      garageId,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.from || opts.to ? { startsAt: { ...(opts.from ? { gte: new Date(opts.from) } : {}), ...(opts.to ? { lt: new Date(opts.to) } : {}) } } : {}),
    },
    include: INCLUDE,
    orderBy: { startsAt: 'asc' },
    take: 500,
  });
}

export async function getAppointment(db: Db, garageId: string, id: string) {
  const appointment = await db.appointment.findFirst({ where: { id, garageId }, include: INCLUDE });
  if (!appointment) throw notFound('Appointment');
  return appointment;
}

async function checkRefs(db: Db, garageId: string, data: { customerId?: string | null; vehicleId?: string | null; mechanicId?: string | null }) {
  await assertCustomer(db, garageId, data.customerId);
  await assertVehicle(db, garageId, data.vehicleId);
  await assertMechanic(db, garageId, data.mechanicId);
}

export async function createAppointment(db: Prisma.TransactionClient, garageId: string, data: z.infer<typeof appointmentInput>) {
  await checkRefs(db, garageId, data);
  const appointment = await db.appointment.create({
    data: { ...data, plate: normalisePlate(data.plate), startsAt: new Date(data.startsAt), garageId },
    include: INCLUDE,
  });
  await emit(db, garageId, 'appointment.booked', { appointmentId: appointment.id, startsAt: appointment.startsAt.toISOString() });
  return appointment;
}

export async function updateAppointment(db: Db, garageId: string, id: string, data: z.infer<typeof appointmentPatch>) {
  const current = await getAppointment(db, garageId, id);
  if (DONE.includes(current.status)) throw conflict(`This appointment is ${current.status.toLowerCase().replace('_', ' ')}`);
  await checkRefs(db, garageId, data);
  const { startsAt, plate, ...rest } = data;
  return db.appointment.update({
    where: { id },
    data: {
      ...rest,
      ...(startsAt !== undefined ? { startsAt: new Date(startsAt) } : {}),
      ...(plate !== undefined ? { plate: normalisePlate(plate) } : {}),
    },
    include: INCLUDE,
  });
}

export async function setAppointmentStatus(db: Db, garageId: string, id: string, status: Exclude<AppointmentStatus, 'ARRIVED'>) {
  const current = await getAppointment(db, garageId, id);
  if (current.status === status) return current;
  if (current.status === 'ARRIVED') throw conflict('This customer has already checked in');
  // A cancelled or missed booking can be put back, in case it was marked by mistake.
  return db.appointment.update({ where: { id }, data: { status }, include: INCLUDE });
}

/** The customer is here: open their job card. Repeat calls return the same job. */
export async function checkIn(db: Prisma.TransactionClient, garage: Garage, id: string, author: Author) {
  const appointment = await getAppointment(db, garage.id, id);
  if (appointment.jobCardId) return { appointment, job: await getJob(db, garage.id, appointment.jobCardId), created: false };
  if (appointment.status === 'CANCELLED') throw conflict('This appointment was cancelled');

  let customerId = appointment.customerId;
  // Someone who booked online may already be a customer: match on phone before creating a duplicate.
  if (!customerId && appointment.phone) {
    customerId = (await db.customer.findFirst({ where: { garageId: garage.id, phone: appointment.phone }, select: { id: true } }))?.id ?? null;
  }
  if (!customerId && appointment.customerName) {
    customerId = (await db.customer.create({ data: { garageId: garage.id, name: appointment.customerName, phone: appointment.phone } })).id;
  }
  let vehicleId = appointment.vehicleId;
  if (!vehicleId && appointment.plate) {
    const known = await db.vehicle.findFirst({ where: { garageId: garage.id, plate: appointment.plate } });
    vehicleId = known
      ? known.id
      : (await db.vehicle.create({ data: { garageId: garage.id, plate: appointment.plate, customerId } })).id;
    if (known && !known.customerId && customerId) await db.vehicle.update({ where: { id: known.id }, data: { customerId } });
  }

  const complaint = [appointment.service, appointment.notes].filter(Boolean).join('\n');
  const job = await createJob(db, garage, { customerId, vehicleId, complaint, mechanicId: appointment.mechanicId }, author);
  const updated = await db.appointment.update({
    where: { id },
    data: { status: 'ARRIVED', jobCardId: job.id, customerId, vehicleId },
    include: INCLUDE,
  });
  return { appointment: updated, job, created: true };
}
