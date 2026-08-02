import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@components/ui/icon";
import { BottomNavBar, NAV_BAR_HEIGHT } from "@components/ui/bottom-nav-bar";
import { ObdSourceBadge } from "@components/ui/obd-source-badge";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  endTrip,
  getTripStats,
  isTripActive,
  MIN_IMU_READINGS,
  MIN_OBD_READINGS,
  OBD_INTERVAL_MS,
  onTripUpdate,
  type TripStats,
} from "@lib/tripRecorder";
import { submitTrip } from "@lib/maintenanceApi";

export default function ActiveTripScreen() {
  const insets = useSafeAreaInsets();
  const [stats, setStats] = useState<TripStats | null>(getTripStats());
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If we land here without an active trip, go back
  useEffect(() => {
    if (!isTripActive()) { router.replace("/(driver)/home"); return; }

    // Listen for OBD/IMU snapshots
    const unsub = onTripUpdate(() => setStats(getTripStats()));

    // Poll every second so the elapsed timer + countdown update smoothly
    pollRef.current = setInterval(() => setStats(getTripStats()), 1000);

    return () => {
      unsub();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function handleEndTrip() {
    const s = getTripStats();
    if (!s) return;

    if (!s.canEnd) {
      const needObd = Math.max(0, MIN_OBD_READINGS - s.obdCount);
      const needImu = Math.max(0, MIN_IMU_READINGS - s.imuCount);
      const waitMsg = needImu > 0
        ? `${needImu} more IMU snapshot${needImu !== 1 ? "s" : ""} needed`
        : `${needObd} more OBD reading${needObd !== 1 ? "s" : ""} needed`;
      Alert.alert("Trip too short", `Keep driving — ${waitMsg} before the trip can be saved.`);
      return;
    }

    Alert.alert("End trip?", "Trip data will be sent to the maintenance backend.", [
      { text: "Keep driving", style: "cancel" },
      {
        text: "End & Save",
        style: "destructive",
        onPress: async () => {
          setSubmitting(true);
          try {
            const batch = await endTrip();
            await submitTrip(batch);
            router.replace({
              pathname: "/(driver)/trip-summary",
              params: { vehicleId: batch.vehicle_id },
            });
          } catch (err: any) {
            Alert.alert(
              "Save failed",
              err?.message ?? "Could not reach the maintenance server. Trip data is lost.",
              [{ text: "OK", onPress: () => router.replace("/(driver)/home") }]
            );
          } finally {
            setSubmitting(false);
          }
        },
      },
    ]);
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
          gap: spacing.sm,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 10, height: 10, borderRadius: 5,
              backgroundColor: palette.success,
            }}
          />
          <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
            Recording Trip
          </Text>
          <View
            style={{
              flexDirection: "row", alignItems: "center",
              gap: spacing.xs, paddingHorizontal: spacing.md,
              paddingVertical: 4, borderRadius: radii.pill,
              backgroundColor: palette.dangerSoft,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: palette.danger }} />
            <Text style={{ ...typography.caption, color: palette.danger, fontWeight: "700" }}>
              LIVE
            </Text>
          </View>
        </View>
        <ObdSourceBadge />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          paddingBottom: insets.bottom + NAV_BAR_HEIGHT + 100,
        }}
      >
        {/* Elapsed time */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.xl,
            padding: spacing.xl,
            alignItems: "center",
            gap: spacing.xs,
            borderLeftWidth: 4,
            borderLeftColor: palette.brand,
          }}
        >
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Elapsed time
          </Text>
          <Text
            style={{
              fontSize: 52,
              fontWeight: "700",
              color: palette.text,
              fontVariant: ["tabular-nums"],
            }}
          >
            {stats ? formatElapsed(stats.elapsedMs) : "00:00"}
          </Text>
          {stats && (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              Next OBD read in{" "}
              <Text style={{ color: palette.brand, fontWeight: "600" }}>
                {formatMs(stats.nextObdInMs)}
              </Text>
            </Text>
          )}
        </View>

        {/* Live OBD readings */}
        {stats?.lastObd && (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              Live OBD Readings
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              <OBDCell
                icon="Gauge"
                label="RPM"
                value={`${stats.lastObd.rpm.toLocaleString()}`}
                sub="rpm"
                color={stats.lastObd.rpm > 3000 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Navigation"
                label="Speed"
                value={`${stats.lastObd.speed_kmh}`}
                sub="km/h"
                color={palette.brand}
              />
              <OBDCell
                icon="Thermometer"
                label="Coolant"
                value={`${stats.lastObd.coolant_temp_c}`}
                sub="°C"
                color={stats.lastObd.coolant_temp_c > 100 ? palette.danger : stats.lastObd.coolant_temp_c > 95 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Zap"
                label="Battery"
                value={`${stats.lastObd.battery_voltage_v}`}
                sub="V"
                color={stats.lastObd.battery_voltage_v < 12.5 ? palette.danger : stats.lastObd.battery_voltage_v < 13.5 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Activity"
                label="Engine Load"
                value={`${stats.lastObd.engine_load_percent}`}
                sub="%"
                color={stats.lastObd.engine_load_percent > 80 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Wind"
                label="Intake Air"
                value={`${stats.lastObd.intake_air_temp_c}`}
                sub="°C"
                color={palette.textMuted}
              />
            </View>
          </View>
        )}

        {/* Driving behaviour events (from IMU) */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            Driving Behaviour
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <EventCard
              icon="Disc"
              label="Braking Events"
              value={stats?.brakingEvents ?? 0}
              description="Hard stops detected"
              dangerAbove={4}
              warnAbove={2}
            />
            <EventCard
              icon="RotateCcw"
              label="Cornering Events"
              value={stats?.corneringEvents ?? 0}
              description="Sharp turns detected"
              dangerAbove={4}
              warnAbove={2}
            />
          </View>
        </View>

        {/* Data collection progress */}
        <View
          style={{
            backgroundColor: palette.surface,
            borderRadius: radii.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            Data Collection
          </Text>
          <ProgressRow
            icon="Radio"
            label="OBD Snapshots"
            count={stats?.obdCount ?? 0}
            min={MIN_OBD_READINGS}
            unit={`/ ${OBD_INTERVAL_MS / 60000} min each`}
          />
          <ProgressRow
            icon="Smartphone"
            label="IMU Snapshots"
            count={stats?.imuCount ?? 0}
            min={MIN_IMU_READINGS}
            unit="/ 2 min each"
          />
          {stats && !stats.canEnd && (
            <View
              style={{
                flexDirection: "row", alignItems: "center", gap: spacing.sm,
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                borderRadius: radii.md, backgroundColor: palette.brandSoft,
              }}
            >
              <Icon name="Info" size={14} color={palette.brand} />
              <Text style={{ ...typography.caption, color: palette.brand, flex: 1 }}>
                {`Keep driving — ${Math.max(0, MIN_IMU_READINGS - (stats.imuCount))} more snapshot${Math.max(0, MIN_IMU_READINGS - stats.imuCount) !== 1 ? "s" : ""} needed`}
              </Text>
            </View>
          )}
          {stats?.canEnd && (
            <View
              style={{
                flexDirection: "row", alignItems: "center", gap: spacing.sm,
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                borderRadius: radii.md, backgroundColor: palette.successSoft,
              }}
            >
              <Icon name="CheckCircle" size={14} color={palette.success} />
              <Text style={{ ...typography.caption, color: palette.success, fontWeight: "600" }}>
                Enough data collected — you can end the trip
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Bottom action bar */}
      <View
        style={{
          position: "absolute",
          left: 0, right: 0,
          bottom: NAV_BAR_HEIGHT + insets.bottom,
          backgroundColor: palette.surface,
          borderTopWidth: 1,
          borderTopColor: palette.border,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
        }}
      >
        <Pressable
          onPress={submitting ? undefined : handleEndTrip}
          disabled={submitting}
          style={({ pressed }) => ({
            backgroundColor:
              submitting ? palette.border
              : pressed   ? "#DC2626"
              :             palette.danger,
            borderRadius: radii.lg,
            paddingVertical: spacing.md + 2,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: spacing.sm,
            opacity: submitting ? 0.7 : 1,
          })}
        >
          <Icon
            name={submitting ? "Loader" : "CircleStop"}
            size={18}
            color={palette.textOnBrand}
          />
          <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
            {submitting ? "Saving trip…" : "End Trip"}
          </Text>
        </Pressable>
      </View>

      <BottomNavBar activeTab="maintenance" />
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OBDCell({
  icon, label, value, sub, color,
}: {
  icon: string; label: string; value: string; sub: string; color: string;
}) {
  return (
    <View
      style={{
        flex: 1, minWidth: "45%",
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.md,
        gap: 2,
        borderTopWidth: 2,
        borderTopColor: color,
      }}
    >
      <Icon name={icon as any} size={14} color={color} />
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 4 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: palette.text }}>
          {value}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{sub}</Text>
      </View>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
    </View>
  );
}

function EventCard({
  icon, label, value, description, dangerAbove, warnAbove,
}: {
  icon: string; label: string; value: number; description: string;
  dangerAbove: number; warnAbove: number;
}) {
  const color =
    value >= dangerAbove ? palette.danger
    : value >= warnAbove ? palette.warning
    : palette.success;
  const bg =
    value >= dangerAbove ? palette.dangerSoft
    : value >= warnAbove ? palette.warningSoft
    : palette.successSoft;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        padding: spacing.md,
        gap: spacing.xs,
        borderTopWidth: 2,
        borderTopColor: color,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon name={icon as any} size={14} color={color} />
        <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>{label}</Text>
      </View>
      <Text style={{ fontSize: 32, fontWeight: "700", color }}>{value}</Text>
      <View
        style={{
          paddingHorizontal: spacing.sm, paddingVertical: 2,
          borderRadius: radii.pill, backgroundColor: bg, alignSelf: "flex-start",
        }}
      >
        <Text style={{ ...typography.caption, color, fontWeight: "600", fontSize: 10 }}>
          {value >= dangerAbove ? "High" : value >= warnAbove ? "Moderate" : "Good"}
        </Text>
      </View>
      <Text style={{ ...typography.caption, color: palette.textMuted, fontSize: 10 }}>
        {description}
      </Text>
    </View>
  );
}

function ProgressRow({
  icon, label, count, min, unit,
}: {
  icon: string; label: string; count: number; min: number; unit: string;
}) {
  const done = count >= min;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
      <Icon name={icon as any} size={16} color={done ? palette.success : palette.textMuted} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ ...typography.caption, color: palette.text }}>{label}</Text>
          <Text
            style={{
              ...typography.caption,
              color: done ? palette.success : palette.brand,
              fontWeight: "600",
            }}
          >
            {count} {unit}
          </Text>
        </View>
        <View
          style={{
            marginTop: 4, height: 4, borderRadius: radii.pill,
            backgroundColor: palette.border, overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.min((count / min) * 100, 100)}%`,
              height: "100%",
              borderRadius: radii.pill,
              backgroundColor: done ? palette.success : palette.brand,
            }}
          />
        </View>
      </View>
      {done && <Icon name="CheckCircle" size={16} color={palette.success} />}
    </View>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatMs(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
