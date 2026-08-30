import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  getVehicleTripSummary,
  type TripSummary,
  type VehicleTripSummary,
} from "@lib/maintenanceApi";
import { useVehicle } from "@lib/vehicleContext";
import { SimulatedTripsModal } from "@components/ui/simulated-trips-modal";
import { useT, type Translate } from "@lib/i18n";

export default function TripSummaryScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { selectedVehicle, user } = useVehicle();
  const { vehicleId: paramId } = useLocalSearchParams<{ vehicleId?: string }>();
  // No stand-in plate: with nothing selected we ask for a vehicle rather than
  // showing another driver's trips. Callers (health) pass "" when unselected,
  // so this falls through on empty strings, not just on undefined.
  const vehicleId = paramId || selectedVehicle?.plateNumber || "";

  const [data, setData] = useState<VehicleTripSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped to force a refetch — after a retry, and after a simulated run so the
  // new mileage appears without navigating away and back.
  const [attempt, setAttempt] = useState(0);
  const [showSimulator, setShowSimulator] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setEmpty(false);
    setLoadFailed(false);
    if (!vehicleId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    getVehicleTripSummary(vehicleId)
      .then((d) => {
        if (!d) setEmpty(true);
        else setData(d);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [vehicleId, attempt]);

  /**
   * Append the next page. The aggregates on the response describe the whole
   * history, not the page, so only `trips` accumulates — everything else is
   * taken from the newest response and stays correct as you scroll.
   */
  function loadMore() {
    if (!data?.has_more || data.next_offset == null || loadingMore) return;
    setLoadingMore(true);
    getVehicleTripSummary(vehicleId, { offset: data.next_offset })
      .then((next) => {
        if (!next) return;
        setData((prev) =>
          prev ? { ...next, trips: [...prev.trips, ...next.trips] } : next
        );
      })
      .catch(() => {
        // Leave what is already on screen alone: losing a page is not a
        // reason to blank out the trips the driver is already reading.
      })
      .finally(() => setLoadingMore(false));
  }

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
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("driver.trips.back")}>
          <Icon name="ChevronLeft" size={24} color={palette.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ ...typography.h3, color: palette.text }}>{t("driver.trips.title")}</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {vehicleId || t("driver.trips.noVehicleTitle")}
          </Text>
        </View>
        {loading && <ActivityIndicator size="small" color={palette.brand} />}
        <Pressable
          onPress={() => setShowSimulator(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("driver.trips.simulateA11y")}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: spacing.xs,
            paddingHorizontal: spacing.sm,
            borderRadius: radii.pill,
            borderWidth: 1.5,
            borderColor: palette.brand,
            backgroundColor: pressed ? palette.brandSoft : "transparent",
          })}
        >
          <Icon name="FlaskConical" size={14} color={palette.brand} />
          <Text style={{ ...typography.micro, color: palette.brand, fontWeight: "700" }}>
            {t("driver.trips.simulate")}
          </Text>
        </Pressable>
      </View>

      {!vehicleId ? (
        <NoVehicleState />
      ) : loading ? (
        <LoadingSkeleton />
      ) : loadFailed ? (
        <LoadFailedState onRetry={() => setAttempt((a) => a + 1)} />
      ) : empty ? (
        <EmptyState message={t("driver.trips.emptyBody")} />
      ) : data ? (
        <ScrollView
          contentContainerStyle={{
            padding: spacing.lg,
            gap: spacing.md,
            paddingBottom: insets.bottom + NAV_BAR_HEIGHT + spacing.lg,
          }}
        >
          <OverviewCards data={data} />
          <BehaviourBar
            label={t("driver.trips.brakingEvents")}
            icon="Disc"
            value={data.total_braking_events}
            max={60}
            dangerAbove={30}
            warnAbove={15}
            unit={t("driver.trips.unitEvents")}
          />
          <BehaviourBar
            label={t("driver.trips.corneringEvents")}
            icon="Navigation"
            value={data.total_cornering_events}
            max={60}
            dangerAbove={25}
            warnAbove={12}
            unit={t("driver.trips.unitEvents")}
          />
          <BehaviourBar
            label={t("driver.trips.averageRpm")}
            icon="Gauge"
            value={Math.round(data.avg_rpm)}
            max={4000}
            dangerAbove={3000}
            warnAbove={2500}
            unit="RPM"
          />

          <Text style={{ ...typography.bodyStrong, color: palette.text, marginTop: spacing.xs }}>
            {t("driver.trips.individualHeading", { count: data.trip_count })}
          </Text>

          {/* Already newest-first from the server. Reversing here would only
              reverse the CURRENT page and interleave it wrongly with the next. */}
          {data.trips.map((trip, idx) => (
            <TripCard key={trip.trip_id} trip={trip} index={data.trip_count - idx} />
          ))}

          {data.has_more ? (
            <Pressable
              onPress={loadMore}
              disabled={loadingMore}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: spacing.sm,
                paddingVertical: spacing.md,
                borderRadius: radii.lg,
                borderWidth: 1.5,
                borderColor: palette.border,
                backgroundColor: pressed ? palette.surfaceMuted : "transparent",
                opacity: loadingMore ? 0.6 : 1,
              })}
            >
              {loadingMore && <ActivityIndicator size="small" color={palette.brand} />}
              <Text style={{ ...typography.bodyStrong, color: palette.brand }}>
                {loadingMore
                  ? t("driver.trips.loadingMore")
                  : t("driver.trips.showOlder", { count: data.trip_count - data.trips.length })}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      ) : null}

      <SimulatedTripsModal
        visible={showSimulator}
        onClose={() => setShowSimulator(false)}
        vehicleId={vehicleId}
        driverId={user?._id ?? "guest"}
        onCompleted={() => setAttempt((a) => a + 1)}
      />

      <BottomNavBar activeTab="maintenance" />
    </View>
  );
}

