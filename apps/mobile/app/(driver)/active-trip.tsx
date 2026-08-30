import { useCallback, useEffect, useRef, useState } from "react";
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
  IMU_INTERVAL_MS,
  MIN_IMU_READINGS,
  MIN_OBD_READINGS,
  OBD_INTERVAL_MS,
  onTripUpdate,
  type TripStats,
} from "@lib/tripRecorder";
import { submitTrip, type TripBatch } from "@lib/maintenanceApi";
import { useHardwareBack } from "@lib/useHardwareBack";
import { useT, type Translate } from "@lib/i18n";

export default function ActiveTripScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const [stats, setStats] = useState<TripStats | null>(getTripStats());
  const [submitting, setSubmitting] = useState(false);
  // Set when a completed trip failed to upload. endTrip() hands back the only
  // copy of the batch, so it is held here and stays retryable instead of lost.
  const [pending, setPending] = useState<TripBatch | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If we land here without an active trip, go back
  useEffect(() => {
    if (!isTripActive()) { router.replace("/(driver)/home"); return; }

    // getTripStats() returns null once the recorder is torn down. Keeping the
    // last non-null reading means the post-end "Trip Recorded" state still
    // shows the numbers that were actually captured, instead of resetting the
    // whole screen to 00:00 and zeroes while the upload is retried.
    const refresh = () => {
      const s = getTripStats();
      if (s) setStats(s);
    };

    // Listen for OBD/IMU snapshots
    const unsub = onTripUpdate(refresh);

    // Poll every second so the elapsed timer + countdown update smoothly
    pollRef.current = setInterval(refresh, 1000);

    return () => {
      unsub();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // An unsaved batch lives only in `pending` — leaving this screen destroys the
  // whole drive, so back has to ask first.
  useHardwareBack(
    useCallback(() => {
      if (!pending) return false;
      Alert.alert(
        t("driver.activeTrip.leaveTitle"),
        t("driver.activeTrip.leaveBody"),
        [
          { text: t("driver.activeTrip.stay"), style: "cancel" },
          {
            text: t("driver.activeTrip.discard"),
            style: "destructive",
            onPress: () => { setPending(null); router.replace("/(driver)/home"); },
          },
        ]
      );
      return true;
    }, [pending, t])
  );

  async function saveTrip(batch: TripBatch) {
    setSubmitting(true);
    try {
      await submitTrip(batch);
      setPending(null);
      router.replace({
        pathname: "/(driver)/trip-summary",
        params: { vehicleId: batch.vehicle_id },
      });
    } catch (err: any) {
      setPending(batch);
      Alert.alert(
        t("driver.activeTrip.saveFailedTitle"),
        t("driver.activeTrip.saveFailedBody", {
          message: err?.message ?? t("driver.activeTrip.saveFailedFallback"),
        }),
        [
          { text: t("driver.activeTrip.retry"), onPress: () => { void saveTrip(batch); } },
          {
            text: t("driver.activeTrip.discard"),
            style: "destructive",
            onPress: () => { setPending(null); router.replace("/(driver)/home"); },
          },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleEndTrip() {
    if (submitting) return;
    const s = getTripStats();
    if (!s) return;

    if (!s.canEnd) {
      const needObd = Math.max(0, MIN_OBD_READINGS - s.obdCount);
      const needImu = Math.max(0, MIN_IMU_READINGS - s.imuCount);
      const waitMsg = needImu > 0
        ? t("driver.activeTrip.tooShortImu", { count: needImu })
        : t("driver.activeTrip.tooShortObd", { count: needObd });
      Alert.alert(t("driver.activeTrip.tooShortTitle"), waitMsg, [
        { text: t("driver.activeTrip.keepDriving"), style: "cancel" },
        {
          // A trip started by mistake otherwise has no way out: the recorder
          // keeps its timers and the phone sensors running. endTrip() tears
          // both down, and there is nothing worth saving below the minimum.
          text: t("driver.activeTrip.discard"),
          style: "destructive",
          onPress: async () => {
            await endTrip().catch(() => {});
            router.replace("/(driver)/home");
          },
        },
      ]);
      return;
    }

    Alert.alert(t("driver.activeTrip.endTitle"), t("driver.activeTrip.endBody"), [
      { text: t("driver.activeTrip.keepDriving"), style: "cancel" },
      {
        text: t("driver.activeTrip.endConfirm"),
        style: "destructive",
        onPress: async () => {
          setSubmitting(true);
          try {
            const batch = await endTrip();
            await saveTrip(batch);
          } catch (err: any) {
            setSubmitting(false);
            Alert.alert(
              t("driver.activeTrip.endFailedTitle"),
              err?.message ?? t("driver.activeTrip.endFailedFallback")
            );
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
              backgroundColor: pending ? palette.warning : palette.success,
            }}
          />
          <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
            {pending ? t("driver.activeTrip.headingRecorded") : t("driver.activeTrip.headingRecording")}
          </Text>
          {/* Recording has stopped once a batch is pending — a LIVE pill there
              would claim the phone is still sampling. */}
          <View
            style={{
              flexDirection: "row", alignItems: "center",
              gap: spacing.xs, paddingHorizontal: spacing.md,
              paddingVertical: 4, borderRadius: radii.pill,
              backgroundColor: pending ? palette.warningSoft : palette.dangerSoft,
            }}
          >
            <View
              style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: pending ? palette.warning : palette.danger,
              }}
            />
            <Text
              style={{
                ...typography.caption,
                color: pending ? palette.warning : palette.danger,
                fontWeight: "700",
              }}
            >
              {pending ? t("driver.activeTrip.pillNotSaved") : t("driver.activeTrip.pillLive")}
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
            {t("driver.activeTrip.elapsed")}
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
          {/* Frozen once the recorder stops — a countdown there would claim a
              read is still coming. */}
          {stats && !pending && (
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {t("driver.activeTrip.nextObdRead")}{" "}
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
              {t("driver.activeTrip.obdHeading")}
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
                label={t("driver.activeTrip.obdSpeed")}
                value={`${stats.lastObd.speed_kmh}`}
                sub="km/h"
                color={palette.brand}
              />
              <OBDCell
                icon="Thermometer"
                label={t("driver.activeTrip.obdCoolant")}
                value={`${stats.lastObd.coolant_temp_c}`}
                sub="°C"
                color={stats.lastObd.coolant_temp_c > 100 ? palette.danger : stats.lastObd.coolant_temp_c > 95 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Zap"
                label={t("driver.activeTrip.obdBattery")}
                value={`${stats.lastObd.battery_voltage_v}`}
                sub="V"
                color={stats.lastObd.battery_voltage_v < 12.5 ? palette.danger : stats.lastObd.battery_voltage_v < 13.5 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Activity"
                label={t("driver.activeTrip.obdEngineLoad")}
                value={`${stats.lastObd.engine_load_percent}`}
                sub="%"
                color={stats.lastObd.engine_load_percent > 80 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Wind"
                label={t("driver.activeTrip.obdIntakeAir")}
                value={`${stats.lastObd.intake_air_temp_c}`}
                sub="°C"
                color={palette.textMuted}
              />
              <OBDCell
                icon="ChevronsUp"
                label={t("driver.activeTrip.obdThrottle")}
                value={`${stats.lastObd.throttle_percent}`}
                sub="%"
                color={stats.lastObd.throttle_percent > 70 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Fuel"
                label={t("driver.activeTrip.obdFuelTrim")}
                value={`${stats.lastObd.ltft_percent}`}
                sub="% LTFT"
                // Trim far from zero means the ECU is compensating hard for a
                // fuelling problem, in either direction — so the threshold is
                // on the MAGNITUDE, not the signed value.
                color={Math.abs(stats.lastObd.ltft_percent) > 10 ? palette.danger : Math.abs(stats.lastObd.ltft_percent) > 5 ? palette.warning : palette.success}
              />
              <OBDCell
                icon="Route"
                label={t("driver.activeTrip.obdDistance")}
                value={`${(stats.distanceKm ?? 0).toFixed(2)}`}
                sub="km"
                color={palette.brand}
              />
            </View>
          </View>
        )}

        {/* Driving behaviour events (from IMU) */}
        <View style={{ gap: spacing.sm }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {t("driver.activeTrip.behaviourHeading")}
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <EventCard
              icon="Disc"
              label={t("driver.activeTrip.brakingEvents")}
              value={stats?.brakingEvents ?? 0}
              description={t("driver.activeTrip.brakingEventsHint")}
              dangerAbove={4}
              warnAbove={2}
            />
            <EventCard
              icon="RotateCcw"
              label={t("driver.activeTrip.corneringEvents")}
              value={stats?.corneringEvents ?? 0}
              description={t("driver.activeTrip.corneringEventsHint")}
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
            {t("driver.activeTrip.dataHeading")}
          </Text>
          <ProgressRow
            icon="Radio"
            label={t("driver.activeTrip.obdSnapshots")}
            count={stats?.obdCount ?? 0}
            min={MIN_OBD_READINGS}
            unit={t("driver.activeTrip.progressUnit", { interval: intervalLabel(OBD_INTERVAL_MS, t) })}
          />
          <ProgressRow
            icon="Smartphone"
            label={t("driver.activeTrip.imuSnapshots")}
            count={stats?.imuCount ?? 0}
            min={MIN_IMU_READINGS}
            unit={t("driver.activeTrip.progressUnit", { interval: intervalLabel(IMU_INTERVAL_MS, t) })}
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
                {t("driver.activeTrip.needSnapshots", {
                  count: Math.max(0, MIN_IMU_READINGS - stats.imuCount),
                })}
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
                {t("driver.activeTrip.enoughData")}
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
          gap: spacing.sm,
        }}
      >
        {pending && !submitting && (
          <Text style={{ ...typography.caption, color: palette.warning, textAlign: "center" }}>
            {t("driver.activeTrip.pendingNote")}
          </Text>
        )}
        <Pressable
          onPress={
            submitting ? undefined
            : pending  ? () => { void saveTrip(pending); }
            :            handleEndTrip
          }
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
            name={submitting ? "Loader" : pending ? "RotateCcw" : "CircleStop"}
            size={18}
            color={palette.textOnBrand}
          />
          <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
            {submitting ? t("driver.activeTrip.saving") : pending ? t("driver.activeTrip.retrySave") : t("driver.activeTrip.endTrip")}
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
  const t = useT();
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
          {value >= dangerAbove
            ? t("driver.activeTrip.statusHigh")
            : value >= warnAbove
              ? t("driver.activeTrip.statusModerate")
              : t("driver.activeTrip.statusGood")}
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

/** Sampling cadence as shown on the progress rows. Reads the real interval so
 *  the dev build's compressed timers aren't described as the 5 min / 2 min spec. */
function intervalLabel(ms: number, t: Translate): string {
  return ms >= 60_000
    ? t("driver.activeTrip.intervalMinutes", { value: ms / 60_000 })
    : t("driver.activeTrip.intervalSeconds", { value: Math.round(ms / 1000) });
}
