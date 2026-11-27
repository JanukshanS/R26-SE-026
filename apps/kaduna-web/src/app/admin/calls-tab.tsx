"use client";

/**
 * Calls customers placed to garages through Kaduna (mobile app and website).
 * Every tap on "Call" is logged by garage-management before the dialler
 * opens; this tab counts them, per garage and per day, for a chosen period.
 */
import { useCallback, useEffect, useState } from "react";

import { getGarageCallStats, type GarageCallStats } from "@/lib/garageApi";
import { useI18n, useT } from "@/lib/i18n";

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const PERIODS = [7, 30, 90] as const;

export function CallsTab() {
  const t = useT();
  const { formatDate } = useI18n();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [stats, setStats] = useState<GarageCallStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setStats(null);
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * DAY_MS);
    getGarageCallStats(isoDay(from), isoDay(to)).then(setStats, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [days]);

  useEffect(load, [load]);

  const peak = Math.max(1, ...(stats?.byDay.map((d) => d.calls) ?? [1]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t("admin.calls.intro")}</p>
        <div className="flex-1" />
        <div role="tablist" aria-label={t("admin.calls.period")} className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={days === p}
              onClick={() => setDays(p)}
              className={`rounded-md px-3 py-1 text-sm ${days === p ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t("admin.calls.lastDays", { n: p })}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p className="font-medium">{t("admin.calls.loadError")}</p>
          <p className="mt-1">{error}</p>
          <button type="button" onClick={load} className="mt-3 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100">
            {t("admin.action.retry")}
          </button>
        </div>
      ) : !stats ? (
        <div className="h-40 animate-pulse rounded-xl border border-border bg-card" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label={t("admin.calls.total")} value={stats.total} />
            <Stat label={t("admin.calls.uniqueCallers")} value={stats.uniqueCallers} />
            <Stat label={t("admin.calls.garagesCalled")} value={stats.garagesCalled} />
          </div>

          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-semibold">{t("admin.calls.perDay")}</h2>
            <div className="mt-4 flex h-32 items-end gap-[3px]" aria-label={t("admin.calls.perDay")}>
              {stats.byDay.map((d) => (
                <div key={d.date} className="group relative flex-1">
                  <div
                    className="w-full rounded-t bg-primary/80 group-hover:bg-primary"
                    style={{ height: `${Math.max(d.calls ? 6 : 2, (d.calls / peak) * 128)}px`, opacity: d.calls ? 1 : 0.25 }}
                  />
                  <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-xs text-background group-hover:block">
                    {formatDate(`${d.date}T12:00:00`, { day: "numeric", month: "short" })}: {d.calls}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card">
            <h2 className="border-b border-border px-5 py-4 font-display text-base font-semibold">{t("admin.calls.byGarage")}</h2>
            {stats.byGarage.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">{t("admin.calls.none")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">{t("admin.calls.garage")}</th>
                      <th className="px-5 py-2.5 font-medium">{t("admin.calls.phone")}</th>
                      <th className="px-5 py-2.5 text-right font-medium">{t("admin.calls.calls")}</th>
                      <th className="px-5 py-2.5 text-right font-medium">{t("admin.calls.lastCall")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byGarage.map((g) => (
                      <tr key={g.garageId} className="border-t border-border">
                        <td className="px-5 py-3">
                          <p className="font-medium">{g.name ?? "—"}</p>
                          {g.address && <p className="text-xs text-muted-foreground">{g.address}</p>}
                        </td>
                        <td className="px-5 py-3 tabular-nums text-muted-foreground">{g.phone ?? "—"}</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums">{g.calls}</td>
                        <td className="px-5 py-3 text-right text-muted-foreground">
                          {g.lastCallAt ? formatDate(g.lastCallAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card">
            <h2 className="border-b border-border px-5 py-4 font-display text-base font-semibold">{t("admin.calls.recent")}</h2>
            {stats.recent.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">{t("admin.calls.none")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {stats.recent.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
                    <span className="font-medium">{c.garageName}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{c.source === "web" ? t("admin.calls.sourceWeb") : t("admin.calls.sourceApp")}</span>
                    <span className="font-mono text-xs text-muted-foreground">{c.userId.slice(0, 8)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDate(c.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}
