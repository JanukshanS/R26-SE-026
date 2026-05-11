import { useEffect, useRef } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { router } from "expo-router";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useEmergency } from "@lib/emergencyContext";
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
    setDispatchResult, setError, setLoading, loading,
  } = useEmergency();

  // Kick off /dispatch/optimize automatically once we land here (matches the
  // "Fetching a Service Provider" loading state in the reference UI).
  const dispatchStarted = useRef(false);
  useEffect(() => {
    if (!incidentId || dispatchStarted.current || dispatchResult) return;
    dispatchStarted.current = true;

    (async () => {
      setLoading(true);
      try {
        const res = await runDispatch({
          incidentId,
          trafficImpactScore: 5,  // default urban traffic weight
        });
        setDispatchResult(res);
      } catch (err) {
        const msg = err instanceof DispatchApiError
          ? `${err.message} (HTTP ${err.status})`
          : (err as Error).message;
        setError(msg);
        Alert.alert("Dispatch failed", msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [incidentId, dispatchResult, setDispatchResult, setError, setLoading]);

  const predicted = triageResult?.predictedServiceType ?? "BATTERY_JUMP";
  const confidence = triageResult?.confidence ?? 0;
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
      <HeaderBar />
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
          {triageResult && (
            <>
              <Row
                label="CONFIDENCE"
                value={`${(confidence * 100).toFixed(0)}%`}
              />
              <Row label="MODEL" value={tierLabel} />
            </>
          )}
        </View>
      </Card>

      {/* Loading / connected card — matches the reference UI's "Fetching..." state */}
      <Card
        variant="muted"
        style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.lg }}
      >
        <View
          style={{
            width: 80, height: 80, borderRadius: radii.lg,
            borderCurve: "continuous",
            backgroundColor: palette.surface,
            alignItems: "center", justifyContent: "center",
          }}
        >
          {dispatchResult ? (
            <Icon name="CheckCircle" size={36} color={palette.success} />
          ) : (
            <Icon name="Wrench" size={36} color={palette.brand} />
          )}
        </View>
        <Text style={{ ...typography.h3, color: palette.text }}>
          {dispatchResult ? "Provider Selected" : "Fetching a Service Provider"}
        </Text>
        {!dispatchResult ? (
          <>
            <ActivityIndicator size="small" color={palette.brand} />
            <Text
              style={{
                ...typography.caption, color: palette.textMuted, textAlign: "center",
              }}
            >
              You will be connected to a {providerTypeLabel("MOBILE_MECHANIC")}
            </Text>
          </>
        ) : (
          <Text
            style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}
          >
            {providerName}
            {providerType ? ` (${providerTypeLabel(providerType)})` : null}
          </Text>
        )}
      </Card>
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
