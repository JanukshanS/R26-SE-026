import { AppState } from 'react-native';
import BackgroundService from 'react-native-background-actions';

import { loadClaimantProfile, saveClaimantProfile } from '@/features/claimant/storage/claimant-profile-store';
import { loadGuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
import { loadDrunkTestEntryMeta } from '@/features/drunk-test/storage/drunk-test-entry-store';
import { loadInsurerCallMeta } from '@/features/insurer-call/storage/insurer-call-store';
import { uploadFullClaimBundleToBackend } from '@/lib/capture-api';
import { clearUploadProgress } from '@/lib/claim-upload-progress-store';
import { getMyUser, getVehicles } from '@/lib/vehicleApi';
import { getVehicleInsurance } from '@/lib/vehicleInsuranceApi';
import {
  resetClaimUploadProgress,
  setClaimUploadFailed,
  setClaimUploadPaused,
  setClaimUploadSucceeded,
  setFraudComplete,
  setFraudProgress,
  setGuidedComplete,
  setGuidedProgress,
} from '@/lib/claim-upload-progress-bus';
import {
  ensureClaimUploadNotificationPermission,
  notifyClaimUploadedSuccessfully,
  notifyClaimUploadFailed,
} from '@/lib/claim-upload-notifications';

type ClaimantData = { fullName: string; nic: string; licenceNumber: string };

/**
 * Everything needed to gather claimant/vehicle metadata and run the upload —
 * deliberately the raw ingredients rather than a pre-resolved payload, so the
 * *whole* sequence (metadata gathering included, not just the file transfer)
 * re-runs as one unit on a pause-retry and is covered by the same
 * paused/failed handling below. No cancel path anywhere in these params —
 * once started, a claim upload can't be cancelled mid-flight (by design).
 */
export type ClaimUploadStartParams = {
  uploadKey: string;
  vehicleId?: string;
  claimant: ClaimantData;
  report: {
    capturedAtIso: string;
    capturedAtDisplayLocal: string;
    gpsLat: number;
    gpsLng: number;
    locationLabel: string;
  };
};

/** Resolves the next time the app returns to the foreground. */
function waitForForeground(): Promise<void> {
  return new Promise((resolve) => {
    if (AppState.currentState === 'active') {
      resolve();
      return;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        subscription.remove();
        resolve();
      }
    });
  });
}

async function gatherAndUpload(params: ClaimUploadStartParams): Promise<void> {
  const [saved, insurerCallMeta, guidedCaptureEntryMeta, drunkTestEntryMeta, vehicles, profileUser] =
    await Promise.all([
      loadClaimantProfile(),
      loadInsurerCallMeta(),
      loadGuidedCaptureEntryMeta(),
      loadDrunkTestEntryMeta(),
      // Guest/unauthenticated sessions get [] back (RLS-filtered), not a thrown
      // error — vehicle stays undefined below and the backend falls back to
      // its own placeholders, same as before this vehicle info existed.
      getVehicles().catch(() => []),
      // The signed-in driver's name/NIC/licence live on their Supabase profile
      // (set via Add Insurer) — that's the real source of truth; the local
      // claimant-profile-store below only exists as a guest-mode fallback.
      getMyUser().catch(() => null),
    ]);
  const claimant = {
    fullName: (profileUser?.name || params.claimant.fullName || saved.fullName).trim(),
    nic: (profileUser?.nicNumber || params.claimant.nic || saved.nic).trim(),
    licenceNumber: (
      profileUser?.licenceNumber ||
      params.claimant.licenceNumber ||
      saved.licenceNumber
    ).trim(),
  };
  await saveClaimantProfile(claimant);
  // Insurer/policy number can differ per vehicle, so they come from the
  // specific vehicle this claim was started for (vehicleId), not a guessed
  // default — otherwise every claim silently attaches to the same vehicle
  // regardless of which one was actually selected for it.
  const targetVehicle = params.vehicleId
    ? vehicles.find((v) => v._id === params.vehicleId) ?? vehicles.find((v) => v.isDefault) ?? vehicles[0]
    : vehicles.find((v) => v.isDefault) ?? vehicles[0];
  // Insurance lives in its own table (vehicle_insurance), not on the vehicle
  // row itself, so the policy number is fetched separately.
  const targetInsurance = targetVehicle ? await getVehicleInsurance(targetVehicle._id).catch(() => null) : null;

  await uploadFullClaimBundleToBackend({
    uploadKey: params.uploadKey,
    insurerCallMeta,
    guidedCaptureEntryMeta,
    drunkTestEntryMeta,
    vehicle: targetVehicle
      ? {
          model: `${targetVehicle.make} ${targetVehicle.model}`.trim(),
          policyNumber: targetInsurance?.insurancePolicyNumber,
          plateNumber: targetVehicle.plateNumber,
          insuranceExpireMonth: targetInsurance?.insuranceExpireMonth,
        }
      : undefined,
    onGuidedProgress: setGuidedProgress,
    onFraudProgress: setFraudProgress,
    onGuidedWalkaroundUploadsComplete: setGuidedComplete,
    onFraudValidationMediaUploadsComplete: setFraudComplete,
    report: params.report,
    claimant,
  });
}

