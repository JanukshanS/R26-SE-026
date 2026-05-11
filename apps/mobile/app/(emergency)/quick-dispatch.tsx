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

import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency, DEMO_VEHICLE } from "@lib/emergencyContext";
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
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !intent) return;
    started.current = true;

    (async () => {
      try {
        const driver = await getCurrentDriverLocation();
        const incident = await createIncident({
          location:    { latitude: driver.latitude, longitude: driver.longitude },
          vehicleInfo: DEMO_VEHICLE,
          description: `Quick-dispatch from home: ${label ?? intent}`,
        });
        setIncidentId(incident.id);

        const triage = await submitTriage({
          incidentId: incident.id,
          responses: {
            Q1_intent: intent,
            ...buildFastPathDefaults(),
          },
        });
        setTriageResult(triage.result);

        const dispatch = await runDispatch({
          incidentId:         incident.id,
          trafficImpactScore: 5,
        });
        setDispatchResult(dispatch);

        router.replace("/(emergency)/connected");
      } catch (err) {
        const msg = err instanceof DispatchApiError
          ? `${err.message} (HTTP ${err.status})`
          : (err as Error).message;
        setError(msg);
      }
    })();
  }, [intent, label, setIncidentId, setTriageResult, setDispatchResult, setError]);

  return (
    <Screen
      footer={
        error ? (
          <Button title="Go Back" variant="secondary" onPress={() => router.back()} />
        ) : undefined
      }
    >
      <HeaderBar />
      <Text style={{ ...typography.h1, color: palette.text }}>
        {label ? `Getting ${label.toLowerCase()}...` : "Dispatching..."}
      </Text>

      <Card
        variant="muted"
        style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.lg }}
      >
        <View
          style={{
            width: 80, height: 80, borderRadius: radii.lg,
            borderCurve: "continuous", backgroundColor: palette.surface,
            alignItems: "center", justifyContent: "center",
          }}
        >
          {error ? (
            <Icon name="AlertTriangle" size={36} color={palette.danger} />
          ) : dispatchResult ? (
            <Icon name="CheckCircle" size={36} color={palette.success} />
          ) : (
            <Icon name="Wrench" size={36} color={palette.brand} />
          )}
        </View>
        <Text style={{ ...typography.h3, color: palette.text }}>
          {error ? "Couldn't dispatch" :
           dispatchResult ? "Provider Found" :
           "Finding the nearest provider"}
        </Text>
        {!error && !dispatchResult && (
          <>
            <ActivityIndicator size="small" color={palette.brand} />
            <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
              Running ECM optimization across available providers
            </Text>
          </>
        )}
        {error && (
          <Text style={{ ...typography.caption, color: palette.danger, textAlign: "center" }}>
            {error}
          </Text>
        )}
      </Card>
    </Screen>
  );
}
