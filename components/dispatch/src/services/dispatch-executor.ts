/**
 * Shared core for running the ECM optimizer against an incident and
 * persisting the result. Used by both the POST /dispatch/optimize route
 * (first assignment) and the re-dispatch watchdog (retry after a decline
 * or acceptance timeout), so both call sites price a job identically and
 * can't silently drift apart.
 * @author Janukshan Sivakumar - IT22635266
 */
import { prisma } from '../utils/prisma';
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

  const dbProviders = await prisma.provider.findMany({
    where: {
      status: 'AVAILABLE',
      ...(excludeProviderIds.length > 0 ? { id: { notIn: excludeProviderIds } } : {}),
    },
    take: maxProviders,
  });
  if (dbProviders.length === 0) return { status: 'no_providers' };

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
