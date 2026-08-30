"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import ImpactChip from "@/components/ImpactChip";
import PortalShell, { EmptyCard } from "@/components/portal/PortalShell";
import { Skeleton } from "@/components/ui/skeleton";
import RequireAuth from "@/lib/auth";
import {
  claimInProgress,
  claimStatusLabel,
  listMyClaims,
  type ClaimSummary,
} from "@/lib/claimsApi";
import {
  DispatchApiError,
  enumLabel,
  listMyIncidents,
  TERMINAL_INCIDENT_STATUSES,
  type AssignedIncident,
} from "@/lib/dispatchApi";
import { useT, type Translate } from "@/lib/i18n";
import {
  COMPONENT_LABELS,
  getVehicleHealth,
  rulToLabel,
  type ComponentKey,
  type ComponentStatus,
  type VehicleHealth,
} from "@/lib/maintenanceApi";
import { defaultVehicle, listVehicles, vehicleTitle, type Vehicle } from "@/lib/vehicleApi";

const TAB_LABELS = ["Overview", "Vehicles", "Incidents", "Claims"] as const;
type Tab = (typeof TAB_LABELS)[number];

const TAB_KEYS: Record<Tab, string> = {
  Overview: "app.tab.overview",
  Vehicles: "app.tab.vehicles",
  Incidents: "app.tab.incidents",
  Claims: "app.tab.claims",
};

const TABS = TAB_LABELS.map((label) => ({
  labelKey: TAB_KEYS[label],
  href: `#${label.toLowerCase()}`,
}));

const POLL_INTERVAL_MS = 10_000;

/** Incident status → driver-facing label + tone. Same tones as the provider
 *  console; only PROVIDER_ASSIGNED is reworded, since "New job" is the
 *  provider's side of that event. Anything else falls back to enumLabel. */
const STATUS_BADGE: Record<string, [string, string]> = {
  CREATED: ["app.incidentStatus.created", "bg-muted text-muted-foreground"],
  PROVIDER_ASSIGNED: ["app.incidentStatus.providerAssigned", "bg-amber-100 text-amber-900"],
  EN_ROUTE: ["app.incidentStatus.enRoute", "bg-primary/15 text-primary"],
  ON_SCENE: ["app.incidentStatus.onScene", "bg-primary/15 text-primary"],
  RESOLVED: ["app.incidentStatus.resolved", "bg-emerald-100 text-emerald-900"],
  ESCALATED: ["app.incidentStatus.escalated", "bg-red-100 text-red-900"],
  CANCELLED: ["app.incidentStatus.cancelled", "bg-muted text-muted-foreground"],
};

const HEALTH_TONE: Record<ComponentStatus, string> = {
  Good: "bg-emerald-100 text-emerald-900",
  Fair: "bg-amber-100 text-amber-900",
  Poor: "bg-orange-100 text-orange-900",
  Critical: "bg-red-100 text-red-900",
  "No data": "bg-muted text-muted-foreground",
};

function Badge({ status }: { status: string }) {
  const t = useT();
  const badge = STATUS_BADGE[status];
  const [label, tone] = badge
    ? [t(badge[0]), badge[1]]
    : [enumLabel(status), "bg-muted text-muted-foreground"];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}

function timeAgo(iso: string, t: Translate): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t("app.timeAgo.justNow");
  if (mins < 60) return t("app.timeAgo.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  return hours < 24
    ? t("app.timeAgo.hours", { count: hours })
    : t("app.timeAgo.days", { count: Math.floor(hours / 24) });
}

function describe(err: unknown, t: Translate): string {
  if (err instanceof DispatchApiError && err.status === 401) {
    return t("app.error.sessionExpired");
  }
  return err instanceof Error ? err.message : String(err);
}

function ErrorCard({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
      >
        {t("app.action.retry")}
      </button>
    </div>
  );
}

function CardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-12" />
      ) : (
        <p className="font-display mt-2 text-3xl font-bold tracking-tight">{value}</p>
      )}
    </div>
  );
}

