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

  // The redirect URI differs between Expo Go, a dev-client build and a
  // standalone build, and Supabase silently refuses any value not on its
  // Redirect URLs allowlist - which looks exactly like "nothing happened".
  // Log it so the value can be copied straight into the dashboard.
  console.log(`[auth] google sign-in redirectTo=${redirectTo}`);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) {
    console.log(`[auth] signInWithOAuth failed: ${error.message}`);
    throw new AuthApiError(error.message);
  }
  console.log(`[auth] provider url=${data.url?.slice(0, 120)}...`);

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log(`[auth] browser closed type=${result.type}` +
    ("url" in result ? ` url=${(result as { url: string }).url}` : ""));
  if (result.type !== "success") {
    console.log("[auth] no session: browser dismissed or never redirected back to the app");
    return false;
  }

  const returned = (result as { url: string }).url;
  // Supabase can hand back either ?code= (PKCE) or #access_token= (implicit),
  // and an error comes back as ?error=/&error_description=. Handle all three
  // instead of silently returning when it is not the one we expected.
  const parsed = new URL(returned);
  const err = parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
  if (err) {
    console.log(`[auth] provider returned an error: ${err}`);
    throw new AuthApiError(err);
  }

  // Implicit flow: tokens arrive in the URL fragment rather than as a code.
  // We ask for PKCE, but accept this too - a successful login must never be
  // thrown away just because it came back in the other shape.
  if (parsed.hash && parsed.hash.includes("access_token")) {
    const frag = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const access_token = frag.get("access_token");
    const refresh_token = frag.get("refresh_token");
    if (access_token && refresh_token) {
      const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
      if (setErr) {
        console.log(`[auth] setSession failed: ${setErr.message}`);
        throw new AuthApiError(setErr.message);
      }
      console.log("[auth] session established (implicit flow)");
      return true;
    }
    console.log("[auth] fragment had access_token but no refresh_token - cannot persist a session");
    return false;
  }

  const code = parsed.searchParams.get("code");
  if (!code) {
    console.log(`[auth] redirect carried neither ?code= nor #access_token: "${returned}"`);
    return false;
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    console.log(`[auth] code exchange failed: ${exchangeError.message}`);
    throw new AuthApiError(exchangeError.message);
  }
  console.log("[auth] session established");
  return true;
}
