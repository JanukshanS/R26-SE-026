"use client";

import Link from "next/link";

import { roleHome, useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

/**
 * The landing page's one door into the system. Signed out it points at
 * /signin, which routes by role; signed in it skips the ceremony and goes
 * straight to that account's area.
 */
export default function SignInLink({ className = "" }: { className?: string }) {
  const { session, profile, loading } = useAuth();
  const t = useT();
  const signedIn = !loading && !!session;

  return (
    <Link href={signedIn ? roleHome(profile) : "/signin"} className={className}>
      {signedIn ? t("signin.link.open") : t("signin.link.signIn")}
    </Link>
  );
}
