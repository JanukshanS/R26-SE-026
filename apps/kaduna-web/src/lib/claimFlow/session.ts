import { supabase } from "@/lib/supabase";

let sessionPromise: Promise<void> | null = null;

/**
 * Ensures a Supabase session exists (anonymous, for this flow) before any
 * write that needs auth.uid() to be set — creating the capture row, uploading
 * media, etc. Idempotent and safe to call from multiple places (CallInsurerStep
 * starts it early in the background; ClaimFlow awaits it for real right before
 * it's actually needed) — only ever runs one sign-in attempt at a time, and a
 * failed attempt is retried on the next call rather than wedging forever.
 *
 * If this rejects, it's almost always because "Anonymous sign-ins" isn't
 * enabled in the Supabase project's Auth settings — the error message says so.
 */
export function ensureClaimSession(): Promise<void> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) return;
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        sessionPromise = null;
        throw new Error(
          `Could not start a session (${error.message}). Anonymous sign-ins may not be enabled for this project.`
        );
      }
    })();
  }
  return sessionPromise;
}
