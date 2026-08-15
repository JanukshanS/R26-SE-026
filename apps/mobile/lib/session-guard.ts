/**
 * Synchronous "who is currently signed in" marker, stamped the instant an auth
 * event fires (see vehicleContext.tsx) — independent of any of the async
 * user/vehicle/claims fetches that event kicks off. Those fetches are
 * fire-and-forget, so a slow request from an account that has since logged
 * out can resolve *after* a different account has logged back in on the same
 * device and land in that new account's cache. Each cache-writing fetch
 * captures getActiveSessionId() before it starts and re-checks it before
 * writing its result, dropping the result if the active session moved on.
 */
let activeSessionId: string | null = null;

export function setActiveSessionId(id: string | null): void {
  activeSessionId = id;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}
