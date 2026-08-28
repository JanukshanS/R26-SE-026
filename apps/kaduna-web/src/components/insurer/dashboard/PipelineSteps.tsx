"use client";

import { useState, useEffect } from "react";

type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

type Step = {
  key: string;
  label: string;
  status: StepStatus;
  started_at?: number;
  completed_at?: number;
};

type PipelineStepsProps = {
  steps: Step[];
  modelState: "idle" | "generating" | "ready" | "error" | "low_light";
  claimLabel?: string;
  onDismiss?: () => void;
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const STEP_ICON: Record<StepStatus, string> = {
  done: "✓",
  running: "◉",
  failed: "✕",
  skipped: "—",
  pending: "○",
};

const STEP_COLOR: Record<StepStatus, string> = {
  done: "text-emerald-400",
  running: "text-blue-400 font-medium",
  failed: "text-red-400",
  skipped: "text-slate-500 opacity-60",
  pending: "text-slate-500",
};

function StepTimer({ step, now }: { step: Step; now: number }) {
  if (step.status === "done" && step.started_at && step.completed_at) {
    return (
      <span className="text-[0.65rem] tabular-nums opacity-75 whitespace-nowrap text-emerald-400">
        {formatDuration(step.completed_at - step.started_at)}
      </span>
    );
  }
  if (step.status === "running" && step.started_at) {
    return (
      <span className="text-[0.65rem] tabular-nums opacity-75 whitespace-nowrap text-blue-400">
        {formatDuration(now / 1000 - step.started_at)}
      </span>
    );
  }
  if (step.status === "failed" && step.started_at && step.completed_at) {
    return (
      <span className="text-[0.65rem] tabular-nums opacity-75 whitespace-nowrap text-red-400">
        {formatDuration(step.completed_at - step.started_at)}
      </span>
    );
  }
  return null;
}

export function PipelineSteps({
  steps,
  modelState,
  claimLabel,
  onDismiss,
}: PipelineStepsProps) {
  const [minimized, setMinimized] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const hasRunning = steps.some((s) => s.status === "running");
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [steps]);

  if (modelState === "idle") return null;

  const running = steps.find((s) => s.status === "running");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const failed = steps.some((s) => s.status === "failed");
  const isLowLight = modelState === "low_light";

  const headerLabel =
    modelState === "ready"
      ? "3D model ready"
      : modelState === "error"
        ? "Pipeline failed"
        : modelState === "low_light"
          ? "Low light — enhanced photos ready"
          : running
            ? running.label
            : "Preparing…";

  const panelBg = failed
    ? "bg-red-950 border-red-800"
    : modelState === "ready"
      ? "bg-emerald-950 border-emerald-800"
      : isLowLight
        ? "bg-amber-950 border-amber-800"
        : "bg-slate-900 border-slate-700";

  return (
    <div
      className={`fixed bottom-6 right-6 w-64 rounded-xl border shadow-lg overflow-hidden text-sm z-[1000] ${panelBg}`}
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none text-slate-200"
        onClick={() => setMinimized((v) => !v)}
      >
        <span className="flex flex-1 items-center gap-1.5 font-medium whitespace-nowrap overflow-hidden text-ellipsis">
          {modelState === "generating" && (
            <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 animate-pulse" />
          )}
          {headerLabel}
        </span>
        <span className="text-[0.72rem] text-slate-400 shrink-0">
          {steps.length > 0 && `${doneCount}/${steps.length}`}
        </span>
        <button
          type="button"
          aria-label={minimized ? "Expand" : "Minimise"}
          className="text-slate-400 text-[0.6rem] shrink-0 bg-transparent border-none cursor-pointer p-0"
        >
          {minimized ? "▲" : "▼"}
        </button>
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="text-slate-400 hover:text-slate-200 text-base leading-none shrink-0 bg-transparent border-none cursor-pointer p-0 pl-0.5"
          >
            ×
          </button>
        )}
      </div>

      {!minimized && (
        <>
          {claimLabel && (
            <div className="px-3 py-1 text-[0.72rem] text-slate-400 border-t border-white/10">
              Generating for <strong className="text-slate-300">{claimLabel}</strong>
            </div>
          )}
          {steps.length > 0 && (
            <div className="border-t border-white/10 px-3 py-2 flex flex-col gap-1.5">
              {steps.map((step) => (
                <div
                  key={step.key}
                  className={`flex items-center gap-2 ${STEP_COLOR[step.status]}`}
                >
                  <span className="w-3.5 text-center text-[0.68rem] shrink-0">
                    {STEP_ICON[step.status]}
                  </span>
                  <span className="flex-1 text-[0.8rem]">{step.label}</span>
                  <StepTimer step={step} now={now} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
