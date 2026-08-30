"use client";

import { useEffect, useState } from "react";

import { scoreIncident, type GeoScore, type Priority } from "@/lib/geoScore";
import { useT, type Translate } from "@/lib/i18n";

const PRIORITY_TOKEN: Record<Priority, string> = {
  CRITICAL: "var(--priority-critical)",
  HIGH: "var(--priority-high)",
  MEDIUM: "var(--priority-medium)",
  LOW: "var(--priority-low)",
};

/**
 * Wording is deliberate. The score measures what an incident does to city
 * traffic; the research rejected impact-ordered dispatch, so nothing here may
 * suggest the number chose or ordered anything. It is context, shown next to
 * the decision, not the decision.
 */
function explain(s: GeoScore, t: Translate): string {
  const parts = [
    t("dashboard.impactChip.explainScore", {
      score: s.score.toFixed(1),
      priority: s.priority.toLowerCase(),
    }),
  ];
  if (s.prediction.queue_km)
    parts.push(t("dashboard.impactChip.explainQueue", { km: s.prediction.queue_km.toFixed(1) }));
  parts.push(t("dashboard.impactChip.explainContext"));
  return parts.join(" ");
}

/**
 * The geo-intelligence score, rendered wherever an incident appears. Absent
 * until the service answers, and absent for good if it doesn't — a missing
 * chip is honest, a zero would not be.
 */
export default function ImpactChip({
  id,
  latitude,
  longitude,
  serviceType,
  createdAt,
  className = "",
}: {
  id: string;
  latitude: number;
  longitude: number;
  serviceType?: string;
  createdAt?: string;
  className?: string;
}) {
  const t = useT();
  const [score, setScore] = useState<GeoScore | null>(null);

  useEffect(() => {
    let cancelled = false;
    scoreIncident({
      id,
      latitude,
      longitude,
      serviceType,
      at: createdAt ? new Date(createdAt) : new Date(),
    }).then((s) => {
      if (!cancelled) setScore(s);
    });
    return () => {
      cancelled = true;
    };
  }, [id, latitude, longitude, serviceType, createdAt]);

  if (!score) return null;

  return (
    <span
      title={explain(score, t)}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: PRIORITY_TOKEN[score.priority] }}
      />
      <span className="tabular-nums">{score.score.toFixed(1)}</span>
      <span className="font-normal text-muted-foreground">{t("dashboard.impactChip.label")}</span>
    </span>
  );
}
