"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { DispatchData, DispatchVariant } from "@/lib/types";

const POLICY_META: { key: keyof DispatchVariant["meanVHL"]; labelKey: string; color: string }[] = [
  { key: "nearest", labelKey: "dashboard.dispatch.policyNearest", color: "#6366f1" },
  { key: "priority", labelKey: "dashboard.dispatch.policyPriority", color: "#f97316" },
  { key: "fifo", labelKey: "dashboard.dispatch.policyFifo", color: "#64748b" },
];

function ReductionBadge({ pct }: { pct: number }) {
  const positive = pct >= 0;
  return (
    <span
      className={`font-black ${positive ? "text-green-400" : "text-red-400"}`}
    >
      {positive ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function VariantCard({
  title,
  subtitle,
  variant,
  highlight,
  cite,
}: {
  title: string;
  subtitle: string;
  variant: DispatchVariant;
  highlight: boolean;
  cite: boolean;
}) {
  const t = useT();
  const maxVHL = Math.max(...POLICY_META.map((p) => variant.meanVHL[p.key]));
  return (
    <div
      className={`rounded-lg border p-3 ${
        highlight
          ? "bg-muted border-indigo-500/60"
          : "bg-muted border-border"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground ">
            {subtitle}
          </p>
        </div>
        {cite ? (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded border border-green-500/50 bg-green-500/10 text-green-400 ">
            {t("dashboard.dispatch.cite")}
          </span>
        ) : (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded border border-red-500/50 bg-red-500/10 text-red-400 ">
            {t("dashboard.dispatch.circular")}
          </span>
        )}
      </div>

      {/* Per-policy mean VHL bars */}
      <div className="space-y-1 mb-2">
        {POLICY_META.map((p) => {
          const v = variant.meanVHL[p.key];
          const pct = maxVHL > 0 ? (v / maxVHL) * 100 : 0;
          return (
            <div key={p.key} className="flex items-center gap-2">
              <span className="text-xs w-20 truncate">{t(p.labelKey)}</span>
              <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: p.color }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-14 text-right font-mono">
                {v.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Headline relative reduction */}
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground ">
          {t("dashboard.dispatch.relative")}
        </span>
        <span className="text-lg">
          <ReductionBadge pct={variant.relReductionPct} />
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">
        {t("dashboard.dispatch.variantStats", {
          ciLow: variant.ci95[0].toFixed(1),
          ciHigh: variant.ci95[1].toFixed(1),
          seedsWon: variant.seedsCbeatsA,
          seeds: variant.seeds,
          spearman: variant.spearmanCostVsScore.toFixed(2),
        })}
      </p>

      {/* N-sweep */}
      <div className="mt-2 grid grid-cols-3 gap-1">
        {variant.nSweep.map((s) => (
          <div
            key={s.N}
            className="rounded bg-muted p-1.5 text-center"
            title={t("dashboard.dispatch.sweepTitle", {
              n: s.N,
              seedsWon: s.seedsCbeatsA,
              seeds: variant.seeds,
            })}
          >
            <p className="text-xs text-muted-foreground">
              {t("dashboard.dispatch.sweepN", { n: s.N })}
            </p>
            <p className="text-xs font-bold">
              <ReductionBadge pct={s.relReductionPct} />
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DispatchPanel() {
  const t = useT();
  const [data, setData] = useState<DispatchData | null>(null);

  useEffect(() => {
    fetch("/data/dispatch.json")
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

  return (
    <div className="space-y-3">
      <h3 className="text-xs  text-muted-foreground font-semibold">
        {t("dashboard.dispatch.title")}
      </h3>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("dashboard.dispatch.intro", { seeds: data.kernel.seeds, n: data.headlineN })}
      </p>

      <VariantCard
        title={t("dashboard.dispatch.sumoTitle")}
        subtitle={t("dashboard.dispatch.sumoSubtitle")}
        variant={data.sumoGrounded}
        highlight
        cite
      />

      <VariantCard
        title={t("dashboard.dispatch.kernelTitle")}
        subtitle={t("dashboard.dispatch.kernelSubtitle")}
        variant={data.kernel}
        highlight={false}
        cite={false}
      />

      <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
        <p className="text-xs font-bold text-yellow-400  mb-1">
          {t("dashboard.dispatch.balancedTitle")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {data.balancedNote}
        </p>
      </div>

      <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
        <p className="text-xs font-bold text-red-400  mb-1">
          {t("dashboard.dispatch.caveatTitle")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {data.honestCaveat}
        </p>
      </div>

      <p className="text-xs text-muted-foreground break-words">
        {t("dashboard.dispatch.source", { source: data.source })}
      </p>
    </div>
  );
}
