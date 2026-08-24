import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
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
  getIncident,
  getProvider,
  haversineKm,
  providerTypeLabel,
  type ProviderRecord,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation, FALLBACK_LOCATION } from "@lib/driverLocation";

type IncidentDetail = Awaited<ReturnType<typeof getIncident>>;

const POLL_INTERVAL_MS = 5000;

/** Nothing left to watch once the job ends — polling stops here. */
const TERMINAL_STATUSES = ["RESOLVED", "ESCALATED", "CANCELLED"];

/** Display ETA in whole minutes from the backend's computed travel time. */
function formatEta(min?: number): string {
  if (!min || min <= 0) return "~5 min";
  return `${Math.max(1, Math.round(min))} min`;
}

/** Headline, explanation and badge for each lifecycle state the driver can be in. */
function statusMeta(status: string, providerName: string | null): {
  title: string;
  detail: string;
  badge: string;
  tone: "neutral" | "success" | "warning" | "danger" | "brand";
} {
  const who = providerName ?? "Your provider";
  switch (status) {
    case "EN_ROUTE":
      return {
        title: "Help is on the way",
        detail: `${who} accepted the job and is heading to you now.`,
        badge: "En route",
        tone: "brand",
      };
    case "ON_SCENE":
      return {
        title: `${who} has arrived`,
        detail: "They're at your location. Flag them down if they can't spot your vehicle.",
        badge: "On scene",
        tone: "success",
      };
    case "RESOLVED":
      return {
        title: "Job complete",
        detail: "This request has been closed. You can head back to the home screen.",
        badge: "Resolved",
        tone: "success",
      };
    case "ESCALATED":
      return {
        title: "Escalated",
        detail: "This needed more than roadside help, so it's been escalated for follow-up.",
        badge: "Escalated",
        tone: "danger",
      };
    case "CANCELLED":
      return {
        title: "Request cancelled",
        detail: "This request is no longer active.",
        badge: "Cancelled",
        tone: "neutral",
      };
    case "DISPATCHING":
      return {
        title: "Finding a new provider",
        detail: providerName
          ? "Dispatch is assigning a provider to your request."
          : "The provider you were matched with declined. Dispatch is finding someone else — this usually takes a few seconds.",
        badge: "Re-dispatching",
        tone: "warning",
      };
    default:
      return {
        title: "Provider assigned",
        detail: `Waiting for ${providerName ?? "your provider"} to accept the job.`,
        badge: "Awaiting accept",
        tone: "warning",
      };
  }
}

