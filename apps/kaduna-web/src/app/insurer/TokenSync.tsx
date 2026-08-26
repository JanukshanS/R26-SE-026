"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { setInsurerToken } from "@/lib/insurer/token";

// Keeps the module-level token in sync with the Supabase session.
// Rendered once in the insurer layout so the token is available before
// any API call fires.
export function TokenSync() {
  const { session } = useAuth();
  useEffect(() => {
    setInsurerToken(session?.access_token ?? "");
  }, [session?.access_token]);
  return null;
}
