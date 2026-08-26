// Who may enter which area, and where an account lands after signing in.
// Kept free of React and of the Supabase client so it stays directly runnable
// under `node --test src/lib/areas.test.ts`.

export type Role = "driver" | "provider" | "ops";

export type Profile = {
  id: string;
  name: string | null;
  role: Role;
  provider_id: string | null;
};

/** Every signed-in area, in nav order. One list drives the post-sign-in
 *  redirect, the portal header and the dashboard rail, so they can't drift. */
export const AREAS: { href: string; label: string; roles: Role[] }[] = [
  { href: "/app", label: "My Kaduna", roles: ["driver", "provider", "ops"] },
  { href: "/report", label: "Report", roles: ["driver", "provider", "ops"] },
  { href: "/provider", label: "Provider", roles: ["provider", "ops"] },
  { href: "/dashboard", label: "Operations", roles: ["ops"] },
  { href: "/insurer", label: "Insurer", roles: ["ops"] },
  { href: "/admin", label: "Admin", roles: ["ops"] },
];

/**
 * A linked provider_id grants the provider area regardless of role. The role
 * column is not client-writable, so an account that registers as a provider
 * through the app carries provider_id while its role stays "driver" until an
 * operator runs admin_set_role — and the provider console itself keys off
 * provider_id, so gating its nav entry on the role would hide a console the
 * account can already use.
 */
export function isProvider(profile: Profile | null | undefined): boolean {
  return profile?.role === "provider" || !!profile?.provider_id;
}

/** Where an account lands after signing in: its most specific area. */
export function roleHome(profile: Profile | null | undefined): string {
  if (profile?.role === "ops") return "/dashboard";
  return isProvider(profile) ? "/provider" : "/app";
}

/** The areas this account may enter, in nav order. */
export function areasFor(profile: Profile | null | undefined): typeof AREAS {
  const role = profile?.role ?? "driver";
  return AREAS.filter(
    (a) => a.roles.includes(role) || (a.href === "/provider" && isProvider(profile))
  );
}
