"use client";

import { useEffect, useState } from "react";
import type { ValidationData } from "@/lib/types";

// SVG scatter geometry (viewBox units).
const W = 300;
const H = 220;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 28;

export default function ValidationPanel() {
  const [data, setData] = useState<ValidationData | null>(null);

  useEffect(() => {
    fetch("/data/validation.json")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Domains: x = impact score (fixed 0-10), y = speed reduction % (0-100).
  const xMin = 0;
  const xMax = 10;
  const yMin = 0;
  const yMax = 100;

  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const sx = (x: number) => PAD_L + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y: number) => PAD_T + (1 - (y - yMin) / (yMax - yMin)) * plotH;

  // Fitted line endpoints (clamped to the plotted y-range).
  const { slope, intercept } = data.fit;
  const lineY = (x: number) => slope * x + intercept;
  const x0 = xMin;
  const x1 = xMax;

  const xTicks = [0, 2, 4, 6, 8, 10];
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="space-y-4">
      <h3 className="text-xs  text-muted-foreground font-semibold">
        SUMO Validation
      </h3>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted border border-border p-2">
          <p className="text-2xl font-bold">{data.rDeployed.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground  mt-0.5">
            Deployed r
          </p>
        </div>
        <div className="rounded-lg bg-muted border border-border p-2">
          <p className="text-2xl font-bold text-indigo-400">{data.rFitted.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground  mt-0.5">
            SUMO-fitted r
          </p>
        </div>
        <div className="rounded-lg bg-muted border border-border p-2">
          <p className="text-2xl font-bold text-indigo-400">{data.cvFitted.toFixed(3)}</p>
          <p className="text-xs text-muted-foreground  mt-0.5">
            Held-out CV
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-muted border border-border p-3">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Impact Score vs SUMO Speed Reduction ({data.n} scenarios)
        </p>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto"
          role="img"
          aria-label="Scatter of deployed impact score against SUMO speed reduction"
        >
          {/* Grid + axes */}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line
                x1={PAD_L}
                x2={W - PAD_R}
                y1={sy(t)}
                y2={sy(t)}
                stroke="var(--border)"
                strokeWidth={0.5}
              />
              <text
                x={PAD_L - 4}
                y={sy(t) + 3}
                textAnchor="end"
                className="fill-[var(--muted-foreground)]"
                fontSize={8}
              >
                {t}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text
              key={`x${t}`}
              x={sx(t)}
              y={H - PAD_B + 12}
              textAnchor="middle"
              className="fill-[var(--muted-foreground)]"
              fontSize={8}
            >
              {t}
            </text>
          ))}

          {/* Fitted regression line */}
          <line
            x1={sx(x0)}
            y1={sy(Math.max(yMin, Math.min(yMax, lineY(x0))))}
            x2={sx(x1)}
            y2={sy(Math.max(yMin, Math.min(yMax, lineY(x1))))}
            stroke="#818cf8"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />

          {/* Points */}
          {data.points.map((p, i) => (
            <circle
              key={i}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={2.2}
              fill="#6366f1"
              fillOpacity={0.55}
            />
          ))}

          {/* r annotation */}
          <text
            x={W - PAD_R - 2}
            y={PAD_T + 12}
            textAnchor="end"
            className="fill-current"
            fontSize={11}
            fontWeight={700}
          >
            r = {data.rDeployed.toFixed(2)}
          </text>
        </svg>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-muted-foreground">{data.xLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-0.5">
          <span className="inline-block w-3 border-t border-dashed border-indigo-400 align-middle mr-1" />
          fitted line · y-axis: {data.yLabel}
        </p>
      </div>

      <div className="rounded-lg bg-muted border border-border p-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          The <span className="text-white font-semibold">deployed</span> 5-factor model
          scores Pearson <span className="text-white font-semibold">r = 0.60</span> against
          SUMO speed reduction. The SUMO-fitted sensitivity weights reach{" "}
          <span className="text-indigo-400 font-semibold">r = 0.93</span> (held-out CV{" "}
          <span className="text-indigo-400 font-semibold">0.924</span>) — a sensitivity
          result, <span className="text-white font-semibold">not</span> the shipped model.
        </p>
      </div>
    </div>
  );
}
