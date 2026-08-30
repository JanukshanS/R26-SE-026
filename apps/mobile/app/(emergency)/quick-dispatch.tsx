/**
 * Quick-dispatch fast-path — used when the driver knows exactly what they need
 * and taps a shortcut from the home screen (Tyre, Fuel, Locksmith). Skips the
 * adaptive questionnaire entirely; sets Q1_intent directly and runs the full
 * pipeline (incident → triage fast-path → dispatch) in one go.
 *
 * Also the destination of the questionnaire's "Skip — send help now" button.
 * Called with no `intent` param it files whatever the driver has answered so
 * far instead of a fast-path payload: buildTriageResponses() already defaults
 * every unanswered field, and dispatch's validators carry no cross-field rules,
 * so a partial payload is valid on every branch.
 *
 * Route params:
 *   intent      — Q1FastIntent value (FLAT_TIRE, FUEL_EMPTY, LOCKOUT, ...).
 *                 Absent when the driver skipped out of the questionnaire.
 *   label       — Human-readable label for the loading screen ("Flat tire")
 *   labelKey    — Translation key for that label, when the caller has one.
 */

import { useCallback, useEffect, useRef } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { DispatchProgress } from "@components/ui/dispatch-progress";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_VEHICLE } from "@lib/emergencyContext";
import { haptics } from "@lib/haptics";
import {
  createIncident, submitTriage, runDispatch, DispatchApiError,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";
import { useT } from "@lib/i18n";

function buildFastPathDefaults() {
  return {
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
  };
}

export default function QuickDispatchScreen() {
  const t = useT();
  const { intent, label, labelKey } =
    useLocalSearchParams<{ intent: string; label: string; labelKey: string }>();
  const {
    setIncidentId, setTriageResult, setDispatchResult, setError,
    dispatchResult, error, incidentId, buildTriageResponses,
  } = useEmergency();

  // No intent param means the driver bailed out of the questionnaire rather
  // than tapping a fast-path tile.
  const skipped = !intent;

  // The pipeline keeps running if the user leaves via back/home mid-flight;
  // without this the continuation yanks them back onto the connected screen,
  // which then renders against an emergency context that was torn down.
  const mounted = useRef(true);

  // What this attempt already filed, so "Try again" after a failure at triage
  // or dispatch resumes instead of filing a second incident for the same job.
  // Seeded from context: the questionnaire files the incident at the warning-
  // lights step, so a driver who skips after that already has one. Filing a
  // second would orphan the first.
  const incidentIdRef = useRef<string | null>(incidentId);
  const triageDoneRef = useRef(false);
  const inFlightRef = useRef(false);

  // Snapshot the answers once. buildTriageResponses' identity changes as the
  // pipeline writes incidentId / triageResult back into context, and this
  // screen must not restart itself when that happens.
  const responsesRef = useRef(skipped ? buildTriageResponses() : null);

  const runDispatchFlow = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const driver = await getCurrentDriverLocation();
      let id = incidentIdRef.current;
      if (!id) {
        const incident = await createIncident({
          location:    { latitude: driver.latitude, longitude: driver.longitude },
          vehicleInfo: DEMO_VEHICLE,
          description: skipped
            ? "Roadside assistance requested via mobile app (questions skipped)"
            : `Quick-dispatch from home: ${label ?? intent}`,
        });
        id = incident.id;
        incidentIdRef.current = id;
        setIncidentId(id);
      }

      if (!triageDoneRef.current) {
        const triage = await submitTriage({
          incidentId: id,
          responses: responsesRef.current ?? {
            Q1_intent: intent,
            ...buildFastPathDefaults(),
          },
        });
        triageDoneRef.current = true;
        setTriageResult(triage.result);
      }

      const dispatch = await runDispatch({
        incidentId: id,
        // trafficImpactScore omitted — dispatch sources it live from geo-intelligence
      });
      if (!mounted.current) return;
      setDispatchResult(dispatch);

      router.replace("/(emergency)/connected");
    } catch (err) {
      if (!mounted.current) return;
      const msg = err instanceof DispatchApiError
        ? t("emergency.error.withStatus", { message: err.message, status: err.status })
        : (err as Error).message;
      haptics.error();
      setError(msg);
    } finally {
      inFlightRef.current = false;
    }
  }, [intent, label, skipped, setIncidentId, setTriageResult, setDispatchResult, setError, t]);

  useEffect(() => {
    mounted.current = true;
    runDispatchFlow();
    return () => {
      mounted.current = false;
    };
  }, [runDispatchFlow]);

  // authHeaders() throws this before any request leaves the device, so retrying
  // can only fail the same way — offer the sign-in screen instead.
  const signedOut = !!error && error.includes("You need to be signed in");

  // whats-wrong sends a key; the home-screen shortcuts still send plain text.
  const labelText = labelKey ? t(labelKey) : label;

  return (
    <Screen>
      <HeaderBar />
      {/* One headline for both entries. Interpolating the tile label into the
          title read badly for half the tiles ("Getting lost my key..."), so the
          label sits underneath as its own line instead. */}
      <Text style={{ ...typography.h1, color: palette.text }}>{t("emergency.quickDispatch.title")}</Text>
      <Text style={{ ...typography.body, color: palette.textMuted }}>
        {skipped
          ? t("emergency.quickDispatch.skippedBody")
          : labelText
            ? t("emergency.quickDispatch.searchingWithLabel", { label: labelText })
            : t("emergency.quickDispatch.searchingBody")}
      </Text>

      {error ? (
        <>
          <ErrorState
            title={t("emergency.quickDispatch.failedTitle")}
            message={
              signedOut
                ? t("emergency.quickDispatch.signedOutBody")
                : t("emergency.quickDispatch.failedBody", { message: error })
            }
            onRetry={signedOut ? undefined : runDispatchFlow}
          />
          {signedOut ? (
            <Button title={t("emergency.action.signIn")} onPress={() => router.push("/(driver)/auth")} />
          ) : null}
        </>
      ) : (
        <Card
          variant="muted"
          style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.lg }}
        >
          <DispatchProgress done={!!dispatchResult} />
        </Card>
      )}
    </Screen>
  );
}
