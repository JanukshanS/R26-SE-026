"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CarFront,
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  LifeBuoy,
  PackageCheck,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Warehouse,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { Card, CardHeader, Empty, ErrorNote, Kpi, Loading, TONE, btnPrimary, btnSecondary, btnSm, LIVE_MS, useLiveLoad, type Tone } from "@/components/garage/ui";
import { claimStatusLabel } from "@/lib/claimsApi";
import { useI18n, useT } from "@/lib/i18n";
import { isFinished } from "@/lib/garageApi";
import { compactPlate } from "@/lib/ownerApi";
import { listMyPickups } from "@/lib/partsApi";
import { daysUntil, insuranceExpiry, vehicleModelLine, vehicleTitle } from "@/lib/vehicleApi";

import type { DriverTab } from "./DriverShell";
import { IncidentBadge, PlateTag, claimsInProgress, isLive, timeAgo, type DriverData } from "./shared";

type Alert = { id: string; tone: Tone; icon: LucideIcon; title: string; body: string; go: DriverTab; vehicleId?: string };

const ACTIVE_REPAIR = new Set(["OPEN", "IN_PROGRESS", "WAITING_PARTS", "READY"]);

export default function Overview({
  data,
  onGo,
  onAddVehicle,
  onBook,
}: {
  data: DriverData;
  onGo: (tab: DriverTab, vehicleId?: string) => void;
  onAddVehicle: () => void;
  onBook: () => void;
}) {
  const t = useT();
  const { formatDate, formatNumber } = useI18n();
  const vehicles = data.vehicles.data;
  const v = data.selected;
  const incidents = data.incidents.data ?? [];
  const live = incidents.filter(isLive);
  const repairs = Object.values(data.repairs);
  const activeRepairs = repairs.filter((r) => ACTIVE_REPAIR.has(r.status));
  const firstName = data.profile.data?.name?.split(" ")[0];
  // Parts a garage asked this driver to collect for their car. Quietly empty if the garage service is down.
  const pickups = useLiveLoad(() => listMyPickups().catch(() => []), [], (d) => (d?.some((p) => p.status !== "COMPLETED") ? LIVE_MS.active : LIVE_MS.idle));
  // Any garage's jobs for this member's cars (matched by plate). Dispatch jobs already show under data.repairs.
  const visits = (data.visits.data?.repairs ?? []).filter((r) => !r.incidentId || !data.repairs[r.incidentId]);
  const atGarage = visits.filter((r) => !isFinished(r.status));
  const selectedAtGarage = v ? atGarage.find((r) => compactPlate(r.plate) === compactPlate(v.plateNumber)) : undefined;

  if (data.vehicles.error) return <ErrorNote message={data.vehicles.error} onRetry={data.vehicles.reload} />;
  if (!vehicles) return <Loading />;

  // ── What needs the driver's attention, most serious first ──
  const alerts: Alert[] = [];
  for (const car of vehicles) {
    const name = vehicleTitle(car);
    const ins = data.insurance[car.id];
    const expiry = insuranceExpiry(ins?.expireMonth);
    if (!ins?.policyNumber && !ins?.provider) {
      alerts.push({ id: `i-${car.id}`, tone: "info", icon: ShieldCheck, title: t("me.alert.noInsurance", { vehicle: name }), body: t("me.alert.noInsuranceBody"), go: "vehicles", vehicleId: car.id });
    } else if (expiry) {
      const days = daysUntil(expiry);
      if (days < 0) alerts.push({ id: `e-${car.id}`, tone: "bad", icon: ShieldAlert, title: t("me.alert.insuranceExpired", { vehicle: name }), body: t("me.alert.insuranceExpiredBody", { date: formatDate(expiry, { month: "long", year: "numeric" }) }), go: "vehicles", vehicleId: car.id });
      else if (days <= 30) alerts.push({ id: `e-${car.id}`, tone: "warn", icon: ShieldAlert, title: t("me.alert.insuranceSoon", { vehicle: name }), body: t("me.alert.insuranceSoonBody", { count: days }), go: "vehicles", vehicleId: car.id });
    }
  }
  for (const p of (pickups.data ?? []).filter((p) => p.as === "VEHICLE_OWNER" && p.status !== "COMPLETED")) {
    alerts.push({
      id: `p-${p.id}`,
      tone: p.status === "READY" ? "vio" : "info",
      icon: PackageCheck,
      title: t(p.status === "READY" ? "me.alert.pickupReady" : "me.alert.pickupSoon", { shop: p.seller.name }),
      body: t("me.alert.pickupBody", { garage: p.garage.name }),
      go: "pickups",
    });
  }
  for (const r of atGarage) {
    const car = r.vehicle ? [r.vehicle.make, r.vehicle.model].filter(Boolean).join(" ") || r.plate : r.plate;
    if (r.approvalsWaiting > 0) {
      alerts.push({ id: `ga-${r.id}`, tone: "warn", icon: ClipboardCheck, title: t("me.alert.approvals", { garage: r.garage.name }), body: t("app.repair.approvals", { n: r.approvalsWaiting }), go: "garage" });
    } else if (r.status === "READY") {
      alerts.push({ id: `gr-${r.id}`, tone: "ok", icon: CheckCircle2, title: t("me.alert.carReady", { vehicle: car ?? "" }), body: t("me.alert.carReadyBody", { garage: r.garage.name }), go: "garage" });
    }
  }
  for (const r of repairs.filter((r) => r.approvalsWaiting > 0)) {
    alerts.push({ id: `r-${r.incidentId}`, tone: "warn", icon: ClipboardCheck, title: t("me.alert.approvals", { garage: r.garage.name }), body: t("app.repair.approvals", { n: r.approvalsWaiting }), go: "requests" });
  }
  const rank: Record<Tone, number> = { bad: 0, brand: 1, warn: 2, info: 3, vio: 4, ok: 5, gray: 6 };
  alerts.sort((a, b) => rank[a.tone] - rank[b.tone]);

  // ── Recent activity across requests, garage work and claims ──
  type Event = { id: string; at: string; icon: LucideIcon; tone: Tone; title: string; extra?: React.ReactNode; go: DriverTab };
  const events: Event[] = [
    ...incidents.map((i) => ({ id: `i-${i.id}`, at: i.createdAt, icon: Siren, tone: "bad" as Tone, title: t("me.activity.request", { service: serviceName(i.triageResponse?.predictedServiceType, t) }), extra: <IncidentBadge status={i.status} />, go: "requests" as DriverTab })),
    ...repairs.map((r) => ({ id: `r-${r.incidentId}`, at: r.lastUpdate?.createdAt ?? r.updatedAt, icon: Warehouse, tone: "vio" as Tone, title: t("me.activity.repair", { garage: r.garage.name, status: t(`track.status.${r.status}`) }), go: "requests" as DriverTab })),
    ...visits.map((r) => ({ id: `g-${r.id}`, at: r.lastUpdate?.createdAt ?? r.updatedAt, icon: Warehouse, tone: "vio" as Tone, title: t("me.activity.repair", { garage: r.garage.name, status: t(`track.status.${r.status}`) }), go: "garage" as DriverTab })),
    ...(data.claims.data ?? []).map((c) => ({ id: `c-${c.id}`, at: c.createdAt, icon: ShieldCheck, tone: "info" as Tone, title: t("me.activity.claim", { vehicle: c.vehicleModel || c.vehicleRegNo || t("app.claim.defaultTitle") }), extra: <span className="text-xs text-muted-foreground">{claimStatusLabel(c.status)}</span>, go: "claims" as DriverTab })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold">{firstName ? t("me.overview.hello", { name: firstName }) : t("me.overview.helloAnon")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{live.length > 0 ? t("me.overview.subLive", { count: live.length }) : alerts.length > 0 ? t("me.overview.subAlerts", { count: alerts.length }) : t("me.overview.subCalm")}</p>
        </div>
        <Link href="/#get-help" className={btnPrimary}>
          <Siren /> {t("app.action.report")}
        </Link>
      </div>

      {vehicles.length === 0 ? (
        <Empty
          title={t("me.vehicles.emptyTitle")}
          body={t("me.vehicles.emptyBody")}
          action={
            <button type="button" onClick={onAddVehicle} className={btnPrimary}>
              <Plus /> {t("me.vehicles.add")}
            </button>
          }
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          {/* Hero: the selected vehicle */}
          {v && (
            <Card className="overflow-hidden p-0! xl:col-span-2">
              <div className="flex flex-col gap-6 bg-[linear-gradient(120deg,#fff7f1,#ffffff_55%)] p-6 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
                      <CarFront className="size-6" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-display text-xl font-bold">{vehicleTitle(v)}</p>
                      {v.nickname && <p className="truncate text-sm text-muted-foreground">{vehicleModelLine(v)}</p>}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <PlateTag plate={v.plateNumber} />
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-medium shadow-sm">
                      <Gauge className="size-3.5 text-muted-foreground" /> {t("app.vehicles.mileage", { km: formatNumber(v.currentMileage) })}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium capitalize shadow-sm">{t(`me.fuel.${v.fuelType}`)}</span>
                  </div>
                  {selectedAtGarage && (
                    <button type="button" onClick={() => onGo("garage", v.id)} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-vio-soft px-4 py-3 text-left text-sm text-vio">
                      <Warehouse className="size-5 shrink-0" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{t("me.overview.atGarageNow", { garage: selectedAtGarage.garage.name })}</span>
                        <span className="block text-xs">{t(`track.status.${selectedAtGarage.status}`)}{selectedAtGarage.promisedAt && ` · ${t("me.repair.promised", { date: formatDate(selectedAtGarage.promisedAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}`}</span>
                      </span>
                      <ArrowRight className="size-4" />
                    </button>
                  )}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onGo("services", v.id)} className={`${btnSecondary} ${btnSm}`}>
                      <Wrench /> {t("me.services.log")}
                    </button>
                    <button type="button" onClick={onBook} className={`${btnSecondary} ${btnSm}`}>
                      <CalendarPlus /> {t("me.garage.book")}
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Needs attention */}
          <Card>
            <CardHeader title={t("me.overview.attention")} sub={alerts.length ? t("me.overview.attentionSub", { count: alerts.length }) : undefined} />
            {alerts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-ok-soft text-ok">
                  <CheckCircle2 className="size-6" />
                </span>
                <p className="font-medium">{t("me.overview.allGood")}</p>
                <p className="text-sm text-muted-foreground">{t("me.overview.allGoodBody")}</p>
              </div>
            ) : (
              <ul className="-mx-2 space-y-1">
                {alerts.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => onGo(a.go, a.vehicleId)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-canvas">
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONE[a.tone].soft}`}>
                        <a.icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-5">{a.title}</span>
                        <span className="block text-xs text-muted-foreground">{a.body}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="brand" icon={CarFront} value={vehicles.length} label={t("app.stat.vehicles")} />
        <Kpi tone="bad" icon={LifeBuoy} value={data.incidents.data ? live.length : "–"} label={t("me.kpi.openRequests")} />
        <Kpi tone="vio" icon={Warehouse} value={activeRepairs.length} label={t("me.kpi.atGarage")} />
        <Kpi tone="info" icon={ShieldCheck} value={data.claims.data ? claimsInProgress(data.claims.data).length : "–"} label={t("app.stat.claimsInProgress")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("app.section.recentActivity")} />
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("app.activity.emptyTitle")}</p>
          ) : (
            <ol className="relative space-y-1 before:absolute before:bottom-3 before:left-[18px] before:top-3 before:w-px before:bg-border">
              {events.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => onGo(e.go)} className="relative flex w-full items-center gap-3 rounded-xl py-2 pr-2 text-left transition hover:bg-canvas">
                    <span className={`relative grid size-9 shrink-0 place-items-center rounded-full ring-4 ring-white ${TONE[e.tone].soft}`}>
                      <e.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
                    {e.extra}
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{timeAgo(e.at, t)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          {activeRepairs[0] && (
            <Card className="border border-vio/20">
              <CardHeader title={t("me.overview.atGarage")} sub={activeRepairs[0].garage.name} action={<span className="rounded-full bg-vio-soft px-2.5 py-1 text-xs font-medium text-vio">{t(`track.status.${activeRepairs[0].status}`)}</span>} />
              {activeRepairs[0].lastUpdate?.note && <p className="text-sm text-muted-foreground">{activeRepairs[0].lastUpdate.note}</p>}
              {activeRepairs[0].promisedAt && (
                <p className="mt-2 flex items-center gap-1.5 text-sm">
                  <CalendarClock className="size-4 text-muted-foreground" /> {t("me.repair.promised", { date: formatDate(activeRepairs[0].promisedAt, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}
                </p>
              )}
              <button type="button" onClick={() => onGo("requests")} className={`${btnSecondary} ${btnSm} mt-4`}>
                {t("me.overview.seeRepair")} <ArrowRight />
              </button>
            </Card>
          )}
          <Card>
            <CardHeader title={t("me.overview.quick")} />
            <div className="grid gap-2">
              <QuickLink href="/#get-help" icon={Siren} tone="bad" title={t("app.action.report")} body={t("me.quick.reportBody")} />
              <QuickButton onClick={onBook} icon={CalendarPlus} tone="vio" title={t("me.garage.book")} body={t("me.quick.bookBody")} />
              <QuickButton onClick={() => onGo("services", v?.id)} icon={Wrench} tone="brand" title={t("me.services.log")} body={t("me.quick.serviceBody")} />
              <QuickButton onClick={onAddVehicle} icon={Plus} tone="info" title={t("me.vehicles.add")} body={t("me.quick.vehicleBody")} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function serviceName(type: string | undefined, t: (k: string) => string) {
  if (!type) return t("app.incident.defaultService");
  return type
    .toLowerCase()
    .split("_")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

function QuickBody({ icon: Icon, tone, title, body }: { icon: LucideIcon; tone: Tone; title: string; body: string }) {
  return (
    <>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${TONE[tone].soft}`}>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
      <ArrowRight className="size-4 text-muted-foreground" />
    </>
  );
}

const quickCls = "flex items-center gap-3 rounded-2xl border border-border p-3 text-left transition hover:bg-canvas";

function QuickLink(props: { href: string; icon: LucideIcon; tone: Tone; title: string; body: string }) {
  return (
    <Link href={props.href} className={quickCls}>
      <QuickBody {...props} />
    </Link>
  );
}

function QuickButton({ onClick, ...props }: { onClick: () => void; icon: LucideIcon; tone: Tone; title: string; body: string }) {
  return (
    <button type="button" onClick={onClick} className={quickCls}>
      <QuickBody {...props} />
    </button>
  );
}
