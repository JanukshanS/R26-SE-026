/**
 * ============================================================================
 * Symptom-Key — canonical hash of a triage response for Bayesian lookup
 * ============================================================================
 *
 * The Bayesian layer stores learned priors keyed by "symptom pattern". Two
 * incidents whose driver answered the same discriminating questions the same
 * way should share the same prior — that is what lets the posterior actually
 * accumulate observations rather than fragmenting one-per-incident.
 *
 * We deliberately use a COARSE key (five most-discriminating fields), not the
 * full 18-field response, so the same pattern recurs often enough for the
 * Bayesian layer to actually activate. Rationale:
 *   - Fine key: hits are ~1-in-a-million; Bayesian never fires in the
 *     time-horizon of a research thesis.
 *   - Coarse key: hits are frequent; priors accumulate real evidence quickly.
 *
 * Five fields chosen (highest Gini-importance in the trained tree):
 *   Q1_intent           — the intent picker; branches the whole form
 *   Q2_engine_start     — first engine-behaviour discriminator
 *   Q3_sound            — starting-sound discriminator
 *   Q_brake_detail      — brake-issue discriminator
 *   Q7_overheat_detail  — overheat-context discriminator
 *
 * NOT_ASKED is preserved verbatim so branches that skipped a question are
 * distinct from those that answered it — otherwise a NOT_ASKED brake path
 * would collide with a SOFT_PEDAL brake path.
 *
 * The digest itself is SHA-1 (not for cryptographic strength — for a stable,
 * short, index-friendly string). Field order + separator is fixed; changing
 * either invalidates every stored prior (call migrations by hand if needed).
 *
 * @module utils/symptom-key
 * @author Janukshan Sivakumar - IT22635266
 */

import { createHash } from 'crypto';
import { TriageResponses } from '../types';

/** Fields participating in the coarse symptom key. Order MUST be stable. */
const KEY_FIELDS: (keyof TriageResponses)[] = [
  'Q1_intent',
  'Q2_engine_start',
  'Q3_sound',
  'Q_brake_detail',
  'Q7_overheat_detail',
];

/**
 * Produce the canonical symptom key for a triage response. Same input →
 * same output, deterministically. Two responses that differ only on
 * non-KEY_FIELDS answers collide by design — that's the whole point.
 */
export function computeSymptomKey(responses: TriageResponses): string {
  const parts = KEY_FIELDS.map((f) => `${f}=${String(responses[f])}`);
  const canonical = parts.join('|');
  const digest = createHash('sha1').update(canonical).digest('hex').slice(0, 16);
  return `sk_${digest}`;
}

/**
 * Return the field-name→value dict the key was derived from. Useful for
 * debugging endpoints ("this key was made from these answers") and for
 * building human-readable Bayesian-stats output.
 */
export function describeSymptomKey(responses: TriageResponses): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of KEY_FIELDS) out[f] = String(responses[f]);
  return out;
}

export { KEY_FIELDS };
