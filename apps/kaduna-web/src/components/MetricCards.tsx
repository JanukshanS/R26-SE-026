"use client";

import type { Stats } from "@/lib/types";

/**
 * The four figures that describe whatever is currently on the map.
 *
 * These sit in the rail beside the map rather than above it, so filtering and
 * reading the result happen in one glance instead of a scroll. Values use
 * tabular numerals so they do not shift width as filters change.
 *
 * `total` is every marker the map can draw — the 500 scored incidents plus any
 * live report currently open in dispatch. It is deliberately not
 * `stats.totalIncidents`, which counts only the scored set: comparing a
 * filtered count that includes live reports against a denominator that excludes
 * them produced the nonsense "515 of 500".
 */
export default function MetricCards({
  stats,
  shown,
  total,
  live,
}: {
  stats: Stats;
  shown: number;
  total: number;
  live: number;
}) {
  const filtered = shown !== total;

  const metrics = [
    {
      label: "On the map",
      value: shown.toLocaleString(),
      unit: filtered ? `of ${total.toLocaleString()}` : "incidents",
      hint: live > 0 ? `${live} live` : null,
    },
    { label: "Average impact", value: stats.avgScore.toFixed(1), unit: "of 10", hint: null },
    {
      label: "Vehicle-hours lost",
      value: Math.round(stats.totalVHL).toLocaleString(),
      unit: "hrs",
      hint: null,
    },
    { label: "Queue length", value: stats.totalQueueKm.toLocaleString(), unit: "km", hint: null },
  ];

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
      {metrics.map((m) => (
        <div key={m.label} className="bg-card px-3 py-2.5">
          <dt className="text-xs text-muted-foreground">{m.label}</dt>
          <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className="font-display text-xl font-bold tabular-nums tracking-tight">
              {m.value}
            </span>
            <span className="text-xs text-muted-foreground">{m.unit}</span>
            {m.hint && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-[var(--priority-low)]" aria-hidden />
                {m.hint}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
