"use client";

import { Camera, MapPin, ShieldCheck, Smartphone } from "lucide-react";

import { Badge, Card, Empty, ErrorNote, Loading } from "@/components/garage/ui";
import { claimStatusLabel } from "@/lib/claimsApi";
import { useI18n, useT } from "@/lib/i18n";

import { CLAIM_TONE, PlateTag, type DriverData } from "./shared";

/** Claims are filed from the app (photos are taken on the phone); here the driver follows them. */
export default function Claims({ data }: { data: DriverData }) {
  const t = useT();
  const { formatDate } = useI18n();
  const { data: claims, error, reload } = data.claims;

  if (error) return <ErrorNote message={`${t("app.error.claimsTitle")}. ${t("app.error.claimsBody", { message: error })}`} onRetry={reload} />;
  if (!claims) return <Loading />;

  return (
    <div className="space-y-5">
      <Card className="flex items-center gap-4 bg-info-soft/60 p-5 shadow-none">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-info">
          <Smartphone className="size-5" />
        </span>
        <p className="text-sm">{t("me.claims.howTo")}</p>
      </Card>
      {claims.length === 0 ? (
        <Empty title={t("app.claims.emptyTitle")} body={t("app.claims.emptyBody")} />
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {claims.map((c) => (
            <Card key={c.id} as="article" className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-info-soft text-info">
                  <ShieldCheck className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-lg font-semibold">{c.vehicleModel || t("app.claim.defaultTitle")}</p>
                  <p className="text-xs text-muted-foreground">{c.capturedAtDisplayLocal ?? formatDate(c.createdAt, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
                <Badge tone={CLAIM_TONE[c.status] ?? "gray"}>{claimStatusLabel(c.status)}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {c.vehicleRegNo && <PlateTag plate={c.vehicleRegNo} />}
                {c.policyNumber && <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{c.policyNumber}</span>}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Camera className="size-4" /> {c.photoCount > 0 ? t("me.claims.photos", { count: c.photoCount }) : t("app.claim.noPhotos")}
                </span>
                {c.locationLabel && (
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <MapPin className="size-4 shrink-0" /> <span className="truncate">{c.locationLabel}</span>
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
