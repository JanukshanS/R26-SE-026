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
import { executeDispatch } from '../services/dispatch-executor';

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

    const outcome = await executeDispatch({
      incidentId,
      maxProviders,
      trafficImpactScore: parsed.data.trafficImpactScore,
      authorization: req.headers.authorization,
    });

    if (outcome.status === 'no_incident') {
      res.status(404).json({ success: false, error: 'Incident not found', timestamp: new Date().toISOString() });
      return;
    }
    if (outcome.status === 'no_triage') {
      res.status(400).json({
        success: false,
        error: 'Triage not completed. Submit triage first via POST /api/v1/triage/submit',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (outcome.status === 'no_providers') {
      res.status(404).json({
        success: false, error: 'No available providers found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { result, trafficImpactScore, trafficImpactSource, triageTier, triageConfidence } = outcome;

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
          triageTier,
          triageConfidence,
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
 * clears the assignment and returns the incident to DISPATCHING; the
 * re-dispatch watchdog (services/redispatch-watchdog.ts) picks it up on its
 * next poll and retries the ECM excluding this provider, so no immediate
 * re-optimization happens here.
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

    // One job at a time. A provider driving to one roadside cannot be at
    // another, and a second acceptance strands whichever driver they do not
    // reach. Derived from the incidents rather than a flag on the provider,
    // for the same reason the dispatch candidate query is (see
    // services/dispatch-executor.ts).
    //
    // Only guards ACCEPT: declining while busy is exactly what a busy
    // provider should be able to do.
    if (accepted && !alreadyAccepted) {
      const held = await prisma.incident.findFirst({
        where: {
          assignedProviderId: providerId,
          status: { in: ['EN_ROUTE', 'ON_SCENE'] },
          id: { not: incidentId },
        },
        select: { id: true },
      });
      if (held) {
        res.status(409).json({
          success: false,
          error: 'You already have a job in progress. Complete it before accepting another.',
          timestamp: new Date().toISOString(),
        });
        return;
      }
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
