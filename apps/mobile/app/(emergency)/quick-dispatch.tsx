/**
 * Quick-dispatch fast-path — used when the driver knows exactly what they need
 * and taps a shortcut from the home screen (Tyre, Fuel, Locksmith). Skips the
 * adaptive questionnaire entirely; sets Q1_intent directly and runs the full
 * pipeline (incident → triage fast-path → dispatch) in one go.
 *
 * Route params:
 *   intent      — Q1FastIntent value (FLAT_TIRE, FUEL_EMPTY, LOCKOUT, ...)
 *   label       — Human-readable label for the loading screen ("Flat tire")
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
  const { intent, label } = useLocalSearchParams<{ intent: string; label: string }>();
  const {
    setIncidentId, setTriageResult, setDispatchResult, setError,
    dispatchResult, error,
  } = useEmergency();

  // The pipeline keeps running if the user leaves via back/home mid-flight;
  // without this the continuation yanks them back onto the connected screen,
  // which then renders against an emergency context that was torn down.
  const mounted = useRef(true);

  // What this attempt already filed, so "Try again" after a failure at triage
  // or dispatch resumes instead of filing a second incident for the same job.
  const incidentIdRef = useRef<string | null>(null);
  const triageDoneRef = useRef(false);
  const inFlightRef = useRef(false);

  const runDispatchFlow = useCallback(async () => {
    if (!intent || inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    try {
      const driver = await getCurrentDriverLocation();
      let id = incidentIdRef.current;
      if (!id) {
        const incident = await createIncident({
          location:    { latitude: driver.latitude, longitude: driver.longitude },
          vehicleInfo: DEMO_VEHICLE,
          description: `Quick-dispatch from home: ${label ?? intent}`,
        });
        id = incident.id;
        incidentIdRef.current = id;
        setIncidentId(id);
      }

      if (!triageDoneRef.current) {
        const triage = await submitTriage({
          incidentId: id,
          responses: {
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
        ? `${err.message} (HTTP ${err.status})`
        : (err as Error).message;
      haptics.error();
      setError(msg);
    } finally {
      inFlightRef.current = false;
    }
  }, [intent, label, setIncidentId, setTriageResult, setDispatchResult, setError]);

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

  return (
    <Screen>
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>
        {label ? `Getting ${label.toLowerCase()}...` : "Dispatching..."}
      </Text>

      {error ? (
        <>
          <ErrorState
            title="Couldn't dispatch"
            message={
              signedOut
                ? "You need to be signed in to send help to your location."
                : `${error}\n\nTap Try again to resend the request, or use back to pick a different kind of help.`
            }
            onRetry={signedOut ? undefined : runDispatchFlow}
          />
          {signedOut ? (
            <Button title="Sign in" onPress={() => router.push("/(driver)/auth")} />
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
