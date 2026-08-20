import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  ALERT_THRESHOLD_PCT,
  EMPTY_HEALTH,
  getVehicleHealth,
  rulToLabel,
  type ComponentHealth,
  type ComponentKey,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";

const COMPONENT_META: Record<ComponentKey, { label: string; icon: string }> = {
  engine: { label: "Engine", icon: "Gauge" },
  brake: { label: "Brakes", icon: "Disc" },
  tire: { label: "Tyres", icon: "Circle" },
  battery: { label: "Battery", icon: "Battery" },
};

// Left column: engine, tire — Right column: brake, battery
const LEFT_COL: ComponentKey[] = ["engine", "tire"];
const RIGHT_COL: ComponentKey[] = ["brake", "battery"];

function healthColor(pct: number): string {
  if (pct >= 75) return palette.success;
  if (pct >= 50) return palette.warning;
  return palette.danger;
}

/** Ring/text color for a component — "No data" gets a neutral color, not a
 * false "danger" red from its placeholder 0% score. */
function statusColor(c: { status: string; health_pct: number }): string {
  return c.status === "No data" ? palette.textMuted : healthColor(c.health_pct);
}

function RingProgress({
  pct,
  size,
  thickness,
  color,
}: {
  pct: number;
  size: number;
  thickness: number;
  color: string;
}) {
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * Math.min(pct / 100, 1);

  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
      <Circle cx={cx} cy={cy} r={r} stroke={palette.border} strokeWidth={thickness} fill="none" />
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        strokeWidth={thickness}
        fill="none"
        strokeDasharray={[circumference, circumference]}
        strokeDashoffset={circumference - filled}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const { selectedVehicle } = useVehicle();
  const vehicleId = selectedVehicle?.plateNumber ?? "";
  const vehicleLabel = selectedVehicle
    ? selectedVehicle.nickname || `${selectedVehicle.make} ${selectedVehicle.model}`
    : "No vehicle added";

  const [data, setData] = useState<VehicleHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!vehicleId) {
      setData(null);
      setError(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    getVehicleHealth(vehicleId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vehicleId]);

  const health = data ?? EMPTY_HEALTH;
  const noData = health.overall_status === "No data";
  const overallColor = statusColor({ status: health.overall_status, health_pct: health.overall_health_pct });
  const allKeys: ComponentKey[] = ["engine", "brake", "tire", "battery"];
  // Only flag components that have crossed the alert threshold (< 35%).
  // "No data" (no trips yet) is not an alert — Fair (50–74%) is also normal.
  const alertKeys = allKeys.filter(
    (k) =>
      health.components[k].status !== "No data" &&
      health.components[k].health_pct < ALERT_THRESHOLD_PCT
  );

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
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h3, color: palette.text }}>Vehicle Health</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{vehicleId}</Text>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={palette.brand} />
        ) : error ? (
          <OfflineBadge />
        ) : (
          <View
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: 5,
              borderRadius: radii.md,
              backgroundColor: palette.brandSoft,
            }}
          >
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "700" }}>
              {vehicleLabel}
            </Text>
          </View>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + NAV_BAR_HEIGHT + spacing.lg,
        }}
      >
        {/* ── Overall health ring card ── */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            paddingVertical: spacing.xl,
            paddingHorizontal: spacing.lg,
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          {/* Large ring */}
          <View style={{ width: 160, height: 160 }}>
            {loading ? (
              <View
                style={{
                  width: 160,
                  height: 160,
                  borderRadius: 80,
                  borderWidth: 14,
                  borderColor: palette.border,
                  opacity: 0.35,
                }}
              />
            ) : (
              <>
                <RingProgress
                  pct={noData ? 100 : health.overall_health_pct}
                  size={160}
                  thickness={14}
                  color={noData ? palette.border : overallColor}
                />
                <View
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 38,
                      fontWeight: "800",
                      color: overallColor,
                      lineHeight: 42,
                    }}
                  >
                    {noData ? "—" : `${Math.round(health.overall_health_pct)}%`}
                  </Text>
                  <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
                    {health.overall_status}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Trip stats row */}
          {!loading && !error && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name="Route" size={13} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {health.trip_count} trip{health.trip_count !== 1 ? "s" : ""} ·{" "}
                {Math.round(health.total_mileage_km).toLocaleString()} km total
              </Text>
            </View>
          )}

          {/* Status pills */}
          {!loading &&
            (noData ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radii.pill,
                  backgroundColor: palette.surfaceMuted,
                }}
              >
                <Icon name="Info" size={13} color={palette.textMuted} />
                <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "500" }}>
                  No trips recorded yet — drive to assess
                </Text>
              </View>
            ) : alertKeys.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: spacing.sm }}
              >
                {alertKeys.map((k) => (
                  <AlertPill
                    key={k}
                    text={`${COMPONENT_META[k].label}: ${rulToLabel(health.components[k])}`}
                  />
                ))}
              </ScrollView>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.xs,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radii.pill,
                  backgroundColor: palette.successSoft,
                }}
              >
                <Icon name="CheckCircle" size={13} color={palette.success} />
                <Text style={{ ...typography.caption, color: palette.success, fontWeight: "500" }}>
                  All components healthy
                </Text>
              </View>
            ))}
        </View>

        {/* ── Component health 2×2 grid ── */}
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>Component Health</Text>

        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1, gap: spacing.md }}>
            {LEFT_COL.map((key) =>
              loading ? (
                <ComponentCardSkeleton key={key} />
              ) : (
                <ComponentCard
                  key={key}
                  componentKey={key}
                  component={health.components[key]}
                  label={COMPONENT_META[key].label}
                />
              )
            )}
          </View>
          <View style={{ flex: 1, gap: spacing.md }}>
            {RIGHT_COL.map((key) =>
              loading ? (
                <ComponentCardSkeleton key={key} />
              ) : (
                <ComponentCard
                  key={key}
                  componentKey={key}
                  component={health.components[key]}
                  label={COMPONENT_META[key].label}
                />
              )
            )}
          </View>
        </View>

        {/* ── Navigation rows ── */}
        <NavRow
          icon="Activity"
          title="Trip Behaviour"
          subtitle="Braking, cornering & driving patterns"
          onPress={() =>
            router.push({ pathname: "/(driver)/trip-summary", params: { vehicleId } })
          }
        />
        <NavRow
          icon="ClipboardList"
          title="Service Records"
          subtitle="View history & log new service events"
          onPress={() =>
            router.push({ pathname: "/(driver)/service-records", params: { vehicleId } })
          }
        />
      </ScrollView>

      <BottomNavBar activeTab="maintenance" />
    </View>
  );
}

