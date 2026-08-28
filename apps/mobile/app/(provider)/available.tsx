import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
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
  DispatchApiError,
  getProvider,
  haversineKm,
  listAssignedIncidents,
  providerTypeLabel,
  serviceTypeAction,
  serviceTypeLabel,
  updateProviderLocation,
  updateProviderStatus,
  type AssignedIncident,
  type ProviderRecord,
  type ServiceType,
} from "@lib/dispatchApi";
import { getCurrentDriverLocation } from "@lib/driverLocation";

/** Statuses that mean "this job is still mine" — the backend filters one at a time. */
const ACTIVE_JOB_STATUSES = ["PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SCENE"];

const POLL_INTERVAL_MS = 5000;

export default function ProviderAvailableScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useVehicle();
  const providerId = user?.providerId ?? null;

  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [jobs, setJobs] = useState<AssignedIncident[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);

  const loadProvider = useCallback(async () => {
    if (!providerId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const me = await getProvider(providerId);
      setProvider(me);
    } catch (err) {
      setError(
        (err as Error).message +
          " (is the dispatch service running on port 3001?)"
      );
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadProvider();
  }, [loadProvider]);

  const offline = provider?.status === "OFFLINE";

  // Poll the assigned-jobs feed while the screen is focused and the provider
  // is not offline. Stops on blur/unmount so no interval survives the screen.
  useFocusEffect(
    useCallback(() => {
      if (!providerId || !provider || offline) return;
      const id = providerId;
      let cancelled = false;
      let inFlight = false;

      async function tick() {
        if (inFlight) return;
        inFlight = true;
        try {
          const pages = await Promise.all(
            ACTIVE_JOB_STATUSES.map((status) =>
              listAssignedIncidents(id, { status })
            )
          );
          if (cancelled) return;
          setJobs(
            pages
              .flatMap((page) => page.incidents)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          );
          setJobsError(null);
        } catch (err) {
          if (cancelled) return;
          setJobsError(
            err instanceof DispatchApiError && err.status === 403
              ? "Your account isn't linked to this provider profile. Log out and set it up again."
              : (err as Error).message +
                  " (is the dispatch service running on port 3001?)"
          );
        } finally {
          inFlight = false;
        }
      }

      void tick();
      const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        clearInterval(handle);
      };
    }, [providerId, provider, offline])
  );

  async function toggleStatus() {
    if (!provider) return;
    setStatusBusy(true);
    const nextStatus = provider.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    try {
      const updated = await updateProviderStatus(provider.id, nextStatus);
      setProvider(updated);
    } catch (err) {
      Alert.alert("Failed to update status", (err as Error).message);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleUpdateLocation() {
    if (!provider) return;
    setLocationBusy(true);
    try {
      const loc = await getCurrentDriverLocation({ forceFresh: true });
      const updated = await updateProviderLocation(provider.id, {
        latitude: loc.latitude,
        longitude: loc.longitude,
      });
      setProvider(updated);
      Alert.alert(
        "Location updated",
        loc.isReal
          ? "Your position on the map has been refreshed from GPS."
          : "GPS was unavailable, so we used your last known area."
      );
    } catch (err) {
      Alert.alert("Failed to update location", (err as Error).message);
    } finally {
      setLocationBusy(false);
    }
  }

  /**
   * Log out — flips the provider OFFLINE first (so they don't keep getting
   * dispatched while away), then clears the auth session and returns to the
   * welcome screen.
   */
  async function handleLogout() {
    if (provider && provider.status !== "OFFLINE") {
      try {
        await updateProviderStatus(provider.id, "OFFLINE");
      } catch {
        /* best-effort — don't block logout if the backend is unreachable */
      }
    }
    try {
      await logout();
    } catch {
      /* logout already clears local state best-effort */
    }
    router.replace("/");
  }

  // Not onboarded yet (no linked provider record) — invite them to set up.
  if (!loading && !providerId) {
    return (
      <Screen
        footer={
          <Button
            title="Set up your provider profile"
            onPress={() => router.replace("/(provider)/onboarding")}
          />
        }
      >
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }}>
          <Icon name="Wrench" size={44} color={palette.brand} />
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
              No provider profile yet
            </Text>
            <Text
              style={{
                ...typography.body,
                color: palette.textMuted,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              Create your provider profile to appear on the dispatch map and
              start receiving roadside jobs near you.
            </Text>
          </View>
        </View>
      </Screen>
    );
  }

  const online = provider?.status === "AVAILABLE";
  const displayName = provider?.name.split(" - ")[1] ?? provider?.name ?? "Provider";
  const typeLabel = provider ? providerTypeLabel(provider.type) : "Provider";

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View
        style={{
          backgroundColor: palette.surface,
          paddingTop: insets.top + spacing.md,
          paddingHorizontal: spacing.xl,
          paddingBottom: spacing.lg,
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: palette.surfaceMuted,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Icon name="UserRound" size={22} color={palette.textMuted} />
          </View>
          <View style={{ gap: 2 }}>
            <Text style={{ ...typography.bodyStrong, color: palette.text }}>
              {loading ? "Loading..." : displayName}
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {typeLabel}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Badge
            label={online ? "Online" : provider ? "Offline" : "—"}
            tone={online ? "success" : "neutral"}
            withDot
          />
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => ({
              opacity: pressed ? 0.7 : 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: palette.border,
              backgroundColor: palette.surface,
            })}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Icon name="LogOut" size={14} color={palette.textMuted} />
            <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
              Log out
            </Text>
          </Pressable>
        </View>
      </View>

      <Screen
        edges={["bottom"]}
        contentContainerStyle={{ paddingBottom: PROVIDER_NAV_BAR_HEIGHT + spacing.xl }}
      >
        {error && (
          <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger }}>
            <Text style={{ ...typography.bodyStrong, color: palette.danger }}>
              Connection error
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {error}
            </Text>
            <Button title="Try again" variant="secondary" size="md" onPress={loadProvider} />
          </Card>
        )}

        <Card>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {loading ? "..." : online ? "Available" : "Offline"}
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            Trust score: {provider ? (provider.trustScore * 100).toFixed(0) + "%" : "—"}
          </Text>
          <View
            style={{
              flexDirection: "row", gap: spacing.md, marginTop: spacing.sm,
            }}
          >
            <Button
              title={statusBusy ? "..." : online ? "GO OFFLINE" : "GO ONLINE"}
              variant="secondary"
              size="md"
              onPress={toggleStatus}
              disabled={!provider || statusBusy}
            />
            <Button
              title={locationBusy ? "UPDATING…" : "UPDATE LOCATION"}
              size="md"
              onPress={handleUpdateLocation}
              disabled={!provider || locationBusy}
            />
          </View>
        </Card>

        <View style={{ gap: spacing.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ ...typography.h3, color: palette.text }}>Assigned Jobs</Text>
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              {!offline && jobs?.length ? `${jobs.length} active` : ""}
            </Text>
          </View>

          {offline ? (
            <Card
              variant="muted"
              style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}
            >
              <Icon name="PowerOff" size={40} color={palette.textMuted} />
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                You&apos;re offline
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
                Go online to start receiving jobs from dispatch.
              </Text>
            </Card>
          ) : (
            <>
              {jobsError && (
                <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger }}>
                  <Text style={{ ...typography.bodyStrong, color: palette.danger }}>
                    Couldn&apos;t load your jobs
                  </Text>
                  <Text style={{ ...typography.caption, color: palette.textMuted }}>
                    {jobsError}
                  </Text>
                </Card>
              )}

              {jobs?.length ? (
                jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    provider={provider}
                    onPress={() =>
                      router.push({
                        pathname: "/(provider)/active-job",
                        params: { incidentId: job.id },
                      })
                    }
                  />
                ))
              ) : jobsError ? null : jobs === null ? (
                <Card style={{ alignItems: "center", paddingVertical: spacing.xl }}>
                  <ActivityIndicator size="small" color={palette.brand} />
                </Card>
              ) : (
                <Card
                  variant="muted"
                  style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}
                >
                  <Icon name="Inbox" size={40} color={palette.textMuted} />
                  <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                    No jobs assigned right now
                  </Text>
                  <Text
                    style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}
                  >
                    New assignments appear here within a few seconds.
                  </Text>
                </Card>
              )}
            </>
          )}
        </View>

        <Pressable
          onPress={() => router.push("/(provider)/services")}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
          accessibilityRole="button"
          accessibilityLabel="Manage my services"
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Icon name="Wrench" size={20} color={palette.brand} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                My Services
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {loading
                  ? "Loading…"
                  : provider?.capabilities.length
                    ? `${provider.capabilities.length} services · tap to edit`
                    : "Set up what you offer"}
              </Text>
            </View>
            <Icon name="ChevronRight" size={18} color={palette.textMuted} />
          </Card>
        </Pressable>
      </Screen>

      <ProviderBottomNavBar activeTab="jobs" />
    </View>
  );
}

