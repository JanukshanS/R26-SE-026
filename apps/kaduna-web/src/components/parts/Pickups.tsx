"use client";

/**
 * Parts someone has to collect from a shop: shown to the mechanic the garage
 * named, or to the car's owner (matched on the plate they registered). Each
 * shows where to go, what to ask for and the code to give at the counter.
 */
import { CheckCircle2, Clock, Package, Phone, Store, Warehouse } from "lucide-react";

import { Card, Empty, ErrorNote, LIVE_MS, Loading, btnSecondary, btnSm, useLiveLoad, vehicleLabel } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { listMyPickups, type Pickup } from "@/lib/partsApi";

import { HandoverCode, MapLink, OrderStatusBadge } from "./shared";

/** Refreshes on its own: quickly while something is still to collect. */
export function usePickups() {
  return useLiveLoad(() => listMyPickups(), [], (d) => (d?.some((p) => p.status !== "COMPLETED") ? LIVE_MS.active : LIVE_MS.idle));
}

export default function Pickups({ as, emptyBody }: { as: "MECHANIC" | "VEHICLE_OWNER"; emptyBody?: string }) {
  const t = useT();
  const pickups = usePickups();
  if (pickups.error && !pickups.data) return <ErrorNote message={pickups.error} onRetry={pickups.reload} />;
  if (!pickups.data) return <Loading />;
  // A mechanic who also drives sees each list where it belongs.
  const mine = pickups.data.filter((p) => p.as === as);
  if (mine.length === 0) return <Empty title={t("parts.pickup.emptyTitle")} body={emptyBody ?? t("parts.pickup.emptyBody")} />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {mine.map((p) => (
        <PickupCard key={p.id} pickup={p} />
      ))}
    </div>
  );
}

export function PickupCard({ pickup: p }: { pickup: Pickup }) {
  const t = useT();
  const { formatDate } = useI18n();
  const done = p.status === "COMPLETED";
  const address = [p.seller.address, p.seller.city].filter(Boolean).join(", ");
  return (
    <Card as="article" className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Store className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold">{p.seller.name}</p>
          <p className="text-xs text-muted-foreground">
            {t("parts.order.number", { n: p.number })}
            {p.job && ` · ${t("parts.pickup.forJob", { n: p.job.number ?? "", vehicle: vehicleLabel(p.job.vehicle, t("garage.vehicle.unknown")) })}`}
          </p>
        </div>
        <OrderStatusBadge status={p.status} />
      </div>

      {done ? (
        <p className="flex items-center gap-2 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
          <CheckCircle2 className="size-4" /> {t("parts.pickup.collected", { date: formatDate(p.completedAt!, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
        </p>
      ) : (
        <>
          {p.status === "CONFIRMED" && (
            <p className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
              <Clock className="size-4" /> {t("parts.pickup.preparing")}
            </p>
          )}
          {p.handoverCode && <HandoverCode code={p.handoverCode} hint={t("parts.pickup.codeHint")} />}
          {p.payOnCollection && <p className="rounded-xl bg-info-soft px-3 py-2 text-sm text-info">{t("parts.pickup.bringPayment")}</p>}
        </>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("parts.pickup.askFor")}</p>
        <ul className="space-y-1 text-sm">
          {p.items.map((i, n) => (
            <li key={n} className="flex items-center gap-2">
              <Package className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{i.description}{i.partNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{i.partNumber}</span>}</span>
              <span className="tabular-nums text-muted-foreground">× {i.quantity}</span>
            </li>
          ))}
        </ul>
      </div>

      {p.sellerNote && <p className="rounded-xl bg-canvas px-3 py-2 text-sm"><span className="font-medium">{p.seller.name}:</span> {p.sellerNote}</p>}

      <div className="space-y-1 text-sm">
        {address && <p>{address}</p>}
        {p.seller.openingHours && <p className="text-xs text-muted-foreground">{p.seller.openingHours}</p>}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {address && <MapLink address={address} />}
          {p.seller.phone && <a href={`tel:${p.seller.phone}`} className={`${btnSecondary} ${btnSm}`}><Phone /> {t("parts.pickup.callShop")}</a>}
        </div>
      </div>

      <p className="mt-auto flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <Warehouse className="size-4" /> {t("parts.pickup.bringTo", { garage: p.garage.name })}
        {p.garage.phone && <a href={`tel:${p.garage.phone}`} className="ml-auto font-medium text-primary hover:underline">{p.garage.phone}</a>}
      </p>
    </Card>
  );
}
