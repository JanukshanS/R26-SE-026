import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Icon, type IconName } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  getEngineSnapshot,
  isEngineMonitorRunning,
  onEngineStateChange,
  type EngineMonitorSnapshot,
  type EngineState,
} from "@lib/engineMonitor";

/**
 * Live readout of the engine-state machine. This is the validation instrument
 * for the observe-only phase: it shows the voltages the thresholds in
 * `engineMonitor.ts` are being judged against, so they can be tuned to a real
 * car before auto start/stop is switched on.
 *
 * Renders nothing when the monitor isn't running (no real dongle paired).
 */

const STATE_STYLE: Record<EngineState, { color: string; bg: string; icon: IconName; label: string }> = {
  unknown:        { color: palette.textMuted, bg: palette.surfaceMuted,   icon: "CircleHelp",    label: "Waiting for a reading" },
  "engine-off":   { color: palette.textMuted, bg: palette.surfaceMuted,   icon: "CirclePower",   label: "Engine off" },
  cranking:       { color: palette.warning,   bg: palette.warningSoft,  icon: "Zap",           label: "Cranking" },
  running:        { color: palette.success,   bg: palette.successSoft,  icon: "Activity",      label: "Engine running" },
  "adapter-lost": { color: palette.danger,    bg: palette.dangerSoft,   icon: "BluetoothOff",  label: "Adapter unreachable" },
};

export function EngineStateDebug() {
  const [snap, setSnap] = useState<EngineMonitorSnapshot | null>(
    isEngineMonitorRunning() ? getEngineSnapshot() : null
  );

  useEffect(() => {
    const unsub = onEngineStateChange(setSnap);
    // The monitor may start after this mounts (pairing completes later), so
    // poll the running flag rather than assuming the subscription is enough.
    const tick = setInterval(() => {
      if (isEngineMonitorRunning()) setSnap(getEngineSnapshot());
      else setSnap(null);
    }, 2000);
    return () => {
      unsub();
      clearInterval(tick);
    };
  }, []);

  if (!snap) return null;

  const s = STATE_STYLE[snap.state];
  const agoSec = snap.lastPollAt ? Math.round((Date.now() - snap.lastPollAt) / 1000) : null;

  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: palette.border,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
        <Icon name="Wrench" size={13} color={palette.textMuted} />
        <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
          ENGINE DETECTION (observing only)
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingVertical: 6,
          borderRadius: radii.pill,
          backgroundColor: s.bg,
          alignSelf: "flex-start",
        }}
      >
        <Icon name={s.icon} size={14} color={s.color} />
        <Text style={{ ...typography.caption, color: s.color, fontWeight: "700" }}>{s.label}</Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        <Field label="Voltage" value={snap.voltage !== null ? `${snap.voltage.toFixed(2)} V` : "—"} />
        <Field label="RPM" value={snap.rpm !== null ? String(snap.rpm) : "not probed"} />
        <Field
          label="Resting baseline"
          value={snap.restingBaselineV !== null ? `${snap.restingBaselineV.toFixed(2)} V` : "learning…"}
        />
        <Field label="In band" value={String(snap.consecutiveInBand)} />
        <Field label="Last poll" value={agoSec !== null ? `${agoSec}s ago` : "—"} />
        {snap.adapterLostSinceMs !== null && (
          <Field label="Lost for" value={`${Math.round(snap.adapterLostSinceMs / 1000)}s`} />
        )}
      </View>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ minWidth: 92 }}>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
      <Text style={{ ...typography.body, color: palette.text, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}