function ComponentCard({
  componentKey,
  component,
  label,
}: {
  componentKey: ComponentKey;
  component: ComponentHealth;
  label: string;
}) {
  const color = statusColor(component);
  const rul = rulToLabel(component);
  const isAlert = component.status !== "Good" && component.status !== "No data";

  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: "/(driver)/component-detail",
          params: { component: componentKey },
        })
      }
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.homeBackground : palette.surface,
        borderRadius: radii.lg,
        padding: spacing.md,
        alignItems: "center",
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: isAlert ? `${color}44` : palette.border,
      })}
    >
      {/* Mini ring */}
      <View style={{ width: 72, height: 72 }}>
        <RingProgress
          pct={component.status === "No data" ? 100 : component.health_pct}
          size={72}
          thickness={7}
          color={component.status === "No data" ? palette.border : color}
        />
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", color, lineHeight: 17 }}>
            {component.status === "No data" ? "—" : `${Math.round(component.health_pct)}%`}
          </Text>
        </View>
      </View>

      <View style={{ alignItems: "center", gap: 3 }}>
        <Text style={{ ...typography.caption, color: palette.text, fontWeight: "600" }}>
          {label}
        </Text>
        <Text style={{ fontSize: 11, color, fontWeight: "500" }}>{rul}</Text>
      </View>
    </Pressable>
  );
}

function ComponentCardSkeleton() {
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.md,
        alignItems: "center",
        gap: spacing.sm,
        borderWidth: 1,
        borderColor: palette.border,
      }}
    >
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          borderWidth: 7,
          borderColor: palette.border,
          opacity: 0.35,
        }}
      />
      <View style={{ height: 13, width: 56, borderRadius: 4, backgroundColor: palette.border, opacity: 0.5 }} />
      <View style={{ height: 11, width: 40, borderRadius: 4, backgroundColor: palette.border, opacity: 0.35 }} />
    </View>
  );
}

function NavRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
          width: 40,
          height: 40,
          borderRadius: radii.md,
          backgroundColor: palette.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon as any} size={20} color={palette.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>{title}</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{subtitle}</Text>
      </View>
      <Icon name="ChevronRight" size={18} color={palette.textMuted} />
    </Pressable>
  );
}

function OfflineBadge() {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: spacing.md,
        paddingVertical: 4,
        borderRadius: radii.pill,
        backgroundColor: palette.warningSoft,
      }}
    >
      <Icon name="WifiOff" size={12} color={palette.warning} />
      <Text style={{ ...typography.caption, color: palette.warning, fontWeight: "600" }}>Offline</Text>
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
