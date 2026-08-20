import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

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
import { getVehicleInsurance } from '@/lib/vehicleInsuranceApi';
import { loadSelectedVehicleId } from '@/lib/selected-vehicle-store';
import { computeClaimBundleUploadKey, isClaimReportSubmittedLocked } from '@/lib/claim-upload-dedupe';
import { captureLocationSnapshot } from '@/lib/location-snapshot-store';
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
  DONE_BADGE_BG,
  DONE_PRIMARY,
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
  pillDoneBg: DONE_BADGE_BG,
  pillDoneText: DONE_PRIMARY,
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

// Floor of the opacity pulse — kept fairly high (not near 0) so the glow never
// fades down to near-invisible between pulses, which is what made the previous
// single-layer version read as barely-there on screen load.
const GLOW_PULSE_FLOOR = 0.55;

/** Self-contained "primary action" glow: one plain View hugging the caller's
 * content, just outside the border — not native shadow props, since
 * shadowOpacity/shadowRadius are iOS-only in RN and Android's elevation only
 * ever renders a plain gray shadow, never a colored one. Manages its own pulse
 * animation from `active` so any caller can drop it in without wiring up
 * shared-value/effect boilerplate itself. */
function GlowHalo({ active }: { active: boolean }) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(
        withSequence(withTiming(1, { duration: 700 }), withTiming(GLOW_PULSE_FLOOR, { duration: 700 })),
        -1,
        true
      );
    } else {
      pulse.value = withTiming(0, { duration: 200 });
    }
  }, [active, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (!active) {
    return null;
  }
  return <Animated.View style={[styles.glowHaloInner, pulseStyle]} />;
}

function TaskCard({
  task,
  glow,
  resolving,
  onPress,
}: {
  task: FlowTask;
  glow: boolean;
  resolving: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.taskCardGlowWrap}>
      <GlowHalo active={glow} />
      <Pressable
        disabled={resolving}
        style={({ pressed }) => [styles.taskCard, glow && styles.taskCardGlowing, pressed && styles.taskCardPressed]}
        onPress={onPress}>
        <Text style={styles.taskTitle}>{task.title}</Text>
        {resolving ? (
          <ActivityIndicator size="small" color={COLORS.stepBadgeText} />
        ) : (
          <StatusPill status={task.status} />
        )}
      </Pressable>
    </View>
  );
}

