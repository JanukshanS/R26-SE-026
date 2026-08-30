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
import { useT } from "@/lib/i18n";
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
const INCIDENT_TYPES: Array<{ value: string; labelKey: string; clearMin: number }> = [
  { value: "accident_major", labelKey: "dashboard.incidentType.accidentMajor", clearMin: 120 },
  { value: "engine_failure", labelKey: "dashboard.incidentType.engineFailure", clearMin: 60 },
  { value: "accident_minor", labelKey: "dashboard.incidentType.accidentMinor", clearMin: 45 },
  { value: "overheating", labelKey: "dashboard.incidentType.overheating", clearMin: 40 },
  { value: "flat_tire", labelKey: "dashboard.incidentType.flatTyre", clearMin: 30 },
  { value: "battery_dead", labelKey: "dashboard.incidentType.flatBattery", clearMin: 25 },
  { value: "fuel_empty", labelKey: "dashboard.incidentType.outOfFuel", clearMin: 20 },
  { value: "other", labelKey: "dashboard.incidentType.other", clearMin: 45 },
];
const DAYS = [
  "dashboard.day.mon",
  "dashboard.day.tue",
  "dashboard.day.wed",
  "dashboard.day.thu",
  "dashboard.day.fri",
  "dashboard.day.sat",
  "dashboard.day.sun",
];

const PRIORITY_TOKEN: Record<string, string> = {
  CRITICAL: "var(--priority-critical-ink)",
  HIGH: "var(--priority-high-ink)",
  MEDIUM: "var(--priority-medium-ink)",
  LOW: "var(--priority-low-ink)",
};

const PRIORITY_LABEL: Record<string, string> = {
  CRITICAL: "dashboard.priority.critical",
  HIGH: "dashboard.priority.high",
  MEDIUM: "dashboard.priority.medium",
  LOW: "dashboard.priority.low",
};

const titled = (s: string) => s.replace(/_/g, " ");

/**
 * Scores a hypothetical incident against the deployed 5-factor model. Results
 * recompute as controls move — there is no submit step, so the panel reads as
 * a live instrument rather than a form.
 */
export default function WhatIfSimulator({ model }: { model: ModelConfig }) {
  const t = useT();
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

  // With a pin the service is authoritative: it resolved the road under the
  // point and applied the sensitive-location overlay, neither of which the
  // in-browser model can do.
  const usingService = Boolean(pin && live);
  const shown = usingService
    ? {
        score: live!.sensitivity?.adjusted_score ?? live!.score,
        priority: live!.priority as string,
        queueKm: live!.prediction.queue_km ?? 0,
        vhl: live!.prediction.vehicle_hours_lost ?? 0,
        recoveryMin: live!.prediction.recovery_min ?? 0,
      }
    : {
        score: result.score,
        priority: result.priority as string,
        queueKm: result.queueKm,
        vhl: result.vhl,
        recoveryMin: result.recoveryMin,
      };
  const accent = PRIORITY_TOKEN[shown.priority];

  return (
    <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wi-road">
            {t("dashboard.whatIf.roadType")}
            {pin && (
              <span className="ml-1.5 text-muted-foreground">
                {t("dashboard.whatIf.roadFromPin")}
              </span>
            )}
          </Label>
          <Select
            value={input.roadType}
            disabled={Boolean(pin)}
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
          <Label htmlFor="wi-incident">{t("dashboard.whatIf.incidentType")}</Label>
          <Select
            value={input.incidentType}
            onValueChange={(v) => setInput({ ...input, incidentType: v })}
          >
            <SelectTrigger id="wi-incident" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INCIDENT_TYPES.map((it) => (
                <SelectItem key={it.value} value={it.value}>
                  {t(it.labelKey)}
                  <span className="ml-1.5 text-muted-foreground">
                    {t("dashboard.whatIf.clearMin", { minutes: it.clearMin })}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="wi-lanes">{t("dashboard.whatIf.totalLanes")}</Label>
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
            <Label htmlFor="wi-blocked">{t("dashboard.whatIf.lanesBlocked")}</Label>
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
            <Label htmlFor="wi-hour">{t("dashboard.whatIf.timeOfDay")}</Label>
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
          <Label htmlFor="wi-day">{t("dashboard.whatIf.day")}</Label>
          <Select
            value={String(input.dayOfWeek)}
            onValueChange={(v) => setInput({ ...input, dayOfWeek: Number(v) })}
          >
            <SelectTrigger id="wi-day" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((d, i) => (
                <SelectItem key={d} value={String(i)}>{t(d)}</SelectItem>
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
            <Label>{t("dashboard.whatIf.placeTitle")}</Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("dashboard.whatIf.placeBody")}
            </p>
          </div>
          {pin && (
            <Button size="sm" variant="ghost" onClick={() => setPin(null)}>
              {t("dashboard.whatIf.clearPin")}
            </Button>
          )}
        </div>

        <LocationPicker
          value={pin}
          onChange={setPin}
          hint={t("dashboard.whatIf.pickerHint")}
          confirmLabel={t("dashboard.whatIf.pickerConfirm")}
        />

        {pin && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {asking && <p className="text-muted-foreground">{t("dashboard.whatIf.scoring")}</p>}
            {!asking && !live && (
              <p className="text-muted-foreground">{t("dashboard.whatIf.serviceDown")}</p>
            )}
            {!asking && live && (
              <div className="space-y-1.5">
                <p className="text-muted-foreground">
                  {live.road?.source === "osm"
                    ? live.road.matched_road
                      ? t("dashboard.whatIf.matchedRoadNamed", {
                          roadType: live.road.road_type,
                          road: live.road.matched_road,
                        })
                      : t("dashboard.whatIf.matchedRoad", { roadType: live.road.road_type })
                    : t("dashboard.whatIf.noRoad")}
                </p>
                {live.sensitivity && live.sensitivity.factor > 1 && (
                  <ul className="space-y-0.5">
                    {live.sensitivity.nearby
                      .filter((n) => n.active)
                      .map((n, i) => (
                        <li key={`${n.type}-${i}`} className="text-muted-foreground">
                          {n.name ?? n.type.replace(/_/g, " ")}
                          {n.distance_m != null
                            ? ` · ${t("dashboard.unit.metres", { m: Math.round(n.distance_m) })}`
                            : ""}
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
                {shown.score.toFixed(1)}
              </span>
              <span className="text-lg text-muted-foreground">{t("dashboard.whatIf.ofTen")}</span>
            </p>
            <p className="mt-1 text-sm font-medium" style={{ color: accent }}>
              {t("dashboard.whatIf.priority", { priority: t(PRIORITY_LABEL[shown.priority]) })}
            </p>
            <p className="mt-1.5 text-center text-xs text-muted-foreground">
              {usingService
                ? t("dashboard.whatIf.byService")
                : t("dashboard.whatIf.byBrowser")}
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("dashboard.whatIf.queue"), value: shown.queueKm, unit: t("dashboard.unit.km") },
            { label: t("dashboard.whatIf.vhl"), value: shown.vhl, unit: t("dashboard.unit.hrs") },
            { label: t("dashboard.whatIf.recovery"), value: shown.recoveryMin, unit: t("dashboard.unit.min") },
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
