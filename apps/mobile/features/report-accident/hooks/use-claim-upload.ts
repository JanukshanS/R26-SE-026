import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { loadClaimantProfile, saveClaimantProfile } from '@/features/claimant/storage/claimant-profile-store';
import { loadGuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
import { loadDrunkTestEntryMeta } from '@/features/drunk-test/storage/drunk-test-entry-store';
import { loadInsurerCallMeta } from '@/features/insurer-call/storage/insurer-call-store';
import { loadReportAccidentEntryMeta } from '@/features/report-accident/storage/report-accident-entry-store';
import { uploadFullClaimBundleToBackend } from '@/lib/capture-api';
import {
  getPersistedSuccessfulClaimUploadKey,
  loadPersistedClaimLocation,
  savePersistedClaimLocation,
  setPersistedSuccessfulClaimUploadKey,
} from '@/lib/claim-upload-dedupe';
import { formatGeocodedLine } from '@/lib/format-geocoded-line';
import { formatTimestamp } from '@/lib/format-timestamp';
import { getMyUser, getVehicles } from '@/lib/vehicleApi';
import { getVehicleInsurance } from '@/lib/vehicleInsuranceApi';

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
  const [photosUploadPercent, setPhotosUploadPercent] = useState<number | null>(null);
  const [photosUploadComplete, setPhotosUploadComplete] = useState(false);
  const [fraudValidationPercent, setFraudValidationPercent] = useState<number | null>(null);
  const [fraudValidationComplete, setFraudValidationComplete] = useState(false);

  const photosUploadedForKeyRef = useRef<string | null>(null);
  const guidedWalkaroundUploadsDoneRef = useRef(false);
  const fraudValidationMediaUploadsDoneRef = useRef(false);
  /** Guards against a second concurrent run for the same key (e.g. a duplicate focus event
   * firing mid-upload) — unlike photosUploadedForKeyRef, this is set before the upload starts. */
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

        try {
          const parsed = reportedAtIso ? new Date(reportedAtIso) : null;
          const recordedAt = parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();

          // Once a claim has been successfully submitted from this device, it stays locked —
          // deleting/retaking individual photos afterward must NOT trigger a fresh re-upload.
          // (Deliberately not comparing against the current uploadKey: retaken photos get new
          // file URIs, which would change the key and defeat this lock. Starting over for real
          // requires an explicit Reset / Start New Claim, which clears the persisted success key.)
          if (uploadKey) {
            const persistedSuccessKey = await getPersistedSuccessfulClaimUploadKey();
            if (!cancelled && persistedSuccessKey != null) {
              photosUploadedForKeyRef.current = uploadKey;
              setPhotosUploadPercent(100);
              setPhotosUploadComplete(true);
              setFraudValidationPercent(100);
              setFraudValidationComplete(true);
              const saved = await loadPersistedClaimLocation();
              if (!cancelled) {
                if (saved) {
                  setLocationLine(saved.locationLine);
                  setTimestampLine(saved.timestampLine);
                }
                setLocationLoading(false);
              }
              return;
            }
            if (!cancelled && photosUploadedForKeyRef.current != null) {
              setPhotosUploadPercent(100);
              setPhotosUploadComplete(true);
              setFraudValidationPercent(100);
              setFraudValidationComplete(true);
              const saved = await loadPersistedClaimLocation();
              if (!cancelled) {
                if (saved) {
                  setLocationLine(saved.locationLine);
                  setTimestampLine(saved.timestampLine);
                }
                setLocationLoading(false);
              }
              return;
            }
          }

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
                const pos = await Location.getCurrentPositionAsync({
                  accuracy: Location.Accuracy.Balanced,
                });
                if (cancelled) return;
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

          if (cancelled || !uploadKey) return;

          // Block upload if GPS location was not obtained.
          if (lat === null) {
            Alert.alert(
              'Location required',
              'We could not get your GPS location. Please enable location access and try again.',
              [{ text: 'OK' }]
            );
            return;
          }

          // null (not 0) — the real resumed starting point isn't known yet until
          // uploadFullClaimBundleToBackend resolves the capture session; the UI shows a
          // spinner in the meantime instead of a misleading "0%".
          setPhotosUploadPercent(null);
          setPhotosUploadComplete(false);
          setFraudValidationPercent(null);
          setFraudValidationComplete(false);
          guidedWalkaroundUploadsDoneRef.current = false;
          fraudValidationMediaUploadsDoneRef.current = false;

          try {
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
                // claimant-profile-store below only exists as a guest-mode fallback
                // (there's no in-app form that ever writes to it directly).
                getMyUser().catch(() => null),
              ]);
            const claimant = {
              fullName: (profileUser?.name || claimantRef.current.fullName || saved.fullName).trim(),
              nic: (profileUser?.nicNumber || claimantRef.current.nic || saved.nic).trim(),
              licenceNumber: (
                profileUser?.licenceNumber ||
                claimantRef.current.licenceNumber ||
                saved.licenceNumber
              ).trim(),
            };
            await saveClaimantProfile(claimant);
            // Insurer/policy number can differ per vehicle, so they come from the
            // specific vehicle this claim was started for (vehicleId), not a guessed
            // default — otherwise every claim silently attaches to the same vehicle
            // regardless of which one was actually selected for it.
            const targetVehicle = vehicleId
              ? vehicles.find((v) => v._id === vehicleId) ?? vehicles.find((v) => v.isDefault) ?? vehicles[0]
              : vehicles.find((v) => v.isDefault) ?? vehicles[0];
            // Insurance lives in its own table (vehicle_insurance), not on the vehicle
            // row itself, so the policy number is fetched separately.
            const targetInsurance = targetVehicle
              ? await getVehicleInsurance(targetVehicle._id).catch(() => null)
              : null;
            await uploadFullClaimBundleToBackend({
              uploadKey,
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
              onGuidedProgress: (p) => { if (!cancelled) setPhotosUploadPercent(p); },
              onFraudProgress: (p) => { if (!cancelled) setFraudValidationPercent(p); },
              onGuidedWalkaroundUploadsComplete: () => {
                if (!cancelled) {
                  guidedWalkaroundUploadsDoneRef.current = true;
                  setPhotosUploadPercent(100);
                  setPhotosUploadComplete(true);
                }
              },
              onFraudValidationMediaUploadsComplete: () => {
                if (!cancelled) {
                  fraudValidationMediaUploadsDoneRef.current = true;
                  setFraudValidationPercent(100);
                  setFraudValidationComplete(true);
                }
              },
              report: {
                capturedAtIso: recordedAt.toISOString(),
                capturedAtDisplayLocal: formatTimestamp(recordedAt),
                gpsLat: lat,
                gpsLng: lng,
                locationLabel: line,
              },
              claimant: {
                fullName: claimant.fullName,
                nic: claimant.nic,
                licenceNumber: claimant.licenceNumber,
              },
            });
            if (!cancelled) {
              photosUploadedForKeyRef.current = uploadKey;
              await setPersistedSuccessfulClaimUploadKey(uploadKey);
              // Best-effort: a storage failure here must not flip the upload into an error state.
              await savePersistedClaimLocation({ locationLine: line, timestampLine: formatTimestamp(recordedAt) }).catch(() => {});
            }
          } catch (e) {
            if (!cancelled) {
              const message = e instanceof Error ? e.message : 'Upload failed';
              if (!guidedWalkaroundUploadsDoneRef.current) {
                setPhotosUploadPercent(0);
                setPhotosUploadComplete(false);
              }
              if (!fraudValidationMediaUploadsDoneRef.current) {
                setFraudValidationPercent(0);
                setFraudValidationComplete(false);
              }
              Alert.alert('Photos upload failed', message);
            }
          }
        } finally {
          if (uploadKey && uploadInFlightForKeyRef.current === uploadKey) {
            uploadInFlightForKeyRef.current = null;
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [uploadKey, claimantHydrated, claimantRef, reportedAtIso, vehicleId])
  );

  return {
    locationLine,
    timestampLine,
    locationLoading,
    photosUploadPercent,
    photosUploadComplete,
    fraudValidationPercent,
    fraudValidationComplete,
  };
}
