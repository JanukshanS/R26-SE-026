/**
 * ============================================================================
 * Provider trust, derived from the record rather than accumulated
 * ============================================================================
 *
 * Trust is the one provider attribute the ECM reads directly: expected cost is
 * divided by it (`dispatch-optimizer.ts`), so it is the term that lets a
 * reliable provider win against a closer unreliable one.
 *
 * WHY THIS IS RECOMPUTED FROM `ResolutionFeedback` INSTEAD OF INCREMENTED.
 * The counters on `Provider` were previously bumped by hand in one endpoint
 * and not at all in the other, which meant the number the optimizer divided by
 * depended on which code path happened to close the job. Deriving it from the
 * feedback rows makes it a function of what actually happened: it cannot drift,
 * it is the same answer no matter who asks, and a rating arriving after the job
 * closed simply changes the inputs and is recomputed.
 *
 * WHAT COUNTS AS A SUCCESS. A dispatch succeeded when the provider was the
 * RIGHT ONE (`wasMatch`) and the driver did not say otherwise. An unrated job
 * counts as successful \u2014 most drivers never rate, and treating silence as
 * dissatisfaction would drive every provider to the floor.
 *
 * THE 0.5 FLOOR is deliberate and load-bearing: trust divides the cost, so an
 * unbounded score lets a couple of early bad jobs multiply a provider's cost
 * far enough that they are never dispatched again and can never recover. The
 * floor keeps a struggling provider in contention.
 *
 * @module services/provider-trust
 * @author Janukshan Sivakumar - IT22635266
 */

import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

/** Below this, the driver is telling us the job did not go well. */
export const SATISFACTORY_RATING = 4;

/** Trust can sink no lower than this \u2014 see the note above. */
export const TRUST_FLOOR = 0.5;

/** What a provider starts on, before they have any history at all. */
export const DEFAULT_TRUST = 0.75;

export interface TrustSummary {
  totalJobs: number;
  successfulJobs: number;
  trustScore: number;
  averageRating: number | null;
}

/**
 * Recompute and persist a provider's trust from their resolution history.
 *
 * Safe to call more than once for the same job: it reads the current rows and
 * overwrites, so a repeated call is a no-op rather than a double count \u2014 which
 * is exactly why the counters are not incremented.
 */
export async function recomputeProviderTrust(providerId: string): Promise<TrustSummary> {
  const rows = await prisma.resolutionFeedback.findMany({
    where: { providerId },
    select: { wasMatch: true, userRating: true },
  });

  const totalJobs = rows.length;
  const successfulJobs = rows.filter(
    (r) => r.wasMatch && (r.userRating === null || r.userRating >= SATISFACTORY_RATING),
  ).length;

  const rated = rows.filter((r) => r.userRating !== null).map((r) => r.userRating as number);
  const averageRating = rated.length
    ? rated.reduce((sum, v) => sum + v, 0) / rated.length
    : null;

  const trustScore = totalJobs > 0
    ? Math.max(TRUST_FLOOR, successfulJobs / totalJobs)
    : DEFAULT_TRUST;

  await prisma.provider.update({
    where: { id: providerId },
    data: { totalJobs, successfulJobs, trustScore, averageRating },
  });

  logger.info('Provider trust recomputed', {
    providerId, totalJobs, successfulJobs,
    trustScore: trustScore.toFixed(3),
    averageRating: averageRating?.toFixed(2) ?? null,
  });

  return { totalJobs, successfulJobs, trustScore, averageRating };
}