function OverviewCards({ data }: { data: VehicleTripSummary }) {
  const t = useT();
  const stats = [
    { label: t("driver.trips.statTrips"), value: String(data.trip_count), icon: "MapPin" },
    { label: t("driver.trips.statDistance"), value: t("driver.trips.valueKm", { value: Math.round(data.total_distance_km).toLocaleString() }), icon: "Route" },
    { label: t("driver.trips.statAvgSpeed"), value: t("driver.trips.valueKmh", { value: data.avg_speed_kmh }), icon: "Gauge" },
    { label: t("driver.trips.statDriveTime"), value: formatMinutes(data.total_duration_minutes, t), icon: "Clock" },
  ];

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
      {stats.map((s) => (
        <View
          key={s.label}
          style={{
            flex: 1,
            minWidth: "45%",
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.md,
            gap: 4,
            alignItems: "flex-start",
          }}
        >
          <Icon name={s.icon as any} size={16} color={palette.brand} />
          <Text style={{ ...typography.h3, color: palette.text, marginTop: 2 }}>{s.value}</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

function BehaviourBar({
  label,
  icon,
  value,
  max,
  dangerAbove,
  warnAbove,
  unit,
}: {
  label: string;
  icon: string;
  value: number;
  max: number;
  dangerAbove: number;
  warnAbove: number;
  unit: string;
}) {
  const t = useT();
  const pct = Math.min((value / max) * 100, 100);
  const color =
    value >= dangerAbove ? palette.danger : value >= warnAbove ? palette.warning : palette.success;
  const bg =
    value >= dangerAbove ? palette.dangerSoft : value >= warnAbove ? palette.warningSoft : palette.successSoft;
  const statusLabel =
    value >= dangerAbove
      ? t("driver.trips.statusHigh")
      : value >= warnAbove
        ? t("driver.trips.statusModerate")
        : t("driver.trips.statusGood");

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.lg,
        gap: spacing.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name={icon as any} size={16} color={color} />
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>{label}</Text>
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingVertical: 3,
            borderRadius: radii.pill,
            backgroundColor: bg,
          }}
        >
          <Text style={{ ...typography.caption, color, fontWeight: "600" }}>{statusLabel}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View
          style={{
            flex: 1,
            height: 8,
            borderRadius: radii.pill,
            backgroundColor: palette.border,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: radii.pill,
              backgroundColor: color,
            }}
          />
        </View>
        <Text style={{ ...typography.caption, color: palette.textMuted, minWidth: 72, textAlign: "right" }}>
          {value.toLocaleString()} {unit}
        </Text>
      </View>
    </View>
  );
}

function TripCard({ trip, index }: { trip: TripSummary; index: number }) {
  const t = useT();
  const brakeColor =
    trip.braking_events >= 4 ? palette.danger : trip.braking_events >= 2 ? palette.warning : palette.success;
  const cornerColor =
    trip.cornering_events >= 4 ? palette.danger : trip.cornering_events >= 2 ? palette.warning : palette.success;

  const date = new Date(trip.start_timestamp);
  const dateStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.lg,
        gap: spacing.md,
        borderLeftWidth: 3,
        borderLeftColor:
          trip.braking_events >= 4 ? palette.danger : trip.braking_events >= 2 ? palette.warning : palette.success,
      }}
    >
      {/* Trip header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>
          {t("driver.trips.tripNumber", { index })}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {t("driver.trips.dateTime", { date: dateStr, time: timeStr })}
        </Text>
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: "row", gap: spacing.lg }}>
        <StatChip icon="Route" label={t("driver.trips.valueKm", { value: trip.distance_km.toFixed(1) })} />
        <StatChip icon="Clock" label={t("driver.trips.valueMin", { value: Math.round(trip.duration_minutes) })} />
        <StatChip icon="Gauge" label={t("driver.trips.valueKmh", { value: Math.round(trip.avg_speed_kmh) })} />
      </View>

      {/* Behaviour row */}
      <View
        style={{
          flexDirection: "row",
          gap: spacing.sm,
          flexWrap: "wrap",
        }}
      >
        <EventPill
          icon="Disc"
          label={t("driver.trips.brakeCount", { count: trip.braking_events })}
          color={brakeColor}
        />
        <EventPill
          icon="Navigation"
          label={t("driver.trips.cornerCount", { count: trip.cornering_events })}
          color={cornerColor}
        />
        <EventPill
          icon="Thermometer"
          label={t("driver.trips.peakTemp", { value: Math.round(trip.max_coolant_temp_c) })}
          color={trip.max_coolant_temp_c > 105 ? palette.danger : trip.max_coolant_temp_c > 95 ? palette.warning : palette.textMuted}
        />
        <EventPill
          icon="Zap"
          label={t("driver.trips.voltage", { value: trip.avg_battery_voltage_v.toFixed(1) })}
          color={trip.avg_battery_voltage_v < 12.5 ? palette.danger : trip.avg_battery_voltage_v < 13.2 ? palette.warning : palette.textMuted}
        />
      </View>
    </View>
  );
}

