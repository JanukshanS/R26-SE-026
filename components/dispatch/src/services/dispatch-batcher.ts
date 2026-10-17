/**
 * Priority window for /dispatch/optimize. Requests arriving within
 * DISPATCH_BATCH_WINDOW_MS are pooled; when the window closes they are
 * dispatched one at a time, highest geo traffic impact first, ties by arrival.
 * Without it, two incidents competing for one provider are settled by
 * whichever request lands first.
 *
 * Sequential on purpose: each executeDispatch marks its provider assigned
 * before the next one reads the busy list.
 *
 * shortcut: the pool lives in process memory, so it is correct only while
 * dispatch runs as one replica; move it to a DB-backed queue before scaling out.
 */
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ServiceTypeProbabilities } from '../types';
import { fetchTrafficImpactScore } from './geo-client';
import { executeDispatch, ExecuteDispatchParams, ExecuteDispatchResult } from './dispatch-executor';

export interface BatchedDispatch {
  outcome: ExecuteDispatchResult;
  batch: { size: number; position: number; windowMs: number } | null;
}

interface Pending {
  params: ExecuteDispatchParams;
  seq: number;
  resolve: (r: BatchedDispatch) => void;
  reject: (e: unknown) => void;
}

let pool: Pending[] = [];
let timer: NodeJS.Timeout | null = null;
let seq = 0;

export function queueDispatch(params: ExecuteDispatchParams): Promise<BatchedDispatch> {
  const windowMs = config.dispatch.batchWindowMs;
  if (windowMs <= 0) return executeDispatch(params).then((outcome) => ({ outcome, batch: null }));

  return new Promise((resolve, reject) => {
    pool.push({ params, seq: seq++, resolve, reject });
    if (!timer) timer = setTimeout(() => void flush(windowMs), windowMs);
  });
}

async function geoScore(params: ExecuteDispatchParams): Promise<number | null> {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: params.incidentId }, include: { triageResponse: true },
    });
    if (!incident?.triageResponse) return null;
    const score = await fetchTrafficImpactScore({
      latitude: incident.latitude,
      longitude: incident.longitude,
      probabilities: incident.triageResponse.probabilities as unknown as ServiceTypeProbabilities,
      authorization: params.authorization,
    });
    return typeof score === 'number' ? score : null;
  } catch {
    return null;
  }
}

async function flush(windowMs: number) {
  const batch = pool;
  pool = [];
  timer = null;

  // An incident geo cannot score ranks last and the executor resolves it as usual.
  const scored = await Promise.all(batch.map(async (item) => ({ item, score: await geoScore(item.params) })));
  scored.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.item.seq - b.item.seq);

  logger.info('Dispatch batch flushed', {
    windowMs,
    order: scored.map((s, i) => ({ position: i + 1, incidentId: s.item.params.incidentId, score: s.score })),
  });

  for (const [i, { item, score }] of scored.entries()) {
    const params = score !== null && item.params.trafficImpactScore === undefined
      ? { ...item.params, trafficImpactScore: score, trafficImpactSource: 'geo-intelligence' as const }
      : item.params;
    try {
      const outcome = await executeDispatch(params);
      item.resolve({ outcome, batch: { size: scored.length, position: i + 1, windowMs } });
    } catch (error) {
      item.reject(error);
    }
  }
}
