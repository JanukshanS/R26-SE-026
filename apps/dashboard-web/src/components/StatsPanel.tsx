"use client";

import type { Stats } from "@/lib/types";

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "text-red-500",
  HIGH: "text-orange-500",
  MEDIUM: "text-yellow-500",
  LOW: "text-green-500",
};

export default function StatsPanel({ stats }: { stats: Stats }) {
  const cards = [
    { label: "Total Incidents", value: stats.totalIncidents, unit: "" },
    { label: "Avg Impact Score", value: stats.avgScore, unit: "/10" },
    { label: "Total Vehicle-Hours Lost", value: stats.totalVHL.toLocaleString(), unit: "hrs" },
    { label: "Total Queue Length", value: stats.totalQueueKm, unit: "km" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div
            key={c.label}
            className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3"
          >
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">{c.label}</p>
            <p className="text-2xl font-bold mt-1">
              {c.value}
              <span className="text-sm font-normal text-[var(--text-muted)] ml-1">{c.unit}</span>
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Priority Distribution</p>
        <div className="space-y-1.5">
          {Object.entries(stats.priorityDist)
            .sort(([a], [b]) => {
              const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
              return order.indexOf(a) - order.indexOf(b);
            })
            .map(([priority, count]) => {
              const pct = ((count / stats.totalIncidents) * 100).toFixed(1);
              return (
                <div key={priority} className="flex items-center gap-2">
                  <span className={`text-xs font-mono w-16 ${PRIORITY_COLORS[priority]}`}>
                    {priority}
                  </span>
                  <div className="flex-1 h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          priority === "CRITICAL" ? "#ef4444" :
                          priority === "HIGH" ? "#f97316" :
                          priority === "MEDIUM" ? "#eab308" : "#22c55e",
                      }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-muted)] w-16 text-right">
                    {count} ({pct}%)
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Avg Score by Road Type</p>
        <div className="space-y-1">
          {Object.entries(stats.byRoadType)
            .sort(([, a], [, b]) => b - a)
            .map(([road, score]) => (
              <div key={road} className="flex items-center gap-2">
                <span className="text-xs w-20 truncate">{road}</span>
                <div className="flex-1 h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-orange-500"
                    style={{ width: `${(score / 10) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--text-muted)] w-8 text-right">{score}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Avg Score by Incident Type</p>
        <div className="space-y-1">
          {Object.entries(stats.byIncidentType)
            .sort(([, a], [, b]) => b - a)
            .map(([type, score]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-xs w-24 truncate">{type.replace(/_/g, " ")}</span>
                <div className="flex-1 h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-purple-500"
                    style={{ width: `${(score / 10) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-[var(--text-muted)] w-8 text-right">{score}</span>
              </div>
            ))}
        </div>
      </div>

      <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">Hourly Impact Profile</p>
        <div className="flex items-end gap-px h-16">
          {Array.from({ length: 24 }, (_, h) => {
            const score = stats.byHour[String(h)] ?? 0;
            const maxScore = Math.max(...Object.values(stats.byHour));
            const height = maxScore > 0 ? (score / maxScore) * 100 : 0;
            const isPeak = h >= 7 && h <= 9 || h >= 17 && h <= 19;
            return (
              <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={`${String(h).padStart(2, "0")}:00 — ${score}/10`}>
                <div
                  className={`w-full rounded-t-sm transition-all ${isPeak ? "bg-orange-500" : "bg-orange-500/60"}`}
                  style={{ height: `${height}%`, minHeight: score > 0 ? "2px" : "0" }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-[var(--text-muted)]">00</span>
          <span className="text-[9px] text-[var(--text-muted)]">06</span>
          <span className="text-[9px] text-[var(--text-muted)]">12</span>
          <span className="text-[9px] text-[var(--text-muted)]">18</span>
          <span className="text-[9px] text-[var(--text-muted)]">23</span>
        </div>
        <p className="text-[9px] text-[var(--text-muted)] text-center mt-0.5">
          <span className="inline-block w-2 h-2 bg-orange-500 rounded-sm mr-1" />Peak hours highlighted
        </p>
      </div>
    </div>
  );
}
