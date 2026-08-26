"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { setInsurerToken } from "./token";

export type InsurerRole = "admin" | "agent" | "staff";

export type InsurerUser = {
  email: string;
  name: string;
  role: InsurerRole;
  company_id: string | null;
  company_name: string | null;
};

export function useInsurerUser(): { user: InsurerUser | null; logout: () => void } {
  const { session, profile } = useAuth();

  useEffect(() => {
    setInsurerToken(session?.access_token ?? "");
  }, [session?.access_token]);

  if (!session) {
    return { user: null, logout: () => { void supabase.auth.signOut(); } };
  }

  // All users that reach the insurer route are gated as "ops" — map to "admin"
  const role: InsurerRole = "admin";

  return {
    user: {
      email: session.user.email ?? "",
      name: profile?.name ?? session.user.email ?? "",
      role,
      company_id: null,
      company_name: null,
    },
    logout: () => { void supabase.auth.signOut(); },
  };
}
