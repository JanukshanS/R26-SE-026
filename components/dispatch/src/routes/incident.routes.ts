/**
 * Incident Routes — CRUD + Resolution with Bayesian feedback
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { createIncidentSchema, resolutionReportSchema } from '../utils/validators';

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

    const where: any = {};
    if (status) where.status = status;

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

    const { actualServiceType, resolutionTimeMinutes, notes, escalationNeeded } = parsed.data;
    const incidentId = String(req.params.id);

    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { triageResponse: true },
    });

    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
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
