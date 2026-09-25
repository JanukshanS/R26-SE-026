"use client";

import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";

import LanguagePicker from "@/components/LanguagePicker";
import { useT } from "@/lib/i18n";
import type { ClaimStage } from "@/lib/claimFlow/types";
import { STAGE_ORDER } from "@/lib/claimFlow/types";
import { useUploadQueueStatus } from "@/lib/claimFlow/uploadQueue";

/**
 * Chrome for the public claim-link flow — deliberately NOT PortalShell, which
 * assumes a signed-in session (account chip, sign-out, area nav). A claimant
 * opening this link has no account at all.
 */
export function ClaimShell({ stage, children }: { stage: ClaimStage; children: React.ReactNode }) {
  const t = useT();
  const stepIndex = STAGE_ORDER.indexOf(stage);
  const totalSteps = STAGE_ORDER.length - 1; // "done" isn't a step to count toward
  const { pendingCount, retrying } = useUploadQueueStatus();

  // A tall step (long scripts, carousels, etc.) left the page scrolled down;
  // without this, the next step renders still scrolled to that same offset —
  // its own "Next"/"Continue" button (or any content) can land far above or
  // below the initial viewport instead of at a predictable position. Every
  // stage change should start scrolled to the top, not wherever the last one
  // left off.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stage]);

  return (
    // flex flex-col + main's flex-1 (below) — lets a step whose content is
    // shorter than the viewport (e.g. GuidedCaptureIntroStep) push its own
    // primary button down to the actual bottom of the screen via mt-auto,
    // instead of the button floating in the middle with dead space below it.
    <div className="flex min-h-screen flex-col bg-background">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <span className="font-display text-lg font-bold tracking-tight">kaduna.lk</span>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" aria-hidden />
                {retrying
                  ? t("claim.common.uploadRetrying")
                  : t("claim.common.uploadPending", { count: pendingCount })}
              </span>
            )}
            <LanguagePicker />
          </div>
        </div>
        {stage !== "done" && (
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.min(100, ((stepIndex + 1) / totalSteps) * 100)}%` }}
            />
          </div>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
        {stage !== "verify" && stage !== "done" && (
          <p className="mb-4 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("claim.common.stepOf", { index: stepIndex, total: totalSteps })}
          </p>
        )}
        {/* Keyed by stage so React mounts a fresh element per step, which is
            what re-triggers this animate-in on every stage change instead of
            it only playing once — a plain CSS transition needs a persistent
            element with a before/after style change, which swapping between
            entirely different step components never gives it. flex-1 so a
            step's own h-full/mt-auto (see GuidedCaptureIntroStep) can reach
            all the way to the bottom of the screen. */}
        <div key={stage} className="flex flex-1 flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </div>
      </main>
    </div>
  );
}
