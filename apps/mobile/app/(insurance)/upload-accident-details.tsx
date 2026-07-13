import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { INSURER_PHONE_TEL } from '@/lib/constants';
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
  percent: number;
  complete: boolean;
}) {
  const pct = complete ? 100 : Math.max(0, Math.min(100, Math.round(percent)));
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
      <Text style={[styles.progressPercent, !showDone && styles.progressPercentPending]}>
        {showDone ? '100%' : `${pct}%`}
      </Text>
    </View>
  );
}

export default function UploadAccidentDetailsScreen() {
  const router = useRouter();
  const { uploadKey, reportedAtIso } = useLocalSearchParams<{ uploadKey?: string; reportedAtIso?: string }>();

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

  const {
    locationLine,
    timestampLine,
    locationLoading,
    photosUploadPercent,
    photosUploadComplete,
    fraudValidationPercent,
    fraudValidationComplete,
  } = useClaimUpload(uploadKey, reportedAtIso, claimantHydrated, claimantRef);

  const claimComplete = photosUploadComplete && fraudValidationComplete;

  const onCallInsurer = async () => {
    try {
      await Linking.openURL(INSURER_PHONE_TEL);
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
    router.replace('/(insurance)');
  };

  const onTabPress = (tab: InsuranceTabId) => {
    if (tab === 'home') {
      router.push('/(insurance)');
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
              GPS + Timestamp signed. You can close the App - Do not disconnect from Internet. We'll notify you.
            </Text>
          </View>

          <Pressable style={({ pressed }) => [styles.insuranceRowBtn, pressed && styles.insuranceRowPressed]}>
            <Text style={styles.insuranceRowLabel}>Insurance</Text>
            <Text style={styles.insuranceRowStatus}>Pending</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.callInsurerBtn, pressed && styles.callInsurerPressed]}
            onPress={onCallInsurer}>
            <Text style={styles.callInsurerText}>Need to call Allianz Insurance ?</Text>
          </Pressable>

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
  newClaimBtnMargin: {
    marginTop: 12,
  },
});
