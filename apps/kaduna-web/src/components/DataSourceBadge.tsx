"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Live service status: where hotspot/stat data came from, whether the geo
 * service answers its health check, and whether dispatch is feeding live
 * incidents. Grey dots mean the platform is down and the static research
 * dataset is standing in — the dashboard stays honest about which one it is.
 */
export default function DataSourceBadge({
  dataSource,
  geoOk,
  liveCount,
}: {
  dataSource: "api" | "static";
  geoOk: boolean;
  liveCount: number;
}) {
  const live = liveCount > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={
          dataSource === "api"
            ? "Hotspots and stats loaded from the geo-intelligence API"
            : "Geo API unreachable — showing the static dataset"
        }
      >
        <span
          className={`size-1.5 rounded-full ${dataSource === "api" ? "bg-[var(--priority-low)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {dataSource === "api" ? "Live data" : "Saved data"}
      </Badge>
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={geoOk ? "Geo-intelligence service is healthy" : "Geo service offline"}
      >
        <span
          className={`size-1.5 rounded-full ${geoOk ? "bg-[var(--priority-low)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {geoOk ? "Geo OK" : "Geo offline"}
      </Badge>
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={
          live
            ? "Receiving live incidents from the dispatch service"
            : "No live backend — showing the static dataset"
        }
      >
        <span
          className={`size-1.5 rounded-full ${live ? "animate-pulse bg-[var(--priority-high)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {live ? `Live ${liveCount}` : "No live reports"}
      </Badge>
    </div>
  );
}
