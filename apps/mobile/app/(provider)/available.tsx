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
import { useT, type Translate } from "@lib/i18n";

/** Statuses that mean "this job is still mine" — the backend filters one at a time. */
const ACTIVE_JOB_STATUSES = ["PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SCENE"];

const POLL_INTERVAL_MS = 5000;

export default function ProviderAvailableScreen() {
  const insets = useSafeAreaInsets();
  const t = useT();
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
        t("provider.available.dispatchError", { message: (err as Error).message })
      );
    } finally {
      setLoading(false);
    }
  }, [providerId, t]);

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
              ? t("provider.available.jobsForbidden")
              : t("provider.available.dispatchError", { message: (err as Error).message })
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
    }, [providerId, provider, offline, t])
  );

  async function toggleStatus() {
    if (!provider) return;
    setStatusBusy(true);
    const nextStatus = provider.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    try {
      const updated = await updateProviderStatus(provider.id, nextStatus);
      setProvider(updated);
    } catch (err) {
      Alert.alert(t("provider.available.statusFailedTitle"), (err as Error).message);
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
        t("provider.available.locationUpdatedTitle"),
        loc.isReal
          ? t("provider.available.locationUpdatedGps")
          : t("provider.available.locationUpdatedFallback")
      );
    } catch (err) {
      Alert.alert(t("provider.available.locationFailedTitle"), (err as Error).message);
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
            title={t("provider.setup.cta")}
            onPress={() => router.replace("/(provider)/onboarding")}
          />
        }
      >
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.lg }}>
          <Icon name="Wrench" size={44} color={palette.brand} />
          <View style={{ alignItems: "center", gap: spacing.sm }}>
            <Text style={{ ...typography.h2, color: palette.text, textAlign: "center" }}>
              {t("provider.setup.emptyTitle")}
            </Text>
            <Text
              style={{
                ...typography.body,
                color: palette.textMuted,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              {t("provider.setup.emptyBody")}
            </Text>
          </View>
        </View>
      </Screen>
    );
  }

  const online = provider?.status === "AVAILABLE";
  const displayName =
    provider?.name.split(" - ")[1] ?? provider?.name ?? t("provider.available.fallbackName");
  const typeLabel = provider
    ? providerTypeLabel(provider.type)
    : t("provider.available.fallbackName");

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
              {loading ? t("provider.available.loadingName") : displayName}
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {typeLabel}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Badge
            label={online ? t("provider.status.online") : provider ? t("provider.status.offline") : "—"}
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
            accessibilityLabel={t("provider.action.logout")}
          >
            <Icon name="LogOut" size={14} color={palette.textMuted} />
            <Text style={{ ...typography.caption, color: palette.textMuted, fontWeight: "600" }}>
              {t("provider.action.logout")}
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
              {t("provider.available.connectionErrorTitle")}
            </Text>
            <Text style={{ ...typography.caption, color: palette.textMuted }}>
              {error}
            </Text>
            <Button title={t("provider.action.retry")} variant="secondary" size="md" onPress={loadProvider} />
          </Card>
        )}

        <Card>
          <Text style={{ ...typography.bodyStrong, color: palette.text }}>
            {loading ? "..." : online ? t("provider.status.available") : t("provider.status.offline")}
          </Text>
          <Text style={{ ...typography.caption, color: palette.textMuted }}>
            {t("provider.available.trustScore", {
              value: provider ? (provider.trustScore * 100).toFixed(0) + "%" : "—",
            })}
          </Text>
          <View
            style={{
              flexDirection: "row", gap: spacing.md, marginTop: spacing.sm,
            }}
          >
            <Button
              title={
                statusBusy
                  ? "..."
                  : online
                    ? t("provider.available.goOffline")
                    : t("provider.available.goOnline")
              }
              variant="secondary"
              size="md"
              onPress={toggleStatus}
              disabled={!provider || statusBusy}
            />
            <Button
              title={
                locationBusy
                  ? t("provider.available.updatingLocation")
                  : t("provider.available.updateLocation")
              }
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
            <Text style={{ ...typography.h3, color: palette.text }}>
              {t("provider.available.jobsHeading")}
            </Text>
            <Text style={{ ...typography.caption, color: palette.brand, fontWeight: "600" }}>
              {!offline && jobs?.length
                ? t("provider.available.activeCount", { count: jobs.length })
                : ""}
            </Text>
          </View>

          {offline ? (
            <Card
              variant="muted"
              style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.md }}
            >
              <Icon name="PowerOff" size={40} color={palette.textMuted} />
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                {t("provider.available.offlineTitle")}
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}>
                {t("provider.available.offlineBody")}
              </Text>
            </Card>
          ) : (
            <>
              {jobsError && (
                <Card style={{ borderLeftWidth: 4, borderLeftColor: palette.danger }}>
                  <Text style={{ ...typography.bodyStrong, color: palette.danger }}>
                    {t("provider.available.jobsErrorTitle")}
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
                    {t("provider.available.emptyTitle")}
                  </Text>
                  <Text
                    style={{ ...typography.caption, color: palette.textMuted, textAlign: "center" }}
                  >
                    {t("provider.available.emptyBody")}
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
          accessibilityLabel={t("provider.available.servicesA11y")}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Icon name="Wrench" size={20} color={palette.brand} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...typography.bodyStrong, color: palette.text }}>
                {t("provider.services.title")}
              </Text>
              <Text style={{ ...typography.caption, color: palette.textMuted }}>
                {loading
                  ? t("provider.common.loading")
                  : provider?.capabilities.length
                    ? t("provider.available.servicesSummary", {
                        count: provider.capabilities.length,
                      })
                    : t("provider.available.servicesSetup")}
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
  const t = useT();
  const service = job.triageResponse?.predictedServiceType as ServiceType | undefined;
  const distanceKm = provider ? haversineKm(provider, job) : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      accessibilityRole="button"
      accessibilityLabel={t("provider.job.openA11y", {
        service: service ? serviceTypeLabel(service) : t("provider.job.fallbackServiceLower"),
      })}
    >
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Icon name="TriangleAlert" size={20} color={palette.danger} />
          <Text style={{ ...typography.h3, color: palette.text, flex: 1 }}>
            {service ? serviceTypeLabel(service) : t("provider.job.fallbackService")}
          </Text>
          <Badge
            label={jobStatusLabel(job.status, t)}
            tone={job.status === "PROVIDER_ASSIGNED" ? "warning" : "brand"}
          />
        </View>
        <Text style={{ ...typography.caption, color: palette.textMuted }}>
          {distanceKm !== null
            ? t("provider.job.distanceAndAge", {
                km: distanceKm.toFixed(1),
                age: receivedLabel(job.createdAt, t),
              })
            : receivedLabel(job.createdAt, t)}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={{ ...typography.body, color: palette.text }}>
            {service ? serviceTypeAction(service) : t("provider.job.fallbackAction")}
          </Text>
          <Icon name="ChevronRight" size={18} color={palette.textMuted} />
        </View>
      </Card>
    </Pressable>
  );
}

function jobStatusLabel(status: string, t: Translate): string {
  if (status === "PROVIDER_ASSIGNED") return t("provider.jobCard.statusNew");
  if (status === "EN_ROUTE") return t("provider.jobCard.statusEnRoute");
  return t("provider.jobCard.statusOnScene");
}

function receivedLabel(createdAt: string, t: Translate): string {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(createdAt).getTime()) / 60000)
  );
  if (minutes < 1) return t("provider.jobCard.justNow");
  if (minutes < 60) return t("provider.jobCard.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("provider.jobCard.hoursAgo", { count: hours });
  return new Date(createdAt).toLocaleDateString("en-GB");
}
