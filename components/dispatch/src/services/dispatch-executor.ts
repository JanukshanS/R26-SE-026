/**
 * Shared core for running the ECM optimizer against an incident and
 * persisting the result. Used by both the POST /dispatch/optimize route
 * (first assignment) and the re-dispatch watchdog (retry after a decline
 * or acceptance timeout), so both call sites price a job identically and
 * can't silently drift apart.
 * @author Janukshan Sivakumar - IT22635266
 */
import { prisma } from '../utils/prisma';
import { argmaxServiceType } from './bayesian-engine';
import { logger } from '../utils/logger';
import { runDispatchOptimizer, ECMProvider } from './dispatch-optimizer';
import { fetchTrafficImpactScore } from './geo-client';
import { ServiceTypeProbabilities, ServiceType } from '../types';

export type TrafficImpactSource = 'client' | 'geo-intelligence' | 'geo-unavailable' | 'default';

export interface ExecuteDispatchParams {
  incidentId: string;
  maxProviders?: number;
  trafficImpactScore?: number;
  /** Providers to leave out of the candidate pool — used on retries so a
   *  decliner or a timed-out provider isn't immediately re-offered the job. */
  excludeProviderIds?: string[];
  authorization?: string;
}

export interface ExecuteDispatchOutcome {
  status: 'dispatched';
  incidentId: string;
  result: Awaited<ReturnType<typeof runDispatchOptimizer>>;
  trafficImpactScore: number;
  trafficImpactSource: TrafficImpactSource;
  triageTier: string;
  triageConfidence: number;
}

export type ExecuteDispatchResult =
  | ExecuteDispatchOutcome
  | { status: 'no_incident' }
  | { status: 'no_triage' }
  | { status: 'no_providers' };

export async function executeDispatch(params: ExecuteDispatchParams): Promise<ExecuteDispatchResult> {
  const { incidentId, maxProviders, excludeProviderIds = [], authorization } = params;

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { triageResponse: true },
  });
  if (!incident) return { status: 'no_incident' };
  if (!incident.triageResponse) return { status: 'no_triage' };

  // Traffic impact: use the caller's value if supplied, otherwise fetch it
  // live from geo-intelligence. Falls back to a neutral 5 if geo is
  // unreachable so dispatch never hard-depends on it.
  let trafficImpactScore = params.trafficImpactScore;
  let trafficImpactSource: TrafficImpactSource = trafficImpactScore !== undefined ? 'client' : 'default';
  if (trafficImpactScore === undefined) {
    const geoScore = await fetchTrafficImpactScore({
      latitude: incident.latitude,
      longitude: incident.longitude,
      probabilities: incident.triageResponse.probabilities as unknown as ServiceTypeProbabilities,
      authorization,
    });
    if (typeof geoScore === 'number') {
      trafficImpactScore = geoScore;
      trafficImpactSource = 'geo-intelligence';
    } else {
      trafficImpactScore = 5;
      if (geoScore === 'geo-unavailable') trafficImpactSource = 'geo-unavailable';
    }
  }

  // A provider already holding a job is not a candidate for another one.
  //
  // DERIVED FROM THE INCIDENTS, not from a BUSY flag on the provider. A flag
  // has to be set on accept and cleared on resolve, decline, cancel, timeout
  // and re-dispatch, and any path that forgets leaves a provider invisible to
  // dispatch for ever with nothing on screen to explain why. The incident rows
  // already say who is occupied, so ask them.
  //
  // PROVIDER_ASSIGNED counts as busy even though it has not been accepted:
  // holding two competing offers at once is how a provider ends up accepting
  // both and stranding one driver.
  const busy = await prisma.incident.findMany({
    where: {
      assignedProviderId: { not: null },
      status: { in: ['PROVIDER_ASSIGNED', 'EN_ROUTE', 'ON_SCENE'] },
    },
    select: { assignedProviderId: true },
  });
  const unavailableIds = Array.from(new Set([
    ...excludeProviderIds,
    ...busy.map((i) => i.assignedProviderId as string),
  ]));

  // The single most likely diagnosis. A provider who cannot perform THIS is
  // not a candidate, however close they are.
  //
  // WHY A HARD GATE AND NOT A PRICED RISK. The ECM already prices mismatch as
  // assessment delay + re-dispatch penalty + service time, which is the right
  // model when a job is substitutable — a mechanic who guessed wrong can often
  // still help. It is the wrong model when it is not: dispatched against a
  // SEVERE_MECHANICAL_TOW, a mobile mechanic with no tow gear achieves nothing
  // on scene, and the driver waits the full assessment-plus-re-dispatch delay
  // to find that out. Observed in production on 2026-08-31: a mechanic 0.0 min
  // away outranked a tow truck 34 min away for a tow-required incident,
  // because ~40 cost units of priced mismatch did not cover a 34-minute travel
  // advantage. No amount of tuning the penalty fixes the category error.
  //
  // Filtered in the QUERY rather than after, so `take` still returns a full
  // page of genuinely eligible providers rather than a page that is mostly
  // discarded.
  const predicted = argmaxServiceType(
    incident.triageResponse.probabilities as unknown as ServiceTypeProbabilities,
  ).serviceType;

  const dbProviders = await prisma.provider.findMany({
    where: {
      status: 'AVAILABLE',
      capabilities: { has: predicted },
      ...(unavailableIds.length > 0 ? { id: { notIn: unavailableIds } } : {}),
    },
    take: maxProviders,
  });

  if (dbProviders.length === 0) {
    // Nobody in the fleet can do this job right now. Escalating is the honest
    // outcome — sending someone who cannot help is not a fallback, it is the
    // bug this gate exists to prevent.
    logger.warn('No capable provider available for the predicted service', {
      incidentId, predictedServiceType: predicted, excluded: unavailableIds.length,
    });
    return { status: 'no_providers' };
  }

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

  const probabilities = incident.triageResponse.probabilities as unknown as ServiceTypeProbabilities;
  const incidentLocation = { latitude: incident.latitude, longitude: incident.longitude };

  const result = await runDispatchOptimizer(ecmProviders, incidentLocation, probabilities, trafficImpactScore);

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
    excludedProviders: excludeProviderIds.length,
  });

  return {
    status: 'dispatched',
    incidentId,
    result,
    trafficImpactScore,
    trafficImpactSource,
    triageTier: incident.triageResponse.tier,
    triageConfidence: incident.triageResponse.confidence,
  };
}
