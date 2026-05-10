import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  FALLBACK_HEALTH,
  getVehicleHealth,
  rulToLabel,
  type ComponentHealth,
  type ComponentKey,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";

const VEHICLE_ID = "CBD-3742";

const COMPONENT_META: Record<ComponentKey, { label: string; icon: string }> = {
  engine: { label: "Engine Oil", icon: "Gauge" },
  brake: { label: "Brake Pads", icon: "Disc" },
  tire: { label: "Tyres", icon: "Circle" },
  battery: { label: "Battery", icon: "Battery" },
};

const COMPONENT_ORDER: ComponentKey[] = ["brake", "engine", "tire", "battery"];

export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<VehicleHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getVehicleHealth(VEHICLE_ID)
      .then(setData)
      .catch(() => setData(FALLBACK_HEALTH))
      .finally(() => setLoading(false));
  }, []);

  const health = data ?? FALLBACK_HEALTH;

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
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h3, color: palette.text }}>Vehicle Health</Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
            paddingHorizontal: spacing.md,
            paddingVertical: 5,
            borderRadius: radii.md,
            backgroundColor: palette.brandSoft,
          }}
        >
          <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
            Toyota Aqua
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + spacing.xxxl,
        }}
      >
        {/* Overall health card */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            borderLeftWidth: 4,
            borderLeftColor: palette.brand,
            gap: spacing.md,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>Vehicle Health</Text>
            {loading ? (
              <ActivityIndicator size="small" color={palette.brand} />
            ) : (
              <StatusBadge status={health.overall_status} />
            )}
          </View>

          <Text
            style={{
              fontSize: 52,
              fontWeight: "700",
              color: healthColor(health.overall_health_pct),
              lineHeight: 56,
            }}
          >
            {Math.round(health.overall_health_pct)}%
          </Text>

          {/* Alert pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing.sm }}
          >
            {COMPONENT_ORDER.filter(
              (k) => health.components[k].status !== "Good"
            ).map((k) => (
              <AlertPill
                key={k}
                text={`${COMPONENT_META[k].label}: ${rulToLabel(health.components[k])}`}
              />
            ))}
          </ScrollView>
        </View>

        {/* Component rows */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            overflow: "hidden",
          }}
        >
          {COMPONENT_ORDER.map((key, idx) => (
            <ComponentRow
              key={key}
              componentKey={key}
              component={health.components[key]}
              label={COMPONENT_META[key].label}
              icon={COMPONENT_META[key].icon as any}
              isLast={idx === COMPONENT_ORDER.length - 1}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function ComponentRow({
  componentKey,
  component,
  label,
  icon,
  isLast,
}: {
  componentKey: ComponentKey;
  component: ComponentHealth;
  label: string;
  icon: any;
  isLast: boolean;
}) {
  const color = healthColor(component.health_pct);
  const rul = rulToLabel(component);

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/(driver)/component-detail",
          params: { component: componentKey },
        })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        gap: spacing.md,
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: palette.border,
      })}
    >
      <Icon name={icon} size={20} color={color} />

      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>{label}</Text>
        <View
          style={{
            height: 6,
            borderRadius: radii.pill,
            backgroundColor: palette.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${component.health_pct}%`,
              height: "100%",
              borderRadius: radii.pill,
              backgroundColor: color,
            }}
          />
        </View>
      </View>

      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text
          style={{
            ...typography.caption,
            color,
            fontWeight: "600",
          }}
        >
          {rul}
        </Text>
      </View>

      <Icon name="ChevronRight" size={16} color={palette.textMuted} />
    </Pressable>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    Good: { bg: palette.successSoft, text: palette.success },
    Fair: { bg: palette.warningSoft, text: palette.warning },
    Poor: { bg: palette.dangerSoft, text: palette.danger },
    Critical: { bg: palette.dangerSoft, text: palette.danger },
  };
  const colors = map[status] ?? map.Good;
  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: 4,
        borderRadius: radii.pill,
        backgroundColor: colors.bg,
      }}
    >
      <Text style={{ ...typography.caption, color: colors.text, fontWeight: "600" }}>
        {status}
      </Text>
    </View>
  );
}

function AlertPill({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radii.pill,
        backgroundColor: palette.dangerSoft,
        borderWidth: 1,
        borderColor: palette.danger + "33",
      }}
    >
      <Icon name="AlertTriangle" size={13} color={palette.danger} />
      <Text style={{ ...typography.caption, color: palette.danger, fontWeight: "500" }}>{text}</Text>
    </View>
  );
}

function healthColor(pct: number): string {
  if (pct >= 75) return palette.success;
  if (pct >= 50) return palette.warning;
  return palette.danger;
}
