"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";

import { useT } from "@/lib/i18n";
import { completeCapture } from "@/lib/claimFlow/uploadApi";
import { useUploadQueueStatus, waitForQueueDrain } from "@/lib/claimFlow/uploadQueue";

const PRIMARY_BTN =
  "w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";

export function SubmitStep({ captureId, onSubmitted }: { captureId: string; onSubmitted: () => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [waitingForUploads, setWaitingForUploads] = useState(true);
  const startedRef = useRef(false);
  const { pendingCount } = useUploadQueueStatus();

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void run();
  }, []);

  const run = async () => {
    setError(null);
    try {
      setWaitingForUploads(true);
      await waitForQueueDrain();
      setWaitingForUploads(false);
      await completeCapture(captureId);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("claim.submit.failed"));
    }
  };

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <button type="button" onClick={() => void run()} className={PRIMARY_BTN}>
          {t("claim.common.retry")}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-12 text-green-600" aria-hidden />
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.submit.success")}</h1>
        <p className="text-sm text-muted-foreground">{t("claim.submit.successBody")}</p>
        <button type="button" onClick={onSubmitted} className={PRIMARY_BTN}>
          {t("claim.common.continue")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <LoaderCircle className="mx-auto size-10 animate-spin text-primary" aria-hidden />
      <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.submit.title")}</h1>
      <p className="text-sm text-muted-foreground">
        {waitingForUploads && pendingCount > 0
          ? t("claim.submit.uploadingRemaining", { count: pendingCount })
          : t("claim.submit.finalizing")}
      </p>
      <p className="text-xs font-medium text-amber-700">{t("claim.submit.doNotClose")}</p>
    </div>
  );
}
