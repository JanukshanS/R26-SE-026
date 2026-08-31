import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ConfirmDialog } from "@components/ui/confirm-dialog";
import { JobConfirmationCard, type Stars } from "@components/ui/job-confirmation-card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { MapPreview } from "@components/ui/map-preview";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
import { useHardwareBack } from "@lib/useHardwareBack";
import { haptics } from "@lib/haptics";
import {
  cancelIncident,
  getIncident,
  getProvider,
  confirmIncident,
  haversineKm,
  providerTypeLabel,
  type ProviderRecord,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation, FALLBACK_LOCATION } from "@lib/driverLocation";
import { useT, type Translate } from "@lib/i18n";

type IncidentDetail = Awaited<ReturnType<typeof getIncident>>;

const POLL_INTERVAL_MS = 5000;

/** Nothing left to watch once the job ends — polling stops here. */
const TERMINAL_STATUSES = ["RESOLVED", "ESCALATED", "CANCELLED"];

/**
 * While the job is still being offered around, the driver can call it off.
 *
 * EN_ROUTE is deliberately absent: by then a provider has accepted and is
 * driving to the scene, so calling it off is a phone call, not a button. The
 * backend enforces the same list — this only decides whether to show the
 * control, it is not the check that matters.
 */
const CANCELLABLE_STATUSES = ["CREATED", "TRIAGING", "DISPATCHING", "PROVIDER_ASSIGNED"];

/** Display ETA in whole minutes from the backend's computed travel time. */
function formatEta(min: number | undefined, t: Translate): string {
  if (!min || min <= 0) return t("emergency.connected.etaFallback");
  return t("emergency.connected.etaMinutes", { minutes: Math.max(1, Math.round(min)) });
}

/** Headline, explanation and badge for each lifecycle state the driver can be in. */
function statusMeta(status: string, providerName: string | null, t: Translate): {
  title: string;
  detail: string;
  badge: string;
  tone: "neutral" | "success" | "warning" | "danger" | "brand";
} {
  const who = providerName ?? t("emergency.connected.fallbackProvider");
  switch (status) {
    case "EN_ROUTE":
      return {
        title: t("emergency.connected.enRouteTitle"),
        detail: t("emergency.connected.enRouteDetail", { name: who }),
        badge: t("emergency.connected.badgeEnRoute"),
        tone: "brand",
      };
    case "ON_SCENE":
      return {
        title: t("emergency.connected.onSceneTitle", { name: who }),
        detail: t("emergency.connected.onSceneDetail"),
        badge: t("emergency.connected.badgeOnScene"),
        tone: "success",
      };
    case "RESOLVED":
      return {
        title: t("emergency.connected.resolvedTitle"),
        detail: t("emergency.connected.resolvedDetail"),
        badge: t("emergency.connected.badgeResolved"),
        tone: "success",
      };
    case "ESCALATED":
      return {
        title: t("emergency.connected.escalatedTitle"),
        detail: t("emergency.connected.escalatedDetail"),
        badge: t("emergency.connected.badgeEscalated"),
        tone: "danger",
      };
    case "CANCELLED":
      return {
        title: t("emergency.connected.cancelledTitle"),
        detail: t("emergency.connected.cancelledDetail"),
        badge: t("emergency.connected.badgeCancelled"),
        tone: "neutral",
      };
    case "DISPATCHING":
      return {
        title: t("emergency.connected.dispatchingTitle"),
        detail: providerName
          ? t("emergency.connected.dispatchingDetail")
          : t("emergency.connected.dispatchingDetailDeclined"),
        badge: t("emergency.connected.badgeDispatching"),
        tone: "warning",
      };
    default:
      return {
        title: t("emergency.connected.assignedTitle"),
        detail: t("emergency.connected.assignedDetail", {
          name: providerName ?? t("emergency.connected.fallbackProviderLower"),
        }),
        badge: t("emergency.connected.badgeAssigned"),
        tone: "warning",
      };
  }
}

