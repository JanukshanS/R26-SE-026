import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

/**
 * Single Supabase client for the whole app (auth + Postgres + storage).
 *
 * URL + publishable key come from EXPO_PUBLIC_* so each environment points at
 * its own project. They are public client credentials (Row Level Security on
 * the tables is what actually protects data), but they are not hardcoded —
 * local runs read apps/mobile/.env, cloud builds read EAS environment
 * variables. See apps/mobile/.env.example.
 *
 * Session storage:
 *   - native → AsyncStorage (SecureStore's 2 KB per-item limit truncates
 *     Supabase sessions; AsyncStorage is the documented Expo choice)
 *   - web    → undefined → supabase-js falls back to localStorage
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY. " +
      "Copy apps/mobile/.env.example to apps/mobile/.env and fill them in, " +
      "then restart Expo with `npx expo start -c`.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // PKCE, not the implicit flow. supabase-js defaults to implicit, which
    // returns #access_token in the redirect URL - readable by anything that
    // can see the URL, and a poor fit for a mobile deep link. PKCE returns a
    // short-lived ?code= that only this client can exchange.
    flowType: "pkce",
    // Native deep links are handled manually after OAuth; only the web build
    // should auto-parse the session out of the redirect URL.
    detectSessionInUrl: Platform.OS === "web",
  },
});

// Pause token auto-refresh while the app is backgrounded, resume on focus —
// the pattern Supabase recommends for React Native so refresh timers don't
// fire (and fail) while suspended.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
