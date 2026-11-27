"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { ClaimFlow } from "@/components/claim/ClaimFlow";

/** Short claim links (`/c?7KQ2MXP4`) — the code is the bare query string, not
 * a `?token=` param, so the SMS stays short. Static export rules out a `/c/[code]`
 * route segment, same reason /claim reads its token from the query string. */
function ShortClaimPageInner() {
  const params = useSearchParams();
  // Uppercased so a retyped lowercase code shares the same saved progress.
  const code = (params.keys().next().value ?? "").trim().toUpperCase();
  return <ClaimFlow token={code || "direct"} />;
}

export default function ShortClaimPage() {
  return (
    <Suspense fallback={null}>
      <ShortClaimPageInner />
    </Suspense>
  );
}
