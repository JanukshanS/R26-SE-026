import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { MapPreview } from "@components/ui/map-preview";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
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
        <ActionPill icon="MessageCircle" />
        <ActionPill icon="Phone" tone="brand" />
      </Card>

      {/* Live map with driver + provider pins, dashed route, and an ETA /
          distance overlay at the bottom. Driver coord comes from real GPS
          when permitted (lib/driverLocation.ts), otherwise the Malabe
          fallback. */}
      <MapPreview
        driverLocation={{ latitude: driverLoc.latitude, longitude: driverLoc.longitude }}
        provider={provider}
        etaText={etaText}
        distanceText={distanceText}
      />

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

      {/* Debug card — top-3 from the ranked providers list. Useful in viva
          to show ECM is actually ranking, not just picking nearest. */}
      {dispatchResult && (
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
      )}
    </Screen>
  );
}

function ActionPill({ icon, tone }: { icon: IconName; tone?: "brand" }) {
  return (
    <Pressable
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
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
