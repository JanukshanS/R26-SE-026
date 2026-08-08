import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for the operator dashboard.
 *
 * URL + publishable key come from NEXT_PUBLIC_* so each environment points at
 * its own project. They are public client credentials, but they are not
 * hardcoded — see .env.example.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_KEY. " +
      "Copy apps/dashboard-web/.env.example to .env.local and fill them in."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Authorization header for the backend services, which reject unauthenticated
 * requests with 401. Read per call rather than cached: the dashboard polls for
 * minutes at a time and supabase-js hands back a refreshed token here.
 *
 * Returns an empty object when signed out so callers still fall back to their
 * bundled static JSON instead of throwing.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
