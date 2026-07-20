import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { loadClaimantProfile, saveClaimantProfile } from '@/features/claimant/storage/claimant-profile-store';
import { loadGuidedCaptureEntryMeta } from '@/features/guided-capture/storage/guided-capture-entry-store';
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

type ClaimantData = { fullName: string; nic: string; licenceNumber: string };

export type UseClaimUploadResult = {
  locationLine: string;
  timestampLine: string;
  locationLoading: boolean;
  photosUploadPercent: number;
  photosUploadComplete: boolean;
  fraudValidationPercent: number;
  fraudValidationComplete: boolean;
};

export function useClaimUpload(
  uploadKey: string | undefined,
  reportedAtIso: string | undefined,
  claimantHydrated: boolean,
  claimantRef: React.MutableRefObject<ClaimantData>
): UseClaimUploadResult {
  const [locationLine, setLocationLine] = useState<string>('Getting location…');
  const [timestampLine, setTimestampLine] = useState<string>('');
  const [locationLoading, setLocationLoading] = useState(true);
  const [photosUploadPercent, setPhotosUploadPercent] = useState(0);
  const [photosUploadComplete, setPhotosUploadComplete] = useState(false);
  const [fraudValidationPercent, setFraudValidationPercent] = useState(0);
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
        // Guards against a second concurrent invocation for the same key (e.g. a duplicate
        // focus event firing while the first pass is still mid-upload) starting a whole
        // second GPS+upload sequence, which would post every photo twice.
        if (uploadKey) {
          if (uploadInFlightForKeyRef.current === uploadKey) {
            return;
          }
          uploadInFlightForKeyRef.current = uploadKey;
        }

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

          setPhotosUploadPercent(0);
          setPhotosUploadComplete(false);
          setFraudValidationPercent(0);
          setFraudValidationComplete(false);
          guidedWalkaroundUploadsDoneRef.current = false;
          fraudValidationMediaUploadsDoneRef.current = false;

          try {
            const [saved, insurerCallMeta, guidedCaptureEntryMeta] = await Promise.all([
              loadClaimantProfile(),
              loadInsurerCallMeta(),
              loadGuidedCaptureEntryMeta(),
            ]);
            const claimant = {
              fullName: (claimantRef.current.fullName || saved.fullName).trim(),
              nic: (claimantRef.current.nic || saved.nic).trim(),
              licenceNumber: (claimantRef.current.licenceNumber || saved.licenceNumber).trim(),
            };
            await saveClaimantProfile(claimant);
            await uploadFullClaimBundleToBackend({
              uploadKey,
              insurerCallMeta,
              guidedCaptureEntryMeta,
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
    }, [uploadKey, claimantHydrated, claimantRef, reportedAtIso])
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
