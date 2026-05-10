/**
 * ============================================================================
 * ECM Dispatch Optimizer — Expected-Cost Minimization Algorithm
 * ============================================================================
 * 
 * Core algorithm for SO2: selects the optimal provider by minimizing the
 * Expected Total Cost under diagnostic uncertainty.
 * 
 * Formula (from research proposal):
 *   ExpectedCost(p, i) = Σ_k [ P(type_k) × ResolutionCost(p, i, type_k) ]
 *                      + λ × TrafficImpact × E[ResolutionTime]
 * 
 *   Where:
 *     Match cost    = TravelTime + ServiceTime
 *     Mismatch cost = WastedTrip + AssessmentDelay + ReDispatchPenalty
 *     FinalCost     = ExpectedCost / TrustScore
 * 
 * The algorithm evaluates ALL available providers and ranks them by cost.
 * The top-ranked provider has the lowest expected cost and is dispatched.
 * 
 * @module services/dispatch-optimizer
 * @author Janukshan Sivakumar - IT22635266
 */

import {
  ServiceType, SERVICE_TYPES, ServiceTypeProbabilities,
  ProviderType, DispatchResult, RankedProvider, CostBreakdown,
  Location,
} from '../types';
import { canProviderHandle, calculateMismatchRisk } from '../constants/capability-matrix';
import { config } from '../config';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────
// Distance & ETA Utilities
// ─────────────────────────────────────────────────────────

/**
 * Haversine distance between two GPS coordinates (km).
 */
