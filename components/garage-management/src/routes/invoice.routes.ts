import { Router } from 'express';

import { dashboard } from '../services/dashboard';
import * as invoices from '../services/invoices';
import { presentInvoice } from '../services/presenters';
import { asyncHandler, ok, page, pageParams } from '../utils/http';
import { prisma } from '../utils/prisma';
import { invoicesQuery, paymentInput } from '../validation';

export const invoiceRouter = Router();

invoiceRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const { status } = invoicesQuery.parse(req.query);
    const { items, total } = await invoices.listInvoices(prisma, req.garage!.id, status, limit, offset);
    ok(res, page(items.map(presentInvoice), total, limit, offset));
  }),
);

invoiceRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentInvoice(await invoices.getInvoice(prisma, req.garage!.id, req.params.id)));
  }),
);

invoiceRouter.post(
  '/:id/pay',
  asyncHandler(async (req, res) => {
    const { method } = paymentInput.parse(req.body);
    const invoice = await prisma.$transaction((tx) => invoices.payInvoice(tx, req.garage!.id, req.params.id, method));
    ok(res, presentInvoice(invoice));
  }),
);

invoiceRouter.post(
  '/:id/void',
  asyncHandler(async (req, res) => {
    const invoice = await prisma.$transaction((tx) => invoices.voidInvoice(tx, req.garage!.id, req.params.id));
    ok(res, presentInvoice(invoice));
  }),
);

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    ok(res, await dashboard(prisma, req.garage!.id));
  }),
);
