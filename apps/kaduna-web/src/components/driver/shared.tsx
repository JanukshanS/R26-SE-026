"use client";

/**
 * Pieces every driver section uses: health tones and gauges, the plate tag,
 * the vehicle switcher, and the hook that loads the portal's data once.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BatteryMedium, CircleDot, Cog, Disc3, type LucideIcon } from "lucide-react";

import { Badge, LIVE_MS, TONE, type Tone } from "@/components/garage/ui";
import { claimInProgress, listMyClaims, type ClaimSummary } from "@/lib/claimsApi";
import { DispatchApiError, listMyIncidents, TERMINAL_INCIDENT_STATUSES, type AssignedIncident } from "@/lib/dispatchApi";
import { isFinished, listRepairs, type Repair } from "@/lib/garageApi";
import type { Translate } from "@/lib/i18n";
import { useT } from "@/lib/i18n";
import { getVehicleHealth, type ComponentKey, type ComponentStatus, type VehicleHealth } from "@/lib/maintenanceApi";
import { listMyVisits, type OwnerVisits } from "@/lib/ownerApi";
import {
  defaultVehicle,
  getMyProfile,
  listInsurance,
  listVehicles,
  vehicleTitle,
  type DriverProfile,
  type Vehicle,
  type VehicleInsurance,
} from "@/lib/vehicleApi";

// ─── Health tones ────────────────────────────────────────────────────────

/** Status colours (good → critical) always come with the status word, never alone. */
export const HEALTH_TONE: Record<ComponentStatus, Tone> = {
  Good: "ok",
  Fair: "warn",
  Poor: "brand",
  Critical: "bad",
  "No data": "gray",
};

export const COMPONENT_ICON: Record<ComponentKey, LucideIcon> = {
  engine: Cog,
  brake: Disc3,
  tire: CircleDot,
  battery: BatteryMedium,
};

export function HealthBadge({ status }: { status: ComponentStatus }) {
  const t = useT();
  return <Badge tone={HEALTH_TONE[status]}>{t(`me.health.status.${status}`)}</Badge>;
}