function haversineDistanceKm(a: Location, b: Location): number {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/**
 * Estimate travel time in minutes from distance.
 * Assumes average speed of 25 km/h in Colombo urban traffic.
 * This is replaced by Google Maps Distance Matrix API in production.
 */
function estimateTravelTimeMinutes(distanceKm: number): number {
  const AVG_SPEED_KMH = 25; // Colombo urban traffic average
  return (distanceKm / AVG_SPEED_KMH) * 60;
}

// ─────────────────────────────────────────────────────────
// Provider Data Interface (from DB)
// ─────────────────────────────────────────────────────────

/** Minimal provider info needed for ECM calculation */
export interface ECMProvider {
  id: string;
  name: string;
  type: ProviderType;
  latitude: number;
  longitude: number;
  capabilities: ServiceType[];
  trustScore: number;
}

// ─────────────────────────────────────────────────────────
// ECM Cost Calculation
// ─────────────────────────────────────────────────────────

/**
 * Calculate the expected cost of dispatching a specific provider
 * to an incident with the given probability distribution.
 * 
 * This is the core ECM formula from the research proposal:
 * 
 *   ExpectedCost = Σ_k [ P(type_k) × ResolutionCost(provider, type_k) ]
 *                + λ × trafficImpact × E[totalTime]
 * 
 * Where ResolutionCost depends on whether the provider CAN or CANNOT
 * handle service type k (match vs. mismatch).
 */
function calculateExpectedCost(
  provider: ECMProvider,
  incidentLocation: Location,
  probabilities: ServiceTypeProbabilities,
  trafficImpactScore: number,
  lambda: number,
): { expectedCost: number; breakdown: CostBreakdown; travelTimeMin: number; serviceTimeMin: number; mismatchRisk: number } {

  const distanceKm = haversineDistanceKm(
    { latitude: provider.latitude, longitude: provider.longitude },
    incidentLocation
  );
  const travelTimeMin = estimateTravelTimeMinutes(distanceKm);

  let expectedServiceCost = 0;
  let expectedMismatchCost = 0;
  let expectedTotalTime = travelTimeMin;

  const { averageServiceTimes, reDispatchPenaltyMinutes, assessmentDelayMinutes } = config.dispatch;

  // For each possible service type, weighted by its probability
  for (const serviceType of SERVICE_TYPES) {
    const prob = probabilities[serviceType];
    if (prob <= 0) continue;

    const serviceTime = averageServiceTimes[serviceType] || 30;

    if (canProviderHandle(provider.type, serviceType)) {
      // MATCH: provider can handle this service type
      // Cost = travelTime + serviceTime (in minutes, used as cost proxy)
      const matchCost = travelTimeMin + serviceTime;
      expectedServiceCost += prob * matchCost;
      expectedTotalTime += prob * serviceTime;
    } else {
      // MISMATCH: provider CANNOT handle this service type
      // Cost = wasted trip + assessment delay + re-dispatch penalty + correct provider travel + service
      const mismatchCost = travelTimeMin           // Wasted initial trip
        + assessmentDelayMinutes                    // Time to realize mismatch on-scene
        + reDispatchPenaltyMinutes                  // Penalty for sending another provider
        + serviceTime;                              // Actual service by correct provider
      expectedMismatchCost += prob * mismatchCost;
      expectedTotalTime += prob * (assessmentDelayMinutes + reDispatchPenaltyMinutes + serviceTime);
    }
  }

  // Traffic externality cost: λ × trafficImpact × expectedTotalTime
  // Higher traffic impact → more important to resolve quickly
  const trafficExternalityCost = lambda * (trafficImpactScore / 10) * expectedTotalTime;

  // Total raw cost
  const rawCost = expectedServiceCost + expectedMismatchCost + trafficExternalityCost;

  // Trust adjustment: divide by trust score (higher trust = lower cost)
  // Clamp trust to [0.1, 1.0] to prevent division by very small numbers
  const clampedTrust = Math.max(0.1, Math.min(1.0, provider.trustScore));
  const trustAdjustment = 1.0 / clampedTrust;
  const totalCost = rawCost * trustAdjustment;

  const mismatchRisk = calculateMismatchRisk(provider.type, probabilities);

  // Average service time (weighted by probabilities)
  let avgServiceTime = 0;
  for (const st of SERVICE_TYPES) {
    avgServiceTime += probabilities[st] * (averageServiceTimes[st] || 30);
  }

  const breakdown: CostBreakdown = {
    expectedServiceCost: parseFloat(expectedServiceCost.toFixed(2)),
    expectedMismatchCost: parseFloat(expectedMismatchCost.toFixed(2)),
    trafficExternalityCost: parseFloat(trafficExternalityCost.toFixed(2)),
    trustAdjustment: parseFloat(trustAdjustment.toFixed(4)),
    totalCost: parseFloat(totalCost.toFixed(2)),
  };

  return {
    expectedCost: parseFloat(totalCost.toFixed(2)),
    breakdown,
    travelTimeMin: parseFloat(travelTimeMin.toFixed(1)),
    serviceTimeMin: parseFloat(avgServiceTime.toFixed(1)),
    mismatchRisk: parseFloat(mismatchRisk.toFixed(4)),
  };
}

// ─────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────

/**
 * Run the ECM Dispatch Optimizer.
 * 
 * Evaluates all available providers, calculates expected cost for each,
 * and returns a ranked list from lowest (best) to highest cost.
 * 
 * @param providers - Available providers to evaluate
 * @param incidentLocation - GPS location of the stranded driver
 * @param probabilities - Probability distribution from triage engine
 * @param trafficImpactScore - Traffic impact (1-10) from Geo-Intelligence
 * @returns DispatchResult with ranked providers and cost breakdowns
 */
export function runDispatchOptimizer(
  providers: ECMProvider[],
  incidentLocation: Location,
  probabilities: ServiceTypeProbabilities,
  trafficImpactScore: number = 5,
): DispatchResult {
  const startTime = performance.now();
  const lambda = config.dispatch.trafficLambda;

  if (providers.length === 0) {
    throw new Error('No available providers to dispatch');
  }

  // Calculate expected cost for each provider
  const evaluatedProviders: RankedProvider[] = providers.map((provider) => {
    const result = calculateExpectedCost(
      provider, incidentLocation, probabilities, trafficImpactScore, lambda
    );

    return {
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        location: { latitude: provider.latitude, longitude: provider.longitude },
        capabilities: provider.capabilities,
        trustScore: provider.trustScore,
        status: 'AVAILABLE' as const,
      },
      expectedCost: result.expectedCost,
      rank: 0, // Will be set after sorting
      estimatedTravelTimeMin: result.travelTimeMin,
      estimatedServiceTimeMin: result.serviceTimeMin,
      mismatchRisk: result.mismatchRisk,
      costBreakdown: result.breakdown,
    };
  });

  // Sort by expected cost (ascending = best first)
  evaluatedProviders.sort((a, b) => a.expectedCost - b.expectedCost);

  // Assign ranks
  evaluatedProviders.forEach((p, i) => { p.rank = i + 1; });

  const computationTimeMs = parseFloat((performance.now() - startTime).toFixed(2));

  const dispatchResult: DispatchResult = {
    rankedProviders: evaluatedProviders,
    selectedProvider: evaluatedProviders[0],
    computationTimeMs,
    trafficImpactScore,
    lambda,
  };

  // Log the dispatch decision
  logger.info('ECM dispatch optimization completed', {
    totalProviders: providers.length,
    computationTimeMs,
    trafficImpactScore,
    lambda,
    selectedProvider: {
      id: evaluatedProviders[0].provider.id,
      name: evaluatedProviders[0].provider.name,
      type: evaluatedProviders[0].provider.type,
      expectedCost: evaluatedProviders[0].expectedCost,
      mismatchRisk: evaluatedProviders[0].mismatchRisk,
      travelTimeMin: evaluatedProviders[0].estimatedTravelTimeMin,
    },
    topThree: evaluatedProviders.slice(0, 3).map((p) => ({
      rank: p.rank,
      name: p.provider.name,
      type: p.provider.type,
      cost: p.expectedCost,
      mismatchRisk: p.mismatchRisk,
    })),
  });

  return dispatchResult;
}
