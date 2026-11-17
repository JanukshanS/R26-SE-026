"use client";

/**
 * The old roadside-help console (go online, accept dispatch offers, report
 * outcomes) is parked while each stakeholder gets a dedicated dashboard — see
 * git history (c6a8072) for it. Providers now work from the garage workspace,
 * whose Kaduna Jobs tab already accepts and declines offers. The route stays
 * so old links and bookmarks still land somewhere useful.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ProviderRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/provider/garage");
  }, [router]);
  return null;
}
