"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { Stats } from "@/lib/types";

const PRIORITY_TOKEN: Record<string, string> = {
  CRITICAL: "var(--priority-critical)",
  HIGH: "var(--priority-high)",
  MEDIUM: "var(--priority-medium)",
  LOW: "var(--priority-low)",
};

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

/** A labelled proportion bar. The number is the value; the bar is the shape. */
function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <div
        className="h-full rounded-full"
        style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: color }}
      />
    </div>
  );
}

export default function StatsPanel({ stats }: { stats: Stats }) {
  const total = Object.values(stats.priorityDist).reduce((a, b) => a + b, 0);
  const roads = Object.entries(stats.byRoadType).sort((a, b) => b[1] - a[1]);
  const types = Object.entries(stats.byIncidentType).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Priority distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {ORDER.filter((p) => p in stats.priorityDist).map((p) => {
            const count = stats.priorityDist[p] ?? 0;
            return (
              <div key={p} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: PRIORITY_TOKEN[p] }}
                      aria-hidden
                    />
                    {p.charAt(0) + p.slice(1).toLowerCase()}
                  </span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    <span className="font-medium text-foreground">{count}</span>{" "}
                    ({total > 0 ? ((count / total) * 100).toFixed(1) : "0.0"}%)
                  </span>
                </div>
                <Meter value={count} max={total} color={PRIORITY_TOKEN[p]} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <BreakdownCard title="Average impact by road type" rows={roads} />
      <BreakdownCard title="Average impact by incident type" rows={types} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Real-data sources</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Synthetic incidents are anchored to real accident geography: 18 known Colombo
            blackspots (NTC 2024) and regional severity stats from data.gov.lk 2012, where
            the Colombo district accounted for ~26.9% of national road accidents.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: [string, number][] }) {
  const max = Math.max(...rows.map(([, v]) => v), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableBody>
            {rows.map(([key, value]) => (
              <TableRow key={key} className="border-0 hover:bg-transparent">
                <TableCell className="py-1.5 pl-0 text-sm capitalize">
                  {key.replace(/_/g, " ")}
                </TableCell>
                <TableCell className="w-[45%] py-1.5">
                  <Meter value={value} max={max} color="var(--primary)" />
                </TableCell>
                <TableCell className="w-12 py-1.5 pr-0 text-right text-sm font-medium tabular-nums">
                  {value.toFixed(1)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