function HealthSummary({ health }: { health: VehicleHealth }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl font-bold tracking-tight">
          {Math.round(health.overall_health_pct)}%
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${HEALTH_TONE[health.overall_status]}`}
        >
          {health.overall_status}
        </span>
        <span className="text-sm text-muted-foreground">
          {t("app.health.trips", {
            count: health.trip_count,
            km: Math.round(health.total_mileage_km).toLocaleString(),
          })}
        </span>
      </div>

      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(COMPONENT_LABELS) as ComponentKey[]).map((key) => {
          const c = health.components[key];
          return (
            <div key={key}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                {COMPONENT_LABELS[key]}
              </dt>
              <dd className="mt-1 flex items-center gap-2">
                <span className="font-medium">{Math.round(c.health_pct)}%</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${HEALTH_TONE[c.status]}`}
                >
                  {rulToLabel(c)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function IncidentCard({ incident }: { incident: AssignedIncident }) {
  const t = useT();
  const service = incident.triageResponse?.predictedServiceType;
  const provider = incident.assignedProvider;
  const vehicle = [incident.vehicleMake, incident.vehicleModel, incident.vehicleYear]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {service ? enumLabel(service) : t("app.incident.defaultService")}
        </h3>
        <Badge status={incident.status} />
        <ImpactChip
          id={incident.id}
          latitude={incident.latitude}
          longitude={incident.longitude}
          serviceType={service}
          createdAt={incident.createdAt}
        />
        <span className="ml-auto text-sm text-muted-foreground">
          {timeAgo(incident.createdAt, t)}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("app.incident.rowVehicle")}
          </dt>
          <dd>{[vehicle, incident.registrationNo].filter(Boolean).join(" · ") || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("app.incident.rowLocation")}
          </dt>
          <dd>
            {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("app.incident.rowProvider")}
          </dt>
          <dd>{provider?.name ?? t("app.incident.providerUnassigned")}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t("app.incident.rowContact")}
          </dt>
          <dd>
            {provider?.phone ? (
              <a className="text-primary hover:underline" href={`tel:${provider.phone}`}>
                {provider.phone}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      {incident.description && (
        <p className="mt-3 text-sm italic text-muted-foreground">“{incident.description}”</p>
      )}
    </div>
  );
}

