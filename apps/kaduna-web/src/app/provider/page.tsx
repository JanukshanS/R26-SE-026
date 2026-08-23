"use client";

import { useCallback, useEffect, useState } from "react";

import PortalShell, { EmptyCard } from "@/components/portal/PortalShell";
import RequireAuth, { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  DispatchApiError,
  enumLabel,
  getProvider,
  haversineKm,
  listAssignedIncidents,
  resolveIncident,
  respondToJob,
  updateProviderLocation,
  updateProviderStatus,
  type AssignedIncident,
  type ProviderRecord,
} from "@/lib/dispatchApi";

const TABS = [
  { label: "Jobs", href: "/provider" },
  { label: "Availability", href: "/provider" },
  { label: "History", href: "/provider" },
];

/** Statuses that mean "this job is still mine" — the backend filters one at a time. */
const ACTIVE_JOB_STATUSES = ["PROVIDER_ASSIGNED", "EN_ROUTE", "ON_SCENE"];
const CLOSED_JOB_STATUSES = ["RESOLVED", "ESCALATED"];
const POLL_INTERVAL_MS = 5000;

function describe(err: unknown): string {
  return err instanceof DispatchApiError && err.status === 403
    ? "Your account isn't linked to this provider profile. Sign out and set it up again."
    : (err as Error).message;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** Label + tone per incident status, matching the mobile provider screens. */
const STATUS_BADGE: Record<string, [string, string]> = {
  PROVIDER_ASSIGNED: ["New job", "bg-amber-100 text-amber-900"],
  EN_ROUTE: ["En route", "bg-primary/15 text-primary"],
  ON_SCENE: ["On scene", "bg-primary/15 text-primary"],
  RESOLVED: ["Resolved", "bg-emerald-100 text-emerald-900"],
  ESCALATED: ["Escalated", "bg-red-100 text-red-900"],
};

function Badge({ status }: { status: string }) {
  const [label, tone] = STATUS_BADGE[status] ?? [
    enumLabel(status),
    "bg-muted text-muted-foreground",
  ];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
  );
}

function Spinner() {
  return (
    <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />
  );
}

