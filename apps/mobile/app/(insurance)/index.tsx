import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { type Href, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsuranceBottomTabBar, type InsuranceTabId } from '@/components/insurance-bottom-tab-bar';
import {
  isDrivingLicenceCaptureComplete,
  loadDrivingLicenceState,
} from '@/features/driving-licence/storage/driving-licence-store';
import { isDrunkTestVideoCaptured, loadDrunkTestState } from '@/features/drunk-test/storage/drunk-test-store';
import { DEFAULT_STOP_COUNT } from '@/features/guided-capture/constants';
import { loadGuidedCaptureStoreState } from '@/features/guided-capture/storage/guided-capture-store';
import { HEIGHT_STEPS } from '@/features/guided-capture/types';
import {
  loadGuidedCaptureEntryMeta,
  saveGuidedCaptureEntryMeta,
} from '@/features/guided-capture/storage/guided-capture-entry-store';
import { isThirdPartyStepComplete, loadThirdPartyState } from '@/features/third-party/storage/third-party-store';
import {
  loadInsurerCallMeta,
  saveInsurerCallMeta,
} from '@/features/insurer-call/storage/insurer-call-store';
import {
  loadReportAccidentEntryMeta,
  saveReportAccidentEntryMeta,
} from '@/features/report-accident/storage/report-accident-entry-store';
import { useIncompleteUploadStatus } from '@/features/report-accident/hooks/use-incomplete-upload-status';
import { findInsuranceCompany, type InsuranceCompany } from '@/lib/insuranceCompaniesApi';
import { getVehicles } from '@/lib/vehicleApi';
import { computeClaimBundleUploadKey, isClaimReportSubmittedLocked } from '@/lib/claim-upload-dedupe';
import { formatGeocodedLine } from '@/lib/format-geocoded-line';
import { formatTimestamp } from '@/lib/format-timestamp';
import { type LocationSnapshotMeta } from '@/lib/location-snapshot-store';
import {
  INSURANCE_BORDER_SOFT,
  INSURANCE_PILL_INCOMPLETE_BG,
  INSURANCE_PILL_INCOMPLETE_TEXT,
  INSURANCE_PRESSED_SURFACE,
  INSURANCE_PRESSED_SURFACE_SOFT,
  INSURANCE_PRIMARY,
  INSURANCE_REPORT_BG,
  INSURANCE_REPORT_DISABLED_BG,
  INSURANCE_STEP_BADGE_BG,
  INSURANCE_TEXT,
  INSURANCE_TEXT_MUTED,
  WHITE,
} from '@/features/guided-capture/capture-ui-theme';

const COLORS = {
  screen: WHITE,
  text: INSURANCE_TEXT,
  textMuted: INSURANCE_TEXT_MUTED,
  border: INSURANCE_BORDER_SOFT,
  stepBadgeBg: INSURANCE_STEP_BADGE_BG,
  stepBadgeText: INSURANCE_PRIMARY,
  cardBg: WHITE,
  pillIncompleteBg: INSURANCE_PILL_INCOMPLETE_BG,
  pillIncompleteText: INSURANCE_PILL_INCOMPLETE_TEXT,
  pillDoneBg: INSURANCE_STEP_BADGE_BG,
  pillDoneText: INSURANCE_PRIMARY,
  reportBg: INSURANCE_REPORT_BG,
  reportText: WHITE,
};

type TaskStatus = 'done' | 'incomplete';

type FlowTask = {
  key: string;
  title: string;
  status: TaskStatus;
  href: Href | null;
};


async function captureLocationSnapshot(): Promise<LocationSnapshotMeta> {
  const capturedAt = new Date();
  const base: LocationSnapshotMeta = {
    capturedAtIso: capturedAt.toISOString(),
    capturedAtDisplayLocal: formatTimestamp(capturedAt),
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    locationPermission: 'unavailable',
    locationLabel: null,
  };

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      base.locationPermission = 'denied';
      if (__DEV__) {
        console.log('[Location captured]', base);
      }
      return base;
    }
    base.locationPermission = 'granted';
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    base.latitude = pos.coords.latitude;
    base.longitude = pos.coords.longitude;
    base.accuracyMeters = pos.coords.accuracy ?? null;
    try {
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: base.latitude,
        longitude: base.longitude,
      });
      if (geo) {
        base.locationLabel = formatGeocodedLine(geo);
      }
    } catch {
      // keep null label
    }
  } catch {
    base.locationPermission = 'unavailable';
  }

  if (__DEV__) {
    console.log('[Location captured]', base);
  }
  return base;
}

