"use client";

import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n";

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
  const t = useT();
  const live = liveCount > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={
          dataSource === "api"
            ? t("dashboard.source.apiTitle")
            : t("dashboard.source.staticTitle")
        }
      >
        <span
          className={`size-1.5 rounded-full ${dataSource === "api" ? "bg-[var(--priority-low)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {dataSource === "api" ? t("dashboard.source.apiLabel") : t("dashboard.source.staticLabel")}
      </Badge>
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={geoOk ? t("dashboard.source.geoOkTitle") : t("dashboard.source.geoDownTitle")}
      >
        <span
          className={`size-1.5 rounded-full ${geoOk ? "bg-[var(--priority-low)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {geoOk ? t("dashboard.source.geoOkLabel") : t("dashboard.source.geoDownLabel")}
      </Badge>
      <Badge
        variant="outline"
        className="gap-1.5 font-normal"
        title={live ? t("dashboard.source.liveTitle") : t("dashboard.source.noLiveTitle")}
      >
        <span
          className={`size-1.5 rounded-full ${live ? "animate-pulse bg-[var(--priority-high)]" : "bg-muted-foreground"}`}
          aria-hidden
        />
        {live ? t("dashboard.source.liveLabel", { n: liveCount }) : t("dashboard.source.noLiveLabel")}
      </Badge>
    </div>
  );
}
