import { Router } from 'express';

import { authorOf, ownerOnly } from '../middleware/auth';
import * as inspections from '../services/inspections';
import * as invoices from '../services/invoices';
import * as jobs from '../services/jobCards';
import { presentInspection, presentInvoice, presentJob, presentJobSummary } from '../services/presenters';
import { DomainError, asyncHandler, ok, page, pageParams } from '../utils/http';
import { compactPlate, vehicleLookup } from '../services/kadunaVehicles';
import { prisma } from '../utils/prisma';
import {
  fromDispatchInput,
  inspectionBoardQuery,
  inspectionCreateInput,
  inspectionItemInput,
  inspectionItemPatch,
  inspectionPatch,
  jobCardInput,
  jobCardPatch,
  jobItemInput,
  jobUpdateInput,
  listJobsQuery,
  statusInput,
} from '../validation';

export const jobRouter = Router();

/** What a mechanic may change on a job card; the rest (customer, mechanic, promise date) is the owner's. */
const MECHANIC_FIELDS = new Set(['diagnosis', 'complaint', 'odometerIn']);

jobRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = pageParams(req.query);
    const query = listJobsQuery.parse(req.query);
    const mechanicId = query.mine === 'true' && req.staff ? req.staff.id : query.mechanicId;
    const { items, total } = await jobs.listJobs(prisma, req.garage!.id, { ...query, mechanicId }, limit, offset);
    ok(res, page(items.map(presentJobSummary), total, limit, offset));
  }),
);

jobRouter.post(
  '/',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const data = jobCardInput.parse(req.body);
    const job = await prisma.$transaction((tx) => jobs.createJob(tx, req.garage!, data));
    ok(res, presentJob(job), 201);
  }),
);

/** Import a Kaduna dispatch job assigned to this provider. Repeat calls return the same job card. */
jobRouter.post(
  '/from-dispatch',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const { incidentId } = fromDispatchInput.parse(req.body);
    const { job, created } = await prisma.$transaction((tx) =>
      jobs.createFromDispatch(tx, req.garage!, incidentId, req.headers.authorization ?? ''),
    );
    ok(res, presentJob(job), created ? 201 : 200);
  }),
);

/**
 * Whether the job's car belongs to a Kaduna member, who then follows the job
 * in their own dashboard. Yes or no only; null when it can't be checked.
 */
jobRouter.get(
  '/:id/owner-link',
  asyncHandler(async (req, res) => {
    const job = await jobs.getJob(prisma, req.garage!.id, req.params.id);
    const plate = job.vehicle?.plate ?? null;
    ok(res, { plate, registered: plate ? await vehicleLookup().plateRegistered(compactPlate(plate)!, req.authToken) : null });
  }),
);

jobRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ok(res, presentJob(await jobs.getJob(prisma, req.garage!.id, req.params.id)));
  }),
);

jobRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = jobCardPatch.parse(req.body);
    if (req.role === 'MECHANIC' && Object.keys(data).some((k) => !MECHANIC_FIELDS.has(k))) {
      throw new DomainError(403, 'Mechanics can change the complaint, diagnosis and odometer only');
    }
    const job = await jobs.updateJob(prisma, req.garage!.id, req.params.id, data);
    ok(res, presentJob(job));
  }),
);

jobRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = statusInput.parse(req.body);
    if (req.role === 'MECHANIC' && jobs.OWNER_ONLY_STATUSES.includes(status)) {
      throw new DomainError(403, 'Only the garage owner can close or cancel a job');
    }
    const job = await prisma.$transaction((tx) => jobs.changeStatus(tx, req.garage!.id, req.params.id, status, authorOf(req)));
    ok(res, presentJob(job));
  }),
);

jobRouter.post(
  '/:id/items',
  asyncHandler(async (req, res) => {
    const data = jobItemInput.parse(req.body);
    const { job } = await prisma.$transaction((tx) => jobs.addItem(tx, req.garage!, req.params.id, data));
    ok(res, presentJob(job), 201);
  }),
);

jobRouter.delete(
  '/:id/items/:itemId',
  asyncHandler(async (req, res) => {
    const job = await prisma.$transaction((tx) => jobs.removeItem(tx, req.garage!.id, req.params.id, req.params.itemId));
    ok(res, presentJob(job));
  }),
);

