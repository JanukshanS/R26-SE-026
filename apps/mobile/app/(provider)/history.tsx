import { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Icon } from "@components/ui/icon";
import { ProviderBottomNavBar, PROVIDER_NAV_BAR_HEIGHT } from "@components/ui/provider-bottom-nav-bar";
import { Screen } from "@components/ui/screen";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import {
  getProviderFeedbacks,
  serviceTypeLabel,
  type ProviderFeedback,
  type ProviderFeedbackSummary,
} from "@lib/dispatchApi";
import { useT, useI18n } from "@lib/i18n";

export default function ProviderHistoryScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const { user } = useVehicle();
  const providerId = user?.providerId ?? null;

  const [feedbacks, setFeedbacks] = useState<ProviderFeedback[] | null>(null);
  const [summary, setSummary] = useState<ProviderFeedbackSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getProviderFeedbacks(providerId, { limit: 30 });
      setFeedbacks(res.feedbacks);
      setSummary(res.summary);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View
        style={{
          backgroundColor: palette.surface,
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.lg,
        }}
      >
        <Text style={{ ...typography.h2, color: palette.text }}>{t("provider.history.title")}</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted, marginTop: 2 }}>
          {t("provider.history.subtitle")}
        </Text>
      </View>

      <Screen
        edges={["bottom"]}
        contentContainerStyle={{ paddingBottom: PROVIDER_NAV_BAR_HEIGHT + spacing.xl }}
      >
        {!providerId ? (
          <Card><Text style={{ ...typography.body, color: palette.textMuted }}>{t("provider.setup.prompt")}</Text></Card>
        ) : loading ? (
          <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
            <ActivityIndicator size="small" color={palette.brand} />
          </Card>
        ) : error ? (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger }}>
            <Text style={{ ...typography.bodyStrong, color: palette.danger }}>{t("provider.history.loadErrorTitle")}</Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>{error}</Text>
            <Button title={t("provider.action.retry")} variant="secondary" size="md" onPress={load} />
          </Card>
        ) : (
          <>
            {summary && summary.totalJobs > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                <MetricTile
                  icon="ClipboardCheck"
                  label={t("provider.metric.jobsCompleted")}
                  value={String(summary.totalJobs)}
                />
                <MetricTile
                  icon="Target"
                  label={t("provider.metric.matchRate")}
                  value={summary.matchRate !== null ? `${Math.round(summary.matchRate * 100)}%` : "—"}
                />
                <MetricTile
                  icon="Clock"
                  label={t("provider.metric.avgResolutionTime")}
                  value={
                    summary.averageResolutionTimeMinutes !== null
                      ? t("provider.history.minutesValue", {
                          minutes: Math.round(summary.averageResolutionTimeMinutes),
                        })
                      : "—"
                  }
                />
                <MetricTile
                  icon="Star"
                  label={t("provider.metric.avgRating")}
                  value={summary.averageRating !== null ? summary.averageRating.toFixed(1) : "—"}
                />
              </View>
            )}

            {feedbacks?.length ? (
              <View style={{ gap: spacing.sm }}>
                {feedbacks.map((fb) => (
                  <FeedbackCard key={fb.id} feedback={fb} />
                ))}
              </View>
            ) : (
              <Card
                variant="muted"
                style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}
              >
                <Icon name="History" size={40} color={palette.textMuted} />
                <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                  {t("provider.history.emptyTitle")}
                </Text>
                <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
                  {t("provider.history.emptyBody")}
                </Text>
              </Card>
            )}
          </>
        )}
      </Screen>

      <ProviderBottomNavBar activeTab="history" />
    </View>
  );
}

function MetricTile({ icon, label, value }: { icon: Parameters<typeof Icon>[0]["name"]; label: string; value: string }) {
  return (
    <Card style={{ flexBasis: "47%", flexGrow: 1, gap: spacing.xs }}>
      <Icon name={icon} size={18} color={palette.brand} />
      <Text style={{ ...typography.h3, color: palette.text }}>{value}</Text>
      <Text style={{ ...typography.caption, color: palette.textMuted }}>{label}</Text>
    </Card>
  );
}

function FeedbackCard({ feedback }: { feedback: ProviderFeedback }) {
  const { t, formatDate } = useI18n();
  const date = formatDate(feedback.createdAt, { day: "numeric", month: "short" });
  return (
    <Card style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ ...typography.bodyStrong, color: palette.text, flex: 1 }}>
          {serviceTypeLabel(feedback.actualServiceType, t)}
        </Text>
        <Badge
          label={
            feedback.wasMatch
              ? t("provider.history.matched")
              : t("provider.history.differed")
          }
          tone={feedback.wasMatch ? "success" : "warning"}
        />
      </View>
      {!feedback.wasMatch && (
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {t("provider.history.originallyPredicted", {
            service: serviceTypeLabel(feedback.predictedServiceType, t),
          })}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>{date}</Text>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {t("provider.history.minutesValue", {
            minutes: Math.round(feedback.resolutionTimeMinutes),
          })}
        </Text>
        {feedback.userRating !== null && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Icon name="Star" size={12} color={palette.warning} />
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {feedback.userRating.toFixed(1)}
            </Text>
          </View>
        )}
      </View>
      {feedback.providerNotes ? (
        <Text style={{ ...typography.caption, color: palette.text, fontStyle: "italic" }}>
          &ldquo;{feedback.providerNotes}&rdquo;
        </Text>
      ) : null}
    </Card>
  );
}
