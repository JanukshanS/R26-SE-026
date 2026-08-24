"use client";

import { useEffect, useState } from "react";

import { scoreIncident, type GeoScore, type Priority } from "@/lib/geoScore";

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
function explain(s: GeoScore): string {
  const parts = [
    `Traffic impact ${s.score.toFixed(1)}/10 (${s.priority.toLowerCase()}) from the geo-intelligence model:`,
    "capacity loss, traffic volume, time of day, road class and incident severity.",
  ];
  if (s.prediction.queue_km) parts.push(`Predicted queue ~${s.prediction.queue_km.toFixed(1)} km.`);
  parts.push("Context for the city, not a dispatch ranking.");
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
      title={explain(score)}
      className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: PRIORITY_TOKEN[score.priority] }}
      />
      <span className="tabular-nums">{score.score.toFixed(1)}</span>
      <span className="font-normal text-muted-foreground">traffic impact</span>
    </span>
  );
}
