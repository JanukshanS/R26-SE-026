"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listProviders } from "@/lib/dispatchApi";
import { fetchHotspots } from "@/lib/geoData";
import {
  COVERED_KM,
  UNIT_LABEL,
  buildRecommendations,
  recommendationText,
  type ProviderPoint,
  type Recommendation,
} from "@/lib/recommendations";
import type { HotspotCluster } from "@/lib/types";

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

function toCsv(rows: Recommendation[]): string {
  const head = [
    "rank", "hotspot_id", "latitude", "longitude", "unit_type", "peak_hour",
    "incidents", "avg_impact", "demand", "nearest_km", "nearest_unit",
    "covered", "priority", "recommendation",
  ].join(",");
  const body = rows.map((r, i) =>
    [
      i + 1, r.hotspotId, r.lat, r.lng, UNIT_LABEL[r.unitType] ?? r.unitType,
      hour(r.peakHour), r.incidents, r.avgScore, r.demand,
      r.nearestKm === null ? "" : r.nearestKm.toFixed(2),
      `"${(r.nearestName ?? "").replace(/"/g, '""')}"`,
      r.covered ? "yes" : "no", r.priority,
      `"${recommendationText(r).replace(/"/g, '""')}"`,
    ].join(",")
  );
  return [head, ...body].join("\n");
}

/**
 * What to do about the hotspots, not just where they are.
 *
 * The clusters on the live map say where incidents concentrate. This ranks them
 * by where stationing a unit would do the most good, which is the difference
 * between a map an analyst has to interpret and a recommendation they can act
 * on.
 */
export default function RecommendationsPanel() {
  const [hotspots, setHotspots] = useState<HotspotCluster[] | null>(null);
  const [providers, setProviders] = useState<ProviderPoint[] | null>(null);
  const [providersFailed, setProvidersFailed] = useState(false);

  useEffect(() => {
    fetchHotspots().then((r) => setHotspots(r.data));
    listProviders(200)
      .then((r) =>
        setProviders(
          r.providers.map((p) => ({
            id: p.id, name: p.name, type: p.type,
            latitude: p.latitude, longitude: p.longitude,
          }))
        )
      )
      // Without the provider list every cluster reads as uncovered, which would
      // overstate the gap. Say so rather than ranking on a false premise.
      .catch(() => setProvidersFailed(true));
  }, []);

  const rows = useMemo(
    () => (hotspots ? buildRecommendations(hotspots, providers ?? []) : []),
    [hotspots, providers]
  );

  if (!hotspots || (!providers && !providersFailed)) {
    return <Skeleton className="h-96 w-full" />;
  }

  const uncovered = rows.filter((r) => !r.covered).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {uncovered} of {rows.length} clusters have no unit of the right kind within {COVERED_KM} km.
          Ranked by <span className="text-foreground">incidents × average impact × how far help is
          today</span> — a busy cluster with a unit already on it scores near zero, because there is
          nothing to recommend.
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2.5"
          onClick={() => {
            const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `kaduna-placement-recommendations-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download className="size-3.5" aria-hidden />
          <span className="text-sm">Export plan</span>
        </Button>
      </div>

      {providersFailed && (
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          The provider list could not be loaded, so coverage distances are unknown. The ranking below
          is by cluster demand alone.
        </p>
      )}

      <ol className="space-y-2">
        {rows.slice(0, 12).map((r, i) => (
          <li
            key={r.hotspotId}
            className="rounded-xl border border-border bg-card p-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-lg font-bold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className="font-medium">
                {UNIT_LABEL[r.unitType] ?? r.unitType} · {hour(r.peakHour)}
              </span>
              <span className="text-sm capitalize text-muted-foreground">
                {r.roadType} · {r.incidentType.replace(/_/g, " ")}
              </span>
              {!r.covered && (
                <span
                  className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                  style={{
                    borderColor: "var(--priority-high)",
                    color: "var(--priority-high)",
                  }}
                >
                  Not covered
                </span>
              )}
              <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                priority <span className="font-semibold text-foreground">{r.priority}</span>
              </span>
            </div>

            <p className="mt-1.5 text-sm">{recommendationText(r)}</p>

            <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden />
                {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
              </span>
              <span>{r.incidents} incidents</span>
              <span>average impact {r.avgScore.toFixed(1)}</span>
              {r.nearestName && <span>nearest today: {r.nearestName}</span>}
            </p>
          </li>
        ))}
      </ol>

      {rows.length > 12 && (
        <p className="text-sm text-muted-foreground">
          Showing the top 12 of {rows.length}. The full list is in the export.
        </p>
      )}
    </div>
  );
}
