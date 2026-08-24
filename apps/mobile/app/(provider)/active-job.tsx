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

type Job = Awaited<ReturnType<typeof getIncident>> & { description?: string | null };

type Triage = {
  predictedServiceType: ServiceType;
  confidence: number;
  tier: string;
} | null;

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
          ? `${describe(err)} Go back to your dashboard and open the job again.`
          : `${describe(err)} Check your connection and try again.`
      );
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

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
    setMinutes(job ? String(elapsedMinutes(job.updatedAt)) : "");
    setFormError(null);
    setActionError(null);
    setMode("resolve");
  }

  async function submitResolution() {
    if (!job || !providerId || !actualType) return;
    const mins = Number(minutes.trim());
    if (!Number.isFinite(mins) || mins < 0 || mins > 480) {
      setFormError("Enter how long the job took, in minutes (0–480).");
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
      title="Back to dashboard"
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
              No job selected
            </Text>
            <Text
              style={{
                ...typography.body,
                color: palette.textMuted,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              Open a job from your dashboard to see the request and accept it.
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
            Loading the job…
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
          title="Could not load this job"
          message={error ?? "The job could not be loaded. Check your connection and try again."}
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
            title="Set up your provider profile"
            onPress={() => router.replace("/(provider)/onboarding")}
          />
        }
      >
        <HeaderBar />
        <ErrorState
          title="No provider profile"
          message="This account isn't linked to a provider record, so it can't accept or resolve jobs. Create your provider profile to start working."
        />
      </Screen>
    );
  }

  const mine = job.assignedProviderId === providerId;
  const offered = mine && job.status === "PROVIDER_ASSIGNED";
  const working = mine && (job.status === "EN_ROUTE" || job.status === "ON_SCENE");
  const closed = job.status === "RESOLVED" || job.status === "ESCALATED";
  const status = statusBadge(job.status);
  const distanceKm = job.assignedProvider
    ? haversineKm(job.assignedProvider, job)
    : null;

  const footer =
    mode === "resolve" ? (
      <>
        <Button
          title={busy ? "Submitting…" : "Submit resolution"}
          disabled={busy || !actualType}
          onPress={submitResolution}
        />
        <Button
          title="Cancel"
          variant="secondary"
          disabled={busy}
          onPress={() => setMode("job")}
        />
      </>
    ) : mode === "decline" ? (
      <>
        <Button
          title={busy ? "Declining…" : "Confirm decline"}
          variant="danger"
          disabled={busy}
          onPress={() => respond(false)}
        />
        <Button
          title="Keep the job"
          variant="secondary"
          disabled={busy}
          onPress={() => setMode("job")}
        />
      </>
    ) : offered ? (
      <>
        <Button
          title={busy ? "Accepting…" : "ACCEPT JOB"}
          disabled={busy}
          onPress={() => respond(true)}
        />
        <Button
          title="Decline"
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
        <Button title="Report outcome" onPress={openResolution} />
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
          title={mode === "resolve" ? "Could not submit the resolution" : "Request failed"}
          message={actionError + " Nothing was changed — you can try again."}
        />
      ) : null}

      {mode === "resolve" ? (
        <>
          <View style={{ gap: spacing.xs }}>
            <Text style={{ ...typography.h1, color: palette.text }}>
              What did you actually do?
            </Text>
            <Text style={{ ...typography.body, color: palette.textMuted }}>
              {triage
                ? `Triage predicted ${serviceTypeLabel(triage.predictedServiceType)}. Your report trains the prediction for the next driver, so pick what the job really was.`
                : "Your report trains the prediction for the next driver, so pick what the job really was."}
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
                    {serviceTypeLabel(st)}
                  </Text>
                  {predicted ? <Badge label="Predicted" tone="neutral" /> : null}
                  {selected ? <Icon name="Check" size={18} color={palette.brand} /> : null}
                </Pressable>
              );
            })}
            {serviceOptions.length === 0 ? (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                Your provider profile has no service types configured, so there is
                nothing to report. Add capabilities to your profile first.
              </Text>
            ) : null}
          </View>

          <TextField
            label="Time on the job (minutes)"
            value={minutes}
            onChangeText={setMinutes}
            placeholder="25"
            keyboardType="number-pad"
            error={formError ?? undefined}
          />

          <TextField
            label="Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything the next provider should know"
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
                I couldn&apos;t complete this — it needs escalation (tow, workshop
                or a second provider).
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
                  Decline this job?
                </Text>
                <Text style={{ ...typography.body, color: palette.textMuted }}>
                  It goes straight back to dispatch for another provider. A reason
                  helps us route better next time.
                </Text>
              </View>
              <TextField
                label="Reason (optional)"
                value={declineReason}
                onChangeText={setDeclineReason}
                placeholder="Too far, already on a job…"
                maxLength={200}
              />
            </>
          ) : null}

          {!mine && !closed ? (
            <Card variant="muted" style={{ flexDirection: "row", gap: spacing.sm }}>
              <Icon name="Info" size={18} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                This job is no longer assigned to you — it went back to dispatch.
              </Text>
            </Card>
          ) : null}

          {closed ? (
            <Card variant="muted" style={{ flexDirection: "row", gap: spacing.sm }}>
              <Icon name="Check" size={18} color={palette.textMuted} />
              <Text style={{ ...typography.caption, color: palette.textMuted, flex: 1 }}>
                This job is closed
                {job.status === "ESCALATED" ? " and was escalated." : "."}
              </Text>
            </Card>
          ) : null}

          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Icon name="TriangleAlert" size={22} color={palette.danger} />
              <Text style={{ ...typography.h3, color: palette.danger, flexShrink: 1 }}>
                {triage ? serviceTypeLabel(triage.predictedServiceType) : "Roadside assistance"}
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
                <Row label="SERVICE" value={serviceTypeAction(triage.predictedServiceType)} />
                <Row
                  label="CONFIDENCE"
                  value={`${(triage.confidence * 100).toFixed(0)}%`}
                />
                <Row label="MODEL" value={tierLabel(triage.tier)} />
              </View>
            ) : (
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                No triage was recorded for this incident — diagnose on arrival.
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
            distanceText={distanceKm !== null ? `${distanceKm.toFixed(1)} km` : null}
          />

          <Card>
            <Row
              label="DISTANCE"
              value={distanceKm !== null ? `${distanceKm.toFixed(1)} km away` : "—"}
            />
            <Row
              label="LOCATION"
              value={`${job.latitude.toFixed(4)}, ${job.longitude.toFixed(4)}`}
            />
            <Row label="REPORTED" value={timeAgo(job.createdAt)} />
            <Row
              label="VEHICLE"
              value={
                [job.vehicleMake, job.vehicleModel, job.vehicleYear]
                  .filter(Boolean)
                  .join(" ") || "Not provided"
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

function timeAgo(iso: string): string {
  const mins = elapsedMinutes(iso);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

function tierLabel(tier: string): string {
  return tier === "OBD_ENHANCED"
    ? "Tier-2 (OBD enhanced)"
    : tier === "BAYESIAN_LEARNED"
      ? "Tier-3 (Bayesian)"
      : "Tier-1";
}

function statusBadge(status: string): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "brand";
} {
  switch (status) {
    case "PROVIDER_ASSIGNED":
      return { label: "New job", tone: "warning" };
    case "EN_ROUTE":
      return { label: "En route", tone: "brand" };
    case "ON_SCENE":
      return { label: "On scene", tone: "brand" };
    case "RESOLVED":
      return { label: "Resolved", tone: "success" };
    case "ESCALATED":
      return { label: "Escalated", tone: "danger" };
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
