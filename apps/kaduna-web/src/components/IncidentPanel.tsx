"use client";

import { X } from "lucide-react";
import type { Incident } from "@/lib/types";

const PRIORITY_TOKEN: Record<string, string> = {
  CRITICAL: "var(--priority-critical)",
  HIGH: "var(--priority-high)",
  MEDIUM: "var(--priority-medium)",
  LOW: "var(--priority-low)",
};

/** Plain names for what the sensitive-location overlay reacts to. */
const NEARBY_LABEL: Record<string, string> = {
  hospital: "Hospital nearby",
  school: "School nearby",
  bridge: "On a bridge",
  market: "Market nearby",
  getaway_eve: "Eve of a long weekend",
};

/**
 * The five factors, named the way an operator would say them rather than by
 * their initials. CLF/TVF/TF/LF/ISF are the model's internal names and mean
 * nothing to the road authority staff this view is for.
 */
const FACTORS = [
  { key: "clf", label: "Capacity lost" },
  { key: "tvf", label: "Traffic volume" },
  { key: "tf", label: "Time of day" },
  { key: "lf", label: "Road importance" },
  { key: "isf", label: "Incident severity" },
] as const;

function FactorBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(Math.max(value, 0), 1) * 100}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

/**
 * The selected incident, broken down into the five factors that produced its
 * score, and the nearby hospitals, schools and bridges that lift it further.
 * The overlay has been running in geo since August but nothing in the product
 * showed it, so an incident could be scored 18% higher for being beside a
 * hospital with no way to see that was why.
 *
 * It lives in the rail beside the map, not floating over it: as an overlay it
 * covered the very markers the operator was comparing it against.
 */
export default function IncidentPanel({
  incident,
  onClose,
}: {
  incident: Incident | null;
  onClose: () => void;
}) {
  if (!incident) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4">
        <p className="text-sm font-medium">No incident selected</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Pick a marker on the map to see the five factors behind its score.
        </p>
      </div>
    );
  }

  const colour = PRIORITY_TOKEN[incident.priority];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
            style={{ borderColor: colour, color: colour }}
          >
            <span className="size-1.5 rounded-full" style={{ background: colour }} aria-hidden />
            {incident.priority}
          </span>
          <span className="truncate font-mono text-xs text-muted-foreground">{incident.id}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Clear selection"
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-3xl font-bold tabular-nums tracking-tight">
            {incident.impactScore}
          </span>
          <span className="text-sm text-muted-foreground">of 10 impact</span>
        </div>

        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border text-center">
          {[
            [incident.queueKm, "queue km"],
            [incident.vhl, "veh-hrs"],
            [incident.recoveryMin, "recovery min"],
          ].map(([value, label]) => (
            <div key={String(label)} className="bg-card px-1 py-2">
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="block text-base font-semibold tabular-nums">{value}</span>
                <span className="block text-xs text-muted-foreground">{label}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">What drove the score</p>
          {FACTORS.map((f) => (
            <FactorBar key={f.key} label={f.label} value={incident[f.key]} />
          ))}
        </div>

        {incident.sensitivity && incident.sensitivity.factor > 1 && (
          <div className="rounded-lg border border-border bg-muted/40 p-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <p className="text-xs font-medium">Where it is makes it worse</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {incident.impactScore.toFixed(1)} &rarr;{" "}
                <span className="font-semibold text-foreground">
                  {incident.sensitivity.adjusted_score.toFixed(1)}
                </span>
              </p>
            </div>
            <ul className="mt-1.5 space-y-1">
              {incident.sensitivity.nearby
                .filter((n) => n.active)
                .map((n, i) => (
                  <li key={`${n.type}-${i}`} className="flex items-baseline gap-2 text-xs">
                    <span className="text-muted-foreground">
                      {NEARBY_LABEL[n.type] ?? n.type}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {n.name ?? ""}
                      {n.distance_m != null && (
                        <span className="text-muted-foreground">
                          {n.name ? " · " : ""}
                          {Math.round(n.distance_m)} m
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      +{Math.round(n.boost * 100)}%
                    </span>
                  </li>
                ))}
              {incident.sensitivity.is_holiday && (
                <li className="text-xs text-muted-foreground">Public holiday</li>
              )}
            </ul>
          </div>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Road</dt>
          <dd className="capitalize">{incident.roadType}</dd>
          <dt className="text-muted-foreground">Lanes</dt>
          <dd>
            {incident.lanesBlocked} of {incident.totalLanes} blocked
          </dd>
          <dt className="text-muted-foreground">Type</dt>
          <dd className="capitalize">{incident.incidentType.replace(/_/g, " ")}</dd>
          <dt className="text-muted-foreground">Time</dt>
          <dd>
            {String(incident.hour).padStart(2, "0")}:00 {incident.dayName}
          </dd>
        </dl>
      </div>
    </div>
  );
}
