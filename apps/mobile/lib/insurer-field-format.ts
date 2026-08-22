/**
 * Shared format/validation for the insurer-related fields that appear on both the
 * Add your Insurer onboarding screen and the Edit Vehicle form — kept in one place so
 * the two stay consistent instead of drifting apart as separate copies.
 */

/** 1 letter + 7 digits, e.g. "B4818153" — first character always forced to
 * uppercase as the user types, rest restricted to digits. */
export function formatLicenceNumber(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]/g, "");
  const first = cleaned.slice(0, 1).toUpperCase();
  const rest = cleaned.slice(1).replace(/[^0-9]/g, "").slice(0, 7);
  return first + rest;
}

export function isValidLicenceNumber(v: string): boolean {
  return /^[A-Z][0-9]{7}$/.test(v);
}

/** 12 digits (new format), or 9 digits + "V" (old format) — a trailing v/V is
 * force-capitalized as typed. */
export function formatNicNumber(raw: string): string {
  const cleaned = raw.replace(/[^0-9vV]/g, "");
  const hasV = /[vV]$/.test(cleaned);
  const digits = cleaned.replace(/[vV]/g, "");
  if (hasV) {
    return digits.slice(0, 9) + "V";
  }
  return digits.slice(0, 12);
}

export function isValidNicNumber(v: string): boolean {
  return /^[0-9]{12}$/.test(v) || /^[0-9]{9}V$/.test(v);
}

/** "YY/MM" — auto-inserts the slash after 2 digits as the user types. */
export function formatExpireMonth(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** "YY/MM" -> months-since-epoch-ish sortable number, or null if malformed. */
function toMonthIndex(v: string): number | null {
  const match = /^([0-9]{2})\/([0-9]{2})$/.exec(v);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return year * 12 + month;
}

function currentMonthIndex(): number {
  const now = new Date();
  return (now.getFullYear() % 100) * 12 + (now.getMonth() + 1);
}

/** Must be a real month (01-12) and strictly later than the current YY/MM. */
export function isValidExpireMonth(v: string): boolean {
  const index = toMonthIndex(v);
  return index != null && index > currentMonthIndex();
}

/** True once the policy is expiring this month, next month, or has already
 * lapsed — "soon" at the granularity available (month only, no exact day). */
export function isExpiringSoon(v: string): boolean {
  const index = toMonthIndex(v);
  return index != null && index <= currentMonthIndex() + 1;
}
