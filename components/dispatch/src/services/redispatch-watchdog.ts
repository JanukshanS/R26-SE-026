/**
 * Re-dispatch watchdog — polls for incidents whose assigned provider went
 * silent (never responded within DISPATCH_TIMEOUT_SECONDS) or explicitly
 * declined via POST /dispatch/respond, and automatically retries the ECM
 * optimizer against the remaining provider pool, excluding everyone
 * already tried for that incident.
 *
 * There's no job queue in this codebase, and a 15s poll granularity is
 * comfortably tight against a 120s timeout, so this runs as a plain
 * setInterval inside the same process rather than pulling in new infra.
 *
 * `Incident` has no dedicated "assignedAt" column, so a timed-out
 * assignment is found via `status = PROVIDER_ASSIGNED AND updatedAt <
 * cutoff` — nothing else touches that row between assignment and either a
 * provider response or this watchdog, so `updatedAt` is a reliable proxy.
 * A `DISPATCHING` incident is ambiguous between "brand new, never
 * dispatched" and "declined/timed-out, needs retry"; the presence of any
 * prior `dispatchDecisions` row disambiguates it.
 * @author Janukshan Sivakumar - IT22635266
 */
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { config } from '../config';
import { executeDispatch } from './dispatch-executor';

const POLL_INTERVAL_MS = 15_000;

async function previouslyTriedProviderIds(incidentId: string): Promise<string[]> {
  // Only rank=1 rows represent providers who were actually offered the job
  // (assigned) — rank>1 rows are just the ECM's runner-up scores and were
  // never contacted, so they stay eligible.
  const rows = await prisma.dispatchDecision.findMany({
    where: { incidentId, rank: 1 },
    select: { providerId: true },
    distinct: ['providerId'],
  });
  return rows.map((r) => r.providerId);
}

async function releaseTimedOutAssignment(incident: { id: string; assignedProviderId: string | null }) {
  if (!incident.assignedProviderId) return;

  const decision = await prisma.dispatchDecision.findFirst({
    where: { incidentId: incident.id, providerId: incident.assignedProviderId },
    orderBy: { createdAt: 'desc' },
  });

  // Conditional write mirrors /respond's own race guard: only flip it if it
  // is still sitting on this exact assignment, so a response landing in the
  // same instant as the watchdog can't be clobbered.
  const { count } = await prisma.incident.updateMany({
    where: { id: incident.id, assignedProviderId: incident.assignedProviderId, status: 'PROVIDER_ASSIGNED' },
    data: { status: 'DISPATCHING', assignedProviderId: null },
  });
  if (count === 0) return; // provider responded in the same instant — nothing to do

  if (decision) {
    await prisma.dispatchDecision.update({
      where: { id: decision.id },
      data: {
        accepted: false,
        declineReason: 'TIMEOUT_NO_RESPONSE',
        responseTimeSeconds: Math.round((Date.now() - new Date(decision.createdAt).getTime()) / 1000),
      },
    });
  }

  logger.info('Re-dispatch watchdog: provider timed out, releasing assignment', {
    incidentId: incident.id,
    providerId: incident.assignedProviderId,
  });
}

async function retryIncident(incidentId: string) {
  const excludeProviderIds = await previouslyTriedProviderIds(incidentId);
  const outcome = await executeDispatch({ incidentId, excludeProviderIds });

  if (outcome.status === 'dispatched') {
    logger.info('Re-dispatch watchdog: re-assigned incident', {
      incidentId,
      selectedProvider: outcome.result.selectedProvider.provider.name,
      excludedCount: excludeProviderIds.length,
    });
    return;
  }

  if (outcome.status === 'no_providers') {
    // Nobody left to try — escalate for human/ops intervention rather than
    // silently re-polling this incident forever.
    await prisma.incident.update({ where: { id: incidentId }, data: { status: 'ESCALATED' } });
    logger.warn('Re-dispatch watchdog: no remaining providers, escalating', {
      incidentId,
      excludedCount: excludeProviderIds.length,
    });
    return;
  }

  logger.warn('Re-dispatch watchdog: retry skipped', { incidentId, outcomeStatus: outcome.status });
}

async function tick() {
  try {
    const cutoff = new Date(Date.now() - config.dispatch.timeoutSeconds * 1000);

    const timedOut = await prisma.incident.findMany({
      where: { status: 'PROVIDER_ASSIGNED', updatedAt: { lt: cutoff } },
      select: { id: true, assignedProviderId: true },
    });
    for (const incident of timedOut) {
      await releaseTimedOutAssignment(incident);
    }

    // DISPATCHING with no current assignment but a prior decision history
    // is either an incident just released above or an explicit decline
    // recorded by /respond — either way it needs a retry.
    const needsRetry = await prisma.incident.findMany({
      where: {
        status: 'DISPATCHING',
        assignedProviderId: null,
        dispatchDecisions: { some: {} },
      },
      select: { id: true },
    });
    for (const incident of needsRetry) {
      await retryIncident(incident.id);
    }
  } catch (error) {
    logger.error('Re-dispatch watchdog tick failed:', error);
  }
}

let handle: NodeJS.Timeout | null = null;

export function startRedispatchWatchdog(): NodeJS.Timeout {
  if (handle) return handle;
  logger.info(
    `Re-dispatch watchdog started (timeout=${config.dispatch.timeoutSeconds}s, poll=${POLL_INTERVAL_MS / 1000}s)`,
  );
  handle = setInterval(tick, POLL_INTERVAL_MS);
  return handle;
}

export function stopRedispatchWatchdog() {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
}