/** A ring gauge with the number in the middle. */
export function HealthRing({ pct, status, size = 132, caption }: { pct: number | null; status: ComponentStatus; size?: number; caption?: string }) {
  const value = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const r = 15.9;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" role="img" aria-label={pct === null ? caption : `${Math.round(value)}%`}>
        <circle cx={18} cy={18} r={r} fill="none" stroke="var(--muted)" strokeWidth={3.2} />
        {pct !== null && (
          <circle cx={18} cy={18} r={r} fill="none" stroke={TONE[HEALTH_TONE[status]].hex} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="font-display font-bold leading-none tabular-nums" style={{ fontSize: size * 0.24 }}>
            {pct === null ? "–" : `${Math.round(value)}%`}
          </p>
          {caption && <p className="mt-1 text-[11px] font-medium text-muted-foreground">{caption}</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Vehicles ────────────────────────────────────────────────────────────

export function PlateTag({ plate, className = "" }: { plate: string; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border-2 border-foreground/80 bg-white px-1.5 py-px font-mono text-xs font-bold tracking-wider text-foreground ${className}`}>
      {plate}
    </span>
  );
}

/** Chips to switch which vehicle a section describes. Hidden with a single vehicle. */
export function VehicleSwitch({ vehicles, value, onChange }: { vehicles: Vehicle[]; value: Vehicle | null; onChange: (id: string) => void }) {
  const t = useT();
  if (vehicles.length < 2) return null;
  return (
    <div role="tablist" aria-label={t("me.vehicles.switch")} className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
      {vehicles.map((v) => {
        const on = v.id === value?.id;
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v.id)}
            className={`flex shrink-0 items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-left text-sm transition ${
              on ? "border-primary bg-brand-soft" : "border-border bg-white hover:bg-canvas"
            }`}
          >
            <span className={`font-semibold ${on ? "text-primary" : ""}`}>{vehicleTitle(v)}</span>
            <PlateTag plate={v.plateNumber} />
          </button>
        );
      })}
    </div>
  );
}

// ─── Time ────────────────────────────────────────────────────────────────

export function timeAgo(iso: string, t: Translate): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return t("app.timeAgo.justNow");
  if (mins < 60) return t("app.timeAgo.minutes", { count: mins });
  const hours = Math.floor(mins / 60);
  return hours < 24 ? t("app.timeAgo.hours", { count: hours }) : t("app.timeAgo.days", { count: Math.floor(hours / 24) });
}

// ─── Incidents ───────────────────────────────────────────────────────────

/** The happy path of a breakdown request, for the progress steps. */
export const INCIDENT_STEPS = ["CREATED", "PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SCENE", "RESOLVED"] as const;

export const INCIDENT_TONE: Record<string, Tone> = {
  CREATED: "gray",
  PROVIDER_ASSIGNED: "warn",
  EN_ROUTE: "info",
  ON_SCENE: "info",
  RESOLVED: "ok",
  ESCALATED: "bad",
  CANCELLED: "gray",
};

const INCIDENT_KEY: Record<string, string> = {
  CREATED: "app.incidentStatus.created",
  PROVIDER_ASSIGNED: "app.incidentStatus.providerAssigned",
  EN_ROUTE: "app.incidentStatus.enRoute",
  ON_SCENE: "app.incidentStatus.onScene",
  RESOLVED: "app.incidentStatus.resolved",
  ESCALATED: "app.incidentStatus.escalated",
  CANCELLED: "app.incidentStatus.cancelled",
};

export function incidentStatusLabel(status: string, t: Translate) {
  return INCIDENT_KEY[status] ? t(INCIDENT_KEY[status]!) : status.replace(/_/g, " ").toLowerCase();
}

export function IncidentBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={INCIDENT_TONE[status] ?? "gray"}>{incidentStatusLabel(status, t)}</Badge>;
}

export const isLive = (i: AssignedIncident) => !TERMINAL_INCIDENT_STATUSES.includes(i.status);

// ─── Data ────────────────────────────────────────────────────────────────

/** undefined = still loading; "offline" = the health service didn't answer. */
export type HealthState = VehicleHealth | "offline" | undefined;

export type Loadable<T> = { data: T | null; error: string | null; reload: () => void };

export interface DriverData {
  vehicles: Loadable<Vehicle[]>;
  insurance: Record<string, VehicleInsurance>;
  reloadInsurance: () => void;
  profile: Loadable<DriverProfile>;
  setProfile: (p: DriverProfile) => void;
  /** Keyed by plate: that's how the maintenance service files a vehicle. */
  health: Record<string, HealthState>;
  reloadHealth: (plate: string) => void;
  incidents: Loadable<AssignedIncident[]>;
  repairs: Record<string, Repair>;
  claims: Loadable<ClaimSummary[]>;
  /** Any garage's jobs and bookings for this member's plates. */
  visits: Loadable<OwnerVisits>;
  /** The vehicle the vehicle-scoped sections describe. */
  selected: Vehicle | null;
  select: (id: string) => void;
}

function useLoadable<T>(load: () => Promise<T>, describe: (err: unknown) => string): Loadable<T> & { setData: (v: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (v) => {
        if (!live) return;
        // A reload that brings nothing new keeps the same object, so nothing on screen resets.
        setData((prev) => (prev !== null && JSON.stringify(prev) === JSON.stringify(v) ? prev : v));
        setError(null);
      },
      (err) => live && setError(describe(err))
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, reload, setData };
}

const SELECTED_KEY = "kaduna.me.vehicle";
const POLL_MS = 10_000;

/** Loads everything the portal shows once, so moving between sections is instant. */
export function useDriverData(): DriverData {
  const t = useT();
  const describe = useCallback(
    (err: unknown) => (err instanceof DispatchApiError && err.status === 401 ? t("app.error.sessionExpired") : err instanceof Error ? err.message : String(err)),
    [t]
  );

  const vehicles = useLoadable(listVehicles, describe);
  const profile = useLoadable(getMyProfile, describe);
  const claims = useLoadable(listMyClaims, describe);
  const insuranceLoad = useLoadable(listInsurance, describe);
  const visits = useLoadable(listMyVisits, describe);

  // ── Selected vehicle (remembered per browser) ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setSelectedId(window.localStorage.getItem(SELECTED_KEY));
    } catch {
      /* storage blocked: fall back to the default vehicle */
    }
  }, []);
  const select = useCallback((id: string) => {
    setSelectedId(id);
    try {
      window.localStorage.setItem(SELECTED_KEY, id);
    } catch {
      /* not remembering is fine */
    }
  }, []);
  const list = vehicles.data;
  const selected = useMemo(() => (list ? list.find((v) => v.id === selectedId) ?? defaultVehicle(list) : null), [list, selectedId]);

  // ── Health, per plate ──
  const [health, setHealth] = useState<Record<string, HealthState>>({});
  const loadHealth = useCallback((plate: string) => {
    setHealth((h) => ({ ...h, [plate]: undefined }));
    getVehicleHealth(plate).then(
      (v) => setHealth((h) => ({ ...h, [plate]: v })),
      () => setHealth((h) => ({ ...h, [plate]: "offline" }))
    );
  }, []);
  const plates = (list ?? []).map((v) => v.plateNumber).join("|");
  useEffect(() => {
    if (!plates) return;
    for (const p of plates.split("|")) loadHealth(p);
  }, [plates, loadHealth]);

  // ── Garage visits: refetched when cars are added or removed ──
  const reloadVisits = visits.reload;
  const firstPlates = useRef<string | null>(null);
  useEffect(() => {
    if (list === null) return;
    if (firstPlates.current === null) {
      firstPlates.current = plates;
      return;
    }
    if (firstPlates.current !== plates) {
      firstPlates.current = plates;
      reloadVisits();
    }
  }, [list, plates, reloadVisits]);

  // Live while a car is at a garage or a booking is coming up within a day; slow otherwise.
  // Paused while the tab is hidden, and refreshed as soon as it's back.
  const visitsData = visits.data;
  const visitsMs =
    visitsData &&
    (visitsData.repairs.some((r) => !isFinished(r.status)) || visitsData.bookings.some((b) => new Date(b.startsAt).getTime() - Date.now() < 86_400_000))
      ? LIVE_MS.active
      : LIVE_MS.idle;
  useEffect(() => {
    const tick = () => !document.hidden && reloadVisits();
    const id = setInterval(tick, visitsMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [visitsMs, reloadVisits]);

  // ── Breakdown requests: polled while any is still moving ──
  const [incidents, setIncidents] = useState<AssignedIncident[] | null>(null);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [incidentTick, setIncidentTick] = useState(0);
  const anyLive = (incidents ?? []).some(isLive);
  const loaded = incidents !== null;
  useEffect(() => {
    if (list === null) return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await listMyIncidents(list.map((v) => v.plateNumber));
        if (cancelled) return;
        setIncidents(next);
        setIncidentsError(null);
      } catch (err) {
        if (!cancelled) setIncidentsError(describe(err));
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const handle = !loaded || anyLive ? setInterval(() => void tick(), POLL_MS) : null;
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (handle) clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, loaded, anyLive, incidentTick, describe]);

  // ── Garage progress for requests a workshop took in (optional extra) ──
  const [repairs, setRepairs] = useState<Record<string, Repair>>({});
  const ids = (incidents ?? []).map((i) => i.id).join(",");
  useEffect(() => {
    if (!ids) return;
    let live = true;
    listRepairs(ids.split(",")).then(
      (r) => live && setRepairs(Object.fromEntries(r.map((x) => [x.incidentId, x]))),
      () => {}
    );
    return () => {
      live = false;
    };
  }, [ids]);

  return {
    vehicles,
    insurance: insuranceLoad.data ?? {},
    reloadInsurance: insuranceLoad.reload,
    profile,
    setProfile: profile.setData,
    health,
    reloadHealth: loadHealth,
    incidents: { data: incidents, error: incidentsError, reload: () => setIncidentTick((n) => n + 1) },
    repairs,
    claims,
    visits,
    selected,
    select,
  };
}

export const claimsInProgress = (claims: ClaimSummary[] | null) => (claims ?? []).filter((c) => claimInProgress(c.status));

/** Claim status → tone, matching the words from claimStatusLabel. */
export const CLAIM_TONE: Record<string, Tone> = {
  uploading: "warn",
  processing: "info",
  pending_review: "vio",
  approved: "ok",
};
