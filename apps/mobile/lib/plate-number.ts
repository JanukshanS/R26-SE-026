/**
 * Sri Lankan vehicle registration numbers.
 *
 * Three shapes are on the road at once, and a roadside app has to accept all of
 * them - rejecting a real plate is far worse here than accepting an odd one,
 * because the driver is stuck by the side of a road and cannot "fix" a plate
 * that is already legally theirs.
 *
 *   Since 2023      2-3 letters + 4 digits            CAB-1234, AB-1234
 *                   (provincial prefixes were dropped for new registrations
 *                   and transfers from 1 Jan 2023)
 *
 *   2000-2022       province + 2-3 letters + 4 digits WP CAB-1234
 *                   province codes: CP EP NC NW SB SP UP WP
 *
 *   Before 2000     1-3 digits + 4 digits             62-1234, 300-0001
 *                   (the Sinhala "ශ්‍රී" that sits between the two groups on
 *                   the physical plate is not something anyone types)
 *
 * Separators vary in the wild - space, hyphen, or nothing - so we normalise
 * first and validate the normalised form.
 */

const PROVINCES = ["CP", "EP", "NC", "NW", "SB", "SP", "UP", "WP"] as const;

/** 2-3 letters + 4 digits, optionally behind a province code. */
const LETTER_SERIES = new RegExp(
  `^(?:(?:${PROVINCES.join("|")})-)?[A-Z]{2,3}-\\d{4}$`
);

/** Pre-2000 numeric series: 1-3 leading digits + 4 digits. */
const NUMERIC_SERIES = /^\d{1,3}-\d{4}$/;

/**
 * Upper-case, strip stray characters, and put a single hyphen between each
 * group. `wp cab 1234` and `WPCAB1234` both become `WP-CAB-1234`.
 */
export function normalizePlate(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";

  const numeric = cleaned.match(/^(\d{1,3})(\d{4})$/);
  if (numeric) return `${numeric[1]}-${numeric[2]}`;

  const withProvince = cleaned.match(
    new RegExp(`^(${PROVINCES.join("|")})([A-Z]{2,3})(\\d{4})$`)
  );
  if (withProvince) {
    return `${withProvince[1]}-${withProvince[2]}-${withProvince[3]}`;
  }

  const letters = cleaned.match(/^([A-Z]{2,3})(\d{4})$/);
  if (letters) return `${letters[1]}-${letters[2]}`;

  // Unrecognised shape: hand back the cleaned text so the error message can
  // echo what the driver actually typed.
  return cleaned;
}

export function isValidPlate(raw: string): boolean {
  const plate = normalizePlate(raw);
  return LETTER_SERIES.test(plate) || NUMERIC_SERIES.test(plate);
}

/** Message shown under the field. Null when the plate is acceptable. */
export function plateError(raw: string): string | null {
  if (!raw.trim()) return "Plate number is required.";
  if (isValidPlate(raw)) return null;
  return "That doesn't look like a Sri Lankan plate. Try CAB-1234, WP-CAB-1234, or 62-1234.";
}
