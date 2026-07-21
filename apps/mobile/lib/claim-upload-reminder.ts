import { computeClaimBundleUploadKey, isClaimReportSubmittedLocked } from '@/lib/claim-upload-dedupe';
import { loadUploadProgress } from '@/lib/claim-upload-progress-store';

export type IncompleteUploadStatus = {
  uploadKey: string;
  reportedAtIso: string;
  percent: number;
};

/**
 * Reports the current claim's in-progress (but interrupted) upload, if any — null once it's
 * fully submitted, or if nothing was ever started for the current photo bundle. Drives both
 * the badge dots (features/report-accident/hooks/use-incomplete-upload-status.ts) and the
 * reminder modal shown on every app open (features/report-accident/components/claim-upload-reminder-modal.tsx).
 */
export async function getIncompleteUploadStatus(): Promise<IncompleteUploadStatus | null> {
  if (await isClaimReportSubmittedLocked()) {
    return null;
  }
  const uploadKey = await computeClaimBundleUploadKey();
  const progress = await loadUploadProgress(uploadKey);
  if (!progress || progress.totalItems <= 0) {
    return null;
  }
  const percent = Math.min(99, Math.round((progress.nextIndex / progress.totalItems) * 100));
  return { uploadKey: progress.uploadKey, reportedAtIso: progress.reportedAtIso, percent };
}
