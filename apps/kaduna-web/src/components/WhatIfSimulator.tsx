"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { calculateImpactScore } from "@/lib/scoring";
import { scoreAtLocation, type AdHocScore } from "@/lib/geoScore";
import type { ModelConfig, WhatIfInput } from "@/lib/types";

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), { ssr: false });

const ROAD_TYPES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential"];

/**
 * Severity is not a taxonomy of everything that can go wrong with a car — it is
 * how long the road stays blocked, relative to a major accident at 120 minutes.
 * That is why an unlisted problem is scorable: "Something else" carries the
 * default clearance, and because severity is a sixth of the score the cost of
 * not having a bespoke entry is bounded. Durations are literature-anchored and
 * are the numbers the police session was asked to correct.
 */
const INCIDENT_TYPES: Array<{ value: string; label: string; clearMin: number }> = [
  { value: "accident_major", label: "Major accident", clearMin: 120 },
  { value: "engine_failure", label: "Engine failure", clearMin: 60 },
  { value: "accident_minor", label: "Minor accident", clearMin: 45 },
  { value: "overheating", label: "Overheating", clearMin: 40 },
  { value: "flat_tire", label: "Flat tyre", clearMin: 30 },
  { value: "battery_dead", label: "Flat battery", clearMin: 25 },
  { value: "fuel_empty", label: "Out of fuel", clearMin: 20 },
  { value: "other", label: "Something else", clearMin: 45 },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PRIORITY_TOKEN: Record<string, string> = {
  CRITICAL: "var(--priority-critical-ink)",
  HIGH: "var(--priority-high-ink)",
  MEDIUM: "var(--priority-medium-ink)",
  LOW: "var(--priority-low-ink)",
};

const titled = (s: string) => s.replace(/_/g, " ");

/**
 * Scores a hypothetical incident against the deployed 5-factor model. Results
 * recompute as controls move — there is no submit step, so the panel reads as
 * a live instrument rather than a form.
 */
export default function WhatIfSimulator({ model }: { model: ModelConfig }) {
  const [input, setInput] = useState<WhatIfInput>({
    roadType: "primary",
    totalLanes: 2,
    lanesBlocked: 1,
    incidentType: "accident_minor",
    hour: 8,
    dayOfWeek: 0,
  });

  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [live, setLive] = useState<AdHocScore | null>(null);
  const [asking, setAsking] = useState(false);

  // With a pin the service answers, because only it can resolve the road under
  // the point and the hospitals, schools and bridges around it. Without one the
  // in-browser model answers and the road is chosen from the list.
  useEffect(() => {
    if (!pin) {
      setLive(null);
      return;
    }
    let cancelled = false;
    setAsking(true);
    const today = new Date();
    scoreAtLocation({
      latitude: pin.latitude,
      longitude: pin.longitude,
      incidentType: input.incidentType,
      totalLanes: input.totalLanes,
      lanesBlocked: input.lanesBlocked,
      hour: input.hour,
      dayOfWeek: input.dayOfWeek,
      date: today.toISOString().slice(0, 10),
    }).then((r) => {
      if (cancelled) return;
      setLive(r);
      setAsking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pin, input]);

  const result = useMemo(() => calculateImpactScore(input, model), [input, model]);
  const blocked = Math.min(input.lanesBlocked, input.totalLanes);
  const accent = PRIORITY_TOKEN[result.priority];

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wi-road">Road type</Label>
          <Select
            value={input.roadType}
            onValueChange={(v) => setInput({ ...input, roadType: v })}
          >
            <SelectTrigger id="wi-road" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROAD_TYPES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wi-incident">Incident type</Label>
          <Select
            value={input.incidentType}
            onValueChange={(v) => setInput({ ...input, incidentType: v })}
          >
            <SelectTrigger id="wi-incident" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCIDENT_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                  <span className="ml-1.5 text-muted-foreground">~{t.clearMin} min to clear</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="wi-lanes">Total lanes</Label>
            <span className="text-sm font-medium tabular-nums">{input.totalLanes}</span>
          </div>
          <Slider
            id="wi-lanes"
            min={1}
            max={6}
            step={1}
            value={[input.totalLanes]}
            onValueChange={([v]) =>
              setInput((i) => ({ ...i, totalLanes: v, lanesBlocked: Math.min(i.lanesBlocked, v) }))
            }
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="wi-blocked">Lanes blocked</Label>
            <span className="text-sm font-medium tabular-nums">{blocked}</span>
          </div>
          <Slider
            id="wi-blocked"
            min={1}
            max={input.totalLanes}
            step={1}
            value={[blocked]}
            onValueChange={([v]) => setInput((i) => ({ ...i, lanesBlocked: v }))}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="wi-hour">Time of day</Label>
            <span className="text-sm font-medium tabular-nums">
              {String(input.hour).padStart(2, "0")}:00
            </span>
          </div>
          <Slider
            id="wi-hour"
            min={0}
            max={23}
            step={1}
            value={[input.hour]}
            onValueChange={([v]) => setInput((i) => ({ ...i, hour: v }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wi-day">Day</Label>
          <Select
            value={String(input.dayOfWeek)}
            onValueChange={(v) => setInput({ ...input, dayOfWeek: Number(v) })}
          >
            <SelectTrigger id="wi-day" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => (
                <SelectItem key={d} value={String(i)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Pinning a real place is what makes the road class and the nearby
          hospitals, schools and bridges real rather than assumed. */}
      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Label>Place it on the map</Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Optional. With a pin, the road and anything sensitive around it come from the
              service instead of the list above.
            </p>
          </div>
          {pin && (
            <Button size="sm" variant="ghost" onClick={() => setPin(null)}>
              Clear pin
            </Button>
          )}
        </div>

        <LocationPicker
          value={pin}
          onChange={setPin}
          hint="Click anywhere in Colombo to score a breakdown at that spot."
          confirmLabel="Scoring at"
        />

        {pin && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {asking && <p className="text-muted-foreground">Scoring this spot…</p>}
            {!asking && !live && (
              <p className="text-muted-foreground">
                The scoring service did not answer, so the figures below are the in-browser
                model using the road type selected above.
              </p>
            )}
            {!asking && live && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-display text-2xl font-bold tabular-nums">
                    {(live.sensitivity?.adjusted_score ?? live.score).toFixed(1)}
                  </span>
                  <span className="text-muted-foreground">of 10, scored by the service</span>
                </div>
                <p className="text-muted-foreground">
                  {live.road?.source === "osm" ? (
                    <>
                      Matched <span className="capitalize text-foreground">{live.road.road_type}</span>
                      {live.road.matched_road ? ` — ${live.road.matched_road}` : ""}
                    </>
                  ) : (
                    <>No road matched at this point, so the default was used.</>
                  )}
                </p>
                {live.sensitivity && live.sensitivity.factor > 1 && (
                  <ul className="space-y-0.5">
                    {live.sensitivity.nearby
                      .filter((n) => n.active)
                      .map((n, i) => (
                        <li key={`${n.type}-${i}`} className="text-muted-foreground">
                          {n.name ?? n.type.replace(/_/g, " ")}
                          {n.distance_m != null ? ` · ${Math.round(n.distance_m)} m` : ""}
                          <span className="text-foreground"> +{Math.round(n.boost * 100)}%</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Card style={{ borderColor: accent }}>
          <CardContent className="flex flex-col items-center justify-center p-6">
            <p className="flex items-baseline gap-1">
              <span
                className="text-5xl font-semibold tabular-nums tracking-tight"
                style={{ color: accent }}
              >
                {result.score}
              </span>
              <span className="text-lg text-muted-foreground">of 10</span>
            </p>
            <p className="mt-1 text-sm font-medium" style={{ color: accent }}>
              {result.priority.charAt(0) + result.priority.slice(1).toLowerCase()} priority
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Queue", value: result.queueKm, unit: "km" },
            { label: "Vehicle-hours lost", value: result.vhl, unit: "hrs" },
            { label: "Recovery", value: result.recoveryMin, unit: "min" },
          ].map((m) => (
            <Card key={m.label}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{m.label}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-xl font-semibold tabular-nums">{m.value}</span>
                  <span className="text-sm text-muted-foreground">{m.unit}</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
