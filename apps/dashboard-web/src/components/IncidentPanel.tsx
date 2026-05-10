"use client";

import type { Incident } from "@/lib/types";

const PRIORITY_BG: Record<string, string> = {
  CRITICAL: "bg-red-500/20 border-red-500/40 text-red-400",
  HIGH: "bg-orange-500/20 border-orange-500/40 text-orange-400",
  MEDIUM: "bg-yellow-500/20 border-yellow-500/40 text-yellow-400",
  LOW: "bg-green-500/20 border-green-500/40 text-green-400",
};

function FactorBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] w-8">{label}</span>
      <div className="flex-1 h-1.5 bg-[var(--bg)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-orange-500 transition-all"
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="text-[10px] text-[var(--text-muted)] w-8 text-right">{value.toFixed(2)}</span>
    </div>
  );
}

export default function IncidentPanel({
  incident,
  onClose,
}: {
  incident: Incident | null;
  onClose: () => void;
}) {
  if (!incident) return null;

  return (
    <div className="absolute top-4 right-4 w-80 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl z-[1000] overflow-hidden">
      <div className="flex items-center justify-between p-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded border ${PRIORITY_BG[incident.priority]}`}>
            {incident.priority}
          </span>
          <span className="text-sm font-mono text-[var(--text-muted)]">{incident.id}</span>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--text-muted)] hover:text-white transition-colors text-lg leading-none"
        >
          &times;
        </button>
      </div>

      <div className="p-3 space-y-3">
        <div className="text-center">
          <p className="text-4xl font-black">
            {incident.impactScore}
            <span className="text-lg font-normal text-[var(--text-muted)]">/10</span>
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Impact Score</p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-[var(--surface-2)] rounded-lg p-2">
            <p className="text-lg font-bold">{incident.queueKm}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Queue km</p>
          </div>
          <div className="bg-[var(--surface-2)] rounded-lg p-2">
            <p className="text-lg font-bold">{incident.vhl}</p>
            <p className="text-[10px] text-[var(--text-muted)]">VHL</p>
          </div>
          <div className="bg-[var(--surface-2)] rounded-lg p-2">
            <p className="text-lg font-bold">{incident.recoveryMin}</p>
            <p className="text-[10px] text-[var(--text-muted)]">Recovery min</p>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Factor Breakdown</p>
          <FactorBar label="CLF" value={incident.clf} />
          <FactorBar label="TVF" value={incident.tvf} />
          <FactorBar label="TF" value={incident.tf} />
          <FactorBar label="LF" value={incident.lf} />
          <FactorBar label="ISF" value={incident.isf} />
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-[var(--text-muted)]">Road</div>
          <div>{incident.roadType}</div>
          <div className="text-[var(--text-muted)]">Lanes</div>
          <div>{incident.lanesBlocked}/{incident.totalLanes} blocked</div>
          <div className="text-[var(--text-muted)]">Type</div>
          <div>{incident.incidentType.replace(/_/g, " ")}</div>
          <div className="text-[var(--text-muted)]">Time</div>
          <div>{String(incident.hour).padStart(2, "0")}:00 {incident.dayName}</div>
        </div>
      </div>
    </div>
  );
}
