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
import { useT } from "@lib/i18n";

type Choice = "CRASH" | "MINOR" | "NONE" | null;

type DamageOption = {
  value: Exclude<Choice, null>;
  badgeKey: string;
  badgeTone: "danger" | "warning" | "success";
  titleKey: string;
};

const DAMAGE_OPTIONS: DamageOption[] = [
  { value: "CRASH", badgeKey: "emergency.safetyCheck.badgeYes", badgeTone: "danger", titleKey: "emergency.safetyCheck.majorTitle" },
  { value: "MINOR", badgeKey: "emergency.safetyCheck.badgeYes", badgeTone: "warning", titleKey: "emergency.safetyCheck.minorTitle" },
  { value: "NONE", badgeKey: "emergency.safetyCheck.badgeNo", badgeTone: "success", titleKey: "emergency.safetyCheck.noneTitle" },
];

export default function SafetyCheckScreen() {
  const t = useT();
  const [choice, setChoice] = useState<Choice>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // What this crash attempt already filed, so a retry resumes instead of
  // filing a second incident. Kept local (not read from context) because the
  // context id/triage may belong to a roadside flow the user backed out of.
  const crashIncidentIdRef = useRef<string | null>(null);
  const crashTriageDoneRef = useRef(false);
  // `ctxLoading` only disables the button on the next render, which leaves a
  // double-tap window open while the JS thread is busy.
  const inFlightRef = useRef(false);
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
    if (inFlightRef.current) return;
    inFlightRef.current = true;
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
        ? t("emergency.error.withCode", { message: err.message, status: err.status })
        : (err as Error).message;
      haptics.error();
      setError(msg);
    } finally {
      inFlightRef.current = false;
      setCtxLoading(false);
    }
  }, [setCtxLoading, setError, setIncidentId, setTriageResult, setDispatchResult, t]);

  function handleNext() {
    if (!choice) return;
    setDamage(choice);
    if (choice === "CRASH") {
      runDispatchFlow();
    } else {
      // A failed crash attempt leaves a MAJOR_CRASH incident + triage in
      // context. Drop it, or diagnosis-lights reuses that incident id and the
      // roadside answers get submitted against the accident.
      if (crashIncidentIdRef.current) {
        crashIncidentIdRef.current = null;
        crashTriageDoneRef.current = false;
        setIncidentId(null);
        setTriageResult(null);
        setDispatchResult(null);
      }
      setError(null);
      // They tapped Accident but there is no real damage, so a crash tow is
      // the wrong call. Back to the grid to say what they actually need -
      // popping to the existing instance rather than stacking a second one.
      if (router.canGoBack()) router.back();
      else router.replace("/(emergency)/whats-wrong");
    }
  }

  function callAmbulance() {
    Linking.openURL("tel:1990").catch(() => {
      Alert.alert(t("emergency.safetyCheck.callFailedTitle"), t("emergency.safetyCheck.callFailedBody"));
    });
  }

  return (
    <Screen
      footer={
        <Button
          title={ctxLoading ? t("emergency.safetyCheck.dispatching") : t("emergency.question.next")}
          disabled={!choice || ctxLoading || signedIn === false}
          onPress={handleNext}
        />
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>{t("emergency.safetyCheck.title")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        {t("emergency.safetyCheck.prompt")}
      </Text>

      {signedIn === false && (
        <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.warning }}>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {t("emergency.safetyCheck.signInTitle")}
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("emergency.safetyCheck.signInBody")}
          </Text>
          <Button
            title={t("emergency.action.signIn")}
            onPress={() => router.push("/(driver)/auth")}
          />
        </Card>
      )}

      {DAMAGE_OPTIONS.map((opt, i) => (
        <Animated.View key={opt.value} entering={FadeInDown.delay(i * 60).springify()}>
          <OptionCard
            badge={t(opt.badgeKey)}
            badgeTone={opt.badgeTone}
            title={t(opt.titleKey)}
            selected={choice === opt.value}
            onPress={() => setChoice(opt.value)}
          />
        </Animated.View>
      ))}

      {error && (
        <ErrorState
          title={t("emergency.safetyCheck.dispatchFailedTitle")}
          message={t("emergency.safetyCheck.dispatchFailedBody", { message: error })}
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
          {t("emergency.safetyCheck.ambulanceTitle")}
        </Text>
        <Text style={{ ...typography.caption, color: palette.textOnBrand, opacity: 0.9 }}>
          {t("emergency.safetyCheck.ambulanceSubtitle")}
        </Text>
      </Pressable>

      {ctxLoading && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("emergency.safetyCheck.dispatchingTow")}
          </Text>
        </View>
      )}
    </Screen>
  );
}
