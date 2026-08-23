import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ErrorState } from "@components/ui/error-state";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  getVehicleHealth,
  rulToBanner,
  type ComponentHealth,
  type ComponentKey,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";

interface ComponentMeta {
  label: string;
  icon: string;
  whyReasons: (c: ComponentHealth) => string[];
  nextSteps: { title: string; price: string; icon: string; description: string }[];
}

const META: Record<ComponentKey, ComponentMeta> = {
  brake: {
    label: "Brake Pads",
    icon: "Disc",
    whyReasons: (c) => [
      `OBD readings: ${Math.round(c.health_pct)}%`,
      c.status === "Good"
        ? "Braking events: within normal frequency"
        : "Braking events: above normal frequency",
      c.status === "Good"
        ? "Driving behaviour: no heavy braking detected"
        : "Driving behaviour: heavy braking detected",
    ],
    nextSteps: [
      {
        title: "Order Brake Pads",
        price: "From LKR 11,500",
        icon: "ShoppingBag",
        description: "4 options in the parts store · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 2,500",
        icon: "Wrench",
        description: "Suggested garage & indicative fitting cost",
      },
    ],
  },
  engine: {
    label: "Engine Oil",
    icon: "Gauge",
    whyReasons: (c) => [
      `OBD readings: ${Math.round(c.health_pct)}%`,
      `Last oil change: ~${Math.round((c.max_lifespan_km - c.predicted_rul_km) / 1000)}k km ago`,
      c.status === "Good"
        ? "Coolant temp: within normal range"
        : "Coolant temp: elevated patterns detected",
    ],
    nextSteps: [
      {
        title: "Order Engine Oil",
        price: "From LKR 4,500",
        icon: "ShoppingBag",
        description: "Oil, filters & service kits · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 14,800",
        icon: "Droplets",
        description: "Suggested garage & indicative oil-change cost",
      },
    ],
  },
  tire: {
    label: "Tyres",
    icon: "Circle",
    whyReasons: (c) => [
      `Tread health: ${Math.round(c.health_pct)}%`,
      c.status === "Good"
        ? "Cornering events: within normal range"
        : "Cornering events: above normal frequency",
      c.status === "Good"
        ? "Tread wear: in line with expected rate"
        : "Tread wear: ahead of expected rate",
    ],
    nextSteps: [
      {
        title: "Order Tyres",
        price: "From LKR 7,800",
        icon: "ShoppingBag",
        description: "4 options in the parts store · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 1,500",
        icon: "RefreshCw",
        description: "Suggested garage & indicative rotation cost",
      },
    ],
  },
  battery: {
    label: "Battery",
    icon: "Battery",
    whyReasons: (c) => [
      `Battery health: ${Math.round(c.health_pct)}%`,
      c.status === "Good"
        ? "Voltage readings: stable"
        : "Voltage readings: outside normal range",
      c.status === "Good"
        ? "No voltage drops detected"
        : "Voltage drops detected under load",
    ],
    nextSteps: [
      {
        title: "Order Battery",
        price: "From LKR 16,000",
        icon: "ShoppingBag",
        description: "4 options in the parts store · indicative prices",
      },
      {
        title: "See garage options",
        price: "LKR 500",
        icon: "Zap",
        description: "Suggested garage & indicative test cost",
      },
    ],
  },
};

