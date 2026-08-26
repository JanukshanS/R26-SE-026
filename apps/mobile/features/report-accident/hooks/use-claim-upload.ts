import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking } from 'react-native';

import { getCurrentPositionOrNull } from '@/features/report-accident/get-current-position';
import { loadReportAccidentEntryMeta } from '@/features/report-accident/storage/report-accident-entry-store';
import { startClaimUploadInBackground } from '@/lib/claim-upload-background-runner';
import {
  getPersistedSuccessfulClaimUploadKey,
  loadPersistedClaimLocation,
  savePersistedClaimLocation,
  setPersistedSuccessfulClaimUploadKey,
} from '@/lib/claim-upload-dedupe';
import {
  getClaimUploadProgressSnapshot,
  IDLE_CLAIM_UPLOAD_PROGRESS,
  markClaimUploadAlreadySucceeded,
  subscribeClaimUploadProgress,
} from '@/lib/claim-upload-progress-bus';
import { formatGeocodedLine } from '@/lib/format-geocoded-line';
import { formatTimestamp } from '@/lib/format-timestamp';

type ClaimantData = { fullName: string; nic: string; licenceNumber: string };

export type UseClaimUploadResult = {
  locationLine: string;
  timestampLine: string;
  locationLoading: boolean;
  /** null while the resumed upload's real starting point is still being resolved (show a spinner). */
  photosUploadPercent: number | null;
  photosUploadComplete: boolean;
  /** null while the resumed upload's real starting point is still being resolved (show a spinner). */
  fraudValidationPercent: number | null;
  fraudValidationComplete: boolean;
  /** Set when the upload is stopped and waiting on the driver (location blocked, or a failed
   * attempt). The dialog that raises it is one-shot, so this keeps the same instruction on
   * screen after it's dismissed instead of leaving the progress rows spinning. */
  uploadError: string | null;
  /** True while the "upload failed" dialog should be shown — the caller renders it (e.g. as
   * a ResetCaptureDialog) since this hook has no JSX of its own. */
  uploadFailedVisible: boolean;
  dismissUploadFailed: () => void;
  /** Hides the dialog and re-runs the upload from where it stopped. */
  retryUpload: () => void;
  /** True while the "location required" dialog should be shown — same pattern as
   * uploadFailedVisible: the caller renders the actual dialog (LocationRequiredDialog),
   * this hook only owns the state driving it. */
  locationRequiredVisible: boolean;
  dismissLocationRequired: () => void;
  retryLocation: () => void;
  openLocationSettings: () => void;
};

