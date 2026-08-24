"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { calculateImpactScore } from "@/lib/scoring";
import type { ModelConfig, WhatIfInput } from "@/lib/types";

const ROAD_TYPES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential"];
const INCIDENT_TYPES = [
  "accident_major", "accident_minor", "engine_failure",
  "overheating", "flat_tire", "battery_dead", "fuel_empty",
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
            <SelectTrigger id="wi-incident" className="w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCIDENT_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">{titled(t)}</SelectItem>
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
