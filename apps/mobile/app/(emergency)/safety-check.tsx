import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { OptionCard } from "@components/ui/option-card";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_VEHICLE } from "@lib/emergencyContext";
import { getAccessToken } from "@lib/capture-api";
import { haptics } from "@lib/haptics";
import { createIncident, submitTriage, runDispatch, DispatchApiError } from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";

type Choice = "CRASH" | "MINOR" | "NONE" | null;

type DamageOption = {
  value: Exclude<Choice, null>;
  badge: string;
  badgeTone: "danger" | "warning" | "success";
  title: string;
};

const DAMAGE_OPTIONS: DamageOption[] = [
  { value: "CRASH", badge: "Yes", badgeTone: "danger", title: "Major (Accident/Crash)" },
  { value: "MINOR", badge: "Yes", badgeTone: "warning", title: "Minor (Dent/Scratch)" },
  { value: "NONE", badge: "No", badgeTone: "success", title: "No Visible Damage" },
];

export default function SafetyCheckScreen() {
  const [choice, setChoice] = useState<Choice>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // What this crash attempt already filed, so a retry resumes instead of
  // filing a second incident. Kept local (not read from context) because the
  // context id/triage may belong to a roadside flow the user backed out of.
  const crashIncidentIdRef = useRef<string | null>(null);
  const crashTriageDoneRef = useRef(false);
  const {
    setDamage,
    setLoading: setCtxLoading,
    setError,
    setIncidentId,
    setTriageResult,
    setDispatchResult,
    loading: ctxLoading,
    error,
  } = useEmergency();

  /**
   * Every dispatch call needs a session, so a signed-out user would answer the
   * whole questionnaire and only fail on the last screen. Re-checked on focus
   * so coming back from sign-in unblocks the flow; the 1990 call button below
   * stays available either way.
   */
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getAccessToken()
        .then((token) => { if (!cancelled) setSignedIn(Boolean(token)); })
        .catch(() => { if (!cancelled) setSignedIn(false); });
      return () => { cancelled = true; };
    }, [])
  );

  /**
   * Prefetch the driver's GPS coords while they read the Safety Check
   * options. The first call goes through permission prompt + GPS lock;
   * subsequent calls (in diagnosis-lights / quick-dispatch / connected)
   * hit the in-memory cache and return immediately.
   */
  useEffect(() => {
    getCurrentDriverLocation().catch(() => {});
  }, []);

  /**
   * MAJOR_CRASH is a fast-path intent. We do the full create-incident +
   * triage-submit + dispatch-optimize round-trip here, then jump straight
   * to the connected screen — skipping the sound + lights questions. Lifted
   * into a callback so the inline error state can re-invoke it on retry.
   */
  const runDispatchFlow = useCallback(async () => {
    setCtxLoading(true);
    setError(null);
    try {
      const driver = await getCurrentDriverLocation();
      // Resume rather than restart: a retry after a failed dispatch must not
      // file a second incident (and a second triage) for the same accident.
      let id = crashIncidentIdRef.current;
      if (!id) {
        const incident = await createIncident({
          location:    { latitude: driver.latitude, longitude: driver.longitude },
          vehicleInfo: DEMO_VEHICLE,
          description: "Major accident reported via mobile app",
        });
        id = incident.id;
        crashIncidentIdRef.current = id;
        setIncidentId(id);
      }

      if (!crashTriageDoneRef.current) {
        const triage = await submitTriage({
          incidentId: id,
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
        crashTriageDoneRef.current = true;
        setTriageResult(triage.result);
      }

      const dispatch = await runDispatch({
        incidentId: id,
        // trafficImpactScore omitted — dispatch sources it live from geo-intelligence
      });
      setDispatchResult(dispatch);

      router.replace("/(emergency)/connected");
    } catch (err) {
      const msg = err instanceof DispatchApiError
        ? `${err.message} (${err.status})`
        : (err as Error).message;
      haptics.error();
      setError(msg);
    } finally {
      setCtxLoading(false);
    }
  }, [setCtxLoading, setError, setIncidentId, setTriageResult, setDispatchResult]);

  function handleNext() {
    if (!choice) return;
    setDamage(choice);
    if (choice === "CRASH") {
      runDispatchFlow();
    } else {
      // Intent picker is the top-level branch of the adaptive form. From
      // there the user enters either the ENGINE subtree (engine-state →
      // sound / electrical / running-issue) or the BRAKE / GEAR subtrees.
      router.push("/(emergency)/intent");
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
          disabled={!choice || ctxLoading || signedIn === false}
          onPress={handleNext}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>Safety Check</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        Is there visible damage to your vehicle?
      </Text>

      {signedIn === false && (
        <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.warning }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            Sign in to request assistance
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            We can only send a provider to a signed-in account. Sign in first — the
            1990 ambulance line below works without an account.
          </Text>
          <Button
            title="Sign in"
            onPress={() => router.push("/(driver)/auth")}
          />
        </Card>
      )}

      {DAMAGE_OPTIONS.map((opt, i) => (
        <Animated.View key={opt.value} entering={FadeInDown.delay(i * 60).springify()}>
          <OptionCard
            badge={opt.badge}
            badgeTone={opt.badgeTone}
            title={opt.title}
            selected={choice === opt.value}
            onPress={() => setChoice(opt.value)}
          />
        </Animated.View>
      ))}

      {error && (
        <ErrorState
          title="Dispatch failed"
          message={`${error}\n\nTap Try again to resend. If you need an ambulance now, use the 1990 button below.`}
          onRetry={runDispatchFlow}
        />
      )}

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
