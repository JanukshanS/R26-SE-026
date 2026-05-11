import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon, type IconName } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_LOCATION, DEMO_VEHICLE } from "@lib/emergencyContext";
import { createIncident, submitTriage, DispatchApiError } from "@lib/dispatchApi";

const LIGHTS: { id: string; icon: IconName; label: string }[] = [
  { id: "engine",  icon: "Cog",           label: "Engine" },
  { id: "oil",     icon: "Droplet",       label: "Oil" },
  { id: "battery", icon: "BatteryWarning",label: "Battery" },
  { id: "brake",   icon: "OctagonAlert",  label: "Brake" },
  { id: "abs",     icon: "CircleSlash2",  label: "ABS" },
  { id: "fuel",    icon: "Fuel",          label: "Fuel" },
  { id: "tyre",    icon: "CircleDot",     label: "Tyre" },
  { id: "temp",    icon: "Thermometer",   label: "Temp" },
  { id: "other",   icon: "TriangleAlert", label: "Other" },
];

export default function DiagnosisLightsScreen() {
  const {
    mobileLights, toggleLight,
    setLoading, setError, setIncidentId, setTriageResult,
    buildTriageResponses, loading,
  } = useEmergency();

  /**
   * Final step of the questionnaire branch — POST /incidents + /triage/submit,
   * then jump to the result screen (which kicks off /dispatch/optimize).
   */
  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const incident = await createIncident({
        location:    DEMO_LOCATION,
        vehicleInfo: DEMO_VEHICLE,
        description: "Roadside assistance requested via mobile app",
      });
      setIncidentId(incident.id);

      const triage = await submitTriage({
        incidentId: incident.id,
        responses:  buildTriageResponses(),
      });
      setTriageResult(triage.result);

      router.push("/(emergency)/diagnosis-result");
    } catch (err) {
      const msg = err instanceof DispatchApiError
        ? `${err.message} (HTTP ${err.status})`
        : (err as Error).message;
      setError(msg);
      Alert.alert(
        "Triage failed",
        `${msg}\n\nMake sure the dispatch service is running on port 3001 ` +
        `(npm run dev in components/dispatch).`
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen
      footer={
        <Button
          title={loading ? "Submitting..." : "Next Step"}
          onPress={handleSubmit}
          disabled={loading}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Process</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Which dashboard lights are on?
      </Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>
        Tap all warning lights you see on your dashboard.
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
        {LIGHTS.map((light) => {
          const active = mobileLights.has(light.id);
          return (
            <Pressable
              key={light.id}
              onPress={() => toggleLight(light.id)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                width: "30%",
                aspectRatio: 1,
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
                {light.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Submitting triage...
          </Text>
        </View>
      )}
    </Screen>
  );
}
