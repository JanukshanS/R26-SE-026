"use client";

/** Bits every parts screen uses: order status badges, the handover code, a map link. */
import { MapPin } from "lucide-react";

import { Badge, type Tone } from "@/components/garage/ui";
import { useT } from "@/lib/i18n";
import type { PartOrderStatus, PaymentTerms } from "@/lib/partsApi";

export const ORDER_TONE: Record<PartOrderStatus, Tone> = {
  REQUESTED: "info",
  QUOTED: "warn",
  CONFIRMED: "brand",
  READY: "vio",
  COMPLETED: "ok",
  DECLINED: "bad",
  CANCELLED: "gray",
};

export function OrderStatusBadge({ status, delivery }: { status: PartOrderStatus; delivery?: boolean }) {
  const t = useT();
  // READY reads differently for a delivery ("On the way") and a pickup ("Ready to collect").
  const key = status === "READY" ? (delivery ? "parts.status.READY_DELIVERY" : "parts.status.READY_PICKUP") : `parts.status.${status}`;
  return <Badge tone={ORDER_TONE[status]}>{t(key)}</Badge>;
}

/** How a garage order is paid: on the garage's trade account, or at handover. */
export function PaymentTermsBadge({ terms, paid }: { terms: PaymentTerms; paid: boolean }) {
  const t = useT();
  if (terms === "ACCOUNT") return <Badge tone="vio" dot={false}>{t("parts.terms.ACCOUNT")}</Badge>;
  return <Badge tone={paid ? "ok" : "gray"} dot={false}>{paid ? t("parts.terms.paid") : t("parts.terms.ON_HANDOVER")}</Badge>;
}

/** The 6-digit handover code, big enough to read out or show across a counter. */
export function HandoverCode({ code, hint }: { code: string; hint?: string }) {
  const t = useT();
  return (
    <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-brand-soft/60 px-4 py-3 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">{t("parts.code.title")}</p>
      <p className="mt-1 font-mono text-3xl font-bold tracking-[0.3em] text-foreground tabular-nums">{code}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function MapLink({ address, className = "" }: { address: string; className?: string }) {
  const t = useT();
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline ${className}`}
    >
      <MapPin className="size-4" /> {t("parts.action.directions")}
    </a>
  );
}
