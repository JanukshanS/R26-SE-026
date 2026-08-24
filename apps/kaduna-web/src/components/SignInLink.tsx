"use client";

import Link from "next/link";

import { roleHome, useAuth } from "@/lib/auth";

/**
 * The landing page's one door into the system. Signed out it points at
 * /signin, which routes by role; signed in it skips the ceremony and goes
 * straight to that account's area.
 */
export default function SignInLink({ className = "" }: { className?: string }) {
  const { session, profile, loading } = useAuth();
  const signedIn = !loading && !!session;

  return (
    <Link href={signedIn ? roleHome(profile) : "/signin"} className={className}>
      {signedIn ? "Open Kaduna" : "Sign in"}
    </Link>
  );
}
