/**
 * Simulated trip history generator.
 *
 * Deliberately has NO account, vehicle or driver fields. Running inside Kaduna
 * means the session, the selected vehicle and the driver id are already known,
 * so the entire feature is: choose how far, choose how it was driven, tap once.
 *
 * The driving style is not decoration. Brake pads wear on braking EVENTS
 * rather than on distance, so 6,000 km of highway barely moves them while the
 * same distance of city traffic wears them heavily. Which component visibly
 * degrades is decided here, not by the distance alone — hence the descriptions
 * naming the component each profile targets.
 */
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Icon } from "@components/ui/icon";
import { palette, radii, spacing, typography } from "@theme/index";
import {
  DRIVE_PROFILES,
  generateAndUploadHistory,
  type DriveProfile,
  type SimulatedTripsProgress,
  type SimulatedTripsResult,
} from "@lib/simulatedTrips";

const PRESET_KM = [1000, 3000, 6000, 12000];

export function SimulatedTripsModal({
  visible,
  onClose,
  vehicleId,
  driverId,
  onCompleted,
}: {
  visible: boolean;
  onClose: () => void;
  vehicleId: string;
  driverId: string;
  /** Fired after a run so the caller can refetch the trip summary. */
  onCompleted: () => void;
}) {
  const [targetKm, setTargetKm] = useState("6000");
  const [profile, setProfile] = useState<DriveProfile>(DRIVE_PROFILES[0]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SimulatedTripsProgress | null>(null);
  const [result, setResult] = useState<SimulatedTripsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const km = Number(targetKm);
    if (!Number.isFinite(km) || km <= 0) {
      setError("Enter a distance in km.");
      return;
    }
    setError(null);
    setResult(null);
    setRunning(true);
    try {
      const res = await generateAndUploadHistory({
        vehicleId,
        driverId,
        targetKm: km,
        profile,
        onProgress: setProgress,
      });
      setResult(res);
      if (res.tripsSent > 0) onCompleted();
      if (res.failed > 0 && res.tripsSent === 0) {
        setError(res.firstError ?? "Every trip failed to upload.");
      }
    } catch (e: any) {
      setError(e?.message ?? "Could not generate trips.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  function close() {
    if (running) return; // never abandon a half-finished upload
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: palette.overlay, justifyContent: "flex-end" }}>
        <View
          style={{
            backgroundColor: palette.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            maxHeight: "88%",
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
              padding: spacing.lg,
              borderBottomWidth: 1,
              borderBottomColor: palette.border,
            }}
          >
            <Icon name="FlaskConical" size={20} color={palette.brand} />
            <View style={{ flex: 1 }}>
              <Text style={{ ...typography.h3, color: palette.text }}>Simulated Trips</Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {vehicleId}
              </Text>
            </View>
            <Pressable onPress={close} disabled={running} hitSlop={10}>
              <Icon name="X" size={22} color={running ? palette.textMuted : palette.text} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
            {/* Distance */}
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                How much driving history?
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted, lineHeight: 18 }}>
                Brake pads are rated for 40,000 km and tires 50,000 km, so wear only
                becomes visible after thousands of kilometres. Around 6,000 km makes
                brake damage clear.
              </Text>

              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                {PRESET_KM.map((km) => {
                  const on = Number(targetKm) === km;
                  return (
                    <Pressable
                      key={km}
                      disabled={running}
                      onPress={() => setTargetKm(String(km))}
                      style={{
                        paddingVertical: spacing.sm,
                        paddingHorizontal: spacing.md,
                        borderRadius: radii.pill,
                        borderWidth: 1.5,
                        borderColor: on ? palette.brand : palette.border,
                        backgroundColor: on ? palette.brandSoft : palette.surfaceMuted,
                      }}
                    >
                      <Text
                        style={{
                          ...typography.caption,
                          color: on ? palette.brand : palette.textMuted,
                          fontWeight: on ? "700" : "500",
                        }}
                      >
                        {km.toLocaleString()} km
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={targetKm}
                onChangeText={setTargetKm}
                editable={!running}
                keyboardType="numeric"
                style={{
                  backgroundColor: palette.surfaceMuted,
                  borderRadius: radii.md,
                  borderWidth: 1,
                  borderColor: palette.border,
                  color: palette.text,
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm + 2,
                  ...typography.body,
                }}
              />
            </View>

            {/* Driving style */}
            <View style={{ gap: spacing.sm }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                How was it driven?
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted, lineHeight: 18 }}>
                This decides which component wears. Brakes wear on braking, not distance.
              </Text>
              {DRIVE_PROFILES.map((p) => {
                const on = p.id === profile.id;
                return (
                  <Pressable
                    key={p.id}
                    disabled={running}
                    onPress={() => setProfile(p)}
                    style={{
                      padding: spacing.md,
                      borderRadius: radii.lg,
                      borderWidth: 1.5,
                      borderColor: on ? palette.brand : palette.border,
                      backgroundColor: on ? palette.brandSoft : palette.surfaceMuted,
                      gap: 3,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text
                        style={{
                          ...typography.bodyStrong,
                          color: on ? palette.brand : palette.text,
                          flex: 1,
                        }}
                      >
                        {p.label}
                      </Text>
                      {on && <Icon name="Check" size={16} color={palette.brand} />}
                    </View>
                    <Text style={{ ...typography.micro, color: palette.textMuted, lineHeight: 16 }}>
                      {p.description}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Progress */}
            {running && progress && (
              <View
                style={{
                  backgroundColor: palette.surfaceMuted,
                  borderRadius: radii.lg,
                  padding: spacing.md,
                  gap: spacing.xs,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <ActivityIndicator size="small" color={palette.brand} />
                  <Text style={{ ...typography.body, color: palette.text, flex: 1 }}>
                    {progress.phase === "generating" ? "Generating…" : "Uploading…"}{" "}
                    {progress.done}/{progress.total}
                  </Text>
                </View>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: palette.border,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 6,
                      width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                      backgroundColor: palette.brand,
                    }}
                  />
                </View>
                <Text style={{ ...typography.micro, color: palette.textMuted }}>
                  {progress.kmStored.toFixed(0)} km stored
                  {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
                </Text>
              </View>
            )}

            {/* Result */}
            {result && !running && (
              <View
                style={{
                  backgroundColor: result.failed > 0 ? palette.warningSoft : palette.successSoft,
                  borderRadius: radii.lg,
                  padding: spacing.md,
                  gap: 4,
                }}
              >
                <Text
                  style={{
                    ...typography.bodyStrong,
                    color: result.failed > 0 ? palette.warning : palette.success,
                  }}
                >
                  {result.tripsSent} trips · {result.kmStored.toFixed(0)} km added
                </Text>
                <Text style={{ ...typography.micro, color: palette.textMuted, lineHeight: 16 }}>
                  Took {(result.elapsedMs / 1000).toFixed(1)}s
                  {result.failed > 0 ? ` · ${result.failed} failed` : ""}
                  {result.skipped > 0 ? ` · ${result.skipped} skipped (too short)` : ""}
                </Text>
                {result.firstError && (
                  <Text style={{ ...typography.micro, color: palette.danger, lineHeight: 16 }}>
                    {result.firstError}
                  </Text>
                )}
                <Text style={{ ...typography.micro, color: palette.textMuted, marginTop: 4 }}>
                  Open Vehicle Health to see the effect.
                </Text>
              </View>
            )}

            {error && !running && (
              <View
                style={{
                  backgroundColor: palette.dangerSoft,
                  borderRadius: radii.lg,
                  padding: spacing.md,
                }}
              >
                <Text style={{ ...typography.caption, color: palette.danger, lineHeight: 18 }}>
                  {error}
                </Text>
              </View>
            )}

            {/* Action */}
            <Pressable
              onPress={run}
              disabled={running}
              style={({ pressed }) => ({
                borderRadius: radii.lg,
                paddingVertical: spacing.md + 2,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: spacing.sm,
                backgroundColor: running
                  ? palette.surfaceMuted
                  : pressed
                    ? palette.brandPressed
                    : palette.brand,
              })}
            >
              {running && <ActivityIndicator size="small" color={palette.textMuted} />}
              <Text
                style={{
                  ...typography.bodyStrong,
                  color: running ? palette.textMuted : palette.textOnBrand,
                }}
              >
                {running ? "Working…" : result ? "Generate More" : "Generate & Upload"}
              </Text>
            </Pressable>

            <View style={{ height: spacing.lg }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