function StatChip({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name={icon as any} size={13} color={palette.textMuted} />
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
    </View>
  );
}

function EventPill({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: spacing.sm + 2,
        paddingVertical: 4,
        borderRadius: radii.pill,
        backgroundColor: color + "18",
        borderWidth: 1,
        borderColor: color + "44",
      }}
    >
      <Icon name={icon as any} size={11} color={color} />
      <Text style={{ ...typography.caption, color, fontWeight: "600", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function LoadingSkeleton() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {[120, 80, 100, 80, 90].map((w, i) => (
        <View
          key={i}
          style={{
            width: `${w}%` as any,
            height: i === 0 ? 80 : 60,
            borderRadius: radii.lg,
            backgroundColor: palette.border,
            opacity: 0.5,
          }}
        />
      ))}
    </View>
  );
}

function EmptyState({ message }: { message: string }) {
  const t = useT();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.lg }}>
      <View
        style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: palette.warningSoft,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="Activity" size={28} color={palette.warning} />
      </View>
      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>{t("driver.trips.emptyTitle")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}

function NoVehicleState() {
  const t = useT();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.lg }}>
      <View
        style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: palette.brandSoft,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="Car" size={28} color={palette.brand} />
      </View>
      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>{t("driver.trips.noVehicleTitle")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        {t("driver.trips.noVehicleBody")}
      </Text>
      <Pressable
        onPress={() => router.push("/(driver)/manage-vehicles")}
        accessibilityRole="button"
        accessibilityLabel={t("driver.trips.manageVehiclesA11y")}
        style={({ pressed }) => ({
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
          borderRadius: radii.lg,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.xl,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.trips.manageVehicles")}</Text>
      </Pressable>
    </View>
  );
}

function LoadFailedState({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.lg }}>
      <View
        style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: palette.dangerSoft,
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="TriangleAlert" size={28} color={palette.danger} />
      </View>
      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>{t("driver.trips.loadFailedTitle")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        {t("driver.trips.loadFailedBody")}
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={t("driver.trips.retry")}
        style={({ pressed }) => ({
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
          borderRadius: radii.lg,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.xl,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>{t("driver.trips.retry")}</Text>
      </Pressable>
    </View>
  );
}

function formatMinutes(mins: number, t: Translate): string {
  if (mins < 60) return t("driver.trips.valueMin", { value: Math.round(mins) });
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0
    ? t("driver.trips.valueHoursMinutes", { hours: h, minutes: m })
    : t("driver.trips.valueHours", { hours: h });
}
