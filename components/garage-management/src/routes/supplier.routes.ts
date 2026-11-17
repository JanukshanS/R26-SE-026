import { Router } from 'express';

import { presentMovement, presentPart, presentSupplier } from '../services/presenters';
import * as suppliers from '../services/suppliers';
import { asyncHandler, ok } from '../utils/http';
import { prisma } from '../utils/prisma';
import { supplierInput, supplierPatch, suppliersQuery } from '../validation';

/** Owner only (mounted behind ownerOnly). */
export const supplierRouter = Router();

supplierRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = suppliersQuery.parse(req.query);
    const rows = await suppliers.listSuppliers(prisma, req.garage!.id, { q: query.q, includeInactive: query.includeInactive === 'true' });
    ok(res, rows.map((r) => ({ ...presentSupplier(r.supplier), totalSpend: Math.round(r.totalSpend * 100) / 100, lastPurchaseAt: r.lastPurchaseAt })));
  }),
);

supplierRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, presentSupplier(await suppliers.createSupplier(prisma, req.garage!.id, supplierInput.parse(req.body))), 201);
  }),
);

supplierRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { supplier, parts, purchases, totalSpend } = await suppliers.supplierDetail(prisma, req.garage!.id, req.params.id);
    ok(res, {
      ...presentSupplier(supplier),
      totalSpend,
      parts: parts.map(presentPart),
      purchases: purchases.map((m) => ({ ...presentMovement(m), partName: m.part.name, partSku: m.part.sku })),
    });
  }),
);

supplierRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentSupplier(await suppliers.updateSupplier(prisma, req.garage!.id, req.params.id, supplierPatch.parse(req.body))));
  }),
);

