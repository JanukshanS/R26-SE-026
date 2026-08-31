import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { ErrorState } from "@components/ui/error-state";
import { HeaderBar } from "@components/ui/header-bar";
import { Icon } from "@components/ui/icon";
import { MapPreview } from "@components/ui/map-preview";
import { Screen } from "@components/ui/screen";
import { TextField } from "@components/ui/text-input";
import { palette, radii, spacing, typography } from "@theme/index";
import { useVehicle } from "@lib/vehicleContext";
import {
  DispatchApiError,
  getIncident,
  haversineKm,
  resolveIncident,
  respondToJob,
  serviceTypeAction,
  serviceTypeLabel,
  type ServiceType,
} from "@lib/dispatchApi";
import { useT, type Translate } from "@lib/i18n";

type Job = Awaited<ReturnType<typeof getIncident>> & { description?: string | null };

type Triage = {
  predictedServiceType: ServiceType;
  confidence: number;
  tier: string;
  /** Full distribution — already on the wire (Prisma includes the whole row),
   *  just wasn't typed here before. Lets the provider see what else it might
   *  be, not just the single top guess, before they head out with tools. */
  probabilities?: Record<string, number> | null;
} | null;

/** Below this, the diagnosis is genuinely uncertain — worth telling the
 *  provider to bring a broader toolkit rather than betting on one guess. */
const LOW_CONFIDENCE_THRESHOLD = 0.45;

/**
 * Active job — the provider's view of one assigned incident:
 *
 *   accept / decline  →  work the job  →  report the actual service performed
 *
 * The resolution report is what closes the Bayesian feedback loop: the actual
 * service type is compared against the triage prediction by the dispatch
 * backend and stored as ResolutionFeedback.
 */
