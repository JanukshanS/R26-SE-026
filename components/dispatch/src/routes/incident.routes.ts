/**
 * Incident Routes — CRUD + Resolution with Bayesian feedback
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { createIncidentSchema, resolutionReportSchema } from '../utils/validators';
import { assertOwnsProvider } from '../middleware/auth';

export const incidentRouter = Router();

/** POST /api/v1/incidents — Create a new incident */
incidentRouter.post('/', async (req, res) => {
  try {
    const parsed = createIncidentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, error: 'Invalid request body',
        details: parsed.error.flatten(), timestamp: new Date().toISOString(),
      });
      return;
    }

    const { location, vehicleInfo, description } = parsed.data;

    const incident = await prisma.incident.create({
      data: {
        latitude: location.latitude,
        longitude: location.longitude,
        vehicleMake: vehicleInfo?.make,
        vehicleModel: vehicleInfo?.model,
        vehicleYear: vehicleInfo?.year,
        fuelType: vehicleInfo?.fuelType,
        registrationNo: vehicleInfo?.registrationNumber,
        hasOBD: vehicleInfo?.hasOBD ?? false,
        description,
        status: 'CREATED',
      },
    });

    logger.info('Incident created', { incidentId: incident.id, location });

    res.status(201).json({
      success: true, data: incident,
      message: 'Incident created successfully. Proceed to triage.',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to create incident:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/** GET /api/v1/incidents/:id — Get incident with all related data */
incidentRouter.get('/:id', async (req, res) => {
  try {
    const id = String(req.params.id);
    const incident = await prisma.incident.findUnique({
      where: { id },
      include: {
        triageResponse: true,
        dispatchDecisions: { include: { provider: true }, orderBy: { rank: 'asc' } },
        feedback: true,
        assignedProvider: true,
      },
    });

    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
      return;
    }

    res.json({ success: true, data: incident, timestamp: new Date().toISOString() });
  } catch (error: any) {
    logger.error('Failed to get incident:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/** GET /api/v1/incidents — List incidents */
incidentRouter.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const limit = parseInt(String(req.query.limit || '20'), 10);
    const offset = parseInt(String(req.query.offset || '0'), 10);

    const assignedProviderId = typeof req.query.assignedProviderId === 'string'
      ? req.query.assignedProviderId : undefined;

    const where: any = {};
    if (status) where.status = status;
    if (assignedProviderId) {
      // Scopes the listing to a provider the caller actually owns. Not a
      // confidentiality boundary: the unfiltered listing below is still
      // unscoped, so any signed-in caller can read every incident.
      if (!(await assertOwnsProvider(req, res, assignedProviderId))) return;
      where.assignedProviderId = assignedProviderId;
    }

    const [incidents, total] = await Promise.all([
      prisma.incident.findMany({
        where, take: limit, skip: offset, orderBy: { createdAt: 'desc' },
        include: { triageResponse: true, assignedProvider: true },
      }),
      prisma.incident.count({ where }),
    ]);

    res.json({
      success: true, data: { incidents, total, limit, offset },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to list incidents:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/** POST /api/v1/incidents/:id/resolve — Submit resolution + Bayesian feedback */
/**
 * Statuses a driver may still cancel from — everything up to and including a
 * provider having been OFFERED the job, but not one who has accepted it.
 *
 * EN_ROUTE is the line. Once a provider has accepted they are driving to the
 * scene, possibly across Colombo, and a silent cancellation strands them with
 * an unpaid trip. Cancelling after that point is a conversation, not a button.
 */
const CANCELLABLE_STATUSES = ['CREATED', 'TRIAGING', 'DISPATCHING', 'PROVIDER_ASSIGNED'] as const;

/**
 * POST /api/v1/incidents/:id/cancel — the driver calls off their own request.
 *
 * OWNERSHIP IS NOT VERIFIED HERE, and cannot be: `Incident` carries no user
 * id, so there is nothing to compare the bearer token against. Any signed-in
 * user could cancel any incident whose id they know. That matches the rest of
 * this router (`GET /:id` is equally open) and is the same hardening gap
 * already tracked for the provider routes — but it is a real hole, not an
 * accepted design, and closing it needs a `userId` column on Incident.
 */
incidentRouter.post('/:id/cancel', async (req, res) => {
  try {
    const incidentId = String(req.params.id);
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });

    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
      return;
    }

    // Cancelling an already-cancelled request is what a retried tap looks
    // like on a flaky roadside connection. Succeed rather than showing the
    // driver an error for something that already went their way.
    if (incident.status === 'CANCELLED') {
      res.json({ success: true, data: incident, message: 'Incident was already cancelled', timestamp: new Date().toISOString() });
      return;
    }

    if (!(CANCELLABLE_STATUSES as readonly string[]).includes(incident.status)) {
      res.status(409).json({
        success: false,
        error: `Incident cannot be cancelled once it is ${incident.status.toLowerCase().replace(/_/g, ' ')}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // The provider being offered this job may accept in this exact instant,
    // and the re-dispatch watchdog may release it in the same tick. Guard the
    // write on the status we decided from, same as the watchdog and /respond
    // do, so whichever lands second is a no-op instead of a clobber.
    const { count } = await prisma.incident.updateMany({
      where: { id: incidentId, status: { in: [...CANCELLABLE_STATUSES] } },
      data: { status: 'CANCELLED', assignedProviderId: null },
    });

    if (count === 0) {
      res.status(409).json({
        success: false,
        error: 'A provider accepted this job just now, so it can no longer be cancelled',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Close out the offer the provider was still holding, so their job list
    // clears and the decision row does not read as an unanswered offer for
    // ever. Mirrors the watchdog's release path.
    if (incident.assignedProviderId) {
      const decision = await prisma.dispatchDecision.findFirst({
        where: { incidentId, providerId: incident.assignedProviderId },
        orderBy: { createdAt: 'desc' },
      });
      if (decision) {
        await prisma.dispatchDecision.update({
          where: { id: decision.id },
          data: {
            accepted: false,
            declineReason: 'CANCELLED_BY_DRIVER',
            responseTimeSeconds: Math.round((Date.now() - new Date(decision.createdAt).getTime()) / 1000),
          },
        });
      }
    }

    const cancelled = await prisma.incident.findUnique({ where: { id: incidentId } });

    logger.info('Incident cancelled by driver', {
      incidentId,
      previousStatus: incident.status,
      releasedProviderId: incident.assignedProviderId ?? null,
    });

    res.json({
      success: true,
      data: cancelled,
      message: 'Request cancelled',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to cancel incident:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

incidentRouter.post('/:id/resolve', async (req, res) => {
  try {
    const parsed = resolutionReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, error: 'Invalid resolution report',
        details: parsed.error.flatten(), timestamp: new Date().toISOString(),
      });
      return;
    }

    const { providerId, actualServiceType, resolutionTimeMinutes, notes, escalationNeeded } = parsed.data;
    const incidentId = String(req.params.id);

    // Checked before the incident is read, so a non-owner cannot probe existence.
    if (!(await assertOwnsProvider(req, res, providerId))) return;

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { triageResponse: true },
    });

    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
      return;
    }

    if (incident.assignedProviderId !== providerId) {
      res.status(409).json({
        success: false, error: 'Incident is not assigned to this provider',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (incident.status === 'RESOLVED' || incident.status === 'ESCALATED') {
      res.status(409).json({
        success: false, error: `Incident is already ${incident.status.toLowerCase()}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const predictedServiceType = incident.triageResponse?.predictedServiceType;
    const wasMatch = predictedServiceType === actualServiceType;

    const updatedIncident = await prisma.incident.update({
      where: { id: incidentId },
      data: { status: escalationNeeded ? 'ESCALATED' : 'RESOLVED', resolvedAt: new Date() },
    });

    // Record feedback for Bayesian learning
    if (incident.triageResponse && incident.assignedProviderId) {
      const triage = incident.triageResponse;
      await prisma.resolutionFeedback.create({
        data: {
          incidentId,
          providerId: incident.assignedProviderId,
          predictedDistribution: triage.probabilities as any,
          predictedServiceType: triage.predictedServiceType,
          predictedConfidence: triage.confidence,
          actualServiceType: actualServiceType as any,
          wasMatch,
          resolutionTimeMinutes,
          providerNotes: notes,
        },
      });

      logger.info('Resolution feedback recorded', {
        incidentId, predictedServiceType, actualServiceType, wasMatch, resolutionTimeMinutes,
      });
    }

    res.json({
      success: true,
      data: {
        incident: updatedIncident, wasMatch,
        message: wasMatch ? 'Prediction matched ✓' : `Mismatch: predicted ${predictedServiceType}, actual ${actualServiceType}`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Failed to resolve incident:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});
