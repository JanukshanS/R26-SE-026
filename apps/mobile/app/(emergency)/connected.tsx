import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_LOCATION } from "@lib/emergencyContext";
import { haversineKm, providerTypeLabel } from "@lib/dispatchApi";

/** Display ETA in whole minutes from the backend's computed travel time. */
function formatEta(min?: number): string {
  if (!min || min <= 0) return "~5 min";
  return `${Math.max(1, Math.round(min))} min`;
}

export default function ConnectedScreen() {
  const { dispatchResult, reset } = useEmergency();
  const sp = dispatchResult?.selectedProvider;

  // Compute distance from the incident location to the provider for display.
  // We don't have the provider's coords in the dispatch response, so we fall
  // back to "computed by ECM" if unavailable. (A future iteration will add
  // provider.location to the response or call getProvider() to fetch.)
  const distanceKm = sp ? null : haversineKm(DEMO_LOCATION, DEMO_LOCATION);

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
              {sp ? " · Mismatch risk " : ""}
              {sp ? `${(sp.mismatchRisk * 100).toFixed(0)}%` : ""}
            </Text>
          </View>
        </View>
        <ActionPill icon="MessageCircle" />
        <ActionPill icon="Phone" tone="brand" />
      </Card>

      {/* Map placeholder — wire to Google Maps later (Phase 4 of roadmap) */}
      <View
        style={{
          height: 220, borderRadius: radii.lg, borderCurve: "continuous",
          backgroundColor: palette.surfaceMuted,
          alignItems: "center", justifyContent: "center", overflow: "hidden",
          gap: spacing.sm,
        }}
      >
        <Icon name="Map" size={48} color={palette.textMuted} />
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          Live route preview
        </Text>
        {sp && (
          <Text style={{ ...typography.micro, color: palette.textMuted }}>
            Computation: {dispatchResult?.metadata.computationTimeMs.toFixed(2)} ms
            · {dispatchResult?.metadata.providersEvaluated} providers evaluated
          </Text>
        )}
      </View>

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
              Expected Cost
            </Text>
            <Text style={{ ...typography.h2, color: palette.text }}>
              {sp ? `${sp.expectedCost.toFixed(1)} min` : "—"}
            </Text>
          </View>
        </View>
      </Card>

      {/* Debug card — top-3 from the ranked providers list. Useful for the viva
          to show the ECM is actually ranking, not just picking nearest. */}
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
