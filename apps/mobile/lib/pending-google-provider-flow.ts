/**
 * A provider's Google sign-in redirects through the app's bare root URL
 * (`Linking.createURL("/")` in authApi.ts — every Google flow does, driver or
 * provider, and changing that risks falling off Supabase's redirect-URL
 * allowlist). Expo Router's own deep-link handling reacts to that same
 * incoming URL and can reset the navigation stack to the root screen before
 * `(provider)/onboarding.tsx`'s post-signin continuation gets a chance to
 * run — so the root screen's own "returning user" auto-redirect
 * (app/index.tsx) sees a session with no providerId yet (it hasn't been
 * linked yet) and sends a brand-new provider to the driver home screen
 * instead of back to onboarding to finish their profile.
 *
 * This flag is plain in-memory module state — not tied to any screen's
 * lifecycle — so it survives that navigation reset regardless of whether
 * Expo Router remounts things. Set right before starting the Google flow;
 * checked (and cleared) by whichever screen actually completes it.
 */
let pending = false;

export function markPendingGoogleProviderFlow(): void {
  pending = true;
}

export function isPendingGoogleProviderFlow(): boolean {
  return pending;
}

export function clearPendingGoogleProviderFlow(): void {
  pending = false;
}