export default function ActiveJobScreen() {
  const { incidentId } = useLocalSearchParams<{ incidentId?: string }>();
  const t = useT();
  const { user } = useVehicle();
  const providerId = user?.providerId ?? null;

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"job" | "decline" | "resolve">("job");

  const [declineReason, setDeclineReason] = useState("");
  const [actualType, setActualType] = useState<ServiceType | null>(null);
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [escalated, setEscalated] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!incidentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setJob(await getIncident(incidentId));
    } catch (err) {
      const rejected =
        err instanceof DispatchApiError && err.status >= 400 && err.status < 500;
      setError(
        rejected
          ? t("provider.activeJob.loadErrorClient", { message: describe(err) })
          : t("provider.activeJob.loadErrorNetwork", { message: describe(err) })
      );
    } finally {
      setLoading(false);
    }
  }, [incidentId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const triage = (job?.triageResponse ?? null) as Triage;

  // What the provider can report having done: their own capabilities, with the
  // predicted service type first so a mismatch is a deliberate, visible choice.
  const serviceOptions = useMemo<ServiceType[]>(() => {
    const caps = job?.assignedProvider?.capabilities ?? [];
    const predicted = triage?.predictedServiceType;
    return predicted ? [predicted, ...caps.filter((c) => c !== predicted)] : caps;
  }, [job, triage]);

  // Top 3 by probability, excluding the top guess already shown as the
  // headline — "what else it might be" for deciding which tools to bring.
  const otherPossibilities = useMemo(() => {
    if (!triage?.probabilities) return [];
    return Object.entries(triage.probabilities)
      .filter(([type]) => type !== triage.predictedServiceType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([type, prob]) => ({ type: type as ServiceType, prob }));
  }, [triage]);

  async function respond(accepted: boolean) {
    if (!job || !providerId) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await respondToJob({
        incidentId: job.id,
        providerId,
        accepted,
        declineReason:
          accepted || !declineReason.trim() ? undefined : declineReason.trim(),
      });
      if (!accepted) {
        router.replace("/(provider)/available");
        return;
      }
      // The respond endpoint returns the bare incident row — keep the relations
      // we already loaded instead of re-fetching a job we know is now ours.
      setJob((prev) => (prev ? { ...prev, ...res.incident } : prev));
      setMode("job");
    } catch (err) {
      setActionError(describe(err));
      if (err instanceof DispatchApiError && err.status === 409) load();
    } finally {
      setBusy(false);
    }
  }

  function openResolution() {
    setActualType(triage?.predictedServiceType ?? serviceOptions[0] ?? null);
    // From when the DRIVER asked for help, not from the last status change.
    // `updatedAt` is touched by every write, including the accept, so it
    // read as "minutes since I last tapped something" — which is 0 for a
    // provider who accepts and closes in the same few minutes. Still fully
    // editable; this is only the starting figure.
    setMinutes(job ? String(elapsedMinutes(job.createdAt)) : "");
    setFormError(null);
    setActionError(null);
    setMode("resolve");
  }

  async function submitResolution() {
    if (!job || !providerId || !actualType) return;
    const mins = Number(minutes.trim());
    if (!Number.isFinite(mins) || mins < 0 || mins > 480) {
      setFormError(t("provider.resolve.minutesInvalid"));
      return;
    }
    setBusy(true);
    setFormError(null);
    setActionError(null);
    try {
      await resolveIncident({
        incidentId: job.id,
        providerId,
        actualServiceType: actualType,
        resolutionTimeMinutes: Math.round(mins),
        notes: notes.trim() || undefined,
        escalationNeeded: escalated,
      });
      router.replace("/(provider)/available");
    } catch (err) {
      setActionError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  const toDashboard = (
    <Button
      title={t("provider.activeJob.backToDashboard")}
      variant="secondary"
      onPress={() => router.replace("/(provider)/available")}
    />
  );

  // Reached from an old navigation path with no job attached.
  if (!incidentId) {
    return (
      <Screen footer={toDashboard}>
        <HeaderBar />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }}>
          <Icon name="Inbox" size={44} color={palette.textMuted} />
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
              {t("provider.activeJob.noJobTitle")}
            </Text>
            <Text
              style={{
                ...typography.body,
                color: palette.textMuted,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              {t("provider.activeJob.noJobBody")}
            </Text>
          </View>
        </View>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen footer={toDashboard}>
        <HeaderBar />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.md }}>
          <ActivityIndicator size="small" color={palette.brand} />
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("provider.activeJob.loading")}
          </Text>
        </View>
      </Screen>
    );
  }

  if (!job) {
    return (
      <Screen footer={toDashboard}>
        <HeaderBar />
        <ErrorState
          title={t("provider.activeJob.loadFailedTitle")}
          message={error ?? t("provider.activeJob.loadFailedBody")}
          onRetry={load}
        />
      </Screen>
    );
  }

  if (!providerId) {
    return (
      <Screen
        footer={
          <Button
            title={t("provider.setup.cta")}
            onPress={() => router.replace("/(provider)/onboarding")}
          />
        }
      >
        <HeaderBar />
        <ErrorState
          title={t("provider.activeJob.noProfileTitle")}
          message={t("provider.activeJob.noProfileBody")}
        />
      </Screen>
    );
  }

  const mine = job.assignedProviderId === providerId;
  const offered = mine && job.status === "PROVIDER_ASSIGNED";
  const working = mine && (job.status === "EN_ROUTE" || job.status === "ON_SCENE");
  const closed = job.status === "RESOLVED" || job.status === "ESCALATED";
  const status = statusBadge(job.status, t);
  const distanceKm = job.assignedProvider
    ? haversineKm(job.assignedProvider, job)
    : null;

  const footer =
    mode === "resolve" ? (
      <>
        <Button
          title={busy ? t("provider.resolve.submitting") : t("provider.resolve.submit")}
          disabled={busy || !actualType}
          onPress={submitResolution}
        />
        <Button
          title={t("provider.action.cancel")}
          variant="secondary"
          disabled={busy}
          onPress={() => setMode("job")}
        />
      </>
    ) : mode === "decline" ? (
      <>
        <Button
          title={busy ? t("provider.decline.submitting") : t("provider.decline.confirm")}
          variant="danger"
          disabled={busy}
          onPress={() => respond(false)}
        />
        <Button
          title={t("provider.decline.keep")}
          variant="secondary"
          disabled={busy}
          onPress={() => setMode("job")}
        />
      </>
    ) : offered ? (
      <>
        <Button
          title={busy ? t("provider.activeJob.accepting") : t("provider.activeJob.accept")}
          disabled={busy}
          onPress={() => respond(true)}
        />
        <Button
          title={t("provider.activeJob.decline")}
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setActionError(null);
            setMode("decline");
          }}
        />
      </>
    ) : working ? (
      <>
        <Button title={t("provider.activeJob.reportOutcome")} onPress={openResolution} />
        {toDashboard}
      </>
    ) : (
      toDashboard
    );

  return (
    <Screen footer={footer}>
      <HeaderBar right={<Badge label={status.label} tone={status.tone} />} />

      {actionError ? (
        <ErrorState
          title={
            mode === "resolve"
              ? t("provider.activeJob.resolveFailedTitle")
              : t("provider.activeJob.requestFailedTitle")
          }
          message={t("provider.activeJob.actionErrorBody", { message: actionError })}
        />
      ) : null}

      {mode === "resolve" ? (
        <>
          <View style={{ gap: spacing.xs }}>
            <Text style={{ ...typography.h1, color: palette.text }}>
              {t("provider.resolve.title")}
            </Text>
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              {triage
                ? t("provider.resolve.introPredicted", {
                    service: serviceTypeLabel(triage.predictedServiceType, t),
                  })
                : t("provider.resolve.intro")}
            </Text>
          </View>

          <View style={{ gap: spacing.sm }}>
            {serviceOptions.map((st) => {
              const selected = st === actualType;
              const predicted = st === triage?.predictedServiceType;
              return (
                <Pressable
                  key={st}
                  onPress={() => setActualType(st)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.85 : 1,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: spacing.md,
                    paddingHorizontal: spacing.lg,
                    paddingVertical: 14,
                    borderRadius: radii.lg,
                    borderCurve: "continuous",
                    borderWidth: 1,
                    borderColor: selected ? palette.brand : palette.border,
                    backgroundColor: selected ? palette.brandSoft : palette.surface,
                  })}
                >
                  <Text
                    style={{
                      ...typography.body,
                      color: selected ? palette.brand : palette.text,
                      fontWeight: selected ? "700" : "400",
                      flexShrink: 1,
                    }}
                  >
                    {serviceTypeLabel(st, t)}
                  </Text>
                  {predicted ? <Badge label={t("provider.resolve.predictedBadge")} tone="neutral" /> : null}
                  {selected ? <Icon name="Check" size={18} color={palette.brand} /> : null}
                </Pressable>
              );
            })}
            {serviceOptions.length === 0 ? (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {t("provider.resolve.noServices")}
              </Text>
            ) : null}
          </View>

          <TextField
            label={t("provider.resolve.minutesLabel")}
            value={minutes}
            onChangeText={setMinutes}
            placeholder="25"
            keyboardType="number-pad"
            error={formError ?? undefined}
          />

          <TextField
            label={t("provider.resolve.notesLabel")}
            value={notes}
            onChangeText={setNotes}
            placeholder={t("provider.resolve.notesPlaceholder")}
            multiline
            maxLength={1000}
          />

          <Pressable
            onPress={() => setEscalated(!escalated)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: escalated }}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          >
            <Card
              variant="muted"
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}
            >
              <Icon
                name={escalated ? "Check" : "TriangleAlert"}
                size={18}
                color={escalated ? palette.brand : palette.textMuted}
              />
              <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                {t("provider.resolve.escalationLabel")}
              </Text>
            </Card>
          </Pressable>
        </>
      ) : (
        <>
          {mode === "decline" ? (
            <>
              <View style={{ gap: spacing.xs }}>
                <Text style={{ ...typography.h1, color: palette.text }}>
                  {t("provider.decline.title")}
                </Text>
                <Text style={{ ...typography.body, color: palette.textMuted }}>
                  {t("provider.decline.body")}
                </Text>
              </View>
              <TextField
                label={t("provider.decline.reasonLabel")}
                value={declineReason}
                onChangeText={setDeclineReason}
                placeholder={t("provider.decline.reasonPlaceholder")}
                maxLength={200}
              />
            </>
          ) : null}

          {!mine && !closed ? (
            <Card variant="muted" style={{ flexDirection: "row", gap: spacing.sm }}>
              <Icon name="Info" size={18} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                {t("provider.activeJob.reassigned")}
              </Text>
            </Card>
          ) : null}

          {closed ? (
            <Card variant="muted" style={{ flexDirection: "row", gap: spacing.sm }}>
              <Icon name="Check" size={18} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                {job.status === "ESCALATED"
                  ? t("provider.activeJob.closedEscalated")
                  : t("provider.activeJob.closed")}
              </Text>
            </Card>
          ) : null}

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name="TriangleAlert" size={22} color={palette.danger} />
              <Text style={{ ...typography.h3, color: palette.danger, flexShrink: 1 }}>
                {triage
                  ? serviceTypeLabel(triage.predictedServiceType, t)
                  : t("provider.job.fallbackService")}
              </Text>
            </View>
            {triage ? (
              <View
                style={{
                  paddingTop: spacing.sm,
                  borderTopWidth: 1,
                  borderTopColor: palette.border,
                  gap: spacing.sm,
                }}
              >
                <Row
                  label={t("provider.activeJob.rowService")}
                  value={serviceTypeAction(triage.predictedServiceType, t)}
                />
                <Row
                  label={t("provider.activeJob.rowConfidence")}
                  value={`${(triage.confidence * 100).toFixed(0)}%`}
                  valueColor={triage.confidence < LOW_CONFIDENCE_THRESHOLD ? palette.warning : undefined}
                />
                <Row label={t("provider.activeJob.rowModel")} value={tierLabel(triage.tier, t)} />

                {otherPossibilities.length > 0 ? (
                  <View style={{ gap: 4, paddingTop: spacing.xs }}>
                    <Text style={{ ...typography.micro, color: palette.textMuted }}>
                      {t("provider.activeJob.alsoPossible")}
                    </Text>
                    {otherPossibilities.map(({ type, prob }) => (
                      <View
                        key={type}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ ...typography.caption, color: palette.text }}>
                          {serviceTypeLabel(type, t)}
                        </Text>
                        <Text style={{ ...typography.caption, color: palette.textMuted }}>
                          {Math.round(prob * 100)}%
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {triage.confidence < LOW_CONFIDENCE_THRESHOLD ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: spacing.sm,
                      backgroundColor: palette.warningSoft,
                      borderRadius: radii.md,
                      padding: spacing.sm,
                      marginTop: spacing.xs,
                    }}
                  >
                    <Icon name="TriangleAlert" size={16} color={palette.warning} />
                    <Text style={{ ...typography.caption, color: palette.text, flex: 1 }}>
                      {t("provider.activeJob.lowConfidence")}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {t("provider.activeJob.noTriage")}
              </Text>
            )}
            {job.description ? (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                “{job.description}”
              </Text>
            ) : null}
          </Card>

          <MapPreview
            driverLocation={{ latitude: job.latitude, longitude: job.longitude }}
            provider={job.assignedProvider ?? null}
            distanceText={
              distanceKm !== null
                ? t("provider.activeJob.km", { km: distanceKm.toFixed(1) })
                : null
            }
          />

          <Card>
            <Row
              label={t("provider.activeJob.rowDistance")}
              value={
                distanceKm !== null
                  ? t("provider.activeJob.kmAway", { km: distanceKm.toFixed(1) })
                  : "—"
              }
            />
            <Row
              label={t("provider.activeJob.rowLocation")}
              value={`${job.latitude.toFixed(4)}, ${job.longitude.toFixed(4)}`}
            />
            <Row label={t("provider.activeJob.rowReported")} value={timeAgo(job.createdAt, t)} />
            <Row
              label={t("provider.activeJob.rowVehicle")}
              value={
                [job.vehicleMake, job.vehicleModel, job.vehicleYear]
                  .filter(Boolean)
                  .join(" ") || t("provider.activeJob.notProvided")
              }
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

function describe(err: unknown): string {
  return err instanceof DispatchApiError
    ? `${err.message} (HTTP ${err.status})`
    : (err as Error).message;
}

function elapsedMinutes(iso: string): number {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return Math.min(480, Math.max(0, Number.isFinite(mins) ? mins : 0));
}

function timeAgo(iso: string, t: Translate): string {
  const mins = elapsedMinutes(iso);
  if (mins < 1) return t("provider.activeJob.justNow");
  if (mins < 60) return t("provider.activeJob.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  return hours < 24
    ? t("provider.activeJob.hoursAgo", { count: hours })
    : t("provider.activeJob.daysAgo", { count: Math.floor(hours / 24) });
}

function tierLabel(tier: string, t: Translate): string {
  return tier === "OBD_ENHANCED"
    ? t("provider.activeJob.tierObd")
    : tier === "BAYESIAN_LEARNED"
      ? t("provider.activeJob.tierBayesian")
      : t("provider.activeJob.tierDefault");
}

function statusBadge(status: string, t: Translate): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "brand";
} {
  switch (status) {
    case "PROVIDER_ASSIGNED":
      return { label: t("provider.activeJob.statusNew"), tone: "warning" };
    case "EN_ROUTE":
      return { label: t("provider.activeJob.statusEnRoute"), tone: "brand" };
    case "ON_SCENE":
      return { label: t("provider.activeJob.statusOnScene"), tone: "brand" };
    case "RESOLVED":
      return { label: t("provider.activeJob.statusResolved"), tone: "success" };
    case "ESCALATED":
      return { label: t("provider.activeJob.statusEscalated"), tone: "danger" };
    default:
      return { label: status.replace(/_/g, " "), tone: "neutral" };
  }
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: 6,
      }}
    >
      <Text style={{ ...typography.micro, color: palette.textMuted }}>{label}</Text>
      <Text
        style={{
          ...typography.bodyStrong,
          color: valueColor ?? palette.text,
          flexShrink: 1,
          textAlign: "right",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
