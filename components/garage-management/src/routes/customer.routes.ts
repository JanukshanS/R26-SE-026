import { Router } from 'express';

import * as customers from '../services/customers';
import { presentCustomer, presentVehicle } from '../services/presenters';
import { asyncHandler, ok, page, pageParams } from '../utils/http';
import { prisma } from '../utils/prisma';
import { customerInput, customerPatch, searchQuery, vehicleInput, vehiclePatch } from '../validation';

export const customerRouter = Router();

customerRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const { q } = searchQuery.parse(req.query);
    const { items, total } = await customers.listCustomers(prisma, req.garage!.id, q, limit, offset);
    ok(res, page(items.map(presentCustomer), total, limit, offset));
  }),
);

customerRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const customer = await customers.createCustomer(prisma, req.garage!.id, customerInput.parse(req.body));
    ok(res, presentCustomer(customer), 201);
  }),
);

customerRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await customers.getCustomer(prisma, req.garage!.id, req.params.id);
    ok(res, { ...presentCustomer(customer), vehicles: customer.vehicles.map(presentVehicle) });
  }),
);

customerRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const customer = await customers.updateCustomer(prisma, req.garage!.id, req.params.id, customerPatch.parse(req.body));
    ok(res, presentCustomer(customer));
  }),
);

export const vehicleRouter = Router();

vehicleRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const { q, customerId } = searchQuery.parse(req.query);
    const { items, total } = await customers.listVehicles(prisma, req.garage!.id, q, customerId, limit, offset);
    ok(res, page(items.map(presentVehicle), total, limit, offset));
  }),
);

vehicleRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const vehicle = await customers.createVehicle(prisma, req.garage!.id, vehicleInput.parse(req.body));
    ok(res, presentVehicle(vehicle), 201);
  }),
);

vehicleRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentVehicle(await customers.getVehicle(prisma, req.garage!.id, req.params.id)));
  }),
);

vehicleRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const vehicle = await customers.updateVehicle(prisma, req.garage!.id, req.params.id, vehiclePatch.parse(req.body));
    ok(res, presentVehicle(vehicle));
  }),
);
