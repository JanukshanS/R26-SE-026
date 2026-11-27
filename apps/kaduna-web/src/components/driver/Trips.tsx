"use client";

import { useEffect, useState } from "react";
import { Gauge, Hourglass, Route, Smartphone, Timer } from "lucide-react";

import { BarChart, Card, CardHeader, Empty, ErrorNote, Kpi, Loading, Spinner, btnSecondary } from "@/components/garage/ui";
import { useI18n, useT } from "@/lib/i18n";
import { getTrips, type TripSummary, type VehicleTrips } from "@/lib/maintenanceApi";

import { VehicleSwitch, type DriverData } from "./shared";

export default function Trips({ data }: { data: DriverData }) {
  const t = useT();
  const { formatDate, formatNumber } = useI18n();
  const v = data.selected;
  const plate = v?.plateNumber ?? "";
  const [summary, setSummary] = useState<VehicleTrips | null | undefined>(undefined);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!plate) return;
    let live = true;
    setSummary(undefined);
    setTrips([]);
    setError(null);
    getTrips(plate).then(
      (s) => {
        if (!live) return;
        setSummary(s);
        setTrips(s?.trips ?? []);
      },
      (err: Error) => live && setError(err.message)
    );
    return () => {
      live = false;
    };
  }, [plate, n]);

  if (data.vehicles.error) return <ErrorNote message={data.vehicles.error} onRetry={data.vehicles.reload} />;
  if (!data.vehicles.data) return <Loading />;
  if (!v) return <Empty title={t("me.vehicles.emptyTitle")} body={t("me.vehicles.emptyBody")} />;

  const switcher = <VehicleSwitch vehicles={data.vehicles.data} value={v} onChange={data.select} />;
  if (error) return <>{switcher}<ErrorNote message={t("me.health.offline")} onRetry={() => setN((x) => x + 1)} /></>;
  if (summary === undefined) return <>{switcher}<Loading /></>;
  if (summary === null) {
    return (
      <>
        {switcher}
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-info-soft text-info">
            <Smartphone className="size-7" />
          </span>
          <h2 className="font-display text-xl font-bold">{t("me.trips.emptyTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t("me.trips.emptyBody")}</p>
        </Card>
      </>
    );
  }

  const hours = summary.total_duration_minutes / 60;
  const chart = [...trips].slice(0, 20).reverse();
  const nextOffset = summary.next_offset ?? null;
  const hasMore = trips.length < summary.trip_count && nextOffset !== null;

  return (
    <div className="space-y-6">
      {switcher}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi tone="brand" icon={Route} value={formatNumber(summary.trip_count)} label={t("me.trips.kpiTrips")} />
        <Kpi tone="info" icon={Gauge} value={`${formatNumber(Math.round(summary.total_distance_km))} km`} label={t("me.trips.kpiDistance")} />
        <Kpi tone="vio" icon={Hourglass} value={`${formatNumber(hours, { maximumFractionDigits: 1 })} h`} label={t("me.trips.kpiTime")} />
        <Kpi tone="ok" icon={Timer} value={`${formatNumber(Math.round(summary.avg_speed_kmh))} km/h`} label={t("me.trips.kpiSpeed")} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        {chart.length > 1 && (
          <Card className="xl:col-span-2">
            <CardHeader title={t("me.trips.chartTitle")} sub={t("me.trips.chartSub", { count: chart.length })} />
            <BarChart
              width={720}
              height={220}
              labels={chart.map((x) => formatDate(x.start_timestamp, { day: "numeric", month: "short" }))}
              series={[{ name: t("me.trips.distance"), color: "#2f6feb", values: chart.map((x) => Math.round(x.distance_km * 10) / 10) }]}
              format={(n) => `${formatNumber(n, { maximumFractionDigits: 0 })} km`}
            />
          </Card>
        )}
        <Card className={chart.length > 1 ? "" : "xl:col-span-3"}>
          <CardHeader title={t("me.trips.styleTitle")} sub={t("me.trips.styleSub")} />
          <dl className="space-y-4">
            {[
              { label: t("me.trips.braking"), n: summary.total_braking_events },
              { label: t("me.trips.cornering"), n: summary.total_cornering_events },
            ].map((row) => {
              const per100 = summary.total_distance_km > 0 ? (row.n / summary.total_distance_km) * 100 : 0;
              return (
                <div key={row.label} className="flex items-center justify-between gap-3 rounded-2xl bg-canvas px-4 py-3">
                  <dt className="text-sm font-medium">{row.label}</dt>
                  <dd className="text-right">
                    <span className="block font-display text-xl font-bold tabular-nums">{formatNumber(per100, { maximumFractionDigits: 1 })}</span>
                    <span className="block text-[11px] text-muted-foreground">{t("me.trips.per100", { n: formatNumber(row.n) })}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>
      </div>

      <Card className="p-0!">
        <div className="p-6 pb-3">
          <h2 className="font-display text-lg font-semibold">{t("me.trips.list")}</h2>
          <p className="text-xs text-muted-foreground">{t("me.trips.listSub", { braking: formatNumber(summary.total_braking_events), cornering: formatNumber(summary.total_cornering_events) })}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-border bg-canvas/60 text-left text-xs font-medium text-muted-foreground">
                <th className="px-6 py-2.5 font-medium">{t("me.trips.when")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("me.trips.distance")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("me.trips.duration")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("me.trips.avgSpeed")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("me.trips.braking")}</th>
                <th className="px-6 py-2.5 text-right font-medium">{t("me.trips.cornering")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trips.map((x) => (
                <tr key={x.trip_id} className="hover:bg-canvas/50">
                  <td className="px-6 py-3 font-medium">{formatDate(x.start_timestamp, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatNumber(x.distance_km, { maximumFractionDigits: 1 })} km</td>
                  <td className="px-3 py-3 text-right tabular-nums">{t("me.trips.minutes", { n: Math.round(x.duration_minutes) })}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{Math.round(x.avg_speed_kmh)} km/h</td>
                  <td className={`px-3 py-3 text-right tabular-nums ${x.braking_events > 3 ? "font-semibold text-warn" : ""}`}>{x.braking_events}</td>
                  <td className={`px-6 py-3 text-right tabular-nums ${x.cornering_events > 3 ? "font-semibold text-warn" : ""}`}>{x.cornering_events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div className="border-t border-border p-4 text-center">
            <button
              type="button"
              disabled={more}
              onClick={async () => {
                setMore(true);
                try {
                  const next = await getTrips(plate, nextOffset!);
                  if (next) {
                    setTrips((prev) => [...prev, ...next.trips.filter((x) => !prev.some((p) => p.trip_id === x.trip_id))]);
                    setSummary((s) => (s ? { ...s, next_offset: next.next_offset ?? null } : s));
                  }
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setMore(false);
                }
              }}
              className={btnSecondary}
            >
              {more && <Spinner />} {t("me.trips.more")}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