const FLOW_TASKS: FlowTask[] = [
  { key: 'guided', title: 'Guided Capture', status: 'incomplete', href: '/(insurance)/guided-capture-intro' },
  { key: 'licence', title: 'Driving Licence Photo', status: 'incomplete', href: '/(insurance)/driving-licence' },
  { key: 'drunk', title: 'User Verification Test', status: 'incomplete', href: '/(insurance)/drunk-test' },
  { key: 'thirdParty', title: '3rd Party Details', status: 'incomplete', href: '/(insurance)/third-party' },
];

function StepRow({
  number,
  title,
  caption,
  showDivider,
}: {
  number: number;
  title: string;
  caption: string;
  showDivider: boolean;
}) {
  return (
    <View>
      <View style={styles.stepRow}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>{number}</Text>
        </View>
        <View style={styles.stepTextBlock}>
          <Text style={styles.stepTitle}>{title}</Text>
          <Text style={styles.stepCaption}>{caption}</Text>
        </View>
      </View>
      {showDivider ? <View style={styles.stepDivider} /> : null}
    </View>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const done = status === 'done';
  return (
    <View style={[styles.pill, done ? styles.pillDone : styles.pillIncomplete]}>
      <Text style={[styles.pillText, done ? styles.pillTextDone : styles.pillTextIncomplete]}>{done ? 'Done' : 'Incomplete'}</Text>
    </View>
  );
}

export default function InsuranceHomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [guidedMeetsMinimum, setGuidedMeetsMinimum] = useState(false);
  const [licenceComplete, setLicenceComplete] = useState(false);
  const [drunkTestComplete, setDrunkTestComplete] = useState(false);
  const [thirdPartyComplete, setThirdPartyComplete] = useState(false);
  const [claimReportLocked, setClaimReportLocked] = useState(false);
  const [insuranceCompany, setInsuranceCompany] = useState<InsuranceCompany | null>(null);
  const incompleteUpload = useIncompleteUploadStatus();

  // The "Need to call ___ Insurance?" button reflects the driver's own
  // default vehicle's insurer — this screen sits outside VehicleProvider
  // (only mounted in (driver)/_layout.tsx), so it fetches directly, same
  // pattern as use-claim-upload.ts.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        try {
          const vehicles = await getVehicles();
          const target = vehicles.find((v) => v.isDefault) ?? vehicles[0];
          if (!target?.insuranceProvider) {
            if (!cancelled) setInsuranceCompany(null);
            return;
          }
          const company = await findInsuranceCompany(target.insuranceProvider);
          if (!cancelled) setInsuranceCompany(company);
        } catch {
          if (!cancelled) setInsuranceCompany(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const [guidedState, licenceState, drunkState, thirdState, submittedLocked] = await Promise.all([
          loadGuidedCaptureStoreState(),
          loadDrivingLicenceState(),
          loadDrunkTestState(),
          loadThirdPartyState(),
          isClaimReportSubmittedLocked(),
        ]);
        if (cancelled) {
          return;
        }
        setGuidedMeetsMinimum(guidedState.photos.length >= DEFAULT_STOP_COUNT * HEIGHT_STEPS.length);
        setLicenceComplete(isDrivingLicenceCaptureComplete(licenceState));
        setDrunkTestComplete(isDrunkTestVideoCaptured(drunkState));
        setThirdPartyComplete(isThirdPartyStepComplete(thirdState));
        setClaimReportLocked(submittedLocked);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const flowTasks = useMemo(
    () =>
      FLOW_TASKS.map((task) => {
        if (task.key === 'guided' && guidedMeetsMinimum) {
          return { ...task, status: 'done' as const };
        }
        if (task.key === 'licence' && licenceComplete) {
          return { ...task, status: 'done' as const };
        }
        if (task.key === 'drunk' && drunkTestComplete) {
          return { ...task, status: 'done' as const };
        }
        if (task.key === 'thirdParty' && thirdPartyComplete) {
          return { ...task, status: 'done' as const };
        }
        return task;
      }),
    [guidedMeetsMinimum, licenceComplete, drunkTestComplete, thirdPartyComplete]
  );

  const completedCount = flowTasks.filter((t) => t.status === 'done').length;
  const totalCount = flowTasks.length;
  const progressLabel = `${completedCount}/${totalCount}`;
  const allFlowStepsComplete = flowTasks.every((t) => t.status === 'done');
  /** Grey “disabled” look after submit, but the button stays pressable to open upload progress. */
  const reportLooksSubmitted = allFlowStepsComplete && claimReportLocked;

  const onTaskPress = (task: FlowTask) => {
    const href = task.href;
    if (!href) {
      return;
    }
    if (task.key === 'guided') {
      void loadGuidedCaptureEntryMeta().then((existing) => {
        if (existing) return;
        void captureLocationSnapshot().then((meta) => {
          void saveGuidedCaptureEntryMeta(meta);
          if (__DEV__) {
            console.log('[Guided Capture entry — time & location at tap]', meta);
          }
        });
      });
    }
    router.push(href);
  };

  const onCallInsurer = async () => {
    if (!insuranceCompany) {
      return;
    }
    try {
      // Android-only: shows the native "Location Accuracy" dialog when device
      // location / high-accuracy mode isn't already on. No-op on iOS.
      await Location.enableNetworkProviderAsync();
    } catch {
      // User tapped "No, thanks" (or provider unavailable) — proceed with the call regardless.
    }

    const existing = await loadInsurerCallMeta();
    if (!existing) {
      const meta = await captureLocationSnapshot();
      await saveInsurerCallMeta(meta);
      if (__DEV__) {
        console.log(`[${insuranceCompany.appName} call — time & location at tap]`, meta);
      }
    }

    try {
      await Linking.openURL(insuranceCompany.phoneTel);
    } catch {
      Alert.alert('Call your insurer', 'Use the phone number on your insurance card or policy document.');
    }
  };

  const onReportAccident = () => {
    if (!allFlowStepsComplete) {
      return;
    }
    void (async () => {
      const reportedAtIso = new Date().toISOString();
      // Fire-and-forget GPS on first tap only; persists until reset.
      void loadReportAccidentEntryMeta().then((existing) => {
        if (existing) return;
        void captureLocationSnapshot().then((meta) => {
          void saveReportAccidentEntryMeta(meta);
        });
      });
      const uploadKey = await computeClaimBundleUploadKey();
      router.push({
        pathname: '/(insurance)/upload-accident-details',
        params: { uploadKey, reportedAtIso },
      });
    })();
  };

  const onTabPress = (tab: InsuranceTabId) => {
    if (tab === 'home') return;
    Alert.alert('Coming soon', 'This section will be added in a future update.');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.shell}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            {navigation.canGoBack() ? (
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.headerBackWithTitle, pressed && styles.pressed]}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back">
                <View style={styles.headerChevronWrap} collapsable={false}>
                  <Ionicons name="chevron-back" size={24} color={COLORS.text} />
                </View>
                <Text style={styles.headerTitle}>Insurance</Text>
              </Pressable>
            ) : (
              <Text style={styles.headerTitle}>Insurance</Text>
            )}
          </View>

          {insuranceCompany ? (
            <Pressable style={({ pressed }) => [styles.callInsurerBtn, pressed && styles.callInsurerPressed]} onPress={onCallInsurer}>
              <Text style={styles.callInsurerText}>{`Need to call ${insuranceCompany.appName}?`}</Text>
            </Pressable>
          ) : null}

          <View style={styles.stepsSection}>
            <StepRow number={1} title="Stay safe first" caption="Move away from the traffic" showDivider />
            <StepRow number={2} title="Walk around the vehicle" caption="Phone will guide the angles" showDivider />
            <StepRow number={3} title="Take photos and submit" caption="We'll update you soon" showDivider={false} />
          </View>

          <View style={styles.nextStepsHeader}>
            <Text style={styles.nextStepsTitle}>Next Steps</Text>
            <Text style={styles.nextStepsProgress}>{progressLabel}</Text>
          </View>

          <View style={styles.taskList}>
            {flowTasks.map((task) => (
              <Pressable
                key={task.key}
                style={({ pressed }) => [styles.taskCard, pressed && styles.taskCardPressed]}
                onPress={() => onTaskPress(task)}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <StatusPill status={task.status} />
              </Pressable>
            ))}
          </View>

          <Pressable
            disabled={!allFlowStepsComplete}
            style={({ pressed }) => [
              styles.reportBtn,
              (!allFlowStepsComplete || reportLooksSubmitted) && styles.reportBtnDisabled,
              pressed && allFlowStepsComplete && styles.reportBtnPressed,
            ]}
            onPress={onReportAccident}
            accessibilityRole="button"
            accessibilityLabel="Report Accident"
            accessibilityHint={
              claimReportLocked
                ? 'Opens upload status. Does not send again until you reset walkaround in Guided Capture.'
                : undefined
            }
            accessibilityState={{ disabled: !allFlowStepsComplete }}>
            <Text
              style={[
                styles.reportBtnText,
                (!allFlowStepsComplete || reportLooksSubmitted) && styles.reportBtnTextDisabled,
              ]}>
              Report Accident
            </Text>
          </Pressable>
          {claimReportLocked ? (
            <Text style={styles.reportLockedHint}>
              Tap the button above to review upload progress (no new upload). For a new incident, open Guided Capture and
              use Reset capture, then complete the steps again.
            </Text>
          ) : incompleteUpload ? (
            <Text style={styles.reportIncompleteHint}>
              {`Your last upload stopped at ${incompleteUpload.percent}% — tap Report Accident to resume.`}
            </Text>
          ) : null}
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
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    marginBottom: 20,
    gap: 4,
  },
  headerBackWithTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 8,
  },
  headerChevronWrap: {
    width: 28,
    height: 28,
    marginRight: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.65,
  },
  callInsurerBtn: {
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  callInsurerPressed: {
    backgroundColor: INSURANCE_PRESSED_SURFACE,
  },
  callInsurerText: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  stepsSection: {
    marginBottom: 10,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
  },
  stepBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.stepBadgeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  stepBadgeText: {
    color: COLORS.stepBadgeText,
    fontSize: 17,
    fontWeight: '800',
  },
  stepTextBlock: {
    flex: 1,
    paddingTop: 2,
  },
  stepTitle: {
    color: COLORS.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  stepCaption: {
    color: COLORS.textMuted,
    fontSize: 15,
    lineHeight: 20,
  },
  stepDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginLeft: 54,
  },
  nextStepsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  nextStepsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  nextStepsProgress: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  taskList: {
    gap: 12,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  taskCardPressed: {
    backgroundColor: INSURANCE_PRESSED_SURFACE_SOFT,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    flex: 1,
    marginRight: 12,
  },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  pillIncomplete: {
    backgroundColor: COLORS.pillIncompleteBg,
  },
  pillDone: {
    backgroundColor: COLORS.pillDoneBg,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  pillTextIncomplete: {
    color: COLORS.pillIncompleteText,
  },
  pillTextDone: {
    color: COLORS.pillDoneText,
  },
  reportBtn: {
    marginTop: 24,
    backgroundColor: COLORS.reportBg,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportBtnDisabled: {
    backgroundColor: INSURANCE_REPORT_DISABLED_BG,
  },
  reportBtnPressed: {
    opacity: 0.9,
  },
  reportBtnText: {
    color: COLORS.reportText,
    fontSize: 17,
    fontWeight: '700',
  },
  reportBtnTextDisabled: {
    color: COLORS.textMuted,
  },
  reportLockedHint: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  reportIncompleteHint: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.reportBg,
    fontWeight: '600',
    textAlign: 'center',
  },
});
