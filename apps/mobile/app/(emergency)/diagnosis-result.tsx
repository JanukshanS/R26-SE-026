import { useCallback, useEffect } from "react";
import { Text, View } from "react-native";
import { router, Stack } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { DispatchProgress } from "@components/ui/dispatch-progress";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
import { useHardwareBack } from "@lib/useHardwareBack";
import { haptics } from "@lib/haptics";
import {
  runDispatch,
  serviceTypeLabel,
  serviceTypeAction,
  providerTypeLabel,
  DispatchApiError,
} from "@lib/dispatchApi";

export default function DiagnosisResultScreen() {
  const {
    incidentId, triageResult, dispatchResult,
    setDispatchResult, setError, setLoading, loading, error,
  } = useEmergency();

  // The diagnosis is complete — back must not re-enter the questionnaire (which
  // would re-submit triage for the same incident). Send it home instead.
  useHardwareBack(useCallback(() => {
    router.replace("/(driver)/home");
    return true;
  }, []));

  // Kick off /dispatch/optimize automatically once we land here (matches the
  // "Fetching a Service Provider" loading state in the reference UI). Lifted
  // into a callback so the inline error state can re-invoke it on retry.
  const runDispatchFlow = useCallback(async () => {
    if (!incidentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await runDispatch({
        incidentId,
        // trafficImpactScore omitted — dispatch sources it live from geo-intelligence
      });
      setDispatchResult(res);
    } catch (err) {
      const msg = err instanceof DispatchApiError
        ? `${err.message} (HTTP ${err.status})`
        : (err as Error).message;
      haptics.error();
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [incidentId, setDispatchResult, setError, setLoading]);

  useEffect(() => {
    if (dispatchResult) return;
    runDispatchFlow();
  }, [dispatchResult, runDispatchFlow]);

  // Nothing to show without the in-memory answers (web reload / deep link):
  // never fabricate a diagnosis, send the driver back to start over.
  if (!triageResult || !incidentId) {
    return (
      <Screen
        footer={
          <Button
            title="Back to Home screen"
            onPress={() => router.replace("/(driver)/home")}
          />
        }
      >
        <Stack.Screen options={{ gestureEnabled: false }} />
        <HeaderBar showBack={false} />
        <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Result</Text>
        <ErrorState
          title="We lost this diagnosis"
          message="Your answers are gone, so there is no result to show. Start the diagnosis again from the home screen."
        />
      </Screen>
    );
  }

  const predicted = triageResult.predictedServiceType;
  const confidence = triageResult.confidence ?? 0;
  const tierLabel = triageResult?.tier === "OBD_ENHANCED"
    ? "Tier-2 (OBD enhanced)"
    : triageResult?.tier === "BAYESIAN_LEARNED"
      ? "Tier-3 (Bayesian)"
      : "Tier-1";

  const providerName = dispatchResult?.selectedProvider?.name;
  const providerType = dispatchResult?.selectedProvider?.type;

  return (
    <Screen
      footer={
        <>
          <Button
            title={dispatchResult ? "See Connected Mechanic" : "Waiting for provider..."}
            disabled={!dispatchResult || loading}
            onPress={() => router.push("/(emergency)/connected")}
          />
          <Button
            title="Back to Home screen"
            variant="secondary"
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      <Stack.Screen options={{ gestureEnabled: false }} />
      <HeaderBar showBack={false} />
      <Text style={{ ...typography.h1, color: palette.text }}>Diagnosis Result</Text>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View
            style={{
              width: 28, height: 28, borderRadius: 14,
              backgroundColor: palette.brandSoft,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Icon name="Bot" size={16} color={palette.brand} />
          </View>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            Service Assistant says
          </Text>
        </View>
        <View
          style={{
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: palette.border,
            gap: spacing.sm,
          }}
        >
          <Row
            label="DIAGNOSIS"
            value={serviceTypeLabel(predicted)}
            valueColor={palette.danger}
          />
          <Row label="SERVICE" value={serviceTypeAction(predicted)} />
          <Row
            label="CONFIDENCE"
            value={`${(confidence * 100).toFixed(0)}%`}
          />
          <Row label="MODEL" value={tierLabel} />
        </View>
      </Card>

      {/* Loading / connected card — matches the reference UI's "Fetching..." state */}
      {error ? (
        <ErrorState
          title="Dispatch failed"
          message={error}
          onRetry={runDispatchFlow}
        />
      ) : (
        <Card
          variant="muted"
          style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.lg }}
        >
          <DispatchProgress done={!!dispatchResult} doneLabel="Provider Selected" />
          {dispatchResult ? (
            <Text
              style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}
            >
              {providerName}
              {providerType ? ` (${providerTypeLabel(providerType)})` : null}
            </Text>
          ) : (
            <Text
              style={{
                ...typography.caption, color: palette.textMuted, textAlign: "center",
              }}
            >
              You will be connected to a {providerTypeLabel("MOBILE_MECHANIC")}
            </Text>
          )}
        </Card>
      )}
    </Screen>
  );
}

function Row({
  label, value, valueColor,
}: {
  label: string; value: string; valueColor?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <Text style={{ ...typography.micro, color: palette.textMuted, width: 88 }}>
        {label}
      </Text>
      <Text
        style={{
          ...typography.bodyStrong,
          color: valueColor ?? palette.text,
          flexShrink: 1,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
