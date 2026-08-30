import { useRef } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Icon, type IconName } from "@components/ui/icon";
import { QuestionScreen, useNextStep } from "@components/ui/question-screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_VEHICLE } from "@lib/emergencyContext";
import { createIncident, DispatchApiError } from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";
import { useT } from "@lib/i18n";

const LIGHTS: { id: string; icon: IconName; labelKey: string }[] = [
  { id: "engine",  icon: "Cog",           labelKey: "emergency.lights.engine" },
  { id: "oil",     icon: "Droplet",       labelKey: "emergency.lights.oil" },
  { id: "battery", icon: "BatteryWarning",labelKey: "emergency.lights.battery" },
  { id: "brake",   icon: "OctagonAlert",  labelKey: "emergency.lights.brake" },
  { id: "abs",     icon: "CircleSlash2",  labelKey: "emergency.lights.abs" },
  { id: "fuel",    icon: "Fuel",          labelKey: "emergency.lights.fuel" },
  { id: "tyre",    icon: "CircleDot",     labelKey: "emergency.lights.tyre" },
  { id: "temp",    icon: "Thermometer",   labelKey: "emergency.lights.temp" },
  { id: "other",   icon: "TriangleAlert", labelKey: "emergency.lights.other" },
];

export default function DiagnosisLightsScreen() {
  const t = useT();
  const {
    mobileLights, toggleLight,
    setLoading, setError, setIncidentId,
    incidentId, loading,
  } = useEmergency();

  // `loading` only disables the button on the next render, which leaves a
  // double-tap window open that would file two incidents.
  const inFlightRef = useRef(false);
  const { advance: goNext } = useNextStep("diagnosis-lights");

  /**
   * After Q5 lights we hand off to the always-asked tail (smells → recent →
   * whichever branch-detail screen is active). The full POST /triage/submit
   * (with OBD) happens generically from question-screen.tsx once a screen
   * finds it has no next step — this one is never that screen, so `goNext`
   * here always just advances.
   *
   * We create the incident HERE (so we have an incident.id ready) — that
   * lets the dispatch backend track the in-progress request even before
   * the final submit, and unlocks the OBD bridge in elm327 (which keys its
   * "current vehicle condition" off the incident id).
   */
  async function handleNext() {
    // Coming back to change an answer and going forward again must not file a
    // second incident — the lights answer is submitted later, on SL context.
    if (incidentId) {
      goNext();
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const driver = await getCurrentDriverLocation();
      const incident = await createIncident({
        location:    { latitude: driver.latitude, longitude: driver.longitude },
        vehicleInfo: DEMO_VEHICLE,
        description: "Roadside assistance requested via mobile app",
      });
      setIncidentId(incident.id);
      goNext();
    } catch (err) {
      const raw = (err as Error).message;
      // authHeaders() throws this before the request leaves the device.
      if (!(err instanceof DispatchApiError) && raw.includes("signed in")) {
        setError(raw);
        Alert.alert(
          t("emergency.lights.signInTitle"),
          t("emergency.lights.signInBody"),
          [
            { text: t("emergency.action.notNow"), style: "cancel" },
            { text: t("emergency.action.signIn"), onPress: () => router.push("/(driver)/auth") },
          ]
        );
        return;
      }
      const reachable = err instanceof DispatchApiError;
      const msg = reachable ? t("emergency.error.withStatus", { message: raw, status: err.status }) : raw;
      setError(msg);
      Alert.alert(
        t("emergency.lights.requestFailedTitle"),
        reachable
          ? t("emergency.lights.requestFailedBody", { message: msg })
          : t("emergency.lights.unreachableBody") +
            (__DEV__ ? `\n\n[dev] ${msg} — is dispatch running on port 3001?` : "")
      );
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <QuestionScreen
      route="diagnosis-lights"
      prompt={t("emergency.lights.prompt")}
      hint={t("emergency.lights.hint")}
      nextLabel={loading ? t("emergency.lights.preparing") : t("emergency.question.next")}
      canNext={!loading}
      onNext={handleNext}
    >

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {LIGHTS.map((light) => {
          const active = mobileLights.has(light.id);
          return (
            <Pressable
              key={light.id}
              onPress={() => toggleLight(light.id)}
              accessibilityRole="checkbox"
              accessibilityLabel={t("emergency.lights.a11y", { name: t(light.labelKey) })}
              accessibilityState={{ checked: active }}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                // No aspectRatio: in a wrapping row the default
                // alignItems:"stretch" fights it, and the icon+label ends up
                // centred against a taller phantom box than the border you see -
                // the label sat almost on the bottom edge. Padding defines the
                // height instead, so the content is genuinely centred.
                flexBasis: "30%",
                flexGrow: 1,
                minHeight: 96,
                paddingVertical: spacing.lg,
                backgroundColor: active ? palette.text : palette.surface,
                borderRadius: radii.md,
                borderCurve: "continuous",
                borderWidth: 1,
                borderColor: active ? palette.text : palette.border,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              })}
            >
              <Icon
                name={light.icon}
                size={28}
                color={active ? palette.warning : palette.textMuted}
              />
              <Text
                style={{
                  ...typography.caption,
                  color: active ? palette.warning : palette.textMuted,
                  fontWeight: "600",
                }}
              >
                {t(light.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("emergency.lights.creating")}
          </Text>
        </View>
      )}
    </QuestionScreen>
  );
}