export function useClaimUpload(
  uploadKey: string | undefined,
  reportedAtIso: string | undefined,
  claimantHydrated: boolean,
  claimantRef: React.MutableRefObject<ClaimantData>,
  /** The vehicle this claim is for (route param, set when the driver picks a vehicle on Home).
   * Without this, every claim silently uploaded against the default/first vehicle regardless
   * of which vehicle was actually selected for that specific claim. */
  vehicleId?: string
): UseClaimUploadResult {
  const [locationLine, setLocationLine] = useState<string>('Getting location…');
  const [timestampLine, setTimestampLine] = useState<string>('');
  const [locationLoading, setLocationLoading] = useState(true);
  /** Set only for the "no GPS location yet" block below — distinct from the shared
   * upload-progress bus's own uploadError (paused/failed), which only exists once an
   * actual background upload attempt has started. Combined into one `uploadError`
   * field in the returned value below, same as before this hook read live progress
   * from a shared store instead of local state. */
  const [locationBlockedError, setLocationBlockedError] = useState<string | null>(null);
  const [locationRequiredVisible, setLocationRequiredVisible] = useState(false);
  /** The "Upload Failed" dialog is one-shot per failure — dismissing it must not
   * un-fail the underlying progress (the inline note stays up), so this is tracked
   * separately from the shared bus's phase rather than folded into it. */
  const [failureDialogDismissed, setFailureDialogDismissed] = useState(false);
  /** Bumped by the "Try again" button on the blocking alerts; re-runs the effect below.
   * Without it the only way back to an upload is leaving the screen and returning. */
  const [retryToken, setRetryToken] = useState(0);

  // Live progress for the currently-running (or just-finished) claim upload — a
  // module-level store, not local state, because the actual upload runs in a
  // react-native-background-actions foreground service independent of whether this
  // screen/hook instance is even mounted (see claim-upload-background-runner.ts).
  // Reopening the app after backgrounding remounts a fresh hook instance that must
  // immediately reflect whatever the still-running background task has already
  // achieved, not reset to a spinner.
  const rawProgress = useSyncExternalStore(subscribeClaimUploadProgress, getClaimUploadProgressSnapshot);
  // Guards against a stale state from a *different* claim's upload (e.g. a lingering
  // 'failed' from before Start New Claim) bleeding into this screen's display.
  const progress = rawProgress.uploadKey === uploadKey ? rawProgress : IDLE_CLAIM_UPLOAD_PROGRESS;

  useEffect(() => {
    if (progress.phase === 'failed') {
      setFailureDialogDismissed(false);
    }
  }, [progress.phase]);

  /** Guards against a second concurrent run for the same key (e.g. a duplicate focus
   * event firing mid-upload) starting a whole second GPS-resolution pass. The actual
   * upload call itself is separately guarded inside startClaimUploadInBackground. */
  const uploadInFlightForKeyRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!claimantHydrated) {
        return () => {};
      }
      let cancelled = false;
      setLocationLoading(true);
      setLocationLine('Getting location…');
      setTimestampLine('');

      const clearInFlight = () => {
        if (uploadInFlightForKeyRef.current === uploadKey) {
          uploadInFlightForKeyRef.current = null;
        }
      };

      void (async () => {
        // No uploadKey means there's nothing to upload or resume — e.g. viewing an
        // already-completed claim fetched from the server (see upload-accident-details.tsx's
        // existingClaimId mode). Every other call site of this hook always has one; bail
        // out before touching GPS/location state at all rather than fetching a location
        // nobody asked for.
        if (!uploadKey) {
          if (!cancelled) {
            setLocationLoading(false);
          }
          return;
        }

        // Guards against a second concurrent invocation for the same key (e.g. a duplicate
        // focus event firing while the first pass is still mid-upload) starting a whole
        // second GPS+upload sequence, which would post every photo twice.
        if (uploadInFlightForKeyRef.current === uploadKey) {
          return;
        }
        uploadInFlightForKeyRef.current = uploadKey;
        if (!cancelled) {
          setLocationBlockedError(null);
        }

        const parsed = reportedAtIso ? new Date(reportedAtIso) : null;
        const recordedAt = parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();

        // Once a claim has been successfully submitted from this device, it stays locked —
        // deleting/retaking individual photos afterward must NOT trigger a fresh re-upload.
        // (Deliberately not comparing against the current uploadKey: retaken photos get new
        // file URIs, which would change the key and defeat this lock. Starting over for real
        // requires an explicit Reset / Start New Claim, which clears the persisted success key.)
        const alreadySucceededThisSession =
          getClaimUploadProgressSnapshot().uploadKey === uploadKey &&
          getClaimUploadProgressSnapshot().phase === 'succeeded';
        const persistedSuccessKey = alreadySucceededThisSession
          ? null
          : await getPersistedSuccessfulClaimUploadKey();
        if (!cancelled && (alreadySucceededThisSession || persistedSuccessKey != null)) {
          if (!alreadySucceededThisSession) {
            markClaimUploadAlreadySucceeded(uploadKey);
          }
          const saved = await loadPersistedClaimLocation();
          if (!cancelled) {
            if (saved) {
              setLocationLine(saved.locationLine);
              setTimestampLine(saved.timestampLine);
            }
            setLocationLoading(false);
          }
          clearInFlight();
          return;
        }

        {
          let lat: number | null = null;
          let lng: number | null = null;
          let line = 'Getting location…';

          const persistedEntryMeta = await loadReportAccidentEntryMeta();
          if (!cancelled && persistedEntryMeta?.latitude != null && persistedEntryMeta?.longitude != null) {
            lat = persistedEntryMeta.latitude;
            lng = persistedEntryMeta.longitude;
            line = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            try {
              const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
              if (geo && !cancelled) line = formatGeocodedLine(geo);
            } catch {
              // keep coordinates
            }
            if (!cancelled) {
              setLocationLine(line);
              setTimestampLine(formatTimestamp(recordedAt));
              setLocationLoading(false);
            }
          } else {
            try {
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (cancelled) return;
              if (status !== 'granted') {
                line = 'Location permission not granted';
                if (!cancelled) {
                  setLocationLine(line);
                  setTimestampLine(formatTimestamp(recordedAt));
                }
              } else {
                const pos = await getCurrentPositionOrNull();
                if (cancelled) return;
                if (!pos) {
                  line = 'Could not read location';
                  setLocationLine(line);
                  setTimestampLine(formatTimestamp(recordedAt));
                } else {
                  lat = pos.coords.latitude;
                  lng = pos.coords.longitude;
                  line = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                  try {
                    const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
                    if (geo && !cancelled) line = formatGeocodedLine(geo);
                  } catch {
                    // keep coordinates
                  }
                  if (!cancelled) {
                    setLocationLine(line);
                    setTimestampLine(formatTimestamp(recordedAt));
                  }
                }
              }
            } catch {
              if (!cancelled) {
                line = 'Could not read location';
                setLocationLine(line);
                setTimestampLine(formatTimestamp(recordedAt));
              }
            } finally {
              if (!cancelled) setLocationLoading(false);
            }
          }

          if (cancelled || !uploadKey) {
            clearInFlight();
            return;
          }

          // Block upload if GPS location was not obtained. (Checking both, not just
          // lat, also narrows lng's type below — the two are always set together in
          // every branch above.)
          if (lat === null || lng === null) {
            setLocationBlockedError(
              'Nothing has been sent yet — your claim needs the accident location. Turn on location access for this app, then come back to this screen to retry.'
            );
            setLocationRequiredVisible(true);
            clearInFlight();
            return;
          }

          // The actual upload runs in a background-actions foreground service (see
          // claim-upload-background-runner.ts), independent of this effect/screen's
          // lifecycle — fire-and-forget, not awaited, so backgrounding or navigating
          // away from this screen can never interrupt it. Live progress is read back
          // via the shared bus (useSyncExternalStore above), not these callbacks.
          void startClaimUploadInBackground({
            uploadKey,
            vehicleId,
            claimant: { ...claimantRef.current },
            report: {
              capturedAtIso: recordedAt.toISOString(),
              capturedAtDisplayLocal: formatTimestamp(recordedAt),
              gpsLat: lat,
              gpsLng: lng,
              locationLabel: line,
            },
          })
            .then(() => {
              if (cancelled) return;
              const snap = getClaimUploadProgressSnapshot();
              // Only persist success bookkeeping once the whole attempt (across any
              // internal pause/retry loop inside the runner) has genuinely finished
              // successfully — a 'failed' settlement already cleared its own state.
              if (snap.uploadKey === uploadKey && snap.phase === 'succeeded') {
                void setPersistedSuccessfulClaimUploadKey(uploadKey);
                // Best-effort: a storage failure here must not flip the upload into an error state.
                void savePersistedClaimLocation({
                  locationLine: line,
                  timestampLine: formatTimestamp(recordedAt),
                }).catch(() => {});
              }
            })
            .finally(clearInFlight);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [uploadKey, claimantHydrated, claimantRef, reportedAtIso, vehicleId, retryToken])
  );

  const dismissUploadFailed = useCallback(() => setFailureDialogDismissed(true), []);
  const retryUpload = useCallback(() => {
    setFailureDialogDismissed(true);
    setRetryToken((n) => n + 1);
  }, []);

  const dismissLocationRequired = useCallback(() => setLocationRequiredVisible(false), []);
  const retryLocation = useCallback(() => {
    setLocationRequiredVisible(false);
    setRetryToken((n) => n + 1);
  }, []);
  const openLocationSettings = useCallback(() => {
    setLocationRequiredVisible(false);
    // Returning from Settings fires no focus event here, so queue the re-run now:
    // it re-prompts with "Try again" ready when they come back.
    setRetryToken((n) => n + 1);
    void Linking.openSettings();
  }, []);

  // "Blocked on missing GPS" shows a static 0%, not the shared bus's null/idle
  // default (which the UI reads as "still resolving" and shows a spinner for) —
  // nothing is uploading while this is blocked, and a spinner here would read as
  // work in progress.
  const photosUploadPercent = locationBlockedError ? 0 : progress.photosUploadPercent;
  const fraudValidationPercent = locationBlockedError ? 0 : progress.fraudValidationPercent;

  return {
    locationLine,
    timestampLine,
    locationLoading,
    photosUploadPercent,
    photosUploadComplete: progress.photosUploadComplete,
    fraudValidationPercent,
    fraudValidationComplete: progress.fraudValidationComplete,
    uploadError: locationBlockedError ?? progress.uploadError,
    uploadFailedVisible: progress.phase === 'failed' && !failureDialogDismissed,
    dismissUploadFailed,
    retryUpload,
    locationRequiredVisible,
    dismissLocationRequired,
    retryLocation,
    openLocationSettings,
  };
}