export default function ComponentDetailScreen() {
  const insets = useSafeAreaInsets();
  const { selectedVehicle } = useVehicle();
  const { component } = useLocalSearchParams<{ component: ComponentKey }>();
  const key: ComponentKey = (component as ComponentKey) ?? "brake";
  const meta = META[key];

  const vehicleId = selectedVehicle?.plateNumber;

  const [componentHealth, setComponentHealth] = useState<ComponentHealth | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  // This is the screen a driver reads before deciding to replace a part, so a
  // failed fetch shows the failure rather than a stand-in reading, and with no
  // vehicle selected we ask for one rather than reading some other plate.
  const load = useCallback(() => {
    if (!vehicleId) {
      setComponentHealth(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    getVehicleHealth(vehicleId)
      .then((d) => setComponentHealth(d.components[key]))
      .catch(() => {
        setComponentHealth(null);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [key, vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!componentHealth) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
        <DetailHeader label={meta.label} loading={loading} />
        <View style={{ padding: spacing.lg }}>
          {!vehicleId ? (
            <View style={{ gap: spacing.md }}>
              <ErrorState
                title="No vehicle selected"
                message={`Add a vehicle and select it on Home to see its ${meta.label.toLowerCase()} health.`}
              />
              <Pressable
                onPress={() => router.push("/(driver)/manage-vehicles")}
                accessibilityRole="button"
                accessibilityLabel="Manage vehicles"
                style={({ pressed }) => ({
                  borderRadius: radii.lg,
                  paddingVertical: spacing.md,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1.5,
                  borderColor: palette.brand,
                  backgroundColor: pressed ? palette.brandSoft : "transparent",
                })}
              >
                <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
                  Manage Vehicles
                </Text>
              </Pressable>
            </View>
          ) : error ? (
            <ErrorState
              title="Couldn't load health data"
              message={`We couldn't reach the maintenance service to read your ${meta.label.toLowerCase()}. Check your connection and try again.`}
              onRetry={load}
            />
          ) : (
            <ActivityIndicator size="small" color={palette.brand} />
          )}
        </View>
      </View>
    );
  }

  const health = componentHealth;
  const banner = rulToBanner(health);
  const noData = health.status === "No data";
  const isUrgent = health.predicted_rul_km < 2000;
  const isHealthy = health.status === "Good";

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      <DetailHeader label={meta.label} loading={loading} />

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + 120,
        }}
      >
        {/* Title + urgency banner */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...typography.h1, color: palette.text }}>{meta.label}</Text>

          {noData ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.md,
                backgroundColor: palette.surfaceMuted,
              }}
            >
              <Icon name="Info" size={16} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
                {banner}
              </Text>
            </View>
          ) : !isHealthy ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                borderRadius: radii.md,
                backgroundColor: isUrgent ? palette.dangerSoft : palette.warningSoft,
              }}
            >
              <Icon
                name="AlertTriangle"
                size={16}
                color={isUrgent ? palette.danger : palette.warning}
              />
              <Text
                style={{
                  ...typography.caption,
                  color: isUrgent ? palette.danger : palette.warning,
                  fontWeight: "600",
                }}
              >
                {banner}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Health bar */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>Health Score</Text>
            <Text
              style={{
                ...typography.h2,
                color: noData ? palette.textMuted : healthColor(health.health_pct),
                fontWeight: "700",
              }}
            >
              {noData ? "—" : `${Math.round(health.health_pct)}%`}
            </Text>
          </View>
          <View
            style={{
              height: 8,
              borderRadius: radii.pill,
              backgroundColor: palette.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${health.health_pct}%`,
                height: "100%",
                borderRadius: radii.pill,
                backgroundColor: healthColor(health.health_pct),
              }}
            />
          </View>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {noData
              ? "Not enough trip data yet to estimate remaining life"
              : `${Math.round(health.predicted_rul_km).toLocaleString()} km remaining life estimated`}
          </Text>
        </View>

        {/* Why section */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {noData ? "How we assess this" : "Why do we think this"}
          </Text>
          <View style={{ gap: spacing.sm }}>
            {(noData
              ? [
                  "No trips recorded yet, so there's nothing to analyse.",
                  "Pair an OBD-II adapter and drive — we read live sensor data each trip.",
                  "A health score appears once we have enough readings.",
                ]
              : meta.whyReasons(health)
            ).map((reason, i) => (
              <View
                key={i}
                style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: palette.brand,
                    marginTop: 6,
                  }}
                />
                <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                  {reason}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Recommended next steps */}
        {!isHealthy && !noData && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Recommend Next Steps
            </Text>
            {meta.nextSteps.map((step, i) => (
              <Pressable
                key={i}
                onPress={() =>
                  router.push(
                    i === 0
                      ? { pathname: "/(driver)/order-parts", params: { component: key } }
                      : { pathname: "/(driver)/auto-schedule", params: { component: key } }
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={step.title}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? palette.homeBackground : palette.surface,
                  borderRadius: radii.lg,
                  padding: spacing.lg,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  borderWidth: 1,
                  borderColor: palette.border,
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radii.md,
                    backgroundColor: palette.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={step.icon as any} size={20} color={palette.brand} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                    {step.title}
                  </Text>
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>
                    {step.description}
                  </Text>
                </View>
                <Text style={{ ...typography.bodyStrong, color: palette.brand, fontWeight: "700" }}>
                  {step.price}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom action buttons */}
      {!isHealthy && !noData && (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: insets.bottom + spacing.md,
            paddingTop: spacing.md,
            paddingHorizontal: spacing.lg,
            backgroundColor: palette.surface,
            borderTopWidth: 1,
            borderTopColor: palette.border,
            gap: spacing.sm,
          }}
        >
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/(driver)/auto-schedule",
                params: { component: key },
              })
            }
            style={({ pressed }) => ({
              backgroundColor: pressed ? palette.brandPressed : palette.brand,
              borderRadius: radii.lg,
              paddingVertical: spacing.md + 2,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: spacing.sm,
            })}
          >
            <Icon name="CalendarCheck" size={18} color={palette.textOnBrand} />
            <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
              Auto Schedule
            </Text>
          </Pressable>

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(driver)/order-parts",
                  params: { component: key },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Select a part and schedule"
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: radii.lg,
                paddingVertical: spacing.md,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1.5,
                borderColor: palette.brand,
                backgroundColor: pressed ? palette.brandSoft : "transparent",
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
                Select and schedule
              </Text>
            </Pressable>

            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
              style={({ pressed }) => ({
                flex: 1,
                borderRadius: radii.lg,
                paddingVertical: spacing.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? palette.homeBackground : "transparent",
              })}
            >
              <Text style={{ ...typography.bodyStrong, color: palette.textMuted }}>
                Not now
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function DetailHeader({ label, loading }: { label: string; loading: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        backgroundColor: palette.surface,
        borderBottomWidth: 1,
        borderBottomColor: palette.border,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
      }}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
        <Icon name="ChevronLeft" size={24} color={palette.text} />
      </Pressable>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>Health</Text>
      <Icon name="ChevronRight" size={14} color={palette.textMuted} />
      <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>{label}</Text>
      {loading && <ActivityIndicator size="small" color={palette.brand} />}
    </View>
  );
}

function healthColor(pct: number): string {
  if (pct >= 75) return palette.success;
  if (pct >= 50) return palette.warning;
  return palette.danger;
}
