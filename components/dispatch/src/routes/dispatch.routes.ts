/**
 * Dispatch Routes — ECM Optimization API
 * Implements SO2: Expected-Cost Minimization under uncertainty.
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { dispatchRequestSchema } from '../utils/validators';
import { runDispatchOptimizer, ECMProvider } from '../services/dispatch-optimizer';
import { ServiceTypeProbabilities, ServiceType } from '../types';

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

    const { incidentId, trafficImpactScore = 5, maxProviders } = parsed.data;

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

/** POST /api/v1/dispatch/respond — Provider accepts/declines (Phase 5) */
dispatchRouter.post('/respond', async (_req, res) => {
  res.status(501).json({
    success: false, error: 'Provider response handling — Phase 5',
    timestamp: new Date().toISOString(),
  });
});
