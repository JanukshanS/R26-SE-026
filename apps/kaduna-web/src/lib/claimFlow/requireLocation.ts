import { showToast } from "./toast";

let exiting = false;

/** False only when location is genuinely off: permission denied (code 1) or
 * position unavailable (code 2, e.g. device location switched off). A timeout
 * (code 3 — a slow GPS fix indoors) counts as on, so a weak signal never
 * bounces a claimant out of their claim. */
export function ensureLocationOn(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(false);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      (err) => resolve(err.code === err.TIMEOUT),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 }
    );
  });
}

/** Toast, then back to the kaduna.lk home page — after a pause so the toast is
 * actually readable. Guarded so overlapping checks only exit once. Progress is
 * saved, so reopening the claim link later resumes where they stopped. */
export function exitToHome(message: string): void {
  if (exiting) return;
  exiting = true;
  showToast(message, 4500);
  setTimeout(() => window.location.replace("/"), 4000);
}
