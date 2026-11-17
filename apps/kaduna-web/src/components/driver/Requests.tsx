"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Check, MapPin, Phone, Siren, Truck, Warehouse } from "lucide-react";

import ImpactChip from "@/components/ImpactChip";
import { Card, Empty, ErrorNote, Loading, Segmented, btnPrimary, btnSecondary, btnSm } from "@/components/garage/ui";
import { enumLabel, type AssignedIncident } from "@/lib/dispatchApi";
import type { Repair } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

import { INCIDENT_STEPS, IncidentBadge, PlateTag, incidentStatusLabel, isLive, timeAgo, type DriverData } from "./shared";

export default function Requests({ data }: { data: DriverData }) {
  const t = useT();
  const [show, setShow] = useState<"all" | "live">("all");
  const { data: incidents, error, reload } = data.incidents;

  if (error) return <ErrorNote message={`${t("app.error.incidentsTitle")}. ${error}`} onRetry={reload} />;
  if (!incidents) return <Loading />;
  if (incidents.length === 0) {
    return (
      <Empty
        title={t("app.incidents.emptyTitle")}
        body={t("me.requests.emptyBody")}
        action={
          <Link href="/#get-help" className={btnPrimary}>
            <Siren /> {t("app.action.report")}
          </Link>
        }
      />
    );
  }

  const live = incidents.filter(isLive);
  const shown = show === "live" ? live : incidents;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: t("me.requests.all", { n: incidents.length }) },
            { value: "live", label: t("me.requests.live", { n: live.length }) },
          ]}
        />
        <Link href="/#get-help" className={`${btnPrimary} ${btnSm}`}>
          <Siren /> {t("app.action.report")}
        </Link>
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("me.requests.noneLive")}</p>
      ) : (
        shown.map((i) => <RequestCard key={i.id} incident={i} repair={data.repairs[i.id]} />)
      )}
    </div>
  );
}

function RequestCard({ incident: i, repair }: { incident: AssignedIncident; repair?: Repair }) {
  const t = useT();
  const { formatDate } = useI18n();
  const service = i.triageResponse?.predictedServiceType;
  const provider = i.assignedProvider;
  const vehicle = [i.vehicleMake, i.vehicleModel, i.vehicleYear].filter(Boolean).join(" ");
  const stepAt = INCIDENT_STEPS.indexOf(i.status as (typeof INCIDENT_STEPS)[number]);
  const offPath = stepAt === -1;

  return (
    <Card as="article" className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${isLive(i) ? "bg-bad-soft text-bad" : "bg-muted text-muted-foreground"}`}>
          <Siren className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{service ? enumLabel(service) : t("app.incident.defaultService")}</h3>
            <IncidentBadge status={i.status} />
            <ImpactChip id={i.id} latitude={i.latitude} longitude={i.longitude} serviceType={service} createdAt={i.createdAt} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(i.createdAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {timeAgo(i.createdAt, t)}
          </p>
        </div>
      </div>

      {/* Progress */}
      {!offPath && (
        <ol className="grid grid-cols-5 gap-1.5" aria-label={t("me.requests.progress")}>
          {INCIDENT_STEPS.map((s, idx) => {
            const done = idx <= stepAt;
            return (
              <li key={s} className="min-w-0">
                <div className={`h-1.5 rounded-full ${done ? (i.status === "RESOLVED" ? "bg-ok" : "bg-primary") : "bg-muted"}`} />
                <p className={`mt-1.5 flex items-center gap-1 truncate text-[11px] ${idx === stepAt ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                  {done && idx < stepAt && <Check className="size-3 shrink-0" />}
                  {incidentStatusLabel(s, t)}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("app.incident.rowVehicle")}</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2 font-medium">
            {vehicle || "–"} {i.registrationNo && <PlateTag plate={i.registrationNo} />}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("app.incident.rowProvider")}</dt>
          <dd className="mt-1 flex items-center gap-2 font-medium">
            <Truck className="size-4 text-muted-foreground" /> {provider?.name ?? t("app.incident.providerUnassigned")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("app.incident.rowLocation")}</dt>
          <dd className="mt-1">
            <a href={`https://www.google.com/maps?q=${i.latitude},${i.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline">
              <MapPin className="size-4" /> {t("me.requests.map")}
            </a>
          </dd>
        </div>
      </dl>

      {i.description && <p className="rounded-xl bg-canvas px-4 py-3 text-sm italic text-muted-foreground">“{i.description}”</p>}

      {provider?.phone && isLive(i) && (
        <a href={`tel:${provider.phone}`} className={`${btnSecondary} ${btnSm}`}>
          <Phone /> {t("me.requests.callProvider")}
        </a>
      )}

      {repair && (
        <div className="rounded-2xl border border-vio/20 bg-vio-soft/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Warehouse className="size-4 text-vio" />
            <span className="font-semibold">{t("app.repair.atGarage", { garage: repair.garage.name })}</span>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-vio">{t(`track.status.${repair.status}`)}</span>
            <span className="text-xs text-muted-foreground">{t("track.jobNo", { n: repair.jobNumber })}</span>
            {repair.garage.phone && (
              <a href={`tel:${repair.garage.phone}`} className={`${btnSecondary} ${btnSm} ml-auto`}>
                <Phone /> {t("me.requests.callGarage")}
              </a>
            )}
          </div>
          {repair.lastUpdate?.note && <p className="mt-2 text-sm">{repair.lastUpdate.note}</p>}
          {repair.promisedAt && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="size-4" /> {t("me.repair.promised", { date: formatDate(repair.promisedAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
            </p>
          )}
          {repair.approvalsWaiting > 0 && <p className="mt-2 text-sm font-medium text-warn">{t("app.repair.approvals", { n: repair.approvalsWaiting })}</p>}
        </div>
      )}
    </Card>
  );
}
