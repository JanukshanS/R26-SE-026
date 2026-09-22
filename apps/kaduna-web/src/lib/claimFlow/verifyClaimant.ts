import { supabase } from "@/lib/supabase";
import type { VerifiedClaimant } from "./types";

/** Calls the verify-claimant Edge Function (apps/mobile/supabase/functions/verify-claimant) —
 * confirms the NIC + plate correspond to the same real driver, and resolves their
 * name/licence/insurer. Public function (no bearer token needed to call it — it
 * does its own privileged lookup internally), so this works before the claimant's
 * anonymous session even exists yet. */
export async function verifyClaimant(nic: string, plateNumber: string): Promise<VerifiedClaimant | null> {
  const { data, error } = await supabase.functions.invoke("verify-claimant", {
    body: { nic, plateNumber },
  });
  if (error || !data || data.error) {
    return null;
  }
  return data as VerifiedClaimant;
}