export default function ConnectedScreen() {
  const t = useT();
  const { dispatchResult, reset } = useEmergency();
  const sp = dispatchResult?.selectedProvider;

  /**
   * Set the instant we start navigating away, and never unset.
   *
   * `reset()` clears `dispatchResult` synchronously, and React re-renders
   * before the navigation commits — so the "we lost this request" branch
   * below rendered for a frame on the way out, flashing an error at a driver
   * whose job had just gone perfectly fine. The branch is for a genuinely
   * absent result (web reload, deep link), not for a screen being left.
   */
  const leaving = useRef(false);

  const goHome = useCallback(() => {
    leaving.current = true;
    reset();
    router.replace("/(driver)/home");
  }, [reset]);

  // Job is dispatched — back returns home (clearing the emergency state for a
  // fresh start), never into the now-stale questionnaire.
  useHardwareBack(useCallback(() => {
    goHome();
    return true;
  }, [goHome]));

  // After dispatch we fetch the provider's full record so we have lat/lng
  // for the map view and distance display.
  const [provider, setProvider] = useState<ProviderRecord | null>(null);

  // Driver location — same coordinates used at incident creation, pulled
  // from the cache (set by safety-check / quick-dispatch on entry). Cached
  // in lib/driverLocation.ts so this resolves synchronously after the
  // first call earlier in the flow.
  const [driverLoc, setDriverLoc] = useState(FALLBACK_LOCATION);
  useEffect(() => {
    getCurrentDriverLocation().then(setDriverLoc).catch(() => {});
  }, []);

  // Failure is surfaced rather than swallowed: without the record there is no
  // phone number, so Call and Message stay disabled and the card shows "—"
  // with nothing telling the driver why or that it can be retried.
  const [providerError, setProviderError] = useState<string | null>(null);
  const loadProvider = useCallback(() => {
    if (!sp?.id) return;
    setProviderError(null);
    getProvider(sp.id)
      .then((p) => { setProvider(p); })
      .catch((err: unknown) => {
        setProvider(null);
        setProviderError(err instanceof Error ? err.message : t("emergency.connected.dispatchUnreachable"));
      });
  }, [sp?.id, t]);

  useEffect(() => { loadProvider(); }, [loadProvider]);

  // dispatchResult is a snapshot from the moment the optimizer answered. The
  // job moves on without it — the provider accepts, declines, arrives, closes
  // it — so poll the incident while this screen is focused and show the real
  // state. Stops on blur, on unmount, and once the job reaches a terminal
  // status (a screen that polls forever drains a stranded driver's battery).
  const incidentId = dispatchResult?.incidentId ?? null;
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  const status = incident?.status ?? "PROVIDER_ASSIGNED";
  const terminal = TERMINAL_STATUSES.includes(status);

  useFocusEffect(
    useCallback(() => {
      if (!incidentId || terminal) return;
      const id = incidentId;
      let cancelled = false;
      let inFlight = false;

      async function tick() {
        if (inFlight) return;
        inFlight = true;
        try {
          const next = await getIncident(id);
          if (cancelled) return;
          setIncident(next);
          setPollError(null);
          // A refused cancel explains itself against the status at the time.
          // Once a fresh status has landed, the status card says it better,
          // and leaving the old line up reads as a live error.
          setCancelError(null);
        } catch (err) {
          // Never blank good data on a failed poll — the driver still needs
          // the provider's phone number when the network is flaky.
          if (cancelled) return;
          setPollError(
            err instanceof Error ? err.message : t("emergency.connected.dispatchUnreachable")
          );
        } finally {
          inFlight = false;
        }
      }

      void tick();
      const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        clearInterval(handle);
      };
    }, [incidentId, terminal, t])
  );

  // Success haptic — fire once when the dispatch result first lands on this screen.
  const successFired = useRef(false);
  useEffect(() => {
    if (dispatchResult && !successFired.current) {
      successFired.current = true;
      haptics.success();
    }
  }, [dispatchResult]);

  // Once the incident has been polled, it is the truth about who is coming:
  // a decline clears assignedProviderId, and a re-dispatch replaces it. Before
  // the first poll lands we fall back to the record fetched above.
  const currentProvider = incident ? incident.assignedProvider ?? null : provider;
  const displayName = currentProvider?.name ?? (incident ? null : sp?.name ?? null);
  const searching = status === "DISPATCHING";
  const meta = statusMeta(status, displayName, t);

  const distanceKm = currentProvider
    ? haversineKm(
        { latitude: driverLoc.latitude, longitude: driverLoc.longitude },
        { latitude: currentProvider.latitude, longitude: currentProvider.longitude },
      )
    : null;

  // The dispatch snapshot's travel time belongs to the originally selected
  // provider, so it only applies while that provider is still the assigned one.
  const etaMin = currentProvider?.id === sp?.id ? sp?.estimatedTravelTimeMin : undefined;
  const showEta =
    !!currentProvider && (status === "PROVIDER_ASSIGNED" || status === "EN_ROUTE");

  const etaText      = showEta && etaMin
    ? t("emergency.connected.etaBadge", { minutes: Math.max(1, Math.round(etaMin)) })
    : null;
  const distanceText = distanceKm !== null
    ? t("emergency.connected.distanceAway", { km: distanceKm.toFixed(1) })
    : null;

  // Call / message the assigned provider. The phone number is part of the
  // provider record fetched above; until it resolves (or if the provider has
  // none on file) the pills are disabled rather than silently doing nothing.
  const providerPhone = currentProvider?.phone ?? null;
  const openLink = (url: string) =>
    Linking.openURL(url).catch(() =>
      Alert.alert(t("emergency.connected.linkFailedTitle"), t("emergency.connected.linkFailedBody")),
    );

  // ── Calling the request off ─────────────────────────────────────
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const doCancel = useCallback(async () => {
    if (!incidentId || cancelling) return;
    setCancelling(true);
    try {
      await cancelIncident(incidentId);
      haptics.success();
      setConfirmingCancel(false);
      // Nothing left to watch, so do not park the driver on a tracking screen
      // for a job that no longer exists — take them home.
      goHome();
    } catch (err) {
      // The likeliest failure by far is a 409: a provider accepted in the
      // seconds between the screen rendering the button and the driver
      // pressing it. Refresh so the screen shows what actually happened
      // ("Help is on the way") instead of a stale Cancel button.
      haptics.error();
      setConfirmingCancel(false);
      setCancelError(
        err instanceof Error ? err.message : t("emergency.connected.dispatchUnreachable")
      );
      try {
        setIncident(await getIncident(incidentId));
      } catch {
        /* the poll will catch up on its next tick */
      }
    } finally {
      setCancelling(false);
    }
  }, [incidentId, cancelling, goHome, t]);

  // ── Confirming the job, and optionally rating it ──
  const submitConfirmation = useCallback(async (input: { resolved: boolean; rating?: Stars }) => {
    if (!incidentId) return;
    await confirmIncident(incidentId, input);
    // Re-read rather than assuming: the response confirms the rating, but the
    // incident row is what the card reads to decide it has been answered.
    try {
      setIncident(await getIncident(incidentId));
    } catch {
      /* the card falls back to its own submitted state on the next poll */
    }
  }, [incidentId]);

  // Traffic-impact score from geo-intelligence — the signal that drives dispatch
  // prioritisation. Priority bands + colours mirror the geo model's thresholds.
  const impactScore = dispatchResult?.metadata.trafficImpactScore ?? null;
  const impactSource = dispatchResult?.metadata.trafficImpactSource;
  const impactPriorityKey =
    impactScore === null ? "" :
    impactScore >= 8 ? "emergency.connected.priorityCritical" :
    impactScore >= 5 ? "emergency.connected.priorityHigh" :
    impactScore >= 3 ? "emergency.connected.priorityMedium" : "emergency.connected.priorityLow";
  const impactColor =
    impactScore === null ? palette.textMuted :
    impactScore >= 8 ? palette.danger :
    impactScore >= 5 ? palette.brand :
    impactScore >= 3 ? palette.warning : palette.success;

  // Without the dispatch result there is no incident to poll and no provider to
  // show — every field below would be invented. Say so instead of rendering an
  // assignment that does not exist (web reload / deep link).
  if (!dispatchResult) {
    // On the way out this branch would flash an error over a job that ended
    // perfectly well; render nothing for the frame or two before the
    // navigation commits.
    if (leaving.current) return null;
    return (
      <Screen
        footer={<Button title={t("emergency.action.backHome")} onPress={goHome} />}
      >
        <HeaderBar showBack={false} />
        <Text style={{ ...typography.h1, color: palette.text }}>{t("emergency.connected.requestTitle")}</Text>
        <ErrorState
          title={t("emergency.connected.lostTitle")}
          message={t("emergency.connected.lostBody")}
        />
      </Screen>
    );
  }

  // `status` falls back to PROVIDER_ASSIGNED before the first poll answers, so
  // gate on the status we have actually been told. Otherwise a driver
  // returning to this screen after a provider accepted sees a Cancel button
  // for the first few hundred milliseconds — offering something the backend
  // will refuse.
  const knownStatus = incident?.status ?? null;
  const canCancel = !!incidentId && !!knownStatus && CANCELLABLE_STATUSES.includes(knownStatus);

  // Rating is offered only once the provider has closed the job, and only when
  // there is a resolution record for it to attach to.
  const feedback = incident?.feedback ?? null;
  const showRating = knownStatus === "RESOLVED" && !!feedback;

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.sm }}>
          {canCancel && (
            <Button
              title={cancelling ? t("emergency.connected.cancelling") : t("emergency.connected.cancelAction")}
              variant="danger"
              disabled={cancelling}
              onPress={() => setConfirmingCancel(true)}
            />
          )}
          <Button
            title={t("emergency.action.backHome")}
            variant="secondary"
            onPress={goHome}
          />
        </View>
      }
    >
      <ConfirmDialog
        visible={confirmingCancel}
        destructive
        busy={cancelling}
        icon="CircleX"
        title={t("emergency.connected.cancelTitle")}
        message={t("emergency.connected.cancelBody")}
        confirmLabel={cancelling ? t("emergency.connected.cancelling") : t("emergency.connected.cancelConfirm")}
        cancelLabel={t("emergency.connected.cancelKeep")}
        onConfirm={() => void doCancel()}
        onCancel={() => setConfirmingCancel(false)}
      />

      <HeaderBar
        showBack={false}
        right={<Badge label={meta.badge} tone={meta.tone} withDot />}
      />
      <Text style={{ ...typography.h1, color: palette.text }}>
        {meta.title}
      </Text>

      {/* A cancel that was refused — almost always because a provider accepted
          first. Kept on the screen rather than in a dismissable alert, since
          the status card right below it now explains what happened instead. */}
      {cancelError && (
        <Text style={{ ...typography.caption, color: palette.danger }}>{cancelError}</Text>
      )}

      {/* The provider says the job is done. This is the only place the driver
          is ever asked whether it actually was, and their answer is what
          decides if the dispatch counted as a success. */}
      {showRating && (
        <Animated.View entering={FadeInDown.springify()}>
          <JobConfirmationCard
            providerName={provider?.name ?? sp?.name ?? t("emergency.connected.fallbackProvider")}
            confirmed={feedback?.driverConfirmed ?? null}
            rating={feedback?.userRating ?? null}
            onSubmit={submitConfirmation}
          />
        </Animated.View>
      )}

      {/* What is actually happening to the request right now, straight from
          the polled incident status. */}
      <Animated.View entering={FadeInDown.springify()}>
        <Card style={{ gap: spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            {searching && <ActivityIndicator size="small" color={palette.brand} />}
            <Text style={{ ...typography.body, color: palette.textMuted, flex: 1 }}>
              {meta.detail}
            </Text>
          </View>
          {pollError && (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {t("emergency.connected.pollPaused", { message: pollError })}
            </Text>
          )}
        </Card>
      </Animated.View>

      {(currentProvider || !incident) && (
        <Animated.View entering={FadeInDown.delay(0).springify()}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View
              style={{
                width: 56, height: 56, borderRadius: 28,
                backgroundColor: palette.surfaceMuted,
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Icon name="UserRound" size={26} color={palette.textMuted} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                {displayName ?? t("emergency.connected.fetchingProvider")}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name="Star" size={12} color={palette.warning} />
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {currentProvider
                    ? t("emergency.connected.typeWithTrust", {
                        type: providerTypeLabel(currentProvider.type, t),
                        trust: (currentProvider.trustScore * 100).toFixed(0),
                      })
                    : sp ? providerTypeLabel(sp.type, t) : "—"}
                </Text>
              </View>
            </View>
            <ActionPill
              icon="MessageCircle"
              accessibilityLabel={displayName
                ? t("emergency.connected.messageNamedA11y", { name: displayName })
                : t("emergency.connected.messageA11y")}
              disabled={!providerPhone}
              onPress={() => providerPhone && openLink(`sms:${providerPhone}`)}
            />
            <ActionPill
              icon="Phone"
              tone="brand"
              accessibilityLabel={displayName
                ? t("emergency.connected.callNamedA11y", { name: displayName })
                : t("emergency.connected.callA11y")}
              disabled={!providerPhone}
              onPress={() => providerPhone && openLink(`tel:${providerPhone}`)}
            />
          </Card>
        </Animated.View>
      )}

      {providerError && !incident && (
        <ErrorState
          title={t("emergency.connected.contactUnavailableTitle")}
          message={t("emergency.connected.contactUnavailableBody", { message: providerError })}
          onRetry={loadProvider}
        />
      )}

      {/* Live map with driver + provider pins, dashed route, and an ETA /
          distance overlay at the bottom. Driver coord comes from real GPS
          when permitted (lib/driverLocation.ts), otherwise the Malabe
          fallback. */}
      <Animated.View entering={FadeInDown.delay(60).springify()}>
        <MapPreview
          driverLocation={{ latitude: driverLoc.latitude, longitude: driverLoc.longitude }}
          provider={currentProvider}
          etaText={etaText}
          distanceText={distanceText}
        />
      </Animated.View>

      {showEta && (
        <Animated.View entering={FadeInDown.delay(120).springify()}>
          <Card>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <View style={{ gap: 2 }}>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {t("emergency.connected.etaHeading")}
                </Text>
                <Text style={{ ...typography.h2, color: palette.text }}>
                  {etaMin ? formatEta(etaMin, t) : "—"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {t("emergency.connected.distanceHeading")}
                </Text>
                <Text style={{ ...typography.h2, color: palette.text }}>
                  {distanceKm !== null ? `${distanceKm.toFixed(1)} km` : "—"}
                </Text>
              </View>
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Traffic-impact score from geo-intelligence — the signal that drives
          dispatch prioritisation: a higher score pushes the optimizer toward a
          faster, higher-trust provider. */}
      {impactScore !== null && (
        <Animated.View entering={FadeInDown.delay(180).springify()}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 }}>
                <Icon name="Gauge" size={24} color={impactColor} />
                <View style={{ gap: 2, flex: 1 }}>
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>
                    {t("emergency.connected.impactHeading")}
                  </Text>
                  <Text style={{ ...typography.bodyStrong, color: impactColor }}>
                    {t(
                      impactSource === "geo-intelligence"
                        ? "emergency.connected.impactPriorityLive"
                        : "emergency.connected.impactPriority",
                      { priority: t(impactPriorityKey) }
                    )}
                  </Text>
                </View>
              </View>
              <Text style={{ ...typography.display, color: impactColor }}>
                {impactScore.toFixed(1)}
              </Text>
            </View>
          </Card>
        </Animated.View>
      )}

      {/* Debug card — top-3 from the ranked providers list. Useful in viva
          to show ECM is actually ranking, not just picking nearest. */}
      {/* The ranking is a snapshot of the optimizer run that produced this
          assignment. Once the provider has declined it names someone who is
          no longer coming, so it goes away while a new one is being found. */}
      {dispatchResult && !searching && (
        <Animated.View entering={FadeInDown.delay(240).springify()}>
          <Card variant="muted">
            <Text style={{ ...typography.micro, color: palette.textMuted }}>
              {t("emergency.connected.rankingHeading")}
            </Text>
            {dispatchResult.allRankedProviders.slice(0, 3).map((p) => (
              <View
                key={p.providerId}
                style={{
                  flexDirection: "row", justifyContent: "space-between",
                  paddingVertical: 4,
                }}
              >
                <Text style={{ ...typography.caption, color: palette.text }}>
                  #{p.rank} {p.name}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {t("emergency.connected.costMinutes", { minutes: p.expectedCost.toFixed(1) })}
                </Text>
              </View>
            ))}
            <Text style={{ ...typography.micro, color: palette.textMuted, marginTop: 4 }}>
              {t("emergency.connected.ecmSummary", {
                ms: dispatchResult.metadata.computationTimeMs.toFixed(2),
                count: dispatchResult.metadata.providersEvaluated,
              })}
            </Text>
          </Card>
        </Animated.View>
      )}
    </Screen>
  );
}

function ActionPill({
  icon, tone, onPress, accessibilityLabel, disabled,
}: {
  icon: IconName;
  tone?: "brand";
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: tone === "brand" ? palette.brand : palette.surfaceMuted,
        alignItems: "center", justifyContent: "center",
      })}
    >
      <Icon
        name={icon}
        size={16}
        color={tone === "brand" ? palette.textOnBrand : palette.text}
      />
    </Pressable>
  );
}
