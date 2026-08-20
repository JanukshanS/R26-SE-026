import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { supabase } from "@lib/supabase";

/**
 * Auth helpers over Supabase Auth (GoTrue). Standalone functions (the supabase
 * client is a module singleton) so screens outside <VehicleProvider> — the
 * onboarding flow — can call them directly. Sessions are persisted + refreshed
 * by supabase-js, so there's no manual token store anymore.
 */

export class AuthApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthApiError";
  }
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role?: string;
}

/**
 * Create an account. name/phone/role go into user metadata, which the
 * `handle_new_user` trigger copies into public.profiles. If the project has
 * email confirmation enabled, no session is returned yet — surfaced via
 * `needsConfirmation` so the caller can tell the user to check their inbox.
 */
export async function signUpEmail(
  input: SignUpInput
): Promise<{ needsConfirmation: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        name: input.name,
        phone: input.phone ?? null,
        role: input.role ?? "driver",
      },
    },
  });
  if (error) throw new AuthApiError(error.message);
  return { needsConfirmation: !data.session };
}

export async function signInEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new AuthApiError(error.message);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Google OAuth (PKCE). On web supabase-js redirects the page and parses the
 * session back via detectSessionInUrl. On native we open the provider URL in a
 * system browser, then exchange the returned `?code=` for a session. Resolves
 * `false` when the user dismissed the browser without signing in, so callers
 * only navigate on a real session.
 */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = Linking.createURL("/");
  if (Platform.OS === "web") {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw new AuthApiError(error.message);
    return false; // browser navigates away
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw new AuthApiError(error.message);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return false; // user dismissed the browser

  const code = new URL(result.url).searchParams.get("code");
  if (!code) {
    throw new AuthApiError("Google did not return a sign-in code. Try again.");
  }
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new AuthApiError(exchangeError.message);
  return true;
}