/** Module-scope so the resolve form inside it survives the 5s poll re-render. */
function JobCard({
  job,
  provider,
  error,
  children,
}: {
  job: AssignedIncident;
  provider: ProviderRecord | null;
  error?: string;
  children?: React.ReactNode;
}) {
  const service = job.triageResponse?.predictedServiceType;
  const km = provider ? haversineKm(provider, job) : null;
  const vehicle = [job.vehicleMake, job.vehicleModel, job.vehicleYear]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-lg font-semibold tracking-tight">
          {service ? enumLabel(service) : "Roadside assistance"}
        </h3>
        <Badge status={job.status} />
        {job.triageResponse?.confidence != null && (
          <span className="text-xs text-muted-foreground">
            {(job.triageResponse.confidence * 100).toFixed(0)}% confidence
            {job.triageResponse.tier ? ` · ${enumLabel(job.triageResponse.tier)}` : ""}
          </span>
        )}
      </div>

      <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Distance</dt>
          <dd>{km !== null ? `${km.toFixed(1)} km away` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Location</dt>
          <dd>
            {job.latitude.toFixed(4)}, {job.longitude.toFixed(4)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Reported</dt>
          <dd>{timeAgo(job.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Vehicle</dt>
          <dd>{vehicle || "Not provided"}</dd>
        </div>
      </dl>

      {job.description && (
        <p className="mt-3 text-sm italic text-muted-foreground">“{job.description}”</p>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {children}
    </div>
  );
}

function ProviderConsole({ providerId }: { providerId: string }) {
  const [provider, setProvider] = useState<ProviderRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);

  const [jobs, setJobs] = useState<AssignedIncident[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [history, setHistory] = useState<AssignedIncident[]>([]);

  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [jobError, setJobError] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);

  const loadProvider = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProvider(await getProvider(providerId));
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadProvider();
  }, [loadProvider]);

  const loadJobs = useCallback(async () => {
    const pages = await Promise.all(
      ACTIVE_JOB_STATUSES.map((status) => listAssignedIncidents(providerId, { status }))
    );
    return pages
      .flatMap((page) => page.incidents)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [providerId]);

  const loadHistory = useCallback(async () => {
    const pages = await Promise.all(
      CLOSED_JOB_STATUSES.map((status) =>
        listAssignedIncidents(providerId, { status, limit: 5 })
      )
    );
    setHistory(
      pages
        .flatMap((page) => page.incidents)
        .sort((a, b) => (b.resolvedAt ?? b.updatedAt).localeCompare(a.resolvedAt ?? a.updatedAt))
        .slice(0, 5)
    );
  }, [providerId]);

  const offline = provider?.status === "OFFLINE";

  // Poll the assigned-jobs feed on mobile's cadence. Skips while the tab is
  // hidden or the provider is offline, and never overlaps two requests.
  useEffect(() => {
    if (!provider || offline) return;
    let cancelled = false;
    let inFlight = false;

    async function tick() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const next = await loadJobs();
        if (cancelled) return;
        setJobs(next);
        setJobsError(null);
      } catch (err) {
        if (!cancelled) setJobsError(describe(err));
      } finally {
        inFlight = false;
      }
    }

    void tick();
    void loadHistory().catch(() => {});
    const handle = setInterval(() => void tick(), POLL_INTERVAL_MS);
    // Catch up immediately when the tab comes back rather than waiting a tick.
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [provider, offline, loadJobs, loadHistory]);

  async function toggleStatus() {
    if (!provider) return;
    const next = provider.status === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    const previous = provider;
    setProvider({ ...provider, status: next }); // optimistic
    setStatusBusy(true);
    try {
      setProvider(await updateProviderStatus(provider.id, next));
    } catch (err) {
      setProvider(previous);
      setError(describe(err));
    } finally {
      setStatusBusy(false);
    }
  }

  function handleUpdateLocation() {
    if (!provider || !navigator.geolocation) return;
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          setProvider(
            await updateProviderLocation(provider.id, {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            })
          );
        } catch (err) {
          setError(describe(err));
        } finally {
          setLocationBusy(false);
        }
      },
      () => {
        setError("Couldn't read your location. Allow location access and try again.");
        setLocationBusy(false);
      }
    );
  }

  async function respond(job: AssignedIncident, accepted: boolean) {
    setBusyJobId(job.id);
    setJobError((prev) => ({ ...prev, [job.id]: "" }));
    try {
      const res = await respondToJob({ incidentId: job.id, providerId, accepted });
      setJobs((prev) =>
        accepted
          ? (prev ?? []).map((j) => (j.id === job.id ? { ...j, ...res.incident } : j))
          : (prev ?? []).filter((j) => j.id !== job.id)
      );
    } catch (err) {
      setJobError((prev) => ({ ...prev, [job.id]: describe(err) }));
      if (err instanceof DispatchApiError && err.status === 409) {
        loadJobs().then(setJobs, () => {});
      }
    } finally {
      setBusyJobId(null);
    }
  }

  async function submitResolution(job: AssignedIncident, form: FormData) {
    const minutes = Number(form.get("minutes"));
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 480) {
      setJobError((prev) => ({
        ...prev,
        [job.id]: "Enter how long the job took, in minutes (0–480).",
      }));
      return;
    }
    setBusyJobId(job.id);
    setJobError((prev) => ({ ...prev, [job.id]: "" }));
    try {
      await resolveIncident({
        incidentId: job.id,
        providerId,
        actualServiceType: String(form.get("actualServiceType")),
        resolutionTimeMinutes: Math.round(minutes),
        notes: String(form.get("notes") ?? "").trim() || undefined,
        escalationNeeded: form.get("escalationNeeded") === "on",
      });
      setResolving(null);
      setJobs((prev) => (prev ?? []).filter((j) => j.id !== job.id));
      void loadHistory().catch(() => {});
    } catch (err) {
      setJobError((prev) => ({ ...prev, [job.id]: describe(err) }));
    } finally {
      setBusyJobId(null);
    }
  }

  const offered = (jobs ?? []).filter((j) => j.status === "PROVIDER_ASSIGNED");
  const active = (jobs ?? []).filter(
    (j) => j.status === "EN_ROUTE" || j.status === "ON_SCENE"
  );
  const online = provider?.status === "AVAILABLE";

  const card = (job: AssignedIncident, children?: React.ReactNode) => (
    <JobCard key={job.id} job={job} provider={provider} error={jobError[job.id]}>
      {children}
    </JobCard>
  );

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="font-display text-2xl font-bold tracking-tight">
                {loading ? "Loading…" : (provider?.name ?? "Provider")}
              </h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  online
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {provider ? (online ? "Available" : enumLabel(provider.status)) : "—"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {provider ? enumLabel(provider.type) : "Provider"} · {providerId}
              {provider ? ` · trust ${(provider.trustScore * 100).toFixed(0)}%` : ""}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleUpdateLocation}
              disabled={!provider || locationBusy}
              className="rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              {locationBusy ? <Spinner /> : "Update location"}
            </button>
            <button
              type="button"
              onClick={toggleStatus}
              disabled={!provider || statusBusy}
              aria-pressed={online}
              className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
                online
                  ? "border border-input hover:bg-accent"
                  : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {statusBusy && <Spinner />} {online ? "Go offline" : "Go online"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{error}</p>
            <button
              type="button"
              onClick={loadProvider}
              className="mt-2 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
            >
              Try again
            </button>
          </div>
        )}
      </section>

      {/* No provider record means the poll never starts — don't spin forever. */}
      {!provider ? null : offline ? (
        <EmptyCard
          title="You're offline"
          body="Go online to start receiving dispatch offers. While you're offline, dispatch routes jobs to other providers."
        />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Job offers{offered.length ? ` (${offered.length})` : ""}
            </h2>

            {jobsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
                <p className="font-medium">Couldn&apos;t load your jobs</p>
                <p className="mt-1">{jobsError}</p>
                <button
                  type="button"
                  onClick={() => loadJobs().then(
                    (next) => { setJobs(next); setJobsError(null); },
                    (err) => setJobsError(describe(err))
                  )}
                  className="mt-3 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
                >
                  Retry
                </button>
              </div>
            ) : jobs === null ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                <Spinner /> Loading your queue…
              </div>
            ) : offered.length === 0 ? (
              <EmptyCard
                title="No jobs waiting"
                body="Dispatch offers appear here within a few seconds of a nearby driver needing the service you provide."
              />
            ) : (
              offered.map((job) =>
                card(
                  job,
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => respond(job, true)}
                      disabled={busyJobId === job.id}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                    >
                      {busyJobId === job.id && <Spinner />} Accept job
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(job, false)}
                      disabled={busyJobId === job.id}
                      className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
                    >
                      Decline
                    </button>
                  </div>
                )
              )
            )}
          </section>

          {active.length > 0 && (
            <section className="space-y-4">
              <h2 className="font-display text-lg font-semibold tracking-tight">Active job</h2>
              {active.map((job) =>
                card(
                  job,
                  resolving === job.id ? (
                    <form
                      className="mt-4 space-y-3 border-t border-border pt-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitResolution(job, new FormData(e.currentTarget));
                      }}
                    >
                      <p className="text-sm text-muted-foreground">
                        Report what you actually did — it trains the prediction for the next
                        driver.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                            Service performed
                          </span>
                          <select
                            name="actualServiceType"
                            defaultValue={job.triageResponse?.predictedServiceType}
                            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          >
                            {serviceOptions(job, provider).map((st) => (
                              <option key={st} value={st}>
                                {enumLabel(st)}
                                {st === job.triageResponse?.predictedServiceType
                                  ? " (predicted)"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-sm">
                          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                            Minutes on the job
                          </span>
                          <input
                            name="minutes"
                            type="number"
                            min={0}
                            max={480}
                            required
                            defaultValue={Math.min(
                              480,
                              Math.max(
                                0,
                                Math.round(
                                  (Date.now() - new Date(job.updatedAt).getTime()) / 60_000
                                )
                              )
                            )}
                            className="mt-1 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <label className="block text-sm">
                        <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                          Notes (optional)
                        </span>
                        <input
                          name="notes"
                          maxLength={1000}
                          placeholder="Anything the next provider should know"
                          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input name="escalationNeeded" type="checkbox" />I couldn&apos;t
                        complete this — it needs escalation.
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={busyJobId === job.id}
                          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
                        >
                          {busyJobId === job.id && <Spinner />} Submit resolution
                        </button>
                        <button
                          type="button"
                          onClick={() => setResolving(null)}
                          className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => setResolving(job.id)}
                        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
                      >
                        Report outcome
                      </button>
                    </div>
                  )
                )
              )}
            </section>
          )}

          {history.length > 0 && (
            <section className="space-y-3">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                Recent history
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {history.map((job) => (
                  <li key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="font-medium">
                      {job.triageResponse?.predictedServiceType
                        ? enumLabel(job.triageResponse.predictedServiceType)
                        : "Roadside assistance"}
                    </span>
                    <Badge status={job.status} />
                    <span className="ml-auto text-muted-foreground">
                      {timeAgo(job.resolvedAt ?? job.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** The provider's own capabilities, predicted service first so a mismatch is deliberate. */
function serviceOptions(job: AssignedIncident, provider: ProviderRecord | null): string[] {
  const caps = provider?.capabilities ?? [];
  const predicted = job.triageResponse?.predictedServiceType;
  return predicted ? [predicted, ...caps.filter((c) => c !== predicted)] : caps;
}

/* Client because the body branches on profile.provider_id, which only exists
   once the session's profile has loaded. */
function ProviderBody() {
  const { profile } = useAuth();

  if (!profile?.provider_id) {
    return (
      <EmptyCard
        title="You're not registered as a provider yet"
        body="Registration happens in the mobile app for now — download Kaduna.lk, switch to provider mode and complete your details. This console unlocks once your provider account is linked."
      />
    );
  }

  return <ProviderConsole providerId={profile.provider_id} />;
}

/** Mobile parity: flip the provider OFFLINE before the session dies, so a
 *  signed-out operator stops receiving dispatches. Reads provider_id fresh
 *  because PortalShell sits above the session context. */
async function goOfflineBeforeSignOut() {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return;
  const { data: prof } = await supabase
    .from("profiles")
    .select("provider_id")
    .eq("id", uid)
    .maybeSingle();
  if (prof?.provider_id) {
    await updateProviderStatus(prof.provider_id, "OFFLINE");
  }
}

export default function ProviderPortalPage() {
  return (
    <RequireAuth>
      <PortalShell
        title="Provider Console"
        tabs={TABS}
        active="Jobs"
        onBeforeSignOut={goOfflineBeforeSignOut}
      >
        <ProviderBody />
      </PortalShell>
    </RequireAuth>
  );
}
