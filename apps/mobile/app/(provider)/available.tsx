import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import {
  getProvider,
  providerTypeLabel,
  serviceTypeLabel,
  updateProviderLocation,
  updateProviderStatus,
  type ProviderRecord,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";

export default function ProviderAvailableScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useVehicle();
  const providerId = user?.providerId ?? null;

  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);

  const loadProvider = useCallback(async () => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const me = await getProvider(providerId);
      setProvider(me);
    } catch (err) {
      setError(
        (err as Error).message +
          " (is the dispatch service running on port 3001?)"
      );
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadProvider();
  }, [loadProvider]);

  async function toggleStatus() {
    if (!provider) return;
    setStatusBusy(true);
    const nextStatus = provider.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    try {
      const updated = await updateProviderStatus(provider.id, nextStatus);
      setProvider(updated);
    } catch (err) {
      Alert.alert("Failed to update status", (err as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleUpdateLocation() {
    if (!provider) return;
    setLocationBusy(true);
    try {
      const loc = await getCurrentDriverLocation({ forceFresh: true });
      const updated = await updateProviderLocation(provider.id, {
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
      setProvider(updated);
      Alert.alert(
        "Location updated",
        loc.isReal
          ? "Your position on the map has been refreshed from GPS."
          : "GPS was unavailable, so we used your last known area."
      );
    } catch (err) {
      Alert.alert("Failed to update location", (err as Error).message);
    } finally {
      setLocationBusy(false);
    }
  }

  /**
   * Log out — flips the provider OFFLINE first (so they don't keep getting
   * dispatched while away), then clears the auth session and returns to the
   * welcome screen.
   */
  async function handleLogout() {
    if (provider && provider.status !== "OFFLINE") {
      try {
        await updateProviderStatus(provider.id, "OFFLINE");
      } catch {
        /* best-effort — don't block logout if the backend is unreachable */
      }
    }
    try {
      await logout();
    } catch {
      /* logout already clears local state best-effort */
    }
    router.replace("/");
  }

  // Not onboarded yet (no linked provider record) — invite them to set up.
  if (!loading && !providerId) {
    return (
      <Screen
        footer={
          <Button
            title="Set up your provider profile"
            onPress={() => router.replace("/(provider)/onboarding")}
          />
        }
      >
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }}>
          <Icon name="Wrench" size={44} color={palette.brand} />
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
              No provider profile yet
            </Text>
            <Text
              style={{
                ...typography.body,
                color: palette.textMuted,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              Create your provider profile to appear on the dispatch map and
              start receiving roadside jobs near you.
            </Text>
          </View>
        </View>
      </Screen>
    );
  }

  const online = provider?.status === "AVAILABLE";
  const displayName = provider?.name.split(" - ")[1] ?? provider?.name ?? "Provider";
  const typeLabel = provider ? providerTypeLabel(provider.type) : "Provider";

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View
        style={{
          backgroundColor: palette.surface,
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.lg,
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: palette.surfaceMuted,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Icon name="UserRound" size={22} color={palette.textMuted} />
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              {loading ? "Loading..." : displayName}
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {typeLabel}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Badge
            label={online ? "Online" : provider ? "Offline" : "—"}
            tone={online ? "success" : "neutral"}
            withDot
          />
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surface,
            })}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Icon name="LogOut" size={14} color={palette.textMuted} />
            <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
              Log out
            </Text>
          </Pressable>
        </View>
      </View>

      <Screen edges={["bottom"]}>
        {error && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger }}>
            <Text style={{ ...typography.bodyStrong, color: palette.danger }}>
              Connection error
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {error}
            </Text>
            <Button title="Try again" variant="secondary" size="md" onPress={loadProvider} />
          </Card>
        )}

        <Card>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {loading ? "..." : online ? "Available" : "Offline"}
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Trust score: {provider ? (provider.trustScore * 100).toFixed(0) + "%" : "—"}
          </Text>
          <View
            style={{
              flexDirection: "row", gap: spacing.md, marginTop: spacing.sm,
            }}
          >
            <Button
              title={statusBusy ? "..." : online ? "GO OFFLINE" : "GO ONLINE"}
              variant="secondary"
              size="md"
              onPress={toggleStatus}
              disabled={!provider || statusBusy}
            />
            <Button
              title={locationBusy ? "UPDATING…" : "UPDATE LOCATION"}
              size="md"
              onPress={handleUpdateLocation}
              disabled={!provider || locationBusy}
            />
          </View>
        </Card>

        <Card
          variant="muted"
          style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}
        >
          <Icon name="Inbox" size={40} color={palette.textMuted} />
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            No pending jobs in your area
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
            We&apos;ll notify you when a request comes in.
          </Text>
          <Text style={{ ...typography.micro, color: palette.textMuted, textAlign: "center" }}>
            (Real-time push arrives in Phase 3 — Socket.IO + provider acceptance)
          </Text>
        </Card>

        <View style={{ gap: spacing.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ ...typography.h3, color: palette.text }}>My Services</Text>
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              {provider ? `${provider.capabilities.length} capabilities` : ""}
            </Text>
          </View>
          <Card>
            {loading ? (
              <ActivityIndicator size="small" color={palette.brand} />
            ) : provider?.capabilities.length ? (
              provider.capabilities.map((service, idx) => (
                <View key={service}>
                  <Text style={{ ...typography.body, color: palette.text }}>
                    {serviceTypeLabel(service)}
                  </Text>
                  {idx < provider.capabilities.length - 1 ? (
                    <View
                      style={{
                        height: 1,
                        backgroundColor: palette.border,
                        marginVertical: spacing.sm,
                      }}
                    />
                  ) : null}
                </View>
              ))
            ) : (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                No capabilities configured
              </Text>
            )}
          </Card>
        </View>

        <Button
          title="Preview an Active Job (demo)"
          variant="secondary"
          leftIcon={<Icon name="Eye" size={16} color={palette.text} />}
          onPress={() => router.push("/(provider)/active-job")}
        />
      </Screen>
    </View>
  );
}
