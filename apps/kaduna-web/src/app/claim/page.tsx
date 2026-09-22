"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { ClaimFlow } from "@/components/claim/ClaimFlow";

/** kaduna-web is a static export (no dynamic route segments at runtime), so
 * the claim-link token is a query param (?token=...) this page reads itself,
 * not a [token] route segment. Direct/no-token visits still work — the
 * identity-confirm step just has nothing to prefill. */
function ClaimPageInner() {
  const params = useSearchParams();
  const token = params.get("token") || "direct";
  return <ClaimFlow token={token} />;
}

export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimPageInner />
    </Suspense>
  );
}