jobRouter.post(
  '/:id/updates',
  asyncHandler(async (req, res) => {
    const data = jobUpdateInput.parse(req.body);
    ok(res, presentJob(await jobs.postUpdate(prisma, req.garage!.id, req.params.id, data, authorOf(req))), 201);
  }),
);

/** A new tracking link; the old one stops working. */
jobRouter.post(
  '/:id/tracking/reset',
  ownerOnly,
  asyncHandler(async (req, res) => {
    ok(res, presentJob(await jobs.resetTracking(prisma, req.garage!.id, req.params.id)));
  }),
);

jobRouter.post(
  '/:id/invoice',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const invoice = await prisma.$transaction((tx) => invoices.issueInvoice(tx, req.garage!, req.params.id));
    ok(res, presentInvoice(invoice), 201);
  }),
);

// ─── Inspection ──────────────────────────────────────────────────────────────

jobRouter.get(
  '/:id/inspection',
  asyncHandler(async (req, res) => {
    const inspection = await inspections.getInspection(prisma, req.garage!.id, req.params.id);
    // null, not 404: "not inspected yet" is a normal state with a start button.
    ok(res, inspection ? presentInspection(inspection) : null);
  }),
);

jobRouter.post(
  '/:id/inspection',
  asyncHandler(async (req, res) => {
    const { template } = inspectionCreateInput.parse(req.body);
    const inspection = await prisma.$transaction((tx) => inspections.createInspection(tx, req.garage!.id, req.params.id, template));
    ok(res, presentInspection(inspection), 201);
  }),
);

jobRouter.patch(
  '/:id/inspection',
  asyncHandler(async (req, res) => {
    const inspection = await inspections.updateInspection(prisma, req.garage!.id, req.params.id, inspectionPatch.parse(req.body));
    ok(res, presentInspection(inspection));
  }),
);

jobRouter.post(
  '/:id/inspection/items',
  asyncHandler(async (req, res) => {
    const inspection = await inspections.addInspectionItem(prisma, req.garage!.id, req.params.id, inspectionItemInput.parse(req.body));
    ok(res, presentInspection(inspection), 201);
  }),
);

jobRouter.patch(
  '/:id/inspection/items/:itemId',
  asyncHandler(async (req, res) => {
    const data = inspectionItemPatch.parse(req.body);
    const inspection = await prisma.$transaction((tx) =>
      inspections.updateInspectionItem(tx, req.garage!.id, req.params.id, req.params.itemId, data, authorOf(req)),
    );
    ok(res, presentInspection(inspection));
  }),
);

jobRouter.delete(
  '/:id/inspection/items/:itemId',
  asyncHandler(async (req, res) => {
    ok(res, presentInspection(await inspections.removeInspectionItem(prisma, req.garage!.id, req.params.id, req.params.itemId)));
  }),
);

jobRouter.post(
  '/:id/inspection/mark-rest-ok',
  asyncHandler(async (req, res) => {
    ok(res, presentInspection(await inspections.markRestOk(prisma, req.garage!.id, req.params.id)));
  }),
);

jobRouter.post(
  '/:id/inspection/send',
  asyncHandler(async (req, res) => {
    const inspection = await prisma.$transaction((tx) => inspections.sendInspection(tx, req.garage!.id, req.params.id, authorOf(req)));
    ok(res, presentInspection(inspection));
  }),
);

jobRouter.post(
  '/:id/inspection/items/:itemId/add-to-job',
  asyncHandler(async (req, res) => {
    const job = await prisma.$transaction((tx) => inspections.addApprovedToJob(tx, req.garage!, req.params.id, req.params.itemId));
    ok(res, presentJob(job), 201);
  }),
);

/** The inspection work queue across jobs (mounted at /inspections). */
export const inspectionRouter = Router();

inspectionRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = inspectionBoardQuery.parse(req.query);
    const mechanicId = query.mine === 'true' && req.staff ? req.staff.id : query.mechanicId;
    const rows = await inspections.inspectionBoard(prisma, req.garage!.id, mechanicId);
    ok(res, rows.map((r) => ({ job: presentJobSummary(r.job), inspection: r.inspection })));
  }),
);
