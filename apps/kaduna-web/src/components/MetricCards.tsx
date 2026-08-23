"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { Stats } from "@/lib/types";

/**
 * Headline figures. Values use tabular numerals so they don't shift width as
 * filters change, and the unit is a separate muted span so the number itself
 * stays the largest thing in the card.
 */
export default function MetricCards({ stats, shown }: { stats: Stats; shown: number }) {
  const filtered = shown !== stats.totalIncidents;

  const metrics = [
    {
      label: "Incidents",
      value: shown.toLocaleString(),
      unit: filtered ? `of ${stats.totalIncidents.toLocaleString()}` : "scored",
    },
    { label: "Average impact", value: stats.avgScore.toFixed(1), unit: "of 10" },
    { label: "Vehicle-hours lost", value: Math.round(stats.totalVHL).toLocaleString(), unit: "hrs" },
    { label: "Queue length", value: stats.totalQueueKm.toLocaleString(), unit: "km" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {metrics.map((m) => (
        <Card key={m.label}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{m.label}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">{m.value}</span>
              <span className="text-sm text-muted-foreground">{m.unit}</span>
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
