import { useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_LOCATION, DEMO_VEHICLE } from "@lib/emergencyContext";
import { createIncident, submitTriage, runDispatch, DispatchApiError } from "@lib/dispatchApi";

type Choice = "CRASH" | "MINOR" | "NONE" | null;

export default function SafetyCheckScreen() {
  const [choice, setChoice] = useState<Choice>(null);
  const {
    setDamage,
    setLoading: setCtxLoading,
    setError,
    setIncidentId,
    setTriageResult,
    setDispatchResult,
    loading: ctxLoading,
  } = useEmergency();

  /**
   * MAJOR_CRASH is a fast-path intent. We do the full create-incident +
   * triage-submit + dispatch-optimize round-trip here, then jump straight
   * to the connected screen — skipping the sound + lights questions.
   */
  async function handleFastPathCrash() {
    setCtxLoading(true);
    setError(null);
    try {
      const incident = await createIncident({
        location:    DEMO_LOCATION,
        vehicleInfo: DEMO_VEHICLE,
        description: "Major accident reported via mobile app",
      });
      setIncidentId(incident.id);

      const triage = await submitTriage({
        incidentId: incident.id,
        responses: {
          Q1_intent:          "MAJOR_CRASH",
          Q2_engine_start:    "NOT_ASKED",
          Q2b_running_issue:  "NOT_ASKED",
          Q3_sound:           "NOT_ASKED",
          Q3b_electrical:     "NOT_ASKED",
          Q4_noise_detail:    "NOT_ASKED",
          Q7_overheat_detail: "NOT_ASKED",
          Q8_smoke_color:     "NOT_ASKED",
          Q_brake_detail:     "NOT_ASKED",
          Q_gear_detail:      "NOT_ASKED",
          Q6_smells:          "NO_SMELL",
          Q5_lights:          ["NONE"],
          Q9_recent:          ["NO_SIGNS"],
          location_type:      "URBAN",
          recent_rain:        "NONE",
          parked_overnight:   "OUTDOOR",
          vehicle_age_bucket: "8_15",
          last_fueled:        "WITHIN_WEEK",
        },
      });
      setTriageResult(triage.result);

      const dispatch = await runDispatch({
        incidentId:         incident.id,
        trafficImpactScore: 9,  // major crash gets high traffic-impact weight
      });
      setDispatchResult(dispatch);

      router.replace("/(emergency)/connected");
    } catch (err) {
      const msg = err instanceof DispatchApiError
        ? `${err.message} (${err.status})`
        : (err as Error).message;
      setError(msg);
      Alert.alert("Dispatch failed", msg);
    } finally {
      setCtxLoading(false);
    }
  }

  function handleNext() {
    if (!choice) return;
    setDamage(choice);
    if (choice === "CRASH") {
      handleFastPathCrash();
    } else {
      // Engine-state is the real branching point of the adaptive form —
      // the answer there decides whether we even need to ask about the
      // engine sound (only relevant when the engine cranks but won't fire).
      router.push("/(emergency)/engine-state");
    }
  }

  function callAmbulance() {
    Linking.openURL("tel:1990").catch(() => {
      Alert.alert("Unable to call", "Please dial 1990 manually.");
    });
  }

  return (
    <Screen
      footer={
        <Button
          title={ctxLoading ? "Dispatching..." : "Next Step"}
          disabled={!choice || ctxLoading}
          onPress={handleNext}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Safety Check</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Is there visible damage to your vehicle?
      </Text>

      <OptionCard
        badge="Yes"
        badgeTone="danger"
        title="Major (Accident/Crash)"
        selected={choice === "CRASH"}
        onPress={() => setChoice("CRASH")}
      />
      <OptionCard
        badge="Yes"
        badgeTone="warning"
        title="Minor (Dent/Scratch)"
        selected={choice === "MINOR"}
        onPress={() => setChoice("MINOR")}
      />
      <OptionCard
        badge="No"
        badgeTone="success"
        title="No Visible Damage"
        selected={choice === "NONE"}
        onPress={() => setChoice("NONE")}
      />

      {/* "1990 — Emergency Ambulance" tap-to-call directly, matches reference UI */}
      <Pressable
        onPress={callAmbulance}
        style={({ pressed }) => ({
          marginTop: spacing.md,
          opacity: pressed ? 0.85 : 1,
          backgroundColor: palette.supportCoral,
          borderRadius: radii.lg,
          borderCurve: "continuous",
          paddingVertical: spacing.lg,
          paddingHorizontal: spacing.lg,
          alignItems: "center",
          gap: 4,
        })}
      >
        <Text style={{ ...typography.bodyStrong, color: palette.textOnBrand }}>
          1990 - Emergency Ambulance
        </Text>
        <Text style={{ ...typography.caption, color: palette.textOnBrand, opacity: 0.9 }}>
          Tap to Call Directly
        </Text>
      </Pressable>

      {ctxLoading && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Dispatching emergency tow...
          </Text>
        </View>
      )}
    </Screen>
  );
}
