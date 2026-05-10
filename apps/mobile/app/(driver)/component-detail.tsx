import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  FALLBACK_HEALTH,
  getVehicleHealth,
  rulToBanner,
  type ComponentHealth,
  type ComponentKey,
} from "@lib/maintenanceApi";

const VEHICLE_ID = "CBD-3742";

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
      "Braking events: above normal frequency",
      "Driving behaviour: Heavy braking detected",
    ],
    nextSteps: [
      {
        title: "Order Break Pads",
        price: "LKR 8,400.00",
        icon: "ShoppingBag",
        description: "4 verified parts options · Delivery 3-5 days",
      },
      {
        title: "Book a garage",
        price: "LKR 2,500.00",
        icon: "Wrench",
        description: "5 verified garages within 5km",
      },
    ],
  },
  engine: {
    label: "Engine Oil",
    icon: "Gauge",
    whyReasons: (c) => [
      `OBD readings: ${Math.round(c.health_pct)}%`,
      `Last oil change: ~${Math.round((c.max_lifespan_km - c.predicted_rul_km) / 1000)}k km ago`,
      "Coolant temp: elevated patterns detected",
    ],
    nextSteps: [
      {
        title: "Book a full service",
        price: "LKR 35,800.00",
        icon: "Wrench",
        description: "Includes oil, filter & full inspection",
      },
      {
        title: "Change Oil",
        price: "LKR 14,800.00",
        icon: "Droplets",
        description: "5 verified garages within 5km",
      },
    ],
  },
  tire: {
    label: "Tyres",
    icon: "Circle",
    whyReasons: (c) => [
      `Tread health: ${Math.round(c.health_pct)}%`,
      "Cornering events: within normal range",
      "Average speed: normal patterns",
    ],
    nextSteps: [
      {
        title: "Order Tyres",
        price: "LKR 12,000.00",
        icon: "ShoppingBag",
        description: "4 verified tyre options · Delivery 3-5 days",
      },
      {
        title: "Tyre Rotation",
        price: "LKR 1,500.00",
        icon: "RefreshCw",
        description: "3 verified garages within 5km",
      },
    ],
  },
  battery: {
    label: "Battery",
    icon: "Battery",
    whyReasons: (c) => [
      `Battery health: ${Math.round(c.health_pct)}%`,
      "Voltage readings: stable",
      "No voltage drops detected",
    ],
    nextSteps: [
      {
        title: "Replace Battery",
        price: "LKR 18,500.00",
        icon: "ShoppingBag",
        description: "3 verified battery options · Delivery 2-3 days",
      },
      {
        title: "Battery Test",
        price: "LKR 500.00",
        icon: "Zap",
        description: "At any verified garage",
      },
    ],
  },
};

export default function ComponentDetailScreen() {
  const insets = useSafeAreaInsets();
  const { component } = useLocalSearchParams<{ component: ComponentKey }>();
  const key: ComponentKey = (component as ComponentKey) ?? "brake";
  const meta = META[key];

  const [componentHealth, setComponentHealth] = useState<ComponentHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getVehicleHealth(VEHICLE_ID)
      .then((d) => setComponentHealth(d.components[key]))
      .catch(() => setComponentHealth(FALLBACK_HEALTH.components[key]))
      .finally(() => setLoading(false));
  }, [key]);

  const health = componentHealth ?? FALLBACK_HEALTH.components[key];
  const banner = rulToBanner(health);
  const isUrgent = health.predicted_rul_km < 2000;
  const isHealthy = health.status === "Good";

  return (
    <View style={{ flex: 1, backgroundColor: palette.homeBackground }}>
      {/* Header */}
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
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>Health</Text>
        <Icon name="ChevronRight" size={14} color={palette.textMuted} />
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>
          {meta.label}
        </Text>
        {loading && <ActivityIndicator size="small" color={palette.brand} />}
      </View>

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

          {!isHealthy && (
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
          )}
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
                color: healthColor(health.health_pct),
                fontWeight: "700",
              }}
            >
              {Math.round(health.health_pct)}%
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
            {Math.round(health.predicted_rul_km).toLocaleString()} km remaining life estimated
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
            Why do we think this
          </Text>
          <View style={{ gap: spacing.sm }}>
            {meta.whyReasons(health).map((reason, i) => (
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
        {!isHealthy && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Recommend Next Steps
            </Text>
            {meta.nextSteps.map((step, i) => (
              <Pressable
                key={i}
                onPress={() =>
                  i === 0
                    ? router.push({
                        pathname: "/(driver)/order-parts",
                        params: { component: key },
                      })
                    : undefined
                }
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
      {!isHealthy && (
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
                Snooze for one week
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function healthColor(pct: number): string {
  if (pct >= 75) return palette.success;
  if (pct >= 50) return palette.warning;
  return palette.danger;
}
