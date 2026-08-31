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
 * WHAT COUNTS AS A SUCCESS. A dispatch succeeded when the right provider was
 * sent (`wasMatch`) and the job actually got done. Only the driver can speak
 * to the second half, which is what `driverConfirmed` is for — and only an
 * explicit "no" counts against the provider. A job nobody confirmed is a
 * success, because most drivers close the app the moment their car starts.
 *
 * THE STAR RATING IS A NUDGE, NOT A VERDICT. It moves trust by at most
 * ±RATING_INFLUENCE, so a provider who fixes the fault is not punished for
 * a driver who was in a bad mood, and a charming provider cannot rate their
 * way out of a run of jobs they did not fix. Rating nothing changes nothing:
 * the adjustment is zero when no job has been rated, so a provider whose
 * drivers never rate sits exactly where their completion record puts them.
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

/**
 * The most a star average can move trust, in either direction.
 *
 * 0.1 against a score that spans 0.5-1.0 means ratings can reorder providers
 * whose completion records are close, and can never outweigh actually fixing
 * cars. That ordering of priorities is the point.
 */
export const RATING_INFLUENCE = 0.1;

/** The star average that means "fine" — above nudges up, below nudges down. */
export const NEUTRAL_RATING = 3;

/** Trust can sink no lower than this — see the note above. */
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
 * overwrites, so a repeated call is a no-op rather than a double count — which
 * is exactly why the counters are not incremented.
 */
export async function recomputeProviderTrust(providerId: string): Promise<TrustSummary> {
  const rows = await prisma.resolutionFeedback.findMany({
    where: { providerId },
    select: { wasMatch: true, userRating: true, driverConfirmed: true },
  });

  const totalJobs = rows.length;

  // The right provider, and the driver did not come back to say it was still
  // broken. `null` — never asked, or asked and ignored — counts as done.
  const successfulJobs = rows.filter(
    (r) => r.wasMatch && r.driverConfirmed !== false,
  ).length;

  const rated = rows.filter((r) => r.userRating !== null).map((r) => r.userRating as number);
  const averageRating = rated.length
    ? rated.reduce((sum, v) => sum + v, 0) / rated.length
    : null;

  // Map the 1-5 average onto -1..+1 around neutral, then scale it right down.
  // No ratings at all leaves this at exactly zero rather than at some assumed
  // value, so silence is genuinely neutral.
  const ratingAdjustment = averageRating === null
    ? 0
    : RATING_INFLUENCE * ((averageRating - NEUTRAL_RATING) / (5 - NEUTRAL_RATING));

  const completionRate = totalJobs > 0 ? successfulJobs / totalJobs : DEFAULT_TRUST;
  const trustScore = Math.min(1, Math.max(TRUST_FLOOR, completionRate + ratingAdjustment));

  await prisma.provider.update({
    where: { id: providerId },
    data: { totalJobs, successfulJobs, trustScore, averageRating },
  });

  logger.info('Provider trust recomputed', {
    providerId, totalJobs, successfulJobs,
    completionRate: completionRate.toFixed(3),
    ratingAdjustment: ratingAdjustment.toFixed(3),
    trustScore: trustScore.toFixed(3),
    averageRating: averageRating?.toFixed(2) ?? null,
  });

  return { totalJobs, successfulJobs, trustScore, averageRating };
}
