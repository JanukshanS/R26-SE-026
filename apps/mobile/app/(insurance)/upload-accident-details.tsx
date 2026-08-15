import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsuranceBottomTabBar, type InsuranceTabId } from '@/components/insurance-bottom-tab-bar';
import {
  findInsuranceCompany,
  getCachedInsuranceCompany,
  type InsuranceCompany,
} from '@/lib/insuranceCompaniesApi';
import { getCachedVehicles, getVehicles } from '@/lib/vehicleApi';
import { getCachedVehicleInsurance, getVehicleInsurance } from '@/lib/vehicleInsuranceApi';
import { loadSelectedVehicleId } from '@/lib/selected-vehicle-store';
import { loadClaimantProfile } from '@/features/claimant/storage/claimant-profile-store';
import { useClaimUpload } from '@/features/report-accident/hooks/use-claim-upload';
import { getCachedClaims, listMyClaims, type ClaimSummary } from '@/lib/claims-api';
import { formatTimestamp } from '@/lib/format-timestamp';
import { clearAllClaimData } from '@/lib/clear-claim-data';
import { saveDismissedClaimId } from '@/lib/claim-upload-dedupe';
import { ResetCaptureDialog } from '@/features/guided-capture/components/reset-capture-dialog';
import {
  INSURANCE_BORDER_SOFT,
  INSURANCE_CARD_BORDER_ACCENT,
  INSURANCE_PRESSED_SURFACE,
  INSURANCE_PRESSED_SURFACE_SOFT,
  INSURANCE_PROGRESS_DONE,
  INSURANCE_TEXT,
  INSURANCE_TEXT_MUTED_SOFT,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

const COLORS = {
  screen: WHITE,
  text: INSURANCE_TEXT,
  textMuted: INSURANCE_TEXT_MUTED_SOFT,
  border: INSURANCE_BORDER_SOFT,
  success: INSURANCE_PROGRESS_DONE,
  cardBorder: INSURANCE_CARD_BORDER_ACCENT,
};

function ProgressRow({
  label,
  percent,
  complete,
}: {
  label: string;
  /** null while the real starting point (e.g. after resuming) is still being resolved. */
  percent: number | null;
  complete: boolean;
}) {
  const resolving = !complete && percent == null;
  const pct = complete ? 100 : Math.max(0, Math.min(100, Math.round(percent ?? 0)));
  const showDone = complete;
  return (
    <View style={styles.progressRow}>
      <View style={styles.progressRowLeft}>
        <Ionicons
          name={showDone ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={showDone ? COLORS.success : COLORS.textMuted}
          style={styles.progressIcon}
        />
        <Text style={styles.progressLabel}>{label}</Text>
      </View>
      {resolving ? (
        <ActivityIndicator size="small" color={COLORS.textMuted} style={styles.progressSpinner} />
      ) : (
        <Text style={[styles.progressPercent, !showDone && styles.progressPercentPending]}>
          {showDone ? '100%' : `${pct}%`}
        </Text>
      )}
    </View>
  );
}

/** Cache-only resolution of a claim's insurer — claim → cached vehicles (matched by
 * plate number, since this claim came from a per-user lookup, not per-vehicle, so it
 * isn't necessarily the currently-selected vehicle) → cached vehicle_insurance →
 * cached company. Returns null the moment any step isn't warm yet, so the caller
 * knows to fall back to the async resolution instead of showing a wrong/empty state. */
function resolveInsurerFromCacheSync(
  claim: ClaimSummary | null
): { company: InsuranceCompany | null; missing: boolean } | null {
  if (!claim?.vehicleRegNo) {
    return null;
  }
  const vehicles = getCachedVehicles();
  if (!vehicles) {
    return null;
  }
  const plate = claim.vehicleRegNo.trim().toLowerCase();
  const match = vehicles.find((v) => v.plateNumber.trim().toLowerCase() === plate);
  if (!match) {
    return null;
  }
  const insurance = getCachedVehicleInsurance(match._id);
  if (insurance === undefined) {
    return null;
  }
  if (!insurance?.insuranceProvider) {
    return { company: null, missing: true };
  }
  const company = getCachedInsuranceCompany(insurance.insuranceProvider);
  if (company === undefined) {
    return null;
  }
  return { company, missing: false };
}

export default function UploadAccidentDetailsScreen() {
  const router = useRouter();
  const { uploadKey, reportedAtIso, vehicleId, existingClaimId } = useLocalSearchParams<{
    uploadKey?: string;
    reportedAtIso?: string;
    vehicleId?: string;
    /** Set instead of uploadKey when Home found an already-finished claim on the
     * server and sent the driver straight here — nothing to upload, just display it. */
    existingClaimId?: string;
  }>();

  const [claimantName, setClaimantName] = useState('');
  const [claimantNic, setClaimantNic] = useState('');
  const [claimantLicence, setClaimantLicence] = useState('');
  const [claimantHydrated, setClaimantHydrated] = useState(false);
  const claimantRef = useRef({ fullName: '', nic: '', licenceNumber: '' });

  useLayoutEffect(() => {
    claimantRef.current = {
      fullName: claimantName,
      nic: claimantNic,
      licenceNumber: claimantLicence,
    };
  }, [claimantName, claimantNic, claimantLicence]);

  useEffect(() => {
    let cancelled = false;
    void loadClaimantProfile().then((p) => {
      if (cancelled) return;
      setClaimantName(p.fullName);
      setClaimantNic(p.nic);
      setClaimantLicence(p.licenceNumber);
      setClaimantHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The vehicleId route param is a one-time snapshot from whenever this screen was pushed
  // (from (insurance)/index.tsx's Report Accident, Home's incomplete-upload resume, or the
  // reminder modal). If the driver switched vehicles on Home since then, that snapshot is
  // stale — the persisted store (updated live by selectVehicle) takes precedence, refreshed
  // every focus, so the upload always targets the vehicle actually selected right now.
  const [effectiveVehicleId, setEffectiveVehicleId] = useState<string | undefined>(vehicleId);

  const {
    locationLine,
    timestampLine,
    locationLoading,
    photosUploadPercent,
    photosUploadComplete,
    fraudValidationPercent,
    fraudValidationComplete,
  } = useClaimUpload(uploadKey, reportedAtIso, claimantHydrated, claimantRef, effectiveVehicleId);

  // existingClaimId mode: nothing local to show progress for — the claim already
  // finished, possibly in an earlier session or on another device. Fetched from the
  // server (the same claims-privacy record, not local files) instead of run through
  // the upload hook above, which is why uploadKey is absent in this mode.
  //
  // Seeded synchronously from claims-api's cache (warmed at login, and by Home's own
  // check right before it navigated here) so the common case shows the real location
  // and timestamp on the very first render — no loading flash. Still confirmed with a
  // fresh fetch below in case the cache is stale or wasn't warm yet.
  const [existingClaim, setExistingClaim] = useState<ClaimSummary | null>(() => {
    if (!existingClaimId) return null;
    return getCachedClaims()?.find((c) => c.id === existingClaimId) ?? null;
  });
  const [loadingExistingClaim, setLoadingExistingClaim] = useState(
    () => existingClaimId != null && existingClaim == null
  );

  useEffect(() => {
    if (!existingClaimId) {
      return;
    }
    let cancelled = false;
    listMyClaims()
      .then((claims) => {
        if (!cancelled) {
          setExistingClaim(claims.find((c) => c.id === existingClaimId) ?? null);
        }
      })
      .catch(() => {
        // Best-effort refresh — keep whatever the cache already seeded above.
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingExistingClaim(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [existingClaimId]);

  const isExistingClaimMode = existingClaimId != null;
  const displayLocationLine = isExistingClaimMode
    ? existingClaim?.locationLabel ?? '—'
    : locationLine;
  const displayTimestampLine = isExistingClaimMode
    ? existingClaim?.capturedAtDisplayLocal ?? ''
    : timestampLine;
  const displayLocationLoading = isExistingClaimMode ? loadingExistingClaim : locationLoading;
  const displayPhotosUploadPercent = isExistingClaimMode ? 100 : photosUploadPercent;
  const displayPhotosUploadComplete = isExistingClaimMode ? true : photosUploadComplete;
  const displayFraudValidationPercent = isExistingClaimMode ? 100 : fraudValidationPercent;
  const displayFraudValidationComplete = isExistingClaimMode ? true : fraudValidationComplete;
  // Set server-side once the Insurer Dashboard's 3D pipeline finishes (captures.status
  // -> "pending_review"). No interim progress is reported back to this app — it's a
  // binary flip once the whole pipeline (low-light enhancement + reconstruction) is done.
  const displayLowLightComplete =
    existingClaim?.status === 'pending_review' || existingClaim?.status === 'approved';
  const displayLowLightPercent = displayLowLightComplete ? 100 : 0;
  const display3DReconstructionComplete =
    existingClaim?.status === 'pending_review' || existingClaim?.status === 'approved';
  const display3DReconstructionPercent = display3DReconstructionComplete ? 100 : 0;

  const claimComplete = isExistingClaimMode
    ? true
    : photosUploadComplete && fraudValidationComplete;

  // Existing-claim mode: try to resolve the insurer synchronously from cache (claim →
  // cached vehicles, matched by plate number → cached vehicle_insurance → cached
  // company) so the button shows correctly on the very first render instead of a
  // spinner. Returns null if any step isn't cached yet — the focus effect below
  // always still runs afterward to confirm/fill in whatever this couldn't resolve.
  const seededInsurer = isExistingClaimMode ? resolveInsurerFromCacheSync(existingClaim) : null;
  const [insuranceCompany, setInsuranceCompany] = useState<InsuranceCompany | null>(
    seededInsurer?.company ?? null
  );
  const [vehicleMissingInsurer, setVehicleMissingInsurer] = useState(seededInsurer?.missing ?? false);
  // True until the insurer lookup below finishes at least once — shows a spinner in
  // the button's place instead of a blank gap while it resolves.
  const [resolvingInsurer, setResolvingInsurer] = useState(
    isExistingClaimMode ? seededInsurer == null : true
  );
  const [callingInsurer, setCallingInsurer] = useState(false);
  const [confirmingNewClaim, setConfirmingNewClaim] = useState(false);

  // Same as (insurance)/index.tsx: this screen sits outside VehicleProvider, so the SPECIFIC
  // vehicle the driver had selected on Home is fetched directly rather than read from context.
  // Falls back to the default/first vehicle only when neither the store nor the route param
  // has a vehicleId.
  //
  // existingClaimId mode is different: the claim is historical and already tied to a
  // specific vehicle regardless of what's selected *now* (this claim came from a
  // per-user lookup, not per-vehicle, so "currently selected" can easily be a
  // different vehicle entirely). Resolve it by matching the claim's own plate number
  // instead — never the persisted/selected vehicle.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (existingClaimId && loadingExistingClaim) {
          // Wait for the claim record itself first; this effect re-runs once that
          // flips (see the dependency array below), so this isn't a dead end.
          return;
        }
        if (!cancelled) {
          setResolvingInsurer(true);
        }
        try {
          let targetVehicleId: string | null;

          if (existingClaimId) {
            targetVehicleId = null;
            const plate = existingClaim?.vehicleRegNo?.trim().toLowerCase();
            if (plate) {
              const vehicles = await getVehicles();
              const match = vehicles.find((v) => v.plateNumber.trim().toLowerCase() === plate);
              targetVehicleId = match?._id ?? null;
            }
          } else {
            const persistedId = await loadSelectedVehicleId();
            const resolvedVehicleId = persistedId ?? vehicleId;
            if (!cancelled) {
              setEffectiveVehicleId(resolvedVehicleId);
            }
            // getVehicleById() isn't needed just to get an id we already have —
            // getVehicleInsurance() takes the vehicle id directly, cutting one full
            // network round trip off this chain.
            targetVehicleId = resolvedVehicleId ?? null;
            if (!targetVehicleId) {
              const vehicles = await getVehicles();
              const target = vehicles.find((v) => v.isDefault) ?? vehicles[0] ?? null;
              targetVehicleId = target?._id ?? null;
            }
          }

          if (!targetVehicleId) {
            if (!cancelled) {
              setInsuranceCompany(null);
              setVehicleMissingInsurer(false);
            }
            return;
          }
          const insurance = await getVehicleInsurance(targetVehicleId);
          if (!insurance?.insuranceProvider) {
            if (!cancelled) {
              setInsuranceCompany(null);
              setVehicleMissingInsurer(true);
            }
            return;
          }
          const company = await findInsuranceCompany(insurance.insuranceProvider);
          if (!cancelled) {
            setInsuranceCompany(company);
            setVehicleMissingInsurer(false);
          }
        } catch {
          if (!cancelled) {
            setInsuranceCompany(null);
            setVehicleMissingInsurer(false);
          }
        } finally {
          if (!cancelled) {
            setResolvingInsurer(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [vehicleId, existingClaimId, existingClaim, loadingExistingClaim])
  );

  const onCallInsurer = async () => {
    if (!insuranceCompany || callingInsurer) {
      return;
    }
    setCallingInsurer(true);
    try {
      await Linking.openURL(insuranceCompany.phoneTel);
    } catch {
      Alert.alert('Call your insurer', 'Use the phone number on your insurance card or policy document.');
    } finally {
      setCallingInsurer(false);
    }
  };

  const performStartNewClaim = async () => {
    // Record which claim is being dismissed *before* wiping local data, so Home's
    // Insurance button knows not to redirect back to its submitted view even though
    // the server won't have a newer claim until this new one is actually submitted.
    // Re-fetched fresh (not read from cache) so this is correct even if a claim just
    // finished uploading moments ago in this same screen session.
    try {
      const claims = await listMyClaims().catch(() => null);
      const latestId = existingClaimId ?? claims?.[0]?.id ?? null;
      if (latestId) {
        await saveDismissedClaimId(latestId);
      }
    } catch {
      // best-effort — worst case the old redirect bug resurfaces once, not fatal
    }
    try {
      await clearAllClaimData();
    } catch {
      // best-effort — navigate even if cleanup partially fails
    }
    // dismissTo, not replace — returns to the existing Insurance screen instead of
    // stacking a new duplicate on top of it (same fix as the 4 step-completion screens).
    router.dismissTo(
      effectiveVehicleId
        ? { pathname: '/(insurance)', params: { vehicleId: effectiveVehicleId } }
        : '/(insurance)'
    );
  };

  const onStartNewClaim = () => {
    setConfirmingNewClaim(true);
  };

  const onTabPress = (tab: InsuranceTabId) => {
    if (tab === 'home') {
      router.dismissTo('/(insurance)');
      return;
    }
    Alert.alert('Coming soon', 'This section will be added in a future update.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.shell}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color={COLORS.text} />
            <Text style={styles.headerBackText}>Report Accident</Text>
          </Pressable>

          <Text style={styles.pageTitle}>Upload Accident Details</Text>

          <View style={styles.progressBlock}>
            <ProgressRow
              label="Photos Uploaded"
              percent={displayPhotosUploadPercent}
              complete={displayPhotosUploadComplete}
            />
            <ProgressRow
              label="Fraud Validation"
              percent={displayFraudValidationPercent}
              complete={displayFraudValidationComplete}
            />
            <ProgressRow
              label="Low light enhancement"
              percent={displayLowLightPercent}
              complete={displayLowLightComplete}
            />
            <ProgressRow
              label="3D Reconstruction"
              percent={display3DReconstructionPercent}
              complete={display3DReconstructionComplete}
            />
          </View>

          <View style={styles.detailCard}>
            <View style={styles.detailCardHeader}>
              <Text style={styles.detailCardHeaderLeft}>
                {existingClaim?.status === 'approved' ? 'Approved' : 'Captured and Submitted'}
              </Text>
            </View>
            <View style={styles.detailLocationRow}>
              {displayLocationLoading ? (
                <ActivityIndicator size="small" color={COLORS.textMuted} style={styles.detailSpinner} />
              ) : null}
              <Text style={styles.detailAddress}>{displayLocationLine}</Text>
            </View>
            <Text style={styles.detailTime}>
              {displayTimestampLine || (displayLocationLoading ? '…' : formatTimestamp(new Date()))}
            </Text>
            <Text style={styles.detailFooter}>
              {existingClaim?.status === 'approved'
                ? 'Your claim has been Approved'
                : existingClaim?.status === 'pending_review'
                ? 'The review process will take 1 - 2 working days'
                : existingClaim?.status === 'processing'
                ? "Your claim has been submitted. We're validating your photos and generating your 3D report — you'll be notified once it's ready for review."
                : "GPS + Timestamp signed. Do not close the app and Do not disconnect from Internet. We'll notify you."}
            </Text>
          </View>

          <Pressable style={({ pressed }) => [styles.insuranceRowBtn, pressed && styles.insuranceRowPressed]}>
            <Text style={styles.insuranceRowLabel}>Insurance</Text>
            <Text style={styles.insuranceRowStatus}>Pending</Text>
          </Pressable>

          {resolvingInsurer ? (
            <View style={[styles.callInsurerBtn, styles.callInsurerCalling]}>
              <ActivityIndicator size="small" color={COLORS.text} />
            </View>
          ) : insuranceCompany ? (
            <Pressable
              disabled={callingInsurer}
              style={({ pressed }) => [
                styles.callInsurerBtn,
                pressed && styles.callInsurerPressed,
                callingInsurer && styles.callInsurerCalling,
              ]}
              onPress={onCallInsurer}>
              {callingInsurer ? (
                <ActivityIndicator size="small" color={COLORS.text} />
              ) : (
                <Text style={styles.callInsurerText}>{`Need to call ${insuranceCompany.appName}?`}</Text>
              )}
            </Pressable>
          ) : vehicleMissingInsurer ? (
            <View style={styles.noInsurerHint}>
              <Text style={styles.noInsurerHintText}>
                No insurance company saved for this vehicle. Add it in My Vehicles → Edit → Add
                insurance company → Save changes.
              </Text>
            </View>
          ) : null}

          {claimComplete && (
            <Pressable
              style={({ pressed }) => [styles.callInsurerBtn, styles.newClaimBtnMargin, pressed && styles.callInsurerPressed]}
              onPress={onStartNewClaim}
              accessibilityRole="button"
              accessibilityLabel="Start a new claim">
              <Text style={styles.callInsurerText}>Start New Claim</Text>
            </Pressable>
          )}
        </ScrollView>

        <InsuranceBottomTabBar onTabPress={onTabPress} />
      </View>

      <ResetCaptureDialog
        visible={confirmingNewClaim}
        onCancel={() => setConfirmingNewClaim(false)}
        onConfirm={() => {
          setConfirmingNewClaim(false);
          void performStartNewClaim();
        }}
        title="Start New Claim?"
        message="This clears your current claim progress — photos, videos and answers — so you can begin a fresh one."
        icon="RotateCcw"
        confirmLabel="Start New Claim"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.screen,
  },
  shell: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 30,
    paddingBottom: 16,
  },
  headerBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 31,
    marginBottom: 20,
    paddingTop: 20,
    paddingBottom: 4,
    alignSelf: 'flex-start',
  },
  headerBackText: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.text,
  },
  pressed: {
    opacity: 0.65,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 25,
  },
  progressBlock: {
    marginBottom: 20,
    gap: 16,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  progressIcon: {
    marginRight: 10,
  },
  progressLabel: {
    fontSize: 18,
    fontWeight: '400',
    color: COLORS.text,
    flex: 1,
  },
  progressPercent: {
    fontSize: 18,
    fontWeight: '500',
    paddingRight: 9,
  },
  progressPercentPending: {
    color: COLORS.textMuted,
  },
  progressSpinner: {
    marginRight: 9,
  },
  detailCard: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    backgroundColor: COLORS.screen,
  },
  detailCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailCardHeaderLeft: {
    fontSize: 18,
    fontWeight: '400',
    color: COLORS.text,
    flex: 1,
    marginRight: 8,
  },
  detailLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  detailSpinner: {
    marginTop: 4,
  },
  detailAddress: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
  },
  detailTime: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 4,
    marginBottom: 14,
  },
  detailFooter: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
  },
  insuranceRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.screen,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  insuranceRowPressed: {
    backgroundColor: INSURANCE_PRESSED_SURFACE_SOFT,
  },
  insuranceRowLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  insuranceRowStatus: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  callInsurerBtn: {
    backgroundColor: COLORS.screen,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callInsurerPressed: {
    backgroundColor: INSURANCE_PRESSED_SURFACE,
  },
  callInsurerCalling: {
    opacity: 0.7,
  },
  callInsurerText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  noInsurerHint: {
    backgroundColor: COLORS.screen,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  noInsurerHintText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  newClaimBtnMargin: {
    marginTop: 12,
  },
});