function ClaimCard({ claim }: { claim: ClaimSummary }) {
  const t = useT();
  const chips = [claim.policyNumber, claim.vehicleRegNo].filter(Boolean) as string[];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {claim.vehicleModel || t("app.claim.defaultTitle")}
        </h3>
        <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
          {claimStatusLabel(claim.status)}
        </span>
        <span className="ml-auto text-sm text-muted-foreground">
          {claim.capturedAtDisplayLocal ?? new Date(claim.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {claim.photoCount > 0
          ? t("app.claim.photos", { count: claim.photoCount })
          : t("app.claim.noPhotos")}
        {claim.locationLabel ? ` · ${claim.locationLabel}` : ""}
      </p>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {chips.map((chip) => (
            <span key={chip} className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function DriverPortal() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("Overview");

  // Read on mount (not during render) so the prerendered HTML always matches.
  useEffect(() => {
    const sync = () => {
      const want = window.location.hash.replace("#", "").toLowerCase();
      setTab(TAB_LABELS.find((t) => t.toLowerCase() === want) ?? "Overview");
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<AssignedIncident[] | null>(null);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  // Missing key = still loading; null = the service has no telemetry for it.
  const [health, setHealth] = useState<Record<string, VehicleHealth | null>>({});

  const loadVehicles = useCallback(() => {
    setVehiclesError(null);
    listVehicles().then(setVehicles, (err) => setVehiclesError(describe(err, t)));
  }, [t]);

  const loadClaims = useCallback(() => {
    setClaimsError(null);
    listMyClaims().then(setClaims, (err) => setClaimsError(describe(err, t)));
  }, [t]);

  useEffect(loadVehicles, [loadVehicles]);
  useEffect(loadClaims, [loadClaims]);

  // Health is per vehicle and never errors out loud — a vehicle with no trips
  // is the normal case, so getVehicleHealth() reports it as null.
  useEffect(() => {
    if (!vehicles) return;
    let cancelled = false;
    for (const v of vehicles) {
      getVehicleHealth(v.id).then((h) => {
        if (!cancelled) setHealth((prev) => ({ ...prev, [v.id]: h }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [vehicles]);

  const loadIncidents = useCallback(
    () => listMyIncidents((vehicles ?? []).map((v) => v.plateNumber)),
    [vehicles]
  );

  const loaded = incidents !== null;
  const anyLive = (incidents ?? []).some(
    (i) => !TERMINAL_INCIDENT_STATUSES.includes(i.status)
  );

  // Same polling shape as the provider console: pause while hidden, never
  // overlap two requests, catch up immediately when the tab returns. Stops
  // once every incident is terminal — nothing left to watch.
  useEffect(() => {
    if (!vehicles) return;
    let cancelled = false;
    let inFlight = false;

    async function tick() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await loadIncidents();
        if (cancelled) return;
        setIncidents(next);
        setIncidentsError(null);
      } catch (err) {
        if (!cancelled) setIncidentsError(describe(err, t));
      } finally {
        inFlight = false;
      }
    }

    void tick();

    // Keep polling until the first load lands and every incident is terminal.
    const handle = !loaded || anyLive ? setInterval(() => void tick(), POLL_INTERVAL_MS) : null;
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (handle) clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [vehicles, loadIncidents, loaded, anyLive, t]);

  const openIncidents = (incidents ?? []).filter(
    (i) => !TERMINAL_INCIDENT_STATUSES.includes(i.status)
  );
  const inProgressClaims = (claims ?? []).filter((c) => claimInProgress(c.status));
  const primary = vehicles ? defaultVehicle(vehicles) : null;

  const noVehicles = vehicles?.length === 0;

  return (
    <PortalShell
      title={t("app.title")}
      tabs={TABS.map((tb) => ({ label: t(tb.labelKey), href: tb.href }))}
      active={t(TAB_KEYS[tab])}
    >
      {tab === "Overview" && (
        <div className="space-y-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {t("app.overview.heading")}
            </h2>
            <Link
              href="/report"
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              {t("app.action.report")}
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t("app.stat.vehicles")} value={vehicles?.length ?? null} />
            <StatCard
              label={t("app.stat.openIncidents")}
              value={incidents ? openIncidents.length : null}
            />
            <StatCard
              label={t("app.stat.claimsInProgress")}
              value={claims ? inProgressClaims.length : null}
            />
          </div>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              {t("app.section.vehicleHealth")}
            </h2>
            {vehiclesError ? (
              <ErrorCard
                title={t("app.error.vehiclesTitle")}
                message={vehiclesError}
                onRetry={loadVehicles}
              />
            ) : !vehicles ? (
              <CardSkeleton rows={1} />
            ) : !primary ? (
              <EmptyCard
                title={t("app.vehicles.noPrimaryTitle")}
                body={t("app.vehicles.noPrimaryBody")}
              />
            ) : (
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-semibold">{vehicleTitle(primary)}</h3>
                  <span className="text-sm text-muted-foreground">{primary.plateNumber}</span>
                </div>
                <div className="mt-4">
                  {!(primary.id in health) ? (
                    <Skeleton className="h-16 w-full" />
                  ) : health[primary.id] ? (
                    <HealthSummary health={health[primary.id]!} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("app.health.noTelemetryPrimary")}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              {t("app.section.recentActivity")}
            </h2>
            {incidentsError ? (
              <ErrorCard
                title={t("app.error.incidentsTitle")}
                message={incidentsError}
                onRetry={() => void loadIncidents().then(setIncidents, () => {})}
              />
            ) : !incidents ? (
              <CardSkeleton rows={2} />
            ) : incidents.length === 0 ? (
              <EmptyCard
                title={t("app.activity.emptyTitle")}
                body={t("app.activity.emptyBody")}
              />
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {incidents.slice(0, 5).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="font-medium">
                      {i.triageResponse?.predictedServiceType
                        ? enumLabel(i.triageResponse.predictedServiceType)
                        : t("app.incident.defaultService")}
                    </span>
                    <Badge status={i.status} />
                    {i.assignedProvider?.name && (
                      <span className="text-muted-foreground">{i.assignedProvider.name}</span>
                    )}
                    <span className="ml-auto text-muted-foreground">{timeAgo(i.createdAt, t)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "Vehicles" && (
        <div className="space-y-4">
          {vehiclesError ? (
            <ErrorCard
              title={t("app.error.vehiclesTitle")}
              message={vehiclesError}
              onRetry={loadVehicles}
            />
          ) : !vehicles ? (
            <CardSkeleton rows={2} />
          ) : noVehicles ? (
            <EmptyCard
              title={t("app.vehicles.emptyTitle")}
              body={t("app.vehicles.emptyBody")}
            />
          ) : (
            vehicles.map((v) => (
              <div key={v.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="font-display text-lg font-semibold tracking-tight">
                    {vehicleTitle(v)}
                  </h3>
                  {v.isDefault && (
                    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                      {t("app.vehicles.defaultBadge")}
                    </span>
                  )}
                  <span className="ml-auto rounded bg-muted px-2 py-0.5 text-sm font-medium">
                    {v.plateNumber}
                  </span>
                </div>

                <p className="mt-1.5 text-sm text-muted-foreground">
                  {[
                    // Only when the heading showed the nickname instead.
                    v.nickname ? [v.year, v.make, v.model].filter(Boolean).join(" ") : null,
                    v.color,
                    v.fuelType,
                    t("app.vehicles.mileage", { km: v.currentMileage.toLocaleString() }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                <div className="mt-4 border-t border-border pt-4">
                  {!(v.id in health) ? (
                    <Skeleton className="h-12 w-full" />
                  ) : health[v.id] ? (
                    <HealthSummary health={health[v.id]!} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t("app.health.noTelemetry")}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "Incidents" && (
        <div className="space-y-4">
          {incidentsError ? (
            <ErrorCard
              title={t("app.error.incidentsTitle")}
              message={incidentsError}
              onRetry={() => void loadIncidents().then(setIncidents, () => {})}
            />
          ) : !incidents ? (
            <CardSkeleton rows={2} />
          ) : incidents.length === 0 ? (
            <EmptyCard
              title={
                noVehicles
                  ? t("app.incidents.emptyNoVehiclesTitle")
                  : t("app.incidents.emptyTitle")
              }
              body={
                noVehicles
                  ? t("app.incidents.emptyNoVehiclesBody")
                  : t("app.incidents.emptyBody")
              }
            />
          ) : (
            incidents.map((i) => <IncidentCard key={i.id} incident={i} />)
          )}
        </div>
      )}

      {tab === "Claims" && (
        <div className="space-y-4">
          {claimsError ? (
            <ErrorCard
              title={t("app.error.claimsTitle")}
              message={t("app.error.claimsBody", { message: claimsError })}
              onRetry={loadClaims}
            />
          ) : !claims ? (
            <CardSkeleton rows={2} />
          ) : claims.length === 0 ? (
            <EmptyCard
              title={t("app.claims.emptyTitle")}
              body={t("app.claims.emptyBody")}
            />
          ) : (
            claims.map((c) => <ClaimCard key={c.id} claim={c} />)
          )}
        </div>
      )}
    </PortalShell>
  );
}

export default function DriverPortalPage() {
  return (
    <RequireAuth>
      <DriverPortal />
    </RequireAuth>
  );
}
