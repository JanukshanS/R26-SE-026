"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import IncidentPanel from "@/components/IncidentPanel";
import { Button } from "@/components/ui/button";
import { downloadIncidentsCsv } from "@/lib/exportCsv";
import { useT } from "@/lib/i18n";
import { getScoreLog, subscribeScoreLog, type ScoreLogEntry } from "@/lib/scoreLog";

const PRIORITY_TOKEN: Record<string, string> = {
  CRITICAL: "var(--priority-critical)",
  HIGH: "var(--priority-high)",
  MEDIUM: "var(--priority-medium)",
  LOW: "var(--priority-low)",
};

const time = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Where the road class came from, said plainly. */
const ROAD_SOURCE: Record<string, string> = {
  osm: "dashboard.scoringLog.roadMatched",
  request: "dashboard.scoringLog.roadSupplied",
  default: "dashboard.scoringLog.roadUnmatched",
};

export default function ScoringLogPanel() {
  const t = useT();
  const [entries, setEntries] = useState<ScoreLogEntry[]>(getScoreLog());
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => subscribeScoreLog(setEntries), []);

  const open = entries.find((e) => e.key === openKey) ?? null;

  if (entries.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="font-display text-lg font-semibold tracking-tight">
          {t("dashboard.scoringLog.emptyTitle")}
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("dashboard.scoringLog.emptyBody")}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t("dashboard.scoringLog.summary", { n: entries.length })}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2.5"
            onClick={() =>
              downloadIncidentsCsv(
                entries.map((e) => e.incident),
                "scoring-log"
              )
            }
          >
            <Download className="size-3.5" aria-hidden />
            <span className="text-sm">{t("dashboard.scoringLog.export")}</span>
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-card text-left">
                <th scope="col" className="px-3 py-2 font-medium">{t("dashboard.scoringLog.colTime")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("dashboard.scoringLog.colIncident")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("dashboard.scoringLog.colRoad")}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{t("dashboard.scoringLog.colImpact")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("dashboard.scoringLog.colPriority")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const selected = e.key === openKey;
                return (
                  <tr
                    key={e.key}
                    onClick={() => setOpenKey(selected ? null : e.key)}
                    aria-selected={selected}
                    className={`cursor-pointer border-b border-border last:border-0 ${
                      selected ? "bg-accent" : "hover:bg-accent/50"
                    }`}
                  >
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{time(e.at)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{e.incident.id}</td>
                    <td className="px-3 py-2">
                      <span className="capitalize">{e.incident.roadType}</span>
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {ROAD_SOURCE[e.roadSource] ? t(ROAD_SOURCE[e.roadSource]) : e.roadSource}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {e.incident.impactScore.toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-medium"
                        style={{ color: PRIORITY_TOKEN[e.incident.priority] }}
                      >
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: PRIORITY_TOKEN[e.incident.priority] }}
                          aria-hidden
                        />
                        {e.incident.priority}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <IncidentPanel incident={open?.incident ?? null} onClose={() => setOpenKey(null)} />
      </div>
    </div>
  );
}
