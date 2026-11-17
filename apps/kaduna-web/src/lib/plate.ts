// Sri Lankan registration numbers, ported from apps/mobile/lib/plate-number.ts
// so a plate typed on the web is stored exactly as the app would store it
// (the maintenance service keys a vehicle's history by this string).
//
//   Since 2023   2-3 letters + 4 digits             CAB-1234
//   2000-2022    province + 2-3 letters + 4 digits  WP-CAB-1234
//   Before 2000  1-3 digits + 4 digits              62-1234

const PROVINCES = ["CP", "EP", "NC", "NW", "SB", "SP", "UP", "WP"] as const;
const LETTER_SERIES = new RegExp(`^(?:(?:${PROVINCES.join("|")})-)?[A-Z]{2,3}-\\d{4}$`);
const NUMERIC_SERIES = /^\d{1,3}-\d{4}$/;

/** `wp cab 1234` and `WPCAB1234` both become `WP-CAB-1234`. */
export function normalizePlate(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!cleaned) return "";
  const numeric = cleaned.match(/^(\d{1,3})(\d{4})$/);
  if (numeric) return `${numeric[1]}-${numeric[2]}`;
  const withProvince = cleaned.match(new RegExp(`^(${PROVINCES.join("|")})([A-Z]{2,3})(\\d{4})$`));
  if (withProvince) return `${withProvince[1]}-${withProvince[2]}-${withProvince[3]}`;
  const letters = cleaned.match(/^([A-Z]{2,3})(\d{4})$/);
  if (letters) return `${letters[1]}-${letters[2]}`;
  return cleaned;
}

export function isValidPlate(raw: string): boolean {
  const plate = normalizePlate(raw);
  return LETTER_SERIES.test(plate) || NUMERIC_SERIES.test(plate);
}
