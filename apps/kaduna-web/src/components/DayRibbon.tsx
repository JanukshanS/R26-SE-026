"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Incident } from "@/lib/types";

/**
 * Impact by hour — a chart that is also the hour filter.
 *
 * Impact in Colombo is rhythmic: 6.9/10 at 18:00 against 3.1 at 22:00. Every
 * incident carries its hour, so selecting a column filters the map instead of
 * duplicating a separate control. Column height is mean impact; the dashed
 * line is the all-day mean, so "worse than typical" reads without an axis.
 */

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Below this many incidents an hour's mean is one or two cases, not a pattern.
 * 02:00 holds a single incident scoring 5.1, which drew a taller bar than
 * 10:00's average of sixteen — the chart was reporting noise with the same
 * confidence as the evening peak. Sparse hours are still shown, because hiding
 * them would misrepresent the night as empty, but they are drawn as outlines so
 * they cannot be mistaken for a trend.
 */
const SPARSE_N = 5;
const label = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function DayRibbon({
  byHour,
  incidents,
  selectedHour,
  onSelectHour,
}: {
  byHour: Record<string, number>;
  incidents: Incident[];
  selectedHour: number | null;
  onSelectHour: (h: number | null) => void;
}) {
  const scores = HOURS.map((h) => byHour[String(h)] ?? 0);
  const max = Math.max(...scores, 1);
  const counts = HOURS.map((h) => incidents.filter((i) => i.hour === h).length);
  // The typical-day line averages only hours with enough incidents to mean
  // something; otherwise a single 02:00 case moves the baseline for the day.
  const solid = HOURS.filter((h) => counts[h] >= SPARSE_N).map((h) => scores[h]);
  const mean = solid.reduce((a, b) => a + b, 0) / (solid.length || 1);
  const peak = scores.indexOf(Math.max(...HOURS.map((h) => (counts[h] >= SPARSE_N ? scores[h] : 0))));

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <h2 className="text-sm font-medium">Impact by hour</h2>
            <p className="text-sm text-muted-foreground">
              Peaks at {label(peak)} · {scores[peak].toFixed(1)} of 10. Outlined bars are hours
              with fewer than {SPARSE_N} incidents. Select an hour to filter the map.
            </p>
          </div>
          {selectedHour !== null && (
            <Button size="sm" variant="secondary" onClick={() => onSelectHour(null)} className="gap-1.5">
              <X className="size-3.5" aria-hidden />
              {label(selectedHour)} · clear
            </Button>
          )}
        </div>

        <div className="relative flex h-24 items-end gap-1" role="group" aria-label="Filter by hour of day">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border"
            style={{ bottom: `${(mean / max) * 100}%` }}
          />
          {HOURS.map((h) => {
            const score = scores[h];
            const selected = selectedHour === h;
            const dimmed = selectedHour !== null && !selected;
            const sparse = counts[h] > 0 && counts[h] < SPARSE_N;
            return (
              <Tooltip key={h}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onSelectHour(selected ? null : h)}
                    aria-pressed={selected}
                    aria-label={`${label(h)}, impact ${score.toFixed(1)} of 10, ${counts[h]} incidents${
                      sparse ? ", too few to be a pattern" : ""
                    }`}
                    className="group flex h-full flex-1 flex-col justify-end rounded-sm outline-offset-2 transition-opacity"
                    style={{ opacity: dimmed ? 0.35 : 1 }}
                  >
                    <span
                      className={`w-full rounded-sm transition-colors ${
                        selected
                          ? "bg-primary"
                          : score === 0
                            ? "bg-border"
                            : sparse
                              ? "border border-dashed border-muted-foreground/50 bg-transparent"
                              : score >= mean
                                ? "bg-primary/70 group-hover:bg-primary"
                                : "bg-muted-foreground/40 group-hover:bg-primary/50"
                      }`}
                      style={{ height: score > 0 ? `${Math.max((score / max) * 100, 8)}%` : "3px" }}
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{label(h)}</p>
                  <p className="text-muted-foreground">
                    {score > 0 ? `${score.toFixed(1)} of 10` : "No data"} · {counts[h]} incidents
                  </p>
                  {sparse && (
                    <p className="text-muted-foreground">Too few to be a pattern</p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="relative mt-1.5 h-4">
          {[0, 6, 12, 18, 23].map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 text-xs tabular-nums text-muted-foreground"
              style={{ left: `${((h + 0.5) / 24) * 100}%` }}
            >
              {String(h).padStart(2, "0")}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
