"use client";

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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
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
      <main className="mx-auto max-w-2xl px-4 py-8">
        {stage !== "verify" && stage !== "done" && (
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("claim.common.stepOf", { index: stepIndex, total: totalSteps })}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
