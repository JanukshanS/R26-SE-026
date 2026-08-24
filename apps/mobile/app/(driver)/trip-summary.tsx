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

export default function TripSummaryScreen() {
  const insets = useSafeAreaInsets();
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
          <Text style={{ ...typography.h3, color: palette.text }}>Trip Behaviour</Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {vehicleId || "No vehicle selected"}
          </Text>
        </View>
        {loading && <ActivityIndicator size="small" color={palette.brand} />}
        <Pressable
          onPress={() => setShowSimulator(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Generate simulated trips"
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
            Simulate
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
        <EmptyState message="No trip data recorded for this vehicle yet." />
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
            label="Braking events"
            icon="Disc"
            value={data.total_braking_events}
            max={60}
            dangerAbove={30}
            warnAbove={15}
            unit="events"
          />
          <BehaviourBar
            label="Cornering events"
            icon="Navigation"
            value={data.total_cornering_events}
            max={60}
            dangerAbove={25}
            warnAbove={12}
            unit="events"
          />
          <BehaviourBar
            label="Average RPM"
            icon="Gauge"
            value={Math.round(data.avg_rpm)}
            max={4000}
            dangerAbove={3000}
            warnAbove={2500}
            unit="RPM"
          />

          <Text style={{ ...typography.bodyStrong, color: palette.text, marginTop: spacing.xs }}>
            Individual Trips ({data.trip_count})
          </Text>

          {[...data.trips].reverse().map((trip, idx) => (
            <TripCard key={trip.trip_id} trip={trip} index={data.trip_count - idx} />
          ))}
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
  const stats = [
    { label: "Trips", value: String(data.trip_count), icon: "MapPin" },
    { label: "Distance", value: `${Math.round(data.total_distance_km).toLocaleString()} km`, icon: "Route" },
    { label: "Avg Speed", value: `${data.avg_speed_kmh} km/h`, icon: "Gauge" },
    { label: "Drive Time", value: formatMinutes(data.total_duration_minutes), icon: "Clock" },
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
  const pct = Math.min((value / max) * 100, 100);
  const color =
    value >= dangerAbove ? palette.danger : value >= warnAbove ? palette.warning : palette.success;
  const bg =
    value >= dangerAbove ? palette.dangerSoft : value >= warnAbove ? palette.warningSoft : palette.successSoft;
  const statusLabel =
    value >= dangerAbove ? "High" : value >= warnAbove ? "Moderate" : "Good";

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
          Trip #{index}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {dateStr} · {timeStr}
        </Text>
      </View>

      {/* Stats row */}
      <View style={{ flexDirection: "row", gap: spacing.lg }}>
        <StatChip icon="Route" label={`${trip.distance_km.toFixed(1)} km`} />
        <StatChip icon="Clock" label={`${Math.round(trip.duration_minutes)} min`} />
        <StatChip icon="Gauge" label={`${Math.round(trip.avg_speed_kmh)} km/h`} />
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
          label={`${trip.braking_events} brake${trip.braking_events !== 1 ? "s" : ""}`}
          color={brakeColor}
        />
        <EventPill
          icon="Navigation"
          label={`${trip.cornering_events} corner${trip.cornering_events !== 1 ? "s" : ""}`}
          color={cornerColor}
        />
        <EventPill
          icon="Thermometer"
          label={`${Math.round(trip.max_coolant_temp_c)}°C peak`}
          color={trip.max_coolant_temp_c > 105 ? palette.danger : trip.max_coolant_temp_c > 95 ? palette.warning : palette.textMuted}
        />
        <EventPill
          icon="Zap"
          label={`${trip.avg_battery_voltage_v.toFixed(1)} V`}
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
      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>No Data Yet</Text>
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        {message}
      </Text>
    </View>
  );
}

function NoVehicleState() {
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
      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>No vehicle selected</Text>
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        Trip behaviour is recorded per vehicle. Add or select one to see its trips.
      </Text>
      <Pressable
        onPress={() => router.push("/(driver)/manage-vehicles")}
        accessibilityRole="button"
        accessibilityLabel="Manage vehicles"
        style={({ pressed }) => ({
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
          borderRadius: radii.lg,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.xl,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Manage Vehicles</Text>
      </Pressable>
    </View>
  );
}

function LoadFailedState({ onRetry }: { onRetry: () => void }) {
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
      <Text style={{ ...typography.h3, color: palette.text, textAlign: "center" }}>Couldn&apos;t load trips</Text>
      <Text style={{ ...typography.body, color: palette.textMuted, textAlign: "center" }}>
        The maintenance server didn&apos;t respond. Check your connection and try again.
      </Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Try again"
        style={({ pressed }) => ({
          backgroundColor: pressed ? palette.brandPressed : palette.brand,
          borderRadius: radii.lg,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.xl,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