export default function ConnectedScreen() {
  const { dispatchResult, reset } = useEmergency();
  const sp = dispatchResult?.selectedProvider;

  // Job is dispatched — back returns home (clearing the emergency state for a
  // fresh start), never into the now-stale questionnaire.
  useHardwareBack(useCallback(() => {
    reset();
    router.replace("/(driver)/home");
    return true;
  }, [reset]));

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
        setProviderError(err instanceof Error ? err.message : "Couldn't reach the dispatch service.");
      });
  }, [sp?.id]);

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
        } catch (err) {
          // Never blank good data on a failed poll — the driver still needs
          // the provider's phone number when the network is flaky.
          if (cancelled) return;
          setPollError(
            err instanceof Error ? err.message : "Couldn't reach the dispatch service."
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
    }, [incidentId, terminal])
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
  const meta = statusMeta(status, displayName);

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
    ? `${Math.max(1, Math.round(etaMin))} min ETA`
    : null;
  const distanceText = distanceKm !== null ? `${distanceKm.toFixed(1)} km away` : null;

  // Call / message the assigned provider. The phone number is part of the
  // provider record fetched above; until it resolves (or if the provider has
  // none on file) the pills are disabled rather than silently doing nothing.
  const providerPhone = currentProvider?.phone ?? null;
  const openLink = (url: string) =>
    Linking.openURL(url).catch(() =>
      Alert.alert("Unavailable", "Couldn't open this on your device."),
    );

  // Traffic-impact score from geo-intelligence — the signal that drives dispatch
  // prioritisation. Priority bands + colours mirror the geo model's thresholds.
  const impactScore = dispatchResult?.metadata.trafficImpactScore ?? null;
  const impactSource = dispatchResult?.metadata.trafficImpactSource;
  const impactPriority =
    impactScore === null ? "" :
    impactScore >= 8 ? "CRITICAL" :
    impactScore >= 5 ? "HIGH" :
    impactScore >= 3 ? "MEDIUM" : "LOW";
  const impactColor =
    impactScore === null ? palette.textMuted :
    impactScore >= 8 ? palette.danger :
    impactScore >= 5 ? palette.brand :
    impactScore >= 3 ? palette.warning : palette.success;

  // Without the dispatch result there is no incident to poll and no provider to
  // show — every field below would be invented. Say so instead of rendering an
  // assignment that does not exist (web reload / deep link).
  if (!dispatchResult) {
    return (
      <Screen
        footer={
          <Button
            title="Back to Home screen"
            onPress={() => {
              reset();
              router.replace("/(driver)/home");
            }}
          />
        }
      >
        <HeaderBar showBack={false} />
        <Text style={{ ...typography.h1, color: palette.text }}>Request</Text>
        <ErrorState
          title="We lost this request"
          message="This screen no longer has your dispatch details, so we can't show who is coming. Start the request again from the home screen."
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <Button
          title="Back to Home screen"
          variant="secondary"
          onPress={() => {
            reset();
            router.replace("/(driver)/home");
          }}
        />
      }
    >
      <HeaderBar
        showBack={false}
        right={<Badge label={meta.badge} tone={meta.tone} withDot />}
      />
      <Text style={{ ...typography.h1, color: palette.text }}>
        {meta.title}
      </Text>

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
              Live updates paused — {pollError} Still retrying in the background.
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
                {displayName ?? "Fetching provider..."}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon name="Star" size={12} color={palette.warning} />
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  {currentProvider ? providerTypeLabel(currentProvider.type)
                    : sp ? providerTypeLabel(sp.type) : "—"}
                  {currentProvider ? ` · Trust ${(currentProvider.trustScore * 100).toFixed(0)}%` : ""}
                </Text>
              </View>
            </View>
            <ActionPill
              icon="MessageCircle"
              accessibilityLabel={displayName ? `Message ${displayName}` : "Message provider"}
              disabled={!providerPhone}
              onPress={() => providerPhone && openLink(`sms:${providerPhone}`)}
            />
            <ActionPill
              icon="Phone"
              tone="brand"
              accessibilityLabel={displayName ? `Call ${displayName}` : "Call provider"}
              disabled={!providerPhone}
              onPress={() => providerPhone && openLink(`tel:${providerPhone}`)}
            />
          </Card>
        </Animated.View>
      )}

      {providerError && !incident && (
        <ErrorState
          title="Contact details unavailable"
          message={`${providerError} Your job is dispatched — the provider is still on the way. Try again to load their phone number.`}
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
                  Estimated Arrival
                </Text>
                <Text style={{ ...typography.h2, color: palette.text }}>
                  {etaMin ? formatEta(etaMin) : "—"}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={{ ...typography.caption, color: palette.textMuted }}>
                  Distance
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
                    Traffic Impact · Geo-Intelligence
                  </Text>
                  <Text style={{ ...typography.bodyStrong, color: impactColor }}>
                    {impactPriority} priority{impactSource === "geo-intelligence" ? " · live" : ""}
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
              DISPATCH RANKING (top 3)
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
                  {p.expectedCost.toFixed(1)} min
                </Text>
              </View>
            ))}
            <Text style={{ ...typography.micro, color: palette.textMuted, marginTop: 4 }}>
              ECM computed in {dispatchResult.metadata.computationTimeMs.toFixed(2)}ms over{" "}
              {dispatchResult.metadata.providersEvaluated} providers
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
