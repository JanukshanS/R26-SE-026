import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { MapPreview } from "@components/ui/map-preview";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
import { useHardwareBack } from "@lib/useHardwareBack";
import { haptics } from "@lib/haptics";
import {
  getProvider,
  haversineKm,
  providerTypeLabel,
  type ProviderRecord,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation, FALLBACK_LOCATION } from "@lib/driverLocation";

/** Display ETA in whole minutes from the backend's computed travel time. */
function formatEta(min?: number): string {
  if (!min || min <= 0) return "~5 min";
  return `${Math.max(1, Math.round(min))} min`;
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

  useEffect(() => {
    if (!sp?.id) return;
    getProvider(sp.id).then(setProvider).catch(() => setProvider(null));
  }, [sp?.id]);

  // Success haptic — fire once when the dispatch result first lands on this screen.
  const successFired = useRef(false);
  useEffect(() => {
    if (dispatchResult && !successFired.current) {
      successFired.current = true;
      haptics.success();
    }
  }, [dispatchResult]);

  const distanceKm = provider
    ? haversineKm(
        { latitude: driverLoc.latitude, longitude: driverLoc.longitude },
        { latitude: provider.latitude, longitude: provider.longitude },
      )
    : null;

  const etaText      = sp?.estimatedTravelTimeMin
    ? `${Math.max(1, Math.round(sp.estimatedTravelTimeMin))} min ETA`
    : null;
  const distanceText = distanceKm !== null ? `${distanceKm.toFixed(1)} km away` : null;

  // Call / message the assigned provider. The phone number is part of the
  // provider record fetched above; until it resolves (or if the provider has
  // none on file) the pills are disabled rather than silently doing nothing.
  const providerPhone = provider?.phone ?? null;
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
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <View
              style={{
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: palette.success,
              }}
            />
            <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>
              Connected
            </Text>
          </View>
        }
      />
      <Text style={{ ...typography.h1, color: palette.text }}>
        Connected to {sp ? providerTypeLabel(sp.type) : "Mechanic"}
      </Text>

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
              {sp?.name ?? "Fetching provider..."}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name="Star" size={12} color={palette.warning} />
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {sp ? providerTypeLabel(sp.type) : "—"}
                {provider ? ` · Trust ${(provider.trustScore * 100).toFixed(0)}%` : ""}
              </Text>
            </View>
          </View>
          <ActionPill
            icon="MessageCircle"
            accessibilityLabel={sp ? `Message ${sp.name}` : "Message provider"}
            disabled={!providerPhone}
            onPress={() => providerPhone && openLink(`sms:${providerPhone}`)}
          />
          <ActionPill
            icon="Phone"
            tone="brand"
            accessibilityLabel={sp ? `Call ${sp.name}` : "Call provider"}
            disabled={!providerPhone}
            onPress={() => providerPhone && openLink(`tel:${providerPhone}`)}
          />
        </Card>
      </Animated.View>

      {/* Live map with driver + provider pins, dashed route, and an ETA /
          distance overlay at the bottom. Driver coord comes from real GPS
          when permitted (lib/driverLocation.ts), otherwise the Malabe
          fallback. */}
      <Animated.View entering={FadeInDown.delay(60).springify()}>
        <MapPreview
          driverLocation={{ latitude: driverLoc.latitude, longitude: driverLoc.longitude }}
          provider={provider}
          etaText={etaText}
          distanceText={distanceText}
        />
      </Animated.View>

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
                {formatEta(sp?.estimatedTravelTimeMin)}
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
      {dispatchResult && (
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
