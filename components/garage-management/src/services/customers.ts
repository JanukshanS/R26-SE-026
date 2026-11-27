/** Customers and their vehicles. */
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { conflict, notFound } from '../utils/http';
import { Db } from '../utils/prisma';
import { customerInput, customerPatch, vehicleInput, vehiclePatch } from '../validation';
import { assertCustomer, normalisePlate } from './shared';

const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

export async function listCustomers(db: Db, garageId: string, q: string | undefined, limit: number, offset: number) {
  const where: Prisma.CustomerWhereInput = {
    garageId,
    ...(q ? { OR: [{ name: contains(q) }, { phone: contains(q) }, { email: contains(q) }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.customer.findMany({ where, orderBy: { name: 'asc' }, take: limit, skip: offset }),
    db.customer.count({ where }),
  ]);
  return { items, total };
}

export async function getCustomer(db: Db, garageId: string, id: string) {
  const customer = await db.customer.findFirst({ where: { id, garageId }, include: { vehicles: true } });
  if (!customer) throw notFound('Customer');
  return customer;
}

export function createCustomer(db: Db, garageId: string, data: z.infer<typeof customerInput>) {
  return db.customer.create({ data: { ...data, garageId } });
}

export async function updateCustomer(db: Db, garageId: string, id: string, data: z.infer<typeof customerPatch>) {
  await getCustomer(db, garageId, id);
  return db.customer.update({ where: { id }, data });
}

export async function listVehicles(db: Db, garageId: string, q: string | undefined, customerId: string | undefined, limit: number, offset: number) {
  const plate = normalisePlate(q);
  const where: Prisma.VehicleWhereInput = {
    garageId,
    ...(customerId ? { customerId } : {}),
    ...(q ? { OR: [{ plate: contains(plate ?? q) }, { make: contains(q) }, { model: contains(q) }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.vehicle.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
    db.vehicle.count({ where }),
  ]);
  return { items, total };
}

export async function getVehicle(db: Db, garageId: string, id: string) {
  const vehicle = await db.vehicle.findFirst({ where: { id, garageId } });
  if (!vehicle) throw notFound('Vehicle');
  return vehicle;
}

async function plateFree(db: Db, garageId: string, plate: string | null, exceptId?: string) {
  if (!plate) return;
  const clash = await db.vehicle.findFirst({ where: { garageId, plate, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { id: true } });
  if (clash) throw conflict(`A vehicle with plate ${plate} is already registered`);
}

export async function createVehicle(db: Db, garageId: string, data: z.infer<typeof vehicleInput>) {
  await assertCustomer(db, garageId, data.customerId);
  const plate = normalisePlate(data.plate);
  await plateFree(db, garageId, plate);
  return db.vehicle.create({ data: { ...data, plate, garageId } });
}

export async function updateVehicle(db: Db, garageId: string, id: string, data: z.infer<typeof vehiclePatch>) {
  await getVehicle(db, garageId, id);
  if (data.customerId !== undefined) await assertCustomer(db, garageId, data.customerId);
  const changes = { ...data };
  if (data.plate !== undefined) {
    changes.plate = normalisePlate(data.plate);
    await plateFree(db, garageId, changes.plate ?? null, id);
  }
  return db.vehicle.update({ where: { id }, data: changes });
}
