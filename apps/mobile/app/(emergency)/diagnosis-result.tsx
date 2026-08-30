import { useCallback, useEffect, useRef } from "react";
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
import { useT } from "@lib/i18n";

export default function DiagnosisResultScreen() {
  const t = useT();
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
  // The error card's Try again only disappears on the next render, which leaves
  // a double-tap window open that would run dispatch twice for one incident.
  const inFlightRef = useRef(false);

  const runDispatchFlow = useCallback(async () => {
    if (!incidentId || inFlightRef.current) return;
    inFlightRef.current = true;
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
        ? t("emergency.error.withStatus", { message: err.message, status: err.status })
        : (err as Error).message;
      haptics.error();
      setError(msg);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [incidentId, setDispatchResult, setError, setLoading, t]);

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
            title={t("emergency.action.backHome")}
            onPress={() => router.replace("/(driver)/home")}
          />
        }
      >
        <Stack.Screen options={{ gestureEnabled: false }} />
        <HeaderBar showBack={false} />
        <Text style={{ ...typography.h1, color: palette.text }}>{t("emergency.diagnosisResult.title")}</Text>
        <ErrorState
          title={t("emergency.diagnosisResult.lostTitle")}
          message={t("emergency.diagnosisResult.lostBody")}
        />
      </Screen>
    );
  }

  const predicted = triageResult.predictedServiceType;
  const confidence = triageResult.confidence ?? 0;
  const tierLabel = triageResult?.tier === "OBD_ENHANCED"
    ? t("emergency.diagnosisResult.tierObd")
    : triageResult?.tier === "BAYESIAN_LEARNED"
      ? t("emergency.diagnosisResult.tierBayesian")
      : t("emergency.diagnosisResult.tierDefault");

  const providerName = dispatchResult?.selectedProvider?.name;
  const providerType = dispatchResult?.selectedProvider?.type;

  return (
    <Screen
      footer={
        <>
          <Button
            title={
              dispatchResult ? t("emergency.diagnosisResult.seeMechanic")
                : error ? t("emergency.diagnosisResult.noProvider")
                  : t("emergency.diagnosisResult.waitingProvider")
            }
            disabled={!dispatchResult || loading}
            onPress={() => router.push("/(emergency)/connected")}
          />
          <Button
            title={t("emergency.action.backHome")}
            variant="secondary"
            onPress={() => router.replace("/(driver)/home")}
          />
        </>
      }
    >
      <Stack.Screen options={{ gestureEnabled: false }} />
      <HeaderBar showBack={false} />
      <Text style={{ ...typography.h1, color: palette.text }}>{t("emergency.diagnosisResult.title")}</Text>

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
            {t("emergency.diagnosisResult.assistantSays")}
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
            label={t("emergency.diagnosisResult.rowDiagnosis")}
            value={serviceTypeLabel(predicted, t)}
            valueColor={palette.danger}
          />
          <Row label={t("emergency.diagnosisResult.rowService")} value={serviceTypeAction(predicted, t)} />
          <Row
            label={t("emergency.diagnosisResult.rowConfidence")}
            value={`${(confidence * 100).toFixed(0)}%`}
          />
          <Row label={t("emergency.diagnosisResult.rowModel")} value={tierLabel} />
        </View>
      </Card>

      {/* Loading / connected card — matches the reference UI's "Fetching..." state */}
      {error ? (
        <ErrorState
          title={t("emergency.diagnosisResult.dispatchFailedTitle")}
          message={t("emergency.diagnosisResult.dispatchFailedBody", { message: error })}
          onRetry={runDispatchFlow}
        />
      ) : (
        <Card
          variant="muted"
          style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.lg }}
        >
          <DispatchProgress done={!!dispatchResult} doneLabel={t("emergency.diagnosisResult.providerSelected")} />
          {dispatchResult ? (
            <Text
              style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}
            >
              {providerName}
              {providerType ? ` (${providerTypeLabel(providerType, t)})` : null}
            </Text>
          ) : (
            <Text
              style={{
                ...typography.caption, color: palette.textMuted, textAlign: "center",
              }}
            >
              {t("emergency.diagnosisResult.searching", { action: serviceTypeAction(predicted, t) })}
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