export default function InsuranceHomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { vehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  // The vehicleId route param is a one-time snapshot from whenever this screen was
  // pushed from Home. If the driver switches vehicles on Home and then starts a
  // second claim without leaving Insurance (e.g. via Guided Capture's Reset capture
  // instead of Home → Insurance again), that snapshot goes stale. The persisted
  // store (updated live by selectVehicle) is refreshed every focus and takes
  // precedence; the route param remains the fallback for a first-ever entry.
  const [effectiveVehicleId, setEffectiveVehicleId] = useState<string | undefined>(vehicleId);
  const [guidedMeetsMinimum, setGuidedMeetsMinimum] = useState(false);
  const [licenceComplete, setLicenceComplete] = useState(false);
  const [drunkTestComplete, setDrunkTestComplete] = useState(false);
  const [thirdPartyComplete, setThirdPartyComplete] = useState(false);
  const [claimReportLocked, setClaimReportLocked] = useState(false);
  const [insuranceCompany, setInsuranceCompany] = useState<InsuranceCompany | null>(null);
  const [vehicleMissingInsurer, setVehicleMissingInsurer] = useState(false);
  // True until the insurer lookup below finishes at least once — was used to show a
  // spinner in the button's place; the button now always reads the same static
  // label, so this no longer drives a visible loading state. Kept (unused) rather
  // than removed in case the spinner treatment is wanted back — see the commented
  // JSX further down.
  const [resolvingInsurer, setResolvingInsurer] = useState(true);
  const [callingInsurer, setCallingInsurer] = useState(false);
  // Local law requires calling the insurer before anything else — these three drive
  // a 30s glow on the call button nudging the driver to do that first. Stops the
  // moment any one of them becomes true: called, started taking photos, or already
  // submitted.
  const [hasCalledInsurer, setHasCalledInsurer] = useState(false);
  const [hasStartedGuidedCapture, setHasStartedGuidedCapture] = useState(false);
  const [glowTimedOut, setGlowTimedOut] = useState(false);
  // Which task card (if any) is currently resolving its entry-location capture —
  // used to show a spinner and block re-tapping while that resolves, so navigating
  // away can't happen before the location write finishes (see onTaskPress).
  const [resolvingTaskKey, setResolvingTaskKey] = useState<string | null>(null);
  const incompleteUpload = useIncompleteUploadStatus();

  // The "Need to call ___ Insurance?" button reflects the SPECIFIC vehicle the driver had
  // selected on Home (passed in as `vehicleId`) — this screen sits outside VehicleProvider
  // (only mounted in (driver)/_layout.tsx), so it can't read that selection from context and
  // fetches directly instead, same pattern as use-claim-upload.ts. Falls back to the
  // default/first vehicle only when no vehicleId was passed (e.g. a stale deep link).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (!cancelled) {
          setResolvingInsurer(true);
        }
        try {
          const persistedId = await loadSelectedVehicleId();
          const resolvedVehicleId = persistedId ?? vehicleId;
          if (!cancelled) {
            setEffectiveVehicleId(resolvedVehicleId);
          }
          // getVehicleById() isn't needed just to get an id we already have —
          // getVehicleInsurance() takes the vehicle id directly, cutting one full
          // network round trip off this chain. Only the no-id fallback (a stale deep
          // link with neither a persisted nor a route-param vehicle) still needs to
          // list vehicles to find one.
          let targetVehicleId = resolvedVehicleId ?? null;
          if (!targetVehicleId) {
            const vehicles = await getVehicles();
            const target = vehicles.find((v) => v.isDefault) ?? vehicles[0] ?? null;
            targetVehicleId = target?._id ?? null;
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
    }, [vehicleId])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      // Fresh 30s window each time this screen is (re)focused, unless one of the
      // stop conditions below is already true by the time the checks resolve.
      setGlowTimedOut(false);
      void (async () => {
        const [guidedState, licenceState, drunkState, thirdState, submittedLocked, insurerCallMeta] =
          await Promise.all([
            loadGuidedCaptureStoreState(),
            loadDrivingLicenceState(),
            loadDrunkTestState(),
            loadThirdPartyState(),
            isClaimReportSubmittedLocked(),
            loadInsurerCallMeta(),
          ]);
        if (cancelled) {
          return;
        }
        setGuidedMeetsMinimum(guidedState.photos.length >= DEFAULT_STOP_COUNT * HEIGHT_STEPS.length);
        setHasStartedGuidedCapture(guidedState.photos.length > 0);
        setHasCalledInsurer(insurerCallMeta != null);
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
  // First still-incomplete card, in list order — the one that glows, but only
  // once the driver has tapped the call button (hasCalledInsurer flips true
  // immediately on tap, before the dialer even opens — see onCallInsurer).
  // Before that, no card glows: the call button is the one thing that should
  // draw the eye first. Reuses flowTasks (the same state driving the
  // Incomplete/Done pills) rather than tracking a separate "which card glows"
  // state, so it advances automatically whenever a step's completion state
  // flips and flowTasks recomputes.
  const firstIncompleteTaskKey = hasCalledInsurer
    ? flowTasks.find((t) => t.status === 'incomplete')?.key ?? null
    : null;
  /** Grey “disabled” look after submit, but the button stays pressable to open upload progress. */
  const reportLooksSubmitted = allFlowStepsComplete && claimReportLocked;

  // Local law requires calling the insurer before anything else — glow the call
  // button for 30s to nudge that, unless it's already been called, the driver has
  // already started taking photos, or the claim is already fully submitted.
  const showGlow =
    insuranceCompany != null &&
    !reportLooksSubmitted &&
    !hasCalledInsurer &&
    !hasStartedGuidedCapture &&
    !glowTimedOut;

  useEffect(() => {
    if (!showGlow) {
      return;
    }
    const timer = setTimeout(() => setGlowTimedOut(true), 30000);
    return () => clearTimeout(timer);
  }, [showGlow]);

  const onTaskPress = async (task: FlowTask) => {
    const href = task.href;
    if (!href || resolvingTaskKey) {
      return;
    }
    if (task.key === 'guided') {
      // Stop the "call insurer" glow the moment the driver starts taking photos —
      // don't wait for the next focus's persisted-state check to catch up.
      setHasStartedGuidedCapture(true);
      // Awaited (not fire-and-forget) — navigating away before this write finished
      // was why the entry location sometimes went missing: the guided capture
      // screen could already be focused, and this save would land after whatever
      // read it first.
      setResolvingTaskKey(task.key);
      try {
        const existing = await loadGuidedCaptureEntryMeta();
        if (!existing) {
          const meta = await captureLocationSnapshot();
          await saveGuidedCaptureEntryMeta(meta);
          if (__DEV__) {
            console.log('[Guided Capture entry — time & location at tap]', meta);
          }
        }
      } finally {
        setResolvingTaskKey(null);
      }
    }
    router.push(href);
  };

  const onCallInsurer = async () => {
    if (!insuranceCompany || callingInsurer) {
      return;
    }
    // Stop the glow immediately on tap — don't wait for the next focus's
    // persisted-state check to catch up.
    setHasCalledInsurer(true);
    setCallingInsurer(true);
    try {
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
    } finally {
      setCallingInsurer(false);
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
        params: { uploadKey, reportedAtIso, vehicleId: effectiveVehicleId },
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

          {/* Static-label version (no spinner, always "Need to call Your Insurer") was
              tried and reverted — restore by swapping this comment block back in:
          {insuranceCompany ? (
            <View style={styles.callInsurerGlowWrap}>
              <GlowHalo active={showGlow} />
              <Pressable
                disabled={callingInsurer}
                style={({ pressed }) => [
                  styles.callInsurerBtn,
                  showGlow && styles.callInsurerBtnGlowing,
                  pressed && styles.callInsurerPressed,
                  callingInsurer && styles.callInsurerCalling,
                ]}
                onPress={onCallInsurer}>
                {callingInsurer ? (
                  <ActivityIndicator size="small" color={COLORS.text} />
                ) : (
                  <Text style={styles.callInsurerText}>Need to call Your Insurer</Text>
                )}
              </Pressable>
            </View>
          ) : vehicleMissingInsurer ? ( */}
          {resolvingInsurer ? (
            <View style={styles.callInsurerGlowWrap}>
              <View style={[styles.callInsurerBtn, styles.callInsurerCalling]}>
                <ActivityIndicator size="small" color={COLORS.text} />
              </View>
            </View>
          ) : insuranceCompany ? (
            <View style={styles.callInsurerGlowWrap}>
              <GlowHalo active={showGlow} />
              <Pressable
                disabled={callingInsurer}
                style={({ pressed }) => [
                  styles.callInsurerBtn,
                  showGlow && styles.callInsurerBtnGlowing,
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
            </View>
          ) : vehicleMissingInsurer ? (
            <View style={styles.noInsurerHint}>
              <Text style={styles.noInsurerHintText}>
                No insurance company saved for this vehicle. Add it in My Vehicles → Edit → Add
                insurance company → Save changes.
              </Text>
            </View>
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
              <TaskCard
                key={task.key}
                task={task}
                glow={task.key === firstIncompleteTaskKey}
                resolving={resolvingTaskKey === task.key}
                onPress={() => void onTaskPress(task)}
              />
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
  callInsurerGlowWrap: {
    position: 'relative',
    // Moved here from callInsurerBtn — a child's marginBottom still counts toward
    // this wrap's auto-computed height in RN's layout, which was inflating the
    // wrap's box on that side only and throwing the halo's insets off-center
    // (thinner/thicker glow on different edges instead of a uniform ring).
    marginBottom: 10,
  },
  // Sits just outside the glowing element's border (radius = its own 16 +
  // inset, so the curve stays concentric). Shared by the call button and
  // whichever task card is currently first-incomplete — see GlowHalo.
  glowHaloInner: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 21,
    // Same color as the glowing border itself (callInsurerBtnGlowing /
    // taskCardGlowing), just with alpha appended, so the halo can never drift
    // from the border it's meant to match.
    backgroundColor: `${INSURANCE_PRIMARY}B3`,
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
    // No marginBottom here — moved to callInsurerGlowWrap (see its comment) so the
    // glow halo's insets stay symmetric. Branches that render callInsurerBtn
    // without that wrap (the resolving-state view below) apply the same wrap style
    // themselves purely for this spacing.
  },
  // Dark-orange border on the button itself while glowing (not the halo) — same
  // color as the numbered step badges' text.
  callInsurerBtnGlowing: {
    borderColor: INSURANCE_PRIMARY,
    borderWidth: 1,
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
    backgroundColor: COLORS.cardBg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  noInsurerHintText: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textMuted,
    textAlign: 'center',
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
  // No marginBottom needed (unlike callInsurerGlowWrap) — taskList's own `gap`
  // already spaces the wraps, so nothing else needs to compensate.
  taskCardGlowWrap: {
    position: 'relative',
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
  // Same treatment as callInsurerBtnGlowing — dark-orange border on the card
  // itself while it's the glowing (first-incomplete) one.
  taskCardGlowing: {
    borderColor: INSURANCE_PRIMARY,
    borderWidth: 1,
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
