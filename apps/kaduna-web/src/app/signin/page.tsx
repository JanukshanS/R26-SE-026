"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import SignIn from "@/components/SignIn";
import { roleHome, useAuth } from "@/lib/auth";

/**
 * The system's single front door. Signed out it shows the shared sign-in card;
 * the moment a session and profile settle it forwards to that role's home area.
 * Google's redirect flow returns here (redirectTo is the current URL), so the
 * bounce covers email, Google redirect and One Tap alike.
 */
export default function SignInPage() {
  const { session, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && session) router.replace(roleHome(profile));
  }, [loading, session, profile, router]);

  if (loading || session) {
    return (
      <main className="grid min-h-screen place-items-center">
        <div
          role="status"
          aria-label="Signing you in"
          className="size-8 animate-spin rounded-full border-2 border-border border-t-primary"
        />
      </main>
    );
  }

  return <SignIn />;
}