// Guards against calling BackgroundService.start() twice for an overlapping
// attempt — its own docs warn this silently kills the in-flight task and starts
// a new one. Observed in practice: Android can recreate the Activity around a
// running foreground service while repeatedly backgrounding/foregrounding
// during a real upload, which re-runs the upload screen's effect. Without this
// guard that produced a cascade of spurious "failed" notifications before one
// attempt finally completed uninterrupted.
let inFlightPromise: Promise<void> | null = null;

/**
 * Starts (or reattaches to) the claim upload running in a background-actions
 * foreground service. Safe to call from every mount of the upload screen's
 * effect — a second call while one is already running just returns the same
 * in-flight promise instead of restarting anything.
 */
export function startClaimUploadInBackground(params: ClaimUploadStartParams): Promise<void> {
  if (inFlightPromise) {
    return inFlightPromise;
  }
  inFlightPromise = runClaimUpload(params).finally(() => {
    inFlightPromise = null;
  });
  return inFlightPromise;
}

async function runClaimUpload(params: ClaimUploadStartParams): Promise<void> {
  await ensureClaimUploadNotificationPermission();
  resetClaimUploadProgress(params.uploadKey);

  // BackgroundService.start()'s own returned promise resolves once the
  // foreground service has launched — NOT once the task function finishes (its
  // headless task runs independently, invoked by the native side). `done` is a
  // second, manually-settled promise so this function's caller (and therefore
  // the inFlightPromise guard above) can await the whole upload attempt, not
  // just the service starting up.
  let settleDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    settleDone = resolve;
  });

  await BackgroundService.start(
    async () => {
      try {
        // Retries in-place, without ever stopping this foreground service
        // instance, so the persistent notification stays visible the whole
        // time — including through a transient backgrounding-induced abort,
        // not just a flicker of "paused" between two separate service starts.
        for (;;) {
          try {
            await gatherAndUpload(params);
            setClaimUploadSucceeded();
            // Awaited, not fire-and-forget: the moment this task function's
            // promise resolves, react-native-background-actions immediately
            // calls stop() on the foreground service (see its _generateTask
            // source — task(...).then(() => self.stop())). A `void` call here
            // raced that teardown against expo-notifications' native call
            // actually posting the notification, and usually lost — the
            // notification silently never appeared.
            await notifyClaimUploadedSuccessfully();
            return;
          } catch (e) {
            // Distinguishes a real failure from the OS aborting the in-flight
            // request because the app was backgrounded (both surface as an
            // identical thrown error). AppState.currentState is checked here,
            // at the moment of the failure, not cached earlier — the abort can
            // happen well after the upload started.
            if (AppState.currentState !== 'active') {
              setClaimUploadPaused('Upload paused — resuming automatically.');
              await waitForForeground();
              continue;
            }
            if (__DEV__) {
              // The raw error is only useful for debugging — the driver sees a
              // plain-language explanation instead (below).
              console.log('[Claim upload failed]', e);
            }
            // A genuine failure means the in-flight resume state can't be
            // trusted — clear it so a resubmission starts a fresh capture
            // instead of colliding with the failed attempt's leftovers.
            await clearUploadProgress().catch(() => {});
            setClaimUploadFailed(
              'Upload stopped before it finished. Your photos are safe on this device — resubmit the claim to try again.'
            );
            // Awaited — same race as the success path above.
            await notifyClaimUploadFailed();
            return;
          }
        }
      } finally {
        settleDone();
      }
    },
    {
      taskName: 'ClaimUpload',
      taskTitle: 'Claim is uploading',
      taskDesc: "We'll let you know once it's done.",
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      foregroundServiceType: ['dataSync'],
    }
  );

  await done;
}
