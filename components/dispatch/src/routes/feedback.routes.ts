/**
 * ============================================================================
 * Feedback Routes — post-resolution reporting + Bayesian introspection
 * ============================================================================
 *
 * Endpoints:
 *   POST /api/v1/incidents/:incidentId/feedback   — report actual outcome
 *   GET  /api/v1/bayesian/priors/:symptomKey      — inspect a stored prior
 *   GET  /api/v1/bayesian/stats                   — aggregate learning stats
 *
 * The feedback POST is the load-bearing endpoint: it closes the Bayesian
 * loop by writing a `ResolutionFeedback` row AND updating the stored
 * posterior for the incident's symptom key. Without this call the tree
 * runs forever unchanged.
 *
 * The GET endpoints are for research / viva demos — they let a reviewer
 * see the posterior converge in real time.
 *
 * Auth: all three are gated by `requireUser` in the parent app.ts. The
 * feedback endpoint additionally verifies the reporting provider is
 * the one assigned to the incident (or an admin — TODO once roles land).
 *
 * @module routes/feedback
 * @author Janukshan Sivakumar - IT22635266
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { recomputeProviderTrust } from '../services/provider-trust';
import {
  ServiceType,
  ServiceTypeProbabilities,
  SERVICE_TYPES,
} from '../types';
import {
  applyFeedback,
  computeAggregateStats,
  getPriorForKey,
} from '../services/bayesian-service';
import {
  computeSymptomKey,
  describeSymptomKey,
} from '../utils/symptom-key';
import {
  argmaxServiceType,
  shannonEntropy,
} from '../services/bayesian-engine';

export const feedbackRouter = Router();
export const bayesianRouter = Router();

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

const feedbackBodySchema = z.object({
  providerId:            z.string().uuid(),
  actualServiceType:     z.enum(SERVICE_TYPES as unknown as [string, ...string[]]),
  resolutionTimeMinutes: z.number().min(0).max(480),
  reDispatches:          z.number().int().min(0).optional(),
  userRating:            z.number().min(0).max(5).optional(),
  providerNotes:         z.string().max(1000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// POST /api/v1/incidents/:incidentId/feedback
// ─────────────────────────────────────────────────────────────────────────

feedbackRouter.post('/:incidentId/feedback', async (req, res) => {
  try {
    const parsed = feedbackBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error:   'Invalid feedback payload',
        details: parsed.error.flatten(),
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const incidentId = req.params.incidentId;
    const {
      providerId,
      actualServiceType,
      resolutionTimeMinutes,
      reDispatches = 0,
      userRating,
      providerNotes,
    } = parsed.data;

    // ── Fetch the incident + its triage record ────────────────────────
    // Feedback only makes sense against an incident that was triaged;
    // fast-path incidents have a triage record too (deterministic 1.0
    // on a single class) so they still work end-to-end.
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { triageResponse: true },
    });
    if (!incident) {
      res.status(404).json({
        success: false, error: 'Incident not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (!incident.triageResponse) {
      res.status(409).json({
        success: false, error: 'Incident has no triage record — cannot compute symptom key',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Confirm provider is registered ────────────────────────────────
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      res.status(404).json({
        success: false, error: 'Provider not found',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ── Rebuild TriageResponses shape so we can compute the symptom key
    //    (the triage record persists fields with different camelCase names)
    const t = incident.triageResponse;
    const responses = {
      Q1_intent:           t.q1Intent,
      Q2_engine_start:     t.q2EngineStart,
      Q2b_running_issue:   t.q2bRunningIssue,
      Q3_sound:            t.q3Sound,
      Q3b_electrical:      t.q3bElectrical,
      Q4_noise_detail:     t.q4NoiseDetail,
      Q7_overheat_detail:  t.q7OverheatDetail,
      Q8_smoke_color:      t.q8SmokeColor,
      Q_brake_detail:      t.qBrakeDetail,
      Q_gear_detail:       t.qGearDetail,
      Q6_smells:           t.q6Smells,
      Q5_lights:           t.q5Lights,
      Q9_recent:           t.q9Recent,
      location_type:       t.locationType,
      recent_rain:         t.recentRain,
      parked_overnight:    t.parkedOvernight,
      vehicle_age_bucket:  t.vehicleAgeBucket,
      last_fueled:         t.lastFueled,
    } as any;

    const symptomKey = computeSymptomKey(responses);

    // ── Persist the ResolutionFeedback row (idempotent per incident) ─
    // Using upsert on the unique `incidentId` column so re-reports for
    // the same incident update instead of erroring — matches how
    // triage.routes.ts handles resubmissions.
    const predictedDistribution = t.probabilities as unknown as ServiceTypeProbabilities;
    const predictedServiceType  = t.predictedServiceType as ServiceType;
    const wasMatch              = predictedServiceType === actualServiceType;

    const feedback = await prisma.resolutionFeedback.upsert({
      where: { incidentId },
      create: {
        incidentId,
        providerId,
        predictedDistribution: predictedDistribution as any,
        predictedServiceType:  predictedServiceType   as any,
        predictedConfidence:   t.confidence,
        actualServiceType:     actualServiceType      as any,
        wasMatch,
        resolutionTimeMinutes,
        reDispatches,
        userRating,
        providerNotes,
      },
      update: {
        providerId,
        actualServiceType:     actualServiceType      as any,
        wasMatch,
        resolutionTimeMinutes,
        reDispatches,
        userRating,
        providerNotes,
      },
    });

    // ── Apply the observation to the Bayesian posterior ───────────────
    const updatedPrior = await applyFeedback(symptomKey, actualServiceType as ServiceType);

    // Trust is DERIVED from the feedback rows, not incremented here — see
    // services/provider-trust.ts. Incrementing made the score depend on which
    // endpoint happened to close the job, and double-counted whenever this
    // handler ran twice for one incident, which its own upsert invites.
    await recomputeProviderTrust(providerId);

    // ── Move incident → RESOLVED ──────────────────────────────────────
    await prisma.incident.update({
      where: { id: incidentId },
      data:  { status: 'RESOLVED', resolvedAt: new Date() },
    });

    logger.info('Feedback recorded', {
      incidentId,
      symptomKey,
      predictedServiceType,
      actualServiceType,
      wasMatch,
      newObservationCount: updatedPrior.observationCount,
      newLearningRate:     updatedPrior.currentLearningRate.toFixed(4),
    });

    const argmax = argmaxServiceType(updatedPrior.probabilities);

    res.json({
      success: true,
      data: {
        feedbackId:            feedback.id,
        symptomKey,
        predictedServiceType,
        actualServiceType,
        wasMatch,
        posterior: {
          observationCount:    updatedPrior.observationCount,
          currentLearningRate: parseFloat(updatedPrior.currentLearningRate.toFixed(4)),
          entropyBits:         parseFloat(shannonEntropy(updatedPrior.probabilities).toFixed(4)),
          argmax: {
            serviceType: argmax.serviceType,
            probability: parseFloat(argmax.probability.toFixed(4)),
          },
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Feedback recording failed:', error);
    res.status(500).json({
      success: false, error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/bayesian/priors/:symptomKey
// ─────────────────────────────────────────────────────────────────────────

bayesianRouter.get('/priors/:symptomKey', async (req, res) => {
  try {
    const stored = await getPriorForKey(req.params.symptomKey);
    if (!stored) {
      res.status(404).json({
        success: false, error: 'No prior found for this symptom key',
        timestamp: new Date().toISOString(),
      });
      return;
    }
    const argmax = argmaxServiceType(stored.probabilities);
    res.json({
      success: true,
      data: {
        symptomKey:          stored.symptomKey,
        observationCount:    stored.observationCount,
        currentLearningRate: parseFloat(stored.currentLearningRate.toFixed(4)),
        entropyBits:         parseFloat(shannonEntropy(stored.probabilities).toFixed(4)),
        probabilities:       stored.probabilities,
        argmax: {
          serviceType: argmax.serviceType,
          probability: parseFloat(argmax.probability.toFixed(4)),
        },
        updatedAt:           stored.updatedAt.toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Prior lookup failed:', error);
    res.status(500).json({
      success: false, error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /api/v1/bayesian/stats
// ─────────────────────────────────────────────────────────────────────────

bayesianRouter.get('/stats', async (_req, res) => {
  try {
    const stats = await computeAggregateStats();
    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
  } catch (error: any) {
    logger.error('Bayesian stats failed:', error);
    res.status(500).json({
      success: false, error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Debug: preview a symptom key for a given TriageResponses payload
// (helps mechanics and researchers understand what pattern they're hitting)
// ─────────────────────────────────────────────────────────────────────────

bayesianRouter.post('/symptom-key/preview', (req, res) => {
  try {
    // The full triageResponsesSchema is heavier than we need for this debug
    // helper; we accept any object and let computeSymptomKey pull the fields
    // it cares about (missing fields render as "undefined" in the key,
    // which is fine for a preview but WON'T match production keys — hence
    // /preview naming).
    const key         = computeSymptomKey(req.body);
    const description = describeSymptomKey(req.body);
    res.json({
      success: true,
      data:    { symptomKey: key, keyFields: description },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(400).json({
      success: false, error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});
