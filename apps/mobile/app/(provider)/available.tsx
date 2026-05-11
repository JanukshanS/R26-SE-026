import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";
import {
  listProviders,
  serviceTypeLabel,
  updateProviderStatus,
  type ProviderRecord,
} from "@lib/dispatchApi";

/**
 * Demo provider profile — for the viva we pick the first seeded MOBILE_MECHANIC
 * to embody. In production this comes from the provider's auth session.
 */
const DEMO_PROVIDER_NAME_PREFIX = "Colombo Mobile Mechanic";

export default function ProviderAvailableScreen() {
  const insets = useSafeAreaInsets();
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await listProviders({ type: "MOBILE_MECHANIC" });
        const me = list.providers.find((p) =>
          p.name.startsWith(DEMO_PROVIDER_NAME_PREFIX)
        ) ?? list.providers[0];
        setProvider(me ?? null);
      } catch (err) {
        setError(
          (err as Error).message +
          " (is the dispatch service running on port 3001?)"
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

  const online = provider?.status === "AVAILABLE";
  const displayName = provider?.name.split(" - ")[1] ?? provider?.name ?? "Provider";

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
              Mobile Mechanic
            </Text>
          </View>
        </View>
        <Badge
          label={online ? "Online" : provider ? "Offline" : "—"}
          tone={online ? "success" : "neutral"}
          withDot
        />
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
            <Button title="UPDATE LOCATION" size="md" onPress={() => {}} />
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
          title="Preview an Active Job"
          variant="secondary"
          onPress={() => router.push("/(provider)/active-job")}
        />
      </Screen>
    </View>
  );
}
