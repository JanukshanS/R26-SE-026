import { useCallback, useEffect, useRef, useState } from "react";
import { FaultCard } from "@components/ui/fault-card";
import { ActivityIndicator, Animated, Pressable, ScrollView, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { ErrorState } from "@components/ui/error-state";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  ALERT_THRESHOLD_PCT,
  EMPTY_HEALTH,
  getVehicleHealth,
  componentStatusLabel,
  rulToLabel,
  type ComponentHealth,
  type ComponentKey,
  type VehicleHealthResponse,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";
import { useTabBack } from "@lib/useTabBack";
import { useT } from "@lib/i18n";

const COMPONENT_META: Record<ComponentKey, { labelKey: string; icon: string }> = {
  engine: { labelKey: "driver.health.componentEngine", icon: "Gauge" },
  brake: { labelKey: "driver.health.componentBrake", icon: "Disc" },
  tire: { labelKey: "driver.health.componentTire", icon: "Circle" },
  battery: { labelKey: "driver.health.componentBattery", icon: "Battery" },
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

/**
 * Opacity pulse for the loading state, driven natively so it stays smooth
 * while the JS thread is busy handling the fetch it is waiting on - which is
 * exactly when a stuttering animation would be most noticeable.
 */
function usePulse(active: boolean): Animated.Value {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    if (!active) {
      opacity.setValue(0.4);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity]);
  return opacity;
}

export default function HealthScreen() {
  const { canGoBack, goBack } = useTabBack();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { selectedVehicle } = useVehicle();
  const vehicleId = selectedVehicle?.plateNumber ?? "";
  const vehicleLabel = selectedVehicle
    ? selectedVehicle.nickname || `${selectedVehicle.make} ${selectedVehicle.model}`
    : t("driver.health.noVehicleAdded");

  const [data, setData] = useState<VehicleHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Bumped per load and again on unmount: switching vehicles, or retrying,
  // must not let the previous request land and show one vehicle's health under
  // another's plate — this is the screen a driver decides on repairs from.
  const loadId = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(() => {
    const id = ++loadId.current;
    const isCurrent = () => mounted.current && id === loadId.current;
    if (!vehicleId) {
      setData(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    setData(null);
    getVehicleHealth(vehicleId)
      .then((d) => {
        if (isCurrent()) setData(d);
      })
      .catch(() => {
        if (isCurrent()) setError(true);
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, [vehicleId]);

  useEffect(() => {
    load();
    return () => {
      mounted.current = false;
    };
  }, [load]);


  const health = data ?? EMPTY_HEALTH;
  const pulseOpacity = usePulse(loading);
  const faults = health.faults ?? [];
  // Colour for the overall error line: the worst severity present.
  const overallFaultTone = faults.some((f) => f.severity === "urgent")
    ? { fg: palette.danger, bg: palette.dangerSoft }
    : faults.some((f) => f.severity === "soon")
      ? { fg: palette.warning, bg: palette.warningSoft }
      : { fg: palette.textMuted, bg: palette.surfaceMuted };
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
        {canGoBack ? (
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("driver.health.back")}>
            <Icon name="ChevronLeft" size={24} color={palette.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h3, color: palette.text }}>{t("driver.health.title")}</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {vehicleId || t("driver.health.noVehicleSelected")}
          </Text>
        </View>
        {loading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ActivityIndicator size="small" color={palette.brand} />
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{t("driver.health.loading")}</Text>
          </View>
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

      {!vehicleId ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <ErrorState
            title={t("driver.health.noVehicleTitle")}
            message={t("driver.health.noVehicleBody")}
          />
          <Pressable
            onPress={() => router.push("/(driver)/manage-vehicles")}
            accessibilityRole="button"
            accessibilityLabel={t("driver.health.manageVehiclesA11y")}
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
            <Text style={{ ...typography.bodyStrong, color: palette.brand }}>{t("driver.health.manageVehicles")}</Text>
          </Pressable>
        </View>
      ) : error ? (
        /* A failed fetch must not render as "No trips recorded yet" — a driver
           decides on repairs from this screen. */
        <View style={{ padding: spacing.lg }}>
          <ErrorState
            title={t("driver.health.loadFailedTitle")}
            message={t("driver.health.loadFailedBody")}
            onRetry={load}
          />
        </View>
      ) : (
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
              <Animated.View
                style={{
                  width: 160,
                  height: 160,
                  borderRadius: 80,
                  borderWidth: 14,
                  borderColor: palette.border,
                  opacity: pulseOpacity,
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
                    {componentStatusLabel(health.overall_status, t)}
                  </Text>
                </View>
              </>
            )}
          </View>

          {/* Health can take a real few seconds - it runs ML inference across
              four components plus a distance-weighted aggregation over every
              stored trip, not a lookup. A silent wait next to a static grey
              ring read as frozen; this says plainly that it is working and
              roughly how long that takes, the same reasoning already applied
              to the fault and component-detail loading states. */}
          {loading ? (
            <Animated.Text
              style={{
                ...typography.caption,
                color: palette.textMuted,
                fontWeight: "600",
                opacity: pulseOpacity,
              }}
            >
              {t("driver.health.checkingReadings")}
            </Animated.Text>
          ) : null}

          {/* Errors noticed, in the overall card.
              One quiet line, same visual weight as the trip stats row below it
              - no coloured block, no subtitle. The full detail (title, causes,
              consequence) already lives one tap away on fault-detail, and on
              the tile that fault belongs to; repeating it here just to be seen
              first was the "unwanted attention" this replaced. Colour is
              carried by the icon alone so it stays a signal, not a banner. */}
          {!loading && !error && faults.length > 0 && (
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(driver)/fault-detail",
                  params: { code: faults[0].code },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={
                faults.length === 1
                  ? t("driver.health.faultsA11ySingle", { title: faults[0].title })
                  : t("driver.health.faultsA11yMany", { count: faults.length })
              }
              hitSlop={6}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon name="TriangleAlert" size={12} color={overallFaultTone.fg} />
              <Text style={{ ...typography.caption, color: overallFaultTone.fg, fontWeight: "600" }}>
                {t("driver.health.issuesNoticed", { count: faults.length })}
              </Text>
              <Icon name="ChevronRight" size={12} color={palette.textMuted} />
            </Pressable>
          )}

          {/* Trip stats row */}
          {!loading && !error && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name="Route" size={13} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {t("driver.health.tripStats", {
                  count: health.trip_count,
                  km: Math.round(health.total_mileage_km).toLocaleString(),
                })}
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
                  {t("driver.health.noTrips")}
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
                    text={t("driver.health.alertPill", {
                      component: t(COMPONENT_META[k].labelKey),
                      status: rulToLabel(health.components[k], t),
                    })}
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
                  {t("driver.health.allHealthy")}
                </Text>
              </View>
            ))}
        </View>

        {/* ── Live fault codes ───────────────────────────────────────────
            Above the wear grid because a stored fault is a statement about
            what IS wrong, and wear is a forecast of what will be. Faults filed
            under "other" appear here too - they belong to no component card,
            so this is the only place a transmission or emissions fault can be
            seen at all. */}
        {!loading && faults.length > 0 ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              {t("driver.health.faultsHeading", { count: faults.length })}
            </Text>
            {faults.map((fault) => (
              <FaultCard
                key={fault.code}
                fault={fault}
                variant="compact"
                // Every fault opens its own page, including the ones that map
                // to no component - fault-detail is keyed on the CODE, so a
                // transmission or fuel-cap fault is no longer a dead end.
                onPress={() =>
                  router.push({
                    pathname: "/(driver)/fault-detail",
                    params: { code: fault.code },
                  })
                }
              />
            ))}
          </View>
        ) : null}

        {/* ── Component health 2×2 grid ── */}
        <Text style={{ ...typography.bodyStrong, color: palette.text }}>{t("driver.health.componentsHeading")}</Text>

        <Animated.View
          style={{ flexDirection: "row", gap: spacing.md, opacity: loading ? pulseOpacity : 1 }}
        >
          <View style={{ flex: 1, gap: spacing.md }}>
            {LEFT_COL.map((key) =>
              loading ? (
                <ComponentCardSkeleton key={key} />
              ) : (
                <ComponentCard
                  key={key}
                  componentKey={key}
                  component={health.components[key]}
                  label={t(COMPONENT_META[key].labelKey)}
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
                  label={t(COMPONENT_META[key].labelKey)}
                />
              )
            )}
          </View>
        </Animated.View>

        {/* ── Navigation rows ── */}
        <NavRow
          icon="Activity"
          title={t("driver.health.navTripsTitle")}
          subtitle={t("driver.health.navTripsSubtitle")}
          onPress={() =>
            router.push({ pathname: "/(driver)/trip-summary", params: { vehicleId } })
          }
        />
        <NavRow
          icon="ClipboardList"
          title={t("driver.health.navRecordsTitle")}
          subtitle={t("driver.health.navRecordsSubtitle")}
          onPress={() =>
            router.push({ pathname: "/(driver)/service-records", params: { vehicleId } })
          }
        />
      </ScrollView>
      )}

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
  const t = useT();
  const color = statusColor(component);
  const rul = rulToLabel(component, t);
  const isAlert = component.status !== "Good" && component.status !== "No data";
  // Faults sit BESIDE the wear ring, never inside it. The ring and its
  // percentage are the wear model speaking; a fault is a separate defect, and
  // letting it recolour the ring would mean a 94%-healthy engine drawn as if
  // the model had changed its mind about how worn it is.
  const faults = component.faults ?? [];
  const worstFault = faults.find((f) => f.severity === "urgent") ?? faults[0];
  const faultColor =
    worstFault?.severity === "urgent"
      ? palette.danger
      : worstFault?.severity === "soon"
        ? palette.warning
        : palette.textMuted;

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
        borderColor: worstFault ? `${faultColor}66` : isAlert ? `${color}44` : palette.border,
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

        {worstFault ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              marginTop: 2,
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: radii.pill,
              backgroundColor: `${faultColor}1A`,
            }}
          >
            <Icon name="TriangleAlert" size={10} color={faultColor} />
            <Text style={{ fontSize: 10, color: faultColor, fontWeight: "700" }}>
              {t("driver.health.faultBadge", { count: faults.length })}
            </Text>
          </View>
        ) : null}
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
  const t = useT();
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
      <Text style={{ ...typography.caption, color: palette.warning, fontWeight: "600" }}>{t("driver.health.offline")}</Text>
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
