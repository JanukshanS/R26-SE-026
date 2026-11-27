"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Lightbulb, RefreshCw, ScanSearch, Smartphone, TriangleAlert } from "lucide-react";

import { Badge, Card, CardHeader, Empty, ErrorNote, Loading, Panel, Progress, Spinner, TONE, btnSecondary, btnSm, type Tone } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { COMPONENTS, getAdvice, hasReading, rulLabel, type ComponentAdvice, type ComponentKey, type VehicleFault } from "@/lib/maintenanceApi";
import { vehicleTitle } from "@/lib/vehicleApi";

import { COMPONENT_ICON, HEALTH_TONE, HealthBadge, HealthRing, PlateTag, VehicleSwitch, timeAgo, type DriverData } from "./shared";

const SEVERITY_TONE: Record<VehicleFault["severity"], Tone> = { urgent: "bad", soon: "warn", monitor: "info" };
const URGENCY_TONE: Record<ComponentAdvice["advice"]["urgency"], Tone> = { critical: "bad", soon: "warn", monitor: "info", healthy: "ok", unknown: "gray" };

export default function Health({ data }: { data: DriverData }) {
  const t = useT();
  const { formatNumber } = useI18n();
  const [part, setPart] = useState<ComponentKey | null>(null);
  const vehicles = data.vehicles.data;
  const v = data.selected;

  if (data.vehicles.error) return <ErrorNote message={data.vehicles.error} onRetry={data.vehicles.reload} />;
  if (!vehicles) return <Loading />;
  if (!v) return <Empty title={t("me.vehicles.emptyTitle")} body={t("me.vehicles.emptyBody")} />;

  const h = data.health[v.plateNumber];
  const switcher = <VehicleSwitch vehicles={vehicles} value={v} onChange={data.select} />;

  if (h === undefined) return <>{switcher}<Loading /></>;
  if (h === "offline") {
    return (
      <>
        {switcher}
        <ErrorNote message={t("me.health.offline")} onRetry={() => data.reloadHealth(v.plateNumber)} />
      </>
    );
  }
  if (!hasReading(h)) {
    return (
      <>
        {switcher}
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-info-soft text-info">
            <Smartphone className="size-7" />
          </span>
          <h2 className="font-display text-xl font-bold">{t("me.health.noTripsTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t("me.health.noTripsBody", { plate: v.plateNumber })}</p>
        </Card>
      </>
    );
  }

  const faults = h.faults;
  return (
    <div className="space-y-6">
      {switcher}
      <Card className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <HealthRing pct={h.overall_health_pct} status={h.overall_status} size={148} caption={t("me.health.overall")} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold">{vehicleTitle(v)}</h2>
            <PlateTag plate={v.plateNumber} />
            <HealthBadge status={h.overall_status} />
          </div>
          <p className="text-sm text-muted-foreground">{t("me.health.summary", { count: h.trip_count, km: formatNumber(Math.round(h.total_mileage_km)) })}</p>
          <p className="flex items-center gap-2 text-sm">
            {!h.faults_checked ? (
              <>
                <ScanSearch className="size-4 text-muted-foreground" /> {t("me.health.codesUnchecked")}
              </>
            ) : faults.length === 0 ? (
              <>
                <CheckCircle2 className="size-4 text-ok" /> {t("me.health.codesNone")}
              </>
            ) : (
              <>
                <TriangleAlert className="size-4 text-bad" /> {t("me.health.codesLive", { count: faults.length })}
              </>
            )}
          </p>
          <button type="button" onClick={() => data.reloadHealth(v.plateNumber)} className={`${btnSecondary} ${btnSm}`}>
            <RefreshCw /> {t("me.health.refresh")}
          </button>
        </div>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {COMPONENTS.map((k) => {
          const c = h.components[k];
          const Icon = COMPONENT_ICON[k];
          const tone = HEALTH_TONE[c.status];
          const partFaults = faults.filter((f) => f.component === k);
          return (
            <Card key={k} as="article">
              <div className="flex items-start gap-3">
                <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${TONE[tone].soft}`}>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-lg font-semibold">{t(`me.part.${k}`)}</p>
                  <p className={`text-sm font-medium ${TONE[tone].text}`}>{rulLabel(c, t)}</p>
                </div>
                <HealthBadge status={c.status} />
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <span className="font-display text-3xl font-bold tabular-nums">{c.status === "No data" ? "–" : `${Math.round(c.health_pct)}%`}</span>
                {c.max_lifespan_km > 0 && c.status !== "No data" && (
                  <span className="text-right text-xs text-muted-foreground">
                    {t("me.health.kmLeft", { left: formatNumber(Math.max(0, Math.round(Math.min(c.predicted_rul_km, c.max_lifespan_km)))), total: formatNumber(Math.round(c.max_lifespan_km)) })}
                  </span>
                )}
              </div>
              <Progress value={c.health_pct} tone={tone} className="mt-2 h-2!" />
              {partFaults.length > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-bad">
                  <TriangleAlert className="size-3.5" /> {partFaults.map((f) => f.code).join(", ")}
                </p>
              )}
              <button type="button" onClick={() => setPart(k)} className={`${btnSecondary} ${btnSm} mt-4`}>
                <Lightbulb /> {t("me.health.whatToDo")}
              </button>
            </Card>
          );
        })}
      </div>

      {faults.length > 0 && (
        <Card>
          <CardHeader title={t("me.health.codesTitle")} sub={t("me.health.codesSub")} />
          <ul className="divide-y divide-border">
            {faults.map((f) => (
              <li key={f.code} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-foreground px-2 py-0.5 font-mono text-xs font-bold text-white">{f.code}</span>
                  <span className="font-semibold">{f.title}</span>
                  <Badge tone={SEVERITY_TONE[f.severity]}>{t(`me.fault.${f.severity}`)}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{t("me.fault.lastSeen", { when: timeAgo(f.last_seen_at, t) })}</span>
                </div>
                {f.likely_causes.length > 0 && (
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {t("me.fault.causes")}: {f.likely_causes.slice(0, 3).join(" · ")}
                  </p>
                )}
                {f.recurrences > 0 && <p className="mt-1 text-xs font-medium text-warn">{t("me.fault.recurred", { count: f.recurrences })}</p>}
                {f.is_generic && <p className="mt-1 text-xs text-muted-foreground">{t("me.fault.generic")}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AdvicePanel plate={v.plateNumber} part={part} onClose={() => setPart(null)} />
    </div>
  );
}

function AdvicePanel({ plate, part, onClose }: { plate: string; part: ComponentKey | null; onClose: () => void }) {
  const t = useT();
  const [advice, setAdvice] = useState<ComponentAdvice | null | undefined>(undefined);
  useEffect(() => {
    if (!part) return;
    let live = true;
    setAdvice(undefined);
    getAdvice(plate, part).then((a) => live && setAdvice(a));
    return () => {
      live = false;
    };
  }, [plate, part]);

  return (
    <Panel open={part !== null} onClose={onClose} title={part ? t(`me.part.${part}`) : ""} description={t("me.health.adviceSub")}>
      {advice === undefined ? (
        <Card className="text-center text-sm text-muted-foreground">
          <Spinner /> {t("me.health.adviceLoading")}
        </Card>
      ) : advice === null ? (
        <ErrorNote message={t("me.health.adviceNone")} />
      ) : (
        <>
          <Card className="space-y-3">
            <Badge tone={URGENCY_TONE[advice.advice.urgency]}>{t(`me.urgency.${advice.advice.urgency}`)}</Badge>
            <h3 className="font-display text-lg font-bold leading-6">{advice.advice.headline}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{advice.advice.detail}</p>
            {advice.advice.is_estimated && <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">{t("me.health.estimated")}</p>}
          </Card>
          {advice.advice.actions.length > 0 && (
            <Card>
              <h4 className="mb-3 text-sm font-semibold">{t("me.health.actions")}</h4>
              <ol className="space-y-2.5">
                {advice.advice.actions.map((a, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-primary">{i + 1}</span>
                    <span className="pt-0.5">{a}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {advice.advice.reasons.length > 0 && (
            <Card>
              <h4 className="mb-2 text-sm font-semibold">{t("me.health.why")}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {advice.advice.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Panel>
  );
}
