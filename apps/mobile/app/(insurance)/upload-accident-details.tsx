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
import { findInsuranceCompany, type InsuranceCompany } from '@/lib/insuranceCompaniesApi';
import { getVehicleById, getVehicles } from '@/lib/vehicleApi';
import { loadSelectedVehicleId } from '@/lib/selected-vehicle-store';
import { loadClaimantProfile } from '@/features/claimant/storage/claimant-profile-store';
import { useClaimUpload } from '@/features/report-accident/hooks/use-claim-upload';
import { formatTimestamp } from '@/lib/format-timestamp';
import { clearAllClaimData } from '@/lib/clear-claim-data';
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

export default function UploadAccidentDetailsScreen() {
  const router = useRouter();
  const { uploadKey, reportedAtIso, vehicleId } = useLocalSearchParams<{
    uploadKey?: string;
    reportedAtIso?: string;
    vehicleId?: string;
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

  const claimComplete = photosUploadComplete && fraudValidationComplete;

  const [insuranceCompany, setInsuranceCompany] = useState<InsuranceCompany | null>(null);
  const [vehicleMissingInsurer, setVehicleMissingInsurer] = useState(false);

  // Same as (insurance)/index.tsx: this screen sits outside VehicleProvider, so the SPECIFIC
  // vehicle the driver had selected on Home is fetched directly rather than read from context.
  // Falls back to the default/first vehicle only when neither the store nor the route param
  // has a vehicleId.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const persistedId = await loadSelectedVehicleId();
          const resolvedVehicleId = persistedId ?? vehicleId;
          if (!cancelled) {
            setEffectiveVehicleId(resolvedVehicleId);
          }
          let target;
          if (resolvedVehicleId) {
            target = await getVehicleById(resolvedVehicleId);
          } else {
            const vehicles = await getVehicles();
            target = vehicles.find((v) => v.isDefault) ?? vehicles[0] ?? null;
          }
          if (!target) {
            if (!cancelled) {
              setInsuranceCompany(null);
              setVehicleMissingInsurer(false);
            }
            return;
          }
          if (!target.insuranceProvider) {
            if (!cancelled) {
              setInsuranceCompany(null);
              setVehicleMissingInsurer(true);
            }
            return;
          }
          const company = await findInsuranceCompany(target.insuranceProvider);
          if (!cancelled) {
            setInsuranceCompany(company);
            setVehicleMissingInsurer(false);
          }
        } catch {
          if (!cancelled) {
            setInsuranceCompany(null);
            setVehicleMissingInsurer(false);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [vehicleId])
  );

  const onCallInsurer = async () => {
    if (!insuranceCompany) {
      return;
    }
    try {
      await Linking.openURL(insuranceCompany.phoneTel);
    } catch {
      Alert.alert('Call your insurer', 'Use the phone number on your insurance card or policy document.');
    }
  };

  const onStartNewClaim = async () => {
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
              percent={photosUploadPercent}
              complete={photosUploadComplete}
            />
            <ProgressRow
              label="Fraud Validation"
              percent={fraudValidationPercent}
              complete={fraudValidationComplete}
            />
            <ProgressRow label="Low light enhancement" percent={0} complete={false} />
            <ProgressRow label="3D Reconstruction" percent={0} complete={false} />
          </View>

          <View style={styles.detailCard}>
            <View style={styles.detailCardHeader}>
              <Text style={styles.detailCardHeaderLeft}>Captured and Submitted</Text>
            </View>
            <View style={styles.detailLocationRow}>
              {locationLoading ? (
                <ActivityIndicator size="small" color={COLORS.textMuted} style={styles.detailSpinner} />
              ) : null}
              <Text style={styles.detailAddress}>{locationLine}</Text>
            </View>
            <Text style={styles.detailTime}>
              {timestampLine || (locationLoading ? '…' : formatTimestamp(new Date()))}
            </Text>
            <Text style={styles.detailFooter}>
              GPS + Timestamp signed. You can close the App - Do not disconnect from Internet. We&apos;ll notify you.
            </Text>
          </View>

          <Pressable style={({ pressed }) => [styles.insuranceRowBtn, pressed && styles.insuranceRowPressed]}>
            <Text style={styles.insuranceRowLabel}>Insurance</Text>
            <Text style={styles.insuranceRowStatus}>Pending</Text>
          </Pressable>

          {insuranceCompany ? (
            <Pressable
              style={({ pressed }) => [styles.callInsurerBtn, pressed && styles.callInsurerPressed]}
              onPress={onCallInsurer}>
              <Text style={styles.callInsurerText}>{`Need to call ${insuranceCompany.appName}?`}</Text>
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
              onPress={() => void onStartNewClaim()}
              accessibilityRole="button"
              accessibilityLabel="Start a new claim">
              <Text style={styles.callInsurerText}>Start New Claim</Text>
            </Pressable>
          )}
        </ScrollView>

        <InsuranceBottomTabBar onTabPress={onTabPress} />
      </View>
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
