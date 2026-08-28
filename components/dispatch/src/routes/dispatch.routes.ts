/**
 * Dispatch Routes — ECM Optimization API
 * Implements SO2: Expected-Cost Minimization under uncertainty.
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { dispatchRequestSchema, providerResponseSchema } from '../utils/validators';
import { assertOwnsProvider } from '../middleware/auth';
import { runDispatchOptimizer, ECMProvider } from '../services/dispatch-optimizer';
import { ServiceTypeProbabilities, ServiceType } from '../types';
import { fetchTrafficImpactScore } from '../services/geo-client';

export const dispatchRouter = Router();

/**
 * POST /api/v1/dispatch/optimize
 * Run ECM algorithm to find optimal provider for an incident.
 * Requires: incident must have completed triage (status = DISPATCHING).
 */
dispatchRouter.post('/optimize', async (req, res) => {
  try {
    const parsed = dispatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, error: 'Invalid dispatch request',
        details: parsed.error.flatten(), timestamp: new Date().toISOString(),
      });
      return;
    }

    const { incidentId, maxProviders } = parsed.data;

    // Get incident with triage data
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { triageResponse: true },
    });

    if (!incident) {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
      return;
    }

    if (!incident.triageResponse) {
      res.status(400).json({
        success: false,
        error: 'Triage not completed. Submit triage first via POST /api/v1/triage/submit',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Traffic impact: use the client's value if supplied, otherwise fetch it live
    // from geo-intelligence. Falls back to a neutral 5 if geo is unreachable so
    // dispatch never hard-depends on it. 'geo-unavailable' means geo answered with
    // an error status (misconfigured deploy), 'default' that it never answered.
    let trafficImpactScore = parsed.data.trafficImpactScore;
    let trafficImpactSource: 'client' | 'geo-intelligence' | 'geo-unavailable' | 'default' =
      trafficImpactScore !== undefined ? 'client' : 'default';
    if (trafficImpactScore === undefined) {
      const geoScore = await fetchTrafficImpactScore({
        latitude: incident.latitude,
        longitude: incident.longitude,
        probabilities: incident.triageResponse.probabilities as unknown as ServiceTypeProbabilities,
        authorization: req.headers.authorization,
      });
      if (typeof geoScore === 'number') {
        trafficImpactScore = geoScore;
        trafficImpactSource = 'geo-intelligence';
      } else {
        trafficImpactScore = 5;
        if (geoScore === 'geo-unavailable') trafficImpactSource = 'geo-unavailable';
      }
    }

    // Get available providers
    const dbProviders = await prisma.provider.findMany({
      where: { status: 'AVAILABLE' },
      take: maxProviders,
    });

    if (dbProviders.length === 0) {
      res.status(404).json({
        success: false, error: 'No available providers found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Map DB providers to ECM interface
    const ecmProviders: ECMProvider[] = dbProviders.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type as any,
      latitude: p.latitude,
      longitude: p.longitude,
      capabilities: p.capabilities as ServiceType[],
      trustScore: p.trustScore,
      serviceTimes: p.serviceTimes as Record<string, number>,
    }));

    // Extract probability distribution from triage
    const probabilities = incident.triageResponse.probabilities as unknown as ServiceTypeProbabilities;
    const incidentLocation = { latitude: incident.latitude, longitude: incident.longitude };

    // Run ECM Dispatch Optimizer
    const result = runDispatchOptimizer(ecmProviders, incidentLocation, probabilities, trafficImpactScore);

    // Persist dispatch decisions to database
    for (const ranked of result.rankedProviders) {
      await prisma.dispatchDecision.create({
        data: {
          incidentId,
          providerId: ranked.provider.id,
          rank: ranked.rank,
          expectedCost: ranked.expectedCost,
          estimatedTravelTimeMin: ranked.estimatedTravelTimeMin,
          estimatedServiceTimeMin: ranked.estimatedServiceTimeMin,
          mismatchRisk: ranked.mismatchRisk,
          costBreakdown: ranked.costBreakdown as any,
          trafficImpactScore,
          lambdaUsed: result.lambda,
          computationTimeMs: result.computationTimeMs,
          totalProvidersEvaluated: result.rankedProviders.length,
        },
      });
    }

    // Assign top provider to incident
    await prisma.incident.update({
      where: { id: incidentId },
      data: {
        assignedProviderId: result.selectedProvider.provider.id,
        status: 'PROVIDER_ASSIGNED',
      },
    });

    logger.info('Dispatch optimization completed and persisted', {
      incidentId,
      selectedProvider: result.selectedProvider.provider.name,
      expectedCost: result.selectedProvider.expectedCost,
      computationTimeMs: result.computationTimeMs,
      providersEvaluated: result.rankedProviders.length,
    });

    res.json({
      success: true,
      data: {
        incidentId,
        selectedProvider: {
          id: result.selectedProvider.provider.id,
          name: result.selectedProvider.provider.name,
          type: result.selectedProvider.provider.type,
          expectedCost: result.selectedProvider.expectedCost,
          mismatchRisk: result.selectedProvider.mismatchRisk,
          estimatedTravelTimeMin: result.selectedProvider.estimatedTravelTimeMin,
          costBreakdown: result.selectedProvider.costBreakdown,
        },
        allRankedProviders: result.rankedProviders.map((r) => ({
          rank: r.rank,
          providerId: r.provider.id,
          name: r.provider.name,
          type: r.provider.type,
          expectedCost: r.expectedCost,
          mismatchRisk: r.mismatchRisk,
          travelTimeMin: r.estimatedTravelTimeMin,
        })),
        metadata: {
          computationTimeMs: result.computationTimeMs,
          trafficImpactScore,
          trafficImpactSource,
          lambda: result.lambda,
          providersEvaluated: result.rankedProviders.length,
          triageTier: incident.triageResponse.tier,
          triageConfidence: incident.triageResponse.confidence,
        },
        message: `Dispatched: ${result.selectedProvider.provider.name} (${result.selectedProvider.provider.type}) — Expected cost: ${result.selectedProvider.expectedCost.toFixed(1)} min`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Dispatch optimization failed:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

/**
 * POST /api/v1/dispatch/respond
 * The assigned provider accepts or declines the job.
 *
 * Accepting moves the incident to EN_ROUTE — the enum has no separate
 * ACCEPTED state, and EN_ROUTE is what an accepted job actually is. Declining
 * clears the assignment and returns the incident to DISPATCHING so it can be
 * re-optimised; re-running the optimizer here is deliberately left to the
 * caller, since it has no exclusion list and would re-pick the decliner.
 */
dispatchRouter.post('/respond', async (req, res) => {
  try {
    const parsed = providerResponseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false, error: 'Invalid provider response',
        details: parsed.error.flatten(), timestamp: new Date().toISOString(),
      });
      return;
    }

    const { incidentId, providerId, accepted, declineReason } = parsed.data;

    if (!(await assertOwnsProvider(req, res, providerId))) return;

    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });

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

    // Accepting an already-accepted job is a no-op rather than an error: a
    // retried request must not rewrite the response time or bounce the status
    // back from ON_SCENE.
    const alreadyAccepted = accepted && (incident.status === 'EN_ROUTE' || incident.status === 'ON_SCENE');
    if (!alreadyAccepted && incident.status !== 'PROVIDER_ASSIGNED') {
      res.status(409).json({
        success: false, error: `Cannot respond to an incident in status ${incident.status}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    let updatedIncident = incident;
    if (!alreadyAccepted) {
      // Conditional write: the transition only lands while the incident still
      // holds the state checked above, so a racing accept and decline cannot
      // both apply. updateMany returns a count rather than the row, hence the
      // re-read below.
      const { count } = await prisma.incident.updateMany({
        where: { id: incidentId, assignedProviderId: providerId, status: 'PROVIDER_ASSIGNED' },
        data: accepted
          ? { status: 'EN_ROUTE' }
          : { status: 'DISPATCHING', assignedProviderId: null },
      });

      if (count === 0) {
        res.status(409).json({
          success: false, error: 'Another response for this incident was recorded first',
          timestamp: new Date().toISOString(),
        });
        return;
      }

      updatedIncident = (await prisma.incident.findUnique({ where: { id: incidentId } })) ?? incident;

      // The decision row from /optimize carries the response; it is absent if
      // the assignment was made some other way, which is not fatal here.
      const decision = await prisma.dispatchDecision.findFirst({
        where: { incidentId, providerId },
        orderBy: { createdAt: 'desc' },
      });
      if (decision) {
        await prisma.dispatchDecision.update({
          where: { id: decision.id },
          data: {
            accepted,
            declineReason: accepted ? null : declineReason,
            responseTimeSeconds: Math.round((Date.now() - new Date(decision.createdAt).getTime()) / 1000),
          },
        });
      }
    }

    logger.info('Provider response recorded', {
      incidentId, providerId, accepted, alreadyAccepted, status: updatedIncident.status,
    });

    res.json({
      success: true,
      data: {
        incident: updatedIncident,
        accepted,
        message: accepted
          ? 'Job accepted — provider en route'
          : 'Job declined — incident returned to dispatch',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Provider response failed:', error);
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});
