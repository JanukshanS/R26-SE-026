"use client";

import { useEffect, useState } from "react";

import { useT } from "@/lib/i18n";
import { resolveClaimLinkToken } from "@/lib/claimFlow/claimLinkToken";
import { captureLocationSnapshot } from "@/lib/claimFlow/location";
import { ensureClaimSession } from "@/lib/claimFlow/session";
import { getOrCreateCapture, reconcileProgress, updateCapture } from "@/lib/claimFlow/uploadApi";
import { loadClaimProgress, newClaimProgress, saveClaimProgress, type ClaimProgress } from "@/lib/claimFlow/progress";
import type { ClaimLinkIdentity, LocationSnapshot, VerifiedClaimant } from "@/lib/claimFlow/types";
import { STAGE_ORDER, type ClaimStage } from "@/lib/claimFlow/types";

import { ClaimShell } from "./ClaimShell";
import { VerifyStep } from "./VerifyStep";
import { CallInsurerStep } from "./CallInsurerStep";
import { GuidedCaptureIntroStep } from "./GuidedCaptureIntroStep";
import { GuidedCaptureStep } from "./GuidedCaptureStep";
import { PhotoSlotsStep, type PhotoSlotDef } from "./PhotoSlotsStep";
import { VideoStep } from "./VideoStep";
import { SubmitStep } from "./SubmitStep";

const GUIDED_TOTAL = 36;
const LICENCE_START = GUIDED_TOTAL;
const LICENCE_TOTAL = 3;
const VIDEO_START = LICENCE_START + LICENCE_TOTAL; // 39
const THIRD_PARTY_START = VIDEO_START + 1; // 40
const THIRD_PARTY_TOTAL = 3;

/** Which stage "owns" a given photo index — used to roll `stage` itself back
 * (not just `nextPhotoIndex`) when reconcileProgress finds the server is
 * behind an already-passed stage. Without this, a stage that had already
 * advanced past the gap before a reload happened would never be revisited:
 * every stage's own startPhotoIndex/resumeCount math clamps up to at least
 * that stage's own START constant, so a corrected-but-lower nextPhotoIndex
 * from an EARLIER stage is silently ignored once `stage` itself has moved on. */
function stageForPhotoIndex(index: number): ClaimStage | null {
  if (index < GUIDED_TOTAL) return "guidedCapture";
  if (index < LICENCE_START + LICENCE_TOTAL) return "drivingLicence";
  if (index < VIDEO_START + 1) return "userVerification";
  if (index < THIRD_PARTY_START + THIRD_PARTY_TOTAL) return "thirdParty";
  return null; // Caught up through every photo/video stage — no rollback needed.
}

const LICENCE_SLOTS: PhotoSlotDef[] = [
  { key: "front", labelKey: "claim.licence.sideFront", bodyKey: "claim.licence.bodyFront", facingMode: "environment" },
  { key: "back", labelKey: "claim.licence.sideBack", bodyKey: "claim.licence.bodyBack", facingMode: "environment" },
  { key: "selfie", labelKey: "claim.licence.sideSelfie", bodyKey: "claim.licence.bodySelfie", facingMode: "user" },
];
const THIRD_PARTY_SLOTS: PhotoSlotDef[] = [
  {
    key: "driverFront",
    labelKey: "claim.thirdParty.stepDriverFront",
    bodyKey: "claim.thirdParty.bodyDriverFront",
    facingMode: "environment",
  },
  {
    key: "driverBack",
    labelKey: "claim.thirdParty.stepDriverBack",
    bodyKey: "claim.thirdParty.bodyDriverBack",
    facingMode: "environment",
  },
  {
    key: "revenue",
    labelKey: "claim.thirdParty.stepRevenue",
    bodyKey: "claim.thirdParty.bodyRevenue",
    facingMode: "environment",
  },
];

function buildCreatePayload(nic: string, claimant: VerifiedClaimant, insurerCallLocation: LocationSnapshot) {
  return {
    claimant_name: claimant.fullName || null,
    claimant_nic: nic || null,
    claimant_licence_number: claimant.licenceNumber || null,
    vehicle_model: claimant.vehicleModel || null,
    policy_number: claimant.policyNumber || null,
    vehicle_reg_no: claimant.plateNumber || null,
    insurance_expire_month: claimant.insuranceExpireMonth || null,
    insurer_call_at: insurerCallLocation.capturedAtIso,
    insurer_call_captured_at_display_local: insurerCallLocation.capturedAtDisplayLocal,
    insurer_call_gps_lat: insurerCallLocation.latitude,
    insurer_call_gps_lng: insurerCallLocation.longitude,
    insurer_call_location_permission: insurerCallLocation.locationPermission,
    insurer_call_location_label: insurerCallLocation.locationLabel,
  };
}

