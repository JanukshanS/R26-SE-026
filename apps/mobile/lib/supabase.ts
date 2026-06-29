import "react-native-url-polyfill/auto";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

/**
 * Single Supabase client for the whole app (auth + Postgres + storage).
 *
 * URL + publishable key are public client credentials — safe to ship (Row
 * Level Security on the tables is what actually protects data), so they default
 * to the kaduna project here and can be overridden via EXPO_PUBLIC_* for other
 * environments.
 *
 * Session storage:
 *   - native → AsyncStorage (SecureStore's 2 KB per-item limit truncates
 *     Supabase sessions; AsyncStorage is the documented Expo choice)
 *   - web    → undefined → supabase-js falls back to localStorage
 */
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://huynmjagdlkvqcmgdipk.supabase.co";
const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ?? "sb_publishable_afsnNQOy9fRKfu-5i1lWUw_AQ9vBRJO";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
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