function JobCard({
  job,
  provider,
  onPress,
}: {
  job: AssignedIncident;
  provider: ProviderRecord | null;
  onPress: () => void;
}) {
  const service = job.triageResponse?.predictedServiceType as ServiceType | undefined;
  const distanceKm = provider ? haversineKm(provider, job) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={`Open job ${service ? serviceTypeLabel(service) : "roadside assistance"}`}
    >
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="TriangleAlert" size={20} color={palette.danger} />
          <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
            {service ? serviceTypeLabel(service) : "Roadside assistance"}
          </Text>
          <Badge
            label={jobStatusLabel(job.status)}
            tone={job.status === "PROVIDER_ASSIGNED" ? "warning" : "brand"}
          />
        </View>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {distanceKm !== null ? `${distanceKm.toFixed(1)} km away · ` : ""}
          {receivedLabel(job.createdAt)}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ ...typography.body, color: palette.text }}>
            {service ? serviceTypeAction(service) : "Assess on arrival"}
          </Text>
          <Icon name="ChevronRight" size={18} color={palette.textMuted} />
        </View>
      </Card>
    </Pressable>
  );
}

function jobStatusLabel(status: string): string {
  if (status === "PROVIDER_ASSIGNED") return "New";
  if (status === "EN_ROUTE") return "En route";
  return "On scene";
}

function receivedLabel(createdAt: string): string {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(createdAt).getTime()) / 60000)
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(createdAt).toLocaleDateString("en-GB");
}