export function ClaimFlow({ token }: { token: string }) {
  const t = useT();
  const [prefill, setPrefill] = useState<ClaimLinkIdentity | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClaimProgress | null>(null);
  const [claimant, setClaimant] = useState<VerifiedClaimant | null>(null);
  const [callInsurerSubmitting, setCallInsurerSubmitting] = useState(false);
  const [callInsurerError, setCallInsurerError] = useState<string | null>(null);

  useEffect(() => {
    const existing = loadClaimProgress(token);
    setProgress(existing ?? newClaimProgress(token));
    if (existing) {
      setClaimant(existing.claimant);
      // Correct a resumed nextPhotoIndex against what's actually confirmed on
      // the server — capture now advances (and bumps this counter) as soon as
      // a photo is *enqueued*, not once its upload is confirmed (see
      // uploadQueue.ts), so a reload while items were still queued could
      // otherwise leave this claiming more is on the server than really is.
      if (existing.captureId && existing.stage !== "submit" && existing.stage !== "done") {
        void reconcileProgress(existing.captureId, existing.nextPhotoIndex).then((corrected) => {
          if (corrected === existing.nextPhotoIndex) return;
          const correctStage = stageForPhotoIndex(corrected);
          // Only roll the stage itself backward — never forward — and only
          // when the recorded stage is genuinely ahead of where the gap is,
          // so a false correction never regresses someone still legitimately
          // mid-stage.
          const shouldRollBackStage =
            correctStage && STAGE_ORDER.indexOf(correctStage) < STAGE_ORDER.indexOf(existing.stage);
          update({
            nextPhotoIndex: corrected,
            ...(shouldRollBackStage ? { stage: correctStage } : {}),
          });
        });
      }
    } else if (token !== "direct") {
      void resolveClaimLinkToken(token).then((identity) => {
        if (identity) {
          setPrefill(identity);
        } else {
          setLinkNotice(t("claim.invalidLink.body"));
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const update = (patch: Partial<ClaimProgress>) => {
    setProgress((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveClaimProgress(next);
      return next;
    });
  };

  if (!progress) return null;

  const onVerified = (v: VerifiedClaimant, enteredNic: string) => {
    setClaimant(v);
    update({ claimant: v, nic: enteredNic, stage: "callInsurer" });
  };

  const onCallInsurerDone = async (location: LocationSnapshot) => {
    if (!claimant) return;
    setCallInsurerError(null);
    setCallInsurerSubmitting(true);
    try {
      update({ insurerCallLocation: location });
      // Wait for the anonymous session for real here — the background
      // sign-in CallInsurerStep kicked off on mount may still be in flight
      // (or may have failed, e.g. Anonymous sign-ins disabled on the
      // project), and getOrCreateCapture needs auth.uid() to actually exist.
      await ensureClaimSession();
      const captureId = await getOrCreateCapture({
        existingCaptureId: progress.captureId,
        createPayload: buildCreatePayload(progress.nic, claimant, location),
      });
      const entry = await captureLocationSnapshot();
      await updateCapture(captureId, {
        guided_capture_started_at: entry.capturedAtIso,
        guided_capture_start_captured_at_display_local: entry.capturedAtDisplayLocal,
        guided_capture_start_gps_lat: entry.latitude,
        guided_capture_start_gps_lng: entry.longitude,
        guided_capture_start_location_permission: entry.locationPermission,
        guided_capture_start_location_label: entry.locationLabel,
      });
      update({ captureId, stage: "guidedCaptureIntro" });
    } catch (err) {
      setCallInsurerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setCallInsurerSubmitting(false);
    }
  };

  const onGuidedIntroNext = () => update({ stage: "guidedCapture" });

  const onPhotoUploaded = (nextPhotoIndex: number) => update({ nextPhotoIndex });

  const onGuidedDone = () => update({ stage: "drivingLicence" });

  const onLicenceDone = async () => {
    if (progress.captureId) {
      const entry = await captureLocationSnapshot();
      await updateCapture(progress.captureId, {
        drunk_test_started_at: entry.capturedAtIso,
        drunk_test_start_captured_at_display_local: entry.capturedAtDisplayLocal,
        drunk_test_start_gps_lat: entry.latitude,
        drunk_test_start_gps_lng: entry.longitude,
        drunk_test_start_location_permission: entry.locationPermission,
        drunk_test_start_location_label: entry.locationLabel,
      });
    }
    update({ stage: "userVerification" });
  };

  const onVideoDone = () => update({ stage: "thirdParty" });

  const onThirdPartyDecision = (applicable: boolean) => {
    update({ thirdPartyApplicable: applicable, stage: applicable ? "thirdParty" : "submit" });
    if (!applicable) void onEnterSubmit();
  };

  const onEnterSubmit = async () => {
    if (!progress.captureId) return;
    const report = await captureLocationSnapshot();
    await updateCapture(progress.captureId, {
      report_captured_at: report.capturedAtIso,
      report_captured_at_display_local: report.capturedAtDisplayLocal,
      report_gps_lat: report.latitude,
      report_gps_lng: report.longitude,
      report_location_label: report.locationLabel,
    });
    update({ stage: "submit" });
  };

  const onThirdPartyDone = () => void onEnterSubmit();

  return (
    <ClaimShell stage={progress.stage}>
      {linkNotice && progress.stage === "verify" && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {linkNotice}
        </p>
      )}

      {progress.stage === "verify" && <VerifyStep prefill={prefill} onVerified={onVerified} />}

      {progress.stage === "callInsurer" && claimant && (
        <CallInsurerStep
          claimant={claimant}
          onDone={(loc) => void onCallInsurerDone(loc)}
          submitting={callInsurerSubmitting}
          error={callInsurerError}
        />
      )}

      {progress.stage === "guidedCaptureIntro" && <GuidedCaptureIntroStep onNext={onGuidedIntroNext} />}

      {progress.stage === "guidedCapture" && progress.captureId && (
        <GuidedCaptureStep
          captureId={progress.captureId}
          startPhotoIndex={progress.nextPhotoIndex}
          resumeUploadedCount={Math.min(progress.nextPhotoIndex, GUIDED_TOTAL)}
          onPhotoUploaded={onPhotoUploaded}
          onAllStopsDone={onGuidedDone}
        />
      )}

      {progress.stage === "drivingLicence" && progress.captureId && (
        <PhotoSlotsStep
          titleKey="claim.licence.title"
          doneBodyKey="claim.licence.bodyDone"
          slots={LICENCE_SLOTS}
          photoSlot="user-verification"
          captureId={progress.captureId}
          startPhotoIndex={Math.max(progress.nextPhotoIndex, LICENCE_START)}
          resumeCount={Math.max(0, Math.min(progress.nextPhotoIndex, LICENCE_START + LICENCE_TOTAL) - LICENCE_START)}
          onPhotoUploaded={onPhotoUploaded}
          onAllDone={() => void onLicenceDone()}
        />
      )}

      {progress.stage === "userVerification" && progress.captureId && (
        <VideoStep
          captureId={progress.captureId}
          photoIndex={Math.max(progress.nextPhotoIndex, VIDEO_START)}
          licenceNumber={progress.claimant?.licenceNumber ?? ""}
          onPhotoUploaded={onPhotoUploaded}
          onDone={onVideoDone}
        />
      )}

      {progress.stage === "thirdParty" && progress.captureId && progress.thirdPartyApplicable === null && (
        <ThirdPartyChoice onChoose={onThirdPartyDecision} />
      )}

      {progress.stage === "thirdParty" && progress.captureId && progress.thirdPartyApplicable === true && (
        <PhotoSlotsStep
          titleKey="claim.thirdParty.title"
          doneBodyKey="claim.thirdParty.bodyDone"
          slots={THIRD_PARTY_SLOTS}
          photoSlot="third-party"
          captureId={progress.captureId}
          startPhotoIndex={Math.max(progress.nextPhotoIndex, THIRD_PARTY_START)}
          resumeCount={Math.max(
            0,
            Math.min(progress.nextPhotoIndex, THIRD_PARTY_START + THIRD_PARTY_TOTAL) - THIRD_PARTY_START
          )}
          onPhotoUploaded={onPhotoUploaded}
          onAllDone={onThirdPartyDone}
        />
      )}

      {progress.stage === "submit" && progress.captureId && (
        <SubmitStep captureId={progress.captureId} onSubmitted={() => update({ stage: "done" })} />
      )}

      {progress.stage === "done" && (
        <p className="text-center text-sm text-muted-foreground">{t("claim.submit.successBody")}</p>
      )}
    </ClaimShell>
  );
}

function ThirdPartyChoice({ onChoose }: { onChoose: (applicable: boolean) => void }) {
  const t = useT();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t("claim.thirdParty.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("claim.thirdParty.body")}</p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => onChoose(false)}
          className="flex-1 rounded-md border border-input px-5 py-3 text-sm font-medium hover:bg-accent"
        >
          {t("claim.thirdParty.notApplicable")}
        </button>
        <button
          type="button"
          onClick={() => onChoose(true)}
          className="flex-1 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          {t("claim.common.continue")}
        </button>
      </div>
    </div>
  );
}
