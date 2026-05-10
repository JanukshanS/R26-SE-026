"use client";

import { useState, useMemo } from "react";
import type { ModelConfig, WhatIfInput } from "@/lib/types";
import { calculateImpactScore } from "@/lib/scoring";

const ROAD_TYPES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential"];
const INCIDENT_TYPES = ["accident_major", "accident_minor", "engine_failure", "overheating", "flat_tire", "battery_dead", "fuel_empty"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-500/20 border-red-500 text-red-400",
  HIGH: "bg-orange-500/20 border-orange-500 text-orange-400",
  MEDIUM: "bg-yellow-500/20 border-yellow-500 text-yellow-400",
  LOW: "bg-green-500/20 border-green-500 text-green-400",
};

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

  const selectClass =
    "w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-orange-500 transition-colors";

  return (
    <div className="space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold">
        What-If Simulator
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase">Road Type</label>
          <select
            className={selectClass}
            value={input.roadType}
            onChange={(e) => setInput({ ...input, roadType: e.target.value })}
          >
            {ROAD_TYPES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase">Incident</label>
          <select
            className={selectClass}
            value={input.incidentType}
            onChange={(e) => setInput({ ...input, incidentType: e.target.value })}
          >
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase">Total Lanes</label>
          <input
            type="range"
            min={1}
            max={6}
            value={input.totalLanes}
            onChange={(e) => setInput({ ...input, totalLanes: +e.target.value })}
            className="w-full accent-orange-500"
          />
          <p className="text-xs text-center">{input.totalLanes}</p>
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase">Lanes Blocked</label>
          <input
            type="range"
            min={1}
            max={input.totalLanes}
            value={Math.min(input.lanesBlocked, input.totalLanes)}
            onChange={(e) => setInput({ ...input, lanesBlocked: +e.target.value })}
            className="w-full accent-red-500"
          />
          <p className="text-xs text-center">{Math.min(input.lanesBlocked, input.totalLanes)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase">Hour ({String(input.hour).padStart(2, "0")}:00)</label>
          <input
            type="range"
            min={0}
            max={23}
            value={input.hour}
            onChange={(e) => setInput({ ...input, hour: +e.target.value })}
            className="w-full accent-orange-500"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-muted)] uppercase">Day</label>
          <select
            className={selectClass}
            value={input.dayOfWeek}
            onChange={(e) => setInput({ ...input, dayOfWeek: +e.target.value })}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={`rounded-xl border-2 p-4 text-center transition-all ${PRIORITY_STYLE[result.priority]}`}>
        <p className="text-5xl font-black">
          {result.score}
          <span className="text-lg font-normal opacity-60">/10</span>
        </p>
        <p className="text-sm font-bold mt-1">{result.priority}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[var(--surface-2)] rounded-lg p-2">
          <p className="text-lg font-bold">{result.queueKm}</p>
          <p className="text-[10px] text-[var(--text-muted)]">Queue km</p>
        </div>
        <div className="bg-[var(--surface-2)] rounded-lg p-2">
          <p className="text-lg font-bold">{result.vhl}</p>
          <p className="text-[10px] text-[var(--text-muted)]">VHL</p>
        </div>
        <div className="bg-[var(--surface-2)] rounded-lg p-2">
          <p className="text-lg font-bold">{result.recoveryMin}</p>
          <p className="text-[10px] text-[var(--text-muted)]">Recovery min</p>
        </div>
      </div>
    </div>
  );
}
