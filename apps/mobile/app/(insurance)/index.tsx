import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomNavBar } from '@/components/ui/bottom-nav-bar';
import { GlowHalo } from '@/features/guided-capture/components/glow-halo';
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
import { useT } from '@/lib/i18n';
import { getVehicleInsurance } from '@/lib/vehicleInsuranceApi';
import { loadSelectedVehicleId } from '@/lib/selected-vehicle-store';
import { loadClaimVehicleId, saveClaimVehicleId } from '@/lib/claim-vehicle-store';
import { getClaimUploadProgressSnapshot, subscribeClaimUploadProgress } from '@/lib/claim-upload-progress-bus';
import { computeClaimBundleUploadKey, isClaimReportSubmittedLocked } from '@/lib/claim-upload-dedupe';
import { captureLocationSnapshot } from '@/lib/location-snapshot-store';
import {
  CAPTURE_ACTION_BLUE_SOFT,
  INSURANCE_BORDER_SOFT,
  INSURANCE_PILL_INCOMPLETE_BG,
  INSURANCE_PILL_INCOMPLETE_TEXT,
  INSURANCE_PRESSED_SURFACE,
  INSURANCE_PRESSED_SURFACE_SOFT,
  INSURANCE_PRIMARY,
  INSURANCE_REPORT_BG,
  INSURANCE_REPORT_DISABLED_BG,
  INSURANCE_SHADOW_COLOR,
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
  titleKey: string;
  status: TaskStatus;
  href: Href | null;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const FLOW_TASKS: FlowTask[] = [
  { key: 'guided', titleKey: 'insurance.hub.taskGuided', status: 'incomplete', href: '/(insurance)/guided-capture-intro', icon: 'camera-outline' },
  { key: 'licence', titleKey: 'insurance.hub.taskLicence', status: 'incomplete', href: '/(insurance)/driving-licence', icon: 'card-outline' },
  { key: 'drunk', titleKey: 'insurance.hub.taskDrunkTest', status: 'incomplete', href: '/(insurance)/drunk-test', icon: 'shield-checkmark-outline' },
  { key: 'thirdParty', titleKey: 'insurance.hub.taskThirdParty', status: 'incomplete', href: '/(insurance)/third-party', icon: 'people-outline' },
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
  const t = useT();
  const done = status === 'done';
  return (
    <View style={[styles.pill, done ? styles.pillDone : styles.pillIncomplete]}>
      <Text style={[styles.pillText, done ? styles.pillTextDone : styles.pillTextIncomplete]}>
        {done ? t('insurance.status.done') : t('insurance.status.incomplete')}
      </Text>
    </View>
  );
}

function TaskCard({
  task,
  glow,
  resolving,
  disabled,
  onPress,
}: {
  task: FlowTask;
  glow: boolean;
  resolving: boolean;
  // Separate from `resolving`: this tile isn't necessarily the one loading, but
  // something else on screen (another tile, or the Call button) is — blocked from
  // being pressed without touching its style, so it doesn't look any different.
  disabled: boolean;
  onPress: () => void;
}) {
  const t = useT();
  return (
    <View style={[styles.taskCardGlowWrap, glow && styles.taskCardGlowWrapActive]}>
      <GlowHalo active={glow} color={INSURANCE_PRIMARY} inset={4} borderRadius={20} />
      <Pressable
        disabled={disabled}
        style={({ pressed }) => [styles.taskCard, glow && styles.taskCardGlowing, pressed && styles.taskCardPressed]}
        onPress={onPress}>
        <View style={styles.taskIconWrap}>
          <Ionicons name={task.icon} size={20} color={INSURANCE_PRIMARY} />
        </View>
        <Text style={styles.taskTitle}>{t(task.titleKey)}</Text>
        {resolving ? (
          <ActivityIndicator size="small" color={INSURANCE_PRIMARY} />
        ) : (
          <StatusPill status={task.status} />
        )}
      </Pressable>
    </View>
  );
}

export default function InsuranceHomeScreen() {
  const t = useT();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
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
  // The disk-persisted "already submitted" flag — refreshed on every focus (see the
  // effect below), but that read is async, so it lags a beat behind the moment an
  // upload actually finishes. Combined with the live upload-progress bus below into
  // claimReportLocked, which reflects a just-finished upload immediately: without
  // that, quickly backing out of Upload Accident Details right as it hits 100% and
  // returning here could still show "Report Accident" in its normal (not yet
  // grayed-out) state for a moment.
  const [claimReportLockedFromDisk, setClaimReportLockedFromDisk] = useState(false);
  const uploadBusProgress = useSyncExternalStore(subscribeClaimUploadProgress, getClaimUploadProgressSnapshot);
  const claimReportLocked = claimReportLockedFromDisk || uploadBusProgress.phase === 'succeeded';
  const [insuranceCompany, setInsuranceCompany] = useState<InsuranceCompany | null>(null);
  const [vehicleMissingInsurer, setVehicleMissingInsurer] = useState(false);
  const [navigating, setNavigating] = useState(false);
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
          // Once a claim has actually started, the vehicle it's pinned to (see
          // onTaskPress below) always wins over whatever is currently selected on
          // Home — the Call button must keep pointing at the claim's own insurer,
          // not silently follow the driver switching vehicles elsewhere.
          const pinnedVehicleId = await loadClaimVehicleId();
          const persistedId = await loadSelectedVehicleId();
          const resolvedVehicleId = pinnedVehicleId ?? persistedId ?? vehicleId;
          if (!cancelled) {
            setEffectiveVehicleId(resolvedVehicleId);
          }
          // Backfill for a claim that already began before this pin existed (or
          // before it ever got a chance to fire) — onTaskPress below only writes
          // the pin on a claim's very first Guided Capture entry, so a claim
          // already mid-flight would otherwise never get pinned at all. Whatever
          // vehicle is resolving right now is the best available answer for it.
          if (!pinnedVehicleId && resolvedVehicleId) {
            const guidedEntry = await loadGuidedCaptureEntryMeta();
            if (guidedEntry) {
              await saveClaimVehicleId(resolvedVehicleId);
            }
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
        setClaimReportLockedFromDisk(submittedLocked);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      setNavigating(false);
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
  // Call and Guided Capture both do an awaited location fetch before doing anything
  // else (dialing / navigating), which can take a moment. While either is in flight,
  // every other button on this screen is blocked from being pressed — not restyled,
  // just non-interactive — so a second tap can't race the in-flight one.
  const anyLoading = callingInsurer || resolvingTaskKey != null;
  /** Grey “disabled” look after submit, but the button stays pressable to open upload progress. */
  const reportLooksSubmitted = allFlowStepsComplete && claimReportLocked;

  // Local law requires calling the insurer before anything else — glow the call
  // button to nudge that, until it's actually been called (or the driver has
  // already started taking photos, or the claim is already fully submitted).
  // No timeout: it stays lit until the driver taps Call, not just for a while.
  const showGlow =
    insuranceCompany != null &&
    !reportLooksSubmitted &&
    !hasCalledInsurer &&
    !hasStartedGuidedCapture;

  const onTaskPress = async (task: FlowTask) => {
    const href = task.href;
    if (!href || resolvingTaskKey || callingInsurer) {
      return;
    }
    // Already submitted — open in a read-only view of what was captured instead of
    // the live capture/retake flow. No entry-location tracking either, since nothing
    // new is being captured.
    if (claimReportLocked) {
      // Appending the query string directly (rather than the {pathname, params}
      // object form) sidesteps typed-routes' strict pathname-literal union, which
      // doesn't include a variant for "any static route + arbitrary params".
      router.push(`${href}?locked=1` as Href);
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
          // This is the true start of a new claim — pin its vehicle now, from
          // whatever is currently selected, so later switching the selected
          // vehicle on Home doesn't change which insurer this claim calls.
          if (effectiveVehicleId) {
            await saveClaimVehicleId(effectiveVehicleId);
          }
        }
      } finally {
        setResolvingTaskKey(null);
      }
    }
    router.push(href);
  };

  const onCallInsurer = async () => {
    if (!insuranceCompany || callingInsurer || resolvingTaskKey) {
      return;
    }
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
        // Only flip this once the dialer has actually opened — flipping it
        // right on tap moved the glow to Guided Capture while the location
        // fetch above was still in flight and the dialer hadn't appeared yet.
        setHasCalledInsurer(true);
      } catch {
        Alert.alert(t('insurance.hub.callFallbackTitle'), t('insurance.hub.callFallbackBody'));
      }
    } finally {
      setCallingInsurer(false);
    }
  };

  const onReportAccident = () => {
    if (!allFlowStepsComplete || navigating) {
      return;
    }
    // computeClaimBundleUploadKey is async, so without this a double tap pushes
    // two upload screens and files the same accident twice.
    setNavigating(true);
    void (async () => {
      try {
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
      } catch {
        Alert.alert(
          t('insurance.hub.openClaimFailedTitle'),
          t('insurance.hub.openClaimFailedBody'),
        );
      } finally {
        setNavigating(false);
      }
    })();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.shell}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            {navigation.canGoBack() ? (
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => [styles.headerBackWithTitle, pressed && styles.pressed]}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t('insurance.action.back')}>
                <View style={styles.headerChevronWrap} collapsable={false}>
                  <Ionicons name="chevron-back" size={24} color={COLORS.text} />
                </View>
                <Text style={styles.headerTitle}>{t('insurance.hub.title')}</Text>
              </Pressable>
            ) : (
              <Text style={styles.headerTitle}>{t('insurance.hub.title')}</Text>
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
            <View style={[styles.callInsurerGlowWrap, showGlow && styles.callInsurerGlowWrapActive]}>
              <GlowHalo active={showGlow} color={INSURANCE_PRIMARY} inset={4} borderRadius={20} />
              <Pressable
                disabled={anyLoading}
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
                  <>
                    <View style={styles.taskIconWrap}>
                      <Ionicons name="call-outline" size={20} color={INSURANCE_PRIMARY} />
                    </View>
                    <Text style={styles.callInsurerText}>
                      {t('insurance.hub.callInsurer', { name: insuranceCompany.appName })}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          ) : vehicleMissingInsurer ? (
            <View style={styles.noInsurerHint}>
              <Text style={styles.noInsurerHintText}>{t('insurance.hub.noInsurerHint')}</Text>
            </View>
          ) : null}

          <View style={styles.stepsSection}>
            <StepRow
              number={1}
              title={t('insurance.hub.step1Title')}
              caption={t('insurance.hub.step1Caption')}
              showDivider
            />
            <StepRow
              number={2}
              title={t('insurance.hub.step2Title')}
              caption={t('insurance.hub.step2Caption')}
              showDivider
            />
            <StepRow
              number={3}
              title={t('insurance.hub.step3Title')}
              caption={t('insurance.hub.step3Caption')}
              showDivider={false}
            />
          </View>

          <View style={styles.nextStepsHeader}>
            <Text style={styles.nextStepsTitle}>{t('insurance.hub.nextSteps')}</Text>
            <Text style={styles.nextStepsProgress}>{progressLabel}</Text>
          </View>

          <View style={styles.taskList}>
            {flowTasks.map((task) => (
              <TaskCard
                key={task.key}
                task={task}
                glow={task.key === firstIncompleteTaskKey}
                resolving={resolvingTaskKey === task.key}
                disabled={anyLoading}
                onPress={() => void onTaskPress(task)}
              />
            ))}
          </View>

          <Pressable
            disabled={!allFlowStepsComplete || navigating || anyLoading}
            style={({ pressed }) => [
              styles.reportBtn,
              (!allFlowStepsComplete || reportLooksSubmitted) && styles.reportBtnDisabled,
              pressed && allFlowStepsComplete && styles.reportBtnPressed,
            ]}
            onPress={onReportAccident}
            accessibilityRole="button"
            accessibilityLabel={t('insurance.hub.reportAccident')}
            accessibilityHint={
              claimReportLocked ? t('insurance.hub.reportAccidentHint') : undefined
            }
            accessibilityState={{ disabled: !allFlowStepsComplete || navigating || anyLoading }}>
            <Text
              style={[
                styles.reportBtnText,
                (!allFlowStepsComplete || reportLooksSubmitted) && styles.reportBtnTextDisabled,
              ]}>
              {t('insurance.hub.reportAccident')}
            </Text>
          </Pressable>
          {claimReportLocked ? (
            <Text style={styles.reportLockedHint}>{t('insurance.hub.reportLockedHint')}</Text>
          ) : incompleteUpload ? (
            <Text style={styles.reportIncompleteHint}>
              {t('insurance.hub.reportResumeHint', { percent: incompleteUpload.percent })}
            </Text>
          ) : null}
        </ScrollView>

        <BottomNavBar activeTab="home" />
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
  // Shadow lives here, not on callInsurerBtn — see taskCardGlowWrap's comment:
  // a Pressable's style array is recreated on every press/glow re-render, and
  // a shadow/elevation prop riding along with it is what caused the
  // intermittent corner-artifact glitch on Android. This wrapper's style
  // object is static, so its shadow never gets invalidated/redrawn.
  callInsurerGlowWrap: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
    marginBottom: 32,
    // So GlowHalo (an absolutely-positioned sibling with negative insets) sits
    // relative to this wrap's own edges, not some further-up ancestor.
    position: 'relative',
  },
  // While glowing, this wrap's own static gray border would sit right next to
  // callInsurerBtn's now-orange border (near-zero gap between them), reading
  // as one noticeably thicker/bigger ring than the plain single-border look.
  // Hiding this outer border while glowing leaves exactly one visible 1px
  // border — same thickness as always, just recolored.
  callInsurerGlowWrapActive: {
    borderColor: 'transparent',
  },
  // flexDirection: 'row' directly on the Pressable (not a centered inner
  // wrapper) so the icon sits at a fixed left position regardless of how
  // long the insurer's name is — a centered icon+text block shifted the
  // icon's x-position depending on text length.
  callInsurerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 16,
    paddingHorizontal: 16,
    // borderWidth stays present at all times, and at a fixed value (only
    // borderColor ever changes, via callInsurerBtnGlowing below) — toggling
    // borderWidth itself between two different values makes Android rebuild
    // this view's background drawable, which flashes an opaque white frame
    // over the button (hiding its text/icon) right as the glow turns on or
    // off. 2 (not 1) so the glow reads clearly — invisible either way while
    // borderColor stays transparent, so this doesn't affect the plain look.
    borderWidth: 2,
    borderColor: 'transparent',
    // Opaque (matching the wrap it sits in), not transparent — GlowHalo sits
    // behind this as a sibling, and a transparent background here let it
    // wash through the whole button's interior instead of only peeking out
    // past its edges. Still overridden by callInsurerPressed on press.
    backgroundColor: COLORS.cardBg,
    // No marginBottom here — moved to callInsurerGlowWrap (see its comment) so the
    // glow halo's insets stay symmetric. Branches that render callInsurerBtn
    // without that wrap (the resolving-state view below) apply the same wrap style
    // themselves purely for this spacing.
  },
  // Dark-orange border on the button itself while glowing (not the halo) — same
  // color as the numbered step badges' text. Only recolors the always-present
  // border (see callInsurerBtn) rather than adding one.
  callInsurerBtnGlowing: {
    borderColor: INSURANCE_PRIMARY,
  },
  callInsurerPressed: {
    backgroundColor: INSURANCE_PRESSED_SURFACE,
  },
  // The button's own layout is left-aligned (for the icon+text case above),
  // but when this is showing just a spinner with no icon/text, it should
  // still be centered rather than sitting at the left edge.
  callInsurerCalling: {
    opacity: 0.7,
    justifyContent: 'center',
  },
  callInsurerText: {
    flex: 1,
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
    marginBottom: 32,
    backgroundColor: COLORS.cardBg,
    borderRadius: 15,
    paddingHorizontal: 16,
    shadowColor: INSURANCE_SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
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
    marginBottom: 8,
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
  // Shadow lives here, not on taskCard — taskCard is a Pressable whose style
  // array changes on every press/glow-state re-render; a shadow/elevation
  // prop riding along with a style that's recreated that often is what caused
  // the intermittent corner-artifact glitch on Android. This wrapper's style
  // object is static, so its shadow never gets invalidated/redrawn.
  taskCardGlowWrap: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    // So GlowHalo (an absolutely-positioned sibling with negative insets) sits
    // relative to this wrap's own edges, not some further-up ancestor.
    position: 'relative',
  },
  // Same reasoning as callInsurerGlowWrapActive above — hides this outer gray
  // border while the card is glowing so only taskCard's own now-orange border
  // shows, keeping the visible border at one consistent 1px thickness.
  taskCardGlowWrapActive: {
    borderColor: 'transparent',
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 16,
    paddingHorizontal: 16,
    // borderWidth stays present at all times, and at a fixed value (only
    // borderColor ever changes, via taskCardGlowing below) — see
    // callInsurerBtn's comment for why toggling borderWidth itself flashes an
    // opaque white frame on Android. 2 (not 1) so the glow reads clearly.
    borderWidth: 2,
    borderColor: 'transparent',
    // Opaque (matching the wrap it sits in), not transparent — GlowHalo sits
    // behind this as a sibling, and a transparent background here let it
    // wash through the whole card's interior instead of only peeking out
    // past its edges. Still overridden by taskCardPressed on press.
    backgroundColor: COLORS.cardBg,
  },
  taskIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: CAPTURE_ACTION_BLUE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  // Same treatment as callInsurerBtnGlowing — recolors the always-present
  // border (see taskCard) while this is the glowing (first-incomplete) card.
  taskCardGlowing: {
    borderColor: INSURANCE_PRIMARY,
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
