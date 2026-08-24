"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BatteryWarning,
  Check,
  CircleDot,
  CircleOff,
  CircleQuestionMark,
  CircleSlash2,
  CircleStop,
  Cog,
  Disc,
  Droplet,
  Droplets,
  Flame,
  Fuel,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  OctagonAlert,
  Settings2,
  Thermometer,
  TriangleAlert,
  WavesHorizontal,
  Zap,
  type LucideIcon,
} from "lucide-react";

import LocationPicker, { type Coords } from "@/components/LocationPicker";
import PortalShell from "@/components/portal/PortalShell";
import RequireAuth from "@/lib/auth";
import {
  createIncident,
  DispatchApiError,
  enumLabel,
  providerTypeLabel,
  runDispatch,
  submitTriage,
  type DispatchResultData,
  type TriageResult,
  type VehicleInfo,
} from "@/lib/dispatchApi";
import {
  answer,
  buildTriageResponses,
  EMPTY_ANSWERS,
  FAST_TILES,
  flowSteps,
  isAnswered,
  isFastIntent,
  LIGHT_TILES,
  ML_TILES,
  toggle,
  type Answers,
  type IntentTile,
  type SLContext,
  type Step,
} from "@/lib/triageFlow";
import { listVehicles, vehicleTitle, type Vehicle } from "@/lib/vehicleApi";

/** Only the icons the tiles name — importing lucide wholesale would ship
 *  every icon in the library into a statically exported bundle. */
const ICONS: Record<string, LucideIcon> = {
  BatteryWarning,
  CircleDot,
  CircleOff,
  CircleQuestionMark,
  CircleSlash2,
  CircleStop,
  Cog,
  Disc,
  Droplet,
  Droplets,
  Flame,
  Fuel,
  KeyRound,
  Lightbulb,
  LockKeyhole,
  OctagonAlert,
  Settings2,
  Thermometer,
  TriangleAlert,
  WavesHorizontal,
  Zap,
};

const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"];

const PRIMARY_BTN =
  "rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50";
const GHOST_BTN =
  "rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50";

function describe(err: unknown): string {
  if (err instanceof DispatchApiError) {
    return err.status === 401
      ? "Your session expired. Sign out and back in, then report again."
      : `${err.message} (HTTP ${err.status})`;
  }
  return err instanceof Error ? err.message : String(err);
}

function Spinner({ className = "" }: { className?: string }) {
  return <LoaderCircle aria-hidden className={`size-4 animate-spin ${className}`} />;
}

function ErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-red-300 px-3 py-1 font-medium hover:bg-red-100"
        >
          Try again
        </button>
      )}
    </div>
  );
}

/** Selectable card, the web equivalent of mobile's OptionCard. */
function OptionCard({
  title,
  description,
  tone,
  selected,
  onSelect,
}: {
  title: string;
  description?: string;
  tone?: "warning" | "danger";
  selected: boolean;
  onSelect: () => void;
}) {
  const edge = selected
    ? "border-primary ring-1 ring-primary"
    : tone === "danger"
      ? "border-red-200"
      : tone === "warning"
        ? "border-amber-200"
        : "border-border";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left hover:bg-accent/40 ${edge}`}
    >
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        {description && (
          <span
            className={`mt-0.5 block text-sm ${
              tone === "danger" ? "text-red-700" : "text-muted-foreground"
            }`}
          >
            {description}
          </span>
        )}
      </span>
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-full border ${
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input"
        }`}
      >
        {selected && <Check className="size-3.5" />}
      </span>
    </button>
  );
}

// ─── Step 1: where and what vehicle ──────────────────────────────────────

function WhereStep({
  coords,
  setCoords,
  vehicles,
  vehiclesError,
  reloadVehicles,
  vehicleId,
  setVehicleId,
  plate,
  setPlate,
  description,
  setDescription,
  onNext,
}: {
  coords: Coords | null;
  setCoords: (c: Coords) => void;
  vehicles: Vehicle[] | null;
  vehiclesError: string | null;
  reloadVehicles: () => void;
  vehicleId: string | null;
  setVehicleId: (id: string) => void;
  plate: string;
  setPlate: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  onNext: () => void;
}) {
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("This browser can't share your location. Click the map below instead.");
      return;
    }
    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Allow it in your browser, or just click the map below where you've broken down."
            : `Couldn't read your location (${err.message}). Click the map below instead.`
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }, [setCoords]);

  const noVehicles = vehicles?.length === 0;
  const ready = !!coords && (noVehicles ? plate.trim().length > 0 : !!vehicleId);

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight">Where are you?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The provider is sent to this pin, so it has to be right. Phone GPS is often a block
          off — check the map and drag the pin if it&apos;s wrong.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={locate} disabled={locating} className={GHOST_BTN}>
            <span className="flex items-center gap-2">
              {locating ? <Spinner /> : <MapPin className="size-4" />}
              {locating ? "Finding you…" : "Use my location"}
            </span>
          </button>
        </div>

        {geoError && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {geoError}
          </p>
        )}

        <div className="mt-4">
          <LocationPicker value={coords} onChange={setCoords} />
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight">Which vehicle?</h2>

        {vehiclesError ? (
          <div className="mt-4">
            <ErrorCard
              title="Couldn't load your vehicles"
              message={vehiclesError}
              onRetry={reloadVehicles}
            />
          </div>
        ) : !vehicles ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading your vehicles…
          </p>
        ) : noVehicles ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t added a vehicle yet. Type the plate instead — it&apos;s what
              links this report back to you, so you can follow it in My Kaduna.
            </p>
            <label className="block text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                Number plate
              </span>
              <input
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="CBD-3742"
                className="mt-1 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 uppercase"
              />
            </label>
          </div>
        ) : (
          <div className="mt-4 space-y-2" role="radiogroup" aria-label="Vehicle">
            {vehicles.map((v) => (
              <OptionCard
                key={v.id}
                title={vehicleTitle(v)}
                description={[v.plateNumber, v.color, v.fuelType].filter(Boolean).join(" · ")}
                selected={vehicleId === v.id}
                onSelect={() => setVehicleId(v.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Anything else? <span className="text-sm font-normal text-muted-foreground">Optional</span>
        </h2>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 500))}
          rows={3}
          placeholder="Parked on the shoulder just past the Malabe junction, hazards on."
          className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </section>

      <div className="flex items-center gap-4">
        <button type="button" onClick={onNext} disabled={!ready} className={PRIMARY_BTN}>
          Continue
        </button>
        {!ready && (
          <span className="text-sm text-muted-foreground">
            {!coords
              ? "We need your location first."
              : noVehicles
                ? "Add the number plate so we can match this report to you."
                : "Pick the vehicle that broke down."}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Step 2: the adaptive questionnaire ──────────────────────────────────

function IntentGrid({ tiles, onPick }: { tiles: IntentTile[]; onPick: (t: IntentTile) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const Glyph = ICONS[tile.icon] ?? TriangleAlert;
        return (
          <button
            key={tile.value}
            type="button"
            onClick={() => onPick(tile)}
            className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border p-4 text-center text-sm font-medium hover:bg-accent/40 ${
              tile.urgent ? "border-red-200 bg-red-50 text-red-900" : "border-border bg-card"
            }`}
          >
            <Glyph
              aria-hidden
              className={`size-6 ${tile.urgent ? "text-red-600" : "text-primary"}`}
            />
            {tile.label}
          </button>
        );
      })}
    </div>
  );
}

function QuestionStep({
  step,
  answers,
  setAnswers,
  onAdvance,
}: {
  step: Step;
  answers: Answers;
  setAnswers: (a: Answers) => void;
  /** Called with the answers to advance from, so branch predicates read the
   *  value that was just picked rather than a stale render. */
  onAdvance: (a: Answers) => void;
}) {
  if (step.kind === "intent") {
    const pick = (tile: IntentTile) => {
      const next = answer(answers, "Q1_intent", tile.value);
      setAnswers(next);
      onAdvance(next);
    };
    return (
      <div className="space-y-8">
        <IntentGrid tiles={FAST_TILES} onPick={pick} />
        <div className="space-y-3">
          <h3 className="font-display text-lg font-semibold tracking-tight">
            Not sure what it is?
          </h3>
          <p className="text-sm text-muted-foreground">
            A few quick questions and we&apos;ll work out what you need.
          </p>
          <IntentGrid tiles={ML_TILES} onPick={pick} />
        </div>
      </div>
    );
  }

  if (step.kind === "lights") {
    const on = answers.Q5_lights;
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {LIGHT_TILES.map((lamp) => {
          const Glyph = ICONS[lamp.icon] ?? TriangleAlert;
          const active = on.includes(lamp.id);
          return (
            <button
              key={lamp.id}
              type="button"
              role="checkbox"
              aria-checked={active}
              onClick={() => setAnswers({ ...answers, Q5_lights: toggle(on, lamp.id) })}
              className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium ${
                active
                  ? "border-foreground bg-foreground text-amber-300"
                  : "border-border bg-card text-muted-foreground hover:bg-accent/40"
              }`}
            >
              <Glyph aria-hidden className="size-6" />
              {lamp.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (step.kind === "multi") {
    const on = answers[step.key] as string[];
    return (
      <div className="space-y-2">
        {step.options!.map((o) => (
          <OptionCard
            key={o.value}
            title={o.title}
            description={o.description}
            tone={o.tone}
            selected={on.includes(o.value)}
            onSelect={() => setAnswers({ ...answers, [step.key]: toggle(on, o.value) })}
          />
        ))}
      </div>
    );
  }

  if (step.kind === "context") {
    return (
      <div className="space-y-5">
        {step.groups!.map((group) => (
          <div key={group.key} className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {group.options.map((o) => {
                const active = answers.context[group.key] === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() =>
                      setAnswers({
                        ...answers,
                        context: { ...answers.context, [group.key]: o.value } as SLContext,
                      })
                    }
                    className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card hover:bg-accent/40"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2" role="radiogroup" aria-label={step.prompt}>
      {step.options!.map((o) => (
        <OptionCard
          key={o.value}
          title={o.title}
          description={o.description}
          tone={o.tone}
          selected={answers[step.key] === o.value}
          onSelect={() => setAnswers(answer(answers, step.key, o.value))}
        />
      ))}
    </div>
  );
}

// ─── Step 3: submit ──────────────────────────────────────────────────────

function TriageCard({ result }: { result: TriageResult }) {
  const ranked = Object.entries(result.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .filter(([, p]) => p > 0);

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Looks like
      </p>
      <p className="font-display mt-1 text-2xl font-bold tracking-tight">
        {enumLabel(result.predictedServiceType)}{" "}
        <span className="text-muted-foreground">
          ({Math.round(result.confidence * 100)}%)
        </span>
      </p>

      {ranked.length > 1 && (
        <ul className="mt-4 space-y-2">
          {ranked.slice(1).map(([service, p]) => (
            <li key={service} className="flex items-center gap-3 text-sm">
              <span className="w-52 shrink-0 text-muted-foreground">{enumLabel(service)}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary/50"
                  style={{ width: `${Math.round(p * 100)}%` }}
                />
              </span>
              <span className="w-10 text-right tabular-nums text-muted-foreground">
                {Math.round(p * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
        Tier-1 diagnosis — questionnaire only. The mobile app adds live OBD telemetry when a
        dongle is paired.
      </p>
    </div>
  );
}

function DispatchCard({
  result,
  noProviders,
}: {
  result: DispatchResultData | null;
  noProviders: boolean;
}) {
  if (noProviders) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <p className="font-semibold">No providers available right now</p>
        <p className="mt-1 text-sm">
          Your report is filed and the diagnosis is saved — nobody has been assigned yet. Ops can
          see it, and the status updates in My Kaduna as soon as someone takes it.
        </p>
      </div>
    );
  }
  if (!result) return null;

  const p = result.selectedProvider;
  const impact = result.metadata.trafficImpactScore;
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Provider assigned
      </p>
      <p className="font-display mt-1 text-2xl font-bold tracking-tight">{p.name}</p>
      <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Type</dt>
          <dd className="mt-0.5 font-medium">{providerTypeLabel(p.type)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Arrives in</dt>
          <dd className="mt-0.5 font-medium">
            {Math.round(p.estimatedTravelTimeMin)} min
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Considered
          </dt>
          <dd className="mt-0.5 font-medium">
            {result.metadata.providersEvaluated} provider
            {result.metadata.providersEvaluated === 1 ? "" : "s"}
          </dd>
        </div>
        {Number.isFinite(impact) && impact > 0 && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Traffic impact
            </dt>
            <dd
              className="mt-0.5 font-medium tabular-nums"
              title="What this breakdown does to city traffic, scored 1-10 by the geo-intelligence service while dispatch was running. Context for road operators, not a ranking of who gets helped first."
            >
              {impact.toFixed(1)}/10
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

type Stage = "where" | "questions" | "submit" | "done";

function ReportFlow() {
  const [stage, setStage] = useState<Stage>("where");

  // One source of truth for the location: the pin. Both "Use my location" and
  // a map click write here, so they can never disagree.
  const [coords, setCoords] = useState<Coords | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [plate, setPlate] = useState("");
  const [description, setDescription] = useState("");

  const loadVehicles = useCallback(() => {
    setVehiclesError(null);
    listVehicles().then((vs) => {
      setVehicles(vs);
      setVehicleId((cur) => cur ?? (vs.find((v) => v.isDefault) ?? vs[0])?.id ?? null);
    }, (err) => setVehiclesError(describe(err)));
  }, []);
  useEffect(loadVehicles, [loadVehicles]);

  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [stepIndex, setStepIndex] = useState(0);
  const steps = flowSteps(answers);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  /** Advance using the answers just picked — mobile computes `next` the same
   *  way, because context hasn't re-rendered when the branch is chosen. */
  const advance = useCallback(
    (from: Answers) => {
      const active = flowSteps(from);
      const here = active.findIndex((s) => s.key === step.key);
      if (here < 0 || here === active.length - 1) setStage("submit");
      else setStepIndex(here + 1);
    },
    [step.key]
  );

  const back = useCallback(() => {
    if (stepIndex === 0) setStage("where");
    else setStepIndex(stepIndex - 1);
  }, [stepIndex]);

  // Pipeline. The refs let a retry resume rather than file a second incident
  // (or a second triage) for the same breakdown.
  const incidentIdRef = useRef<string | null>(null);
  const triageDoneRef = useRef(false);
  const inFlightRef = useRef(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [dispatch, setDispatch] = useState<DispatchResultData | null>(null);
  const [noProviders, setNoProviders] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  const selected = vehicles?.find((v) => v.id === vehicleId) ?? null;

  const run = useCallback(async () => {
    if (inFlightRef.current || !coords) return;
    inFlightRef.current = true;
    setPipelineError(null);
    try {
      let id = incidentIdRef.current;
      if (!id) {
        const fuel = selected?.fuelType?.toUpperCase();
        const vehicleInfo: VehicleInfo = selected
          ? {
              make: selected.make,
              model: selected.model,
              year: selected.year,
              fuelType: FUEL_TYPES.includes(fuel ?? "")
                ? (fuel as VehicleInfo["fuelType"])
                : undefined,
              registrationNumber: selected.plateNumber,
            }
          : { registrationNumber: plate.trim().toUpperCase() };

        const incident = await createIncident({
          location: coords,
          vehicleInfo,
          description: description.trim() || "Roadside assistance requested via kaduna.lk",
        });
        id = incident.id;
        incidentIdRef.current = id;
        setIncidentId(id);
      }

      if (!triageDoneRef.current) {
        // No obdData: the browser has no ELM327 bridge and the field is optional.
        const result = await submitTriage({
          incidentId: id,
          responses: buildTriageResponses(answers),
        });
        triageDoneRef.current = true;
        setTriage(result.result);
      }

      try {
        setDispatch(await runDispatch({ incidentId: id }));
      } catch (err) {
        // "No available providers found" is an outcome, not a failure — the
        // incident and its diagnosis are already filed either way.
        if (
          err instanceof DispatchApiError &&
          err.status === 404 &&
          err.message.toLowerCase().includes("provider")
        ) {
          setNoProviders(true);
        } else {
          throw err;
        }
      }
      setSettled(true);
    } catch (err) {
      setPipelineError(describe(err));
    } finally {
      inFlightRef.current = false;
    }
  }, [answers, coords, description, plate, selected]);

  useEffect(() => {
    if (stage === "submit" && !settled) void run();
    // `run` changes identity as the pipeline writes results back — only the
    // stage transition should kick it off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const crash = answers.Q1_intent === "MAJOR_CRASH";

  return (
    <PortalShell title="Report a breakdown">
      {stage === "where" && (
        <WhereStep
          coords={coords}
          setCoords={setCoords}
          vehicles={vehicles}
          vehiclesError={vehiclesError}
          reloadVehicles={loadVehicles}
          vehicleId={vehicleId}
          setVehicleId={setVehicleId}
          plate={plate}
          setPlate={setPlate}
          description={description}
          setDescription={setDescription}
          onNext={() => setStage("questions")}
        />
      )}

      {stage === "questions" && (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {step.title} · Step {stepIndex + 1} of {steps.length}
              </span>
              <button
                type="button"
                onClick={back}
                className="flex items-center gap-1.5 hover:text-foreground"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight">{step.prompt}</h2>
            {step.hint && <p className="mt-1 text-sm text-muted-foreground">{step.hint}</p>}
          </div>

          <QuestionStep
            step={step}
            answers={answers}
            setAnswers={setAnswers}
            onAdvance={advance}
          />

          {step.kind !== "intent" && (
            <button
              type="button"
              onClick={() => advance(answers)}
              disabled={!isAnswered(step, answers)}
              className={PRIMARY_BTN}
            >
              {stepIndex === steps.length - 1 ? "Get help" : "Next"}
            </button>
          )}
        </div>
      )}

      {(stage === "submit" || stage === "done") && (
        <div className="space-y-6">
          {crash && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900">
              <p className="font-semibold">If anyone is hurt, call 1990 first.</p>
              <p className="mt-1 text-sm">
                1990 Suwa Seriya is the free ambulance service. We&apos;ll keep arranging the
                tow while you do.
              </p>
            </div>
          )}

          {pipelineError ? (
            <ErrorCard
              title="Couldn't finish your report"
              message={`${pipelineError} Nothing you answered has been lost — retrying picks up where it stopped.`}
              onRetry={() => void run()}
            />
          ) : !settled ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Spinner className="text-primary" />
              {!incidentId
                ? "Filing your report…"
                : !triage
                  ? "Running the diagnosis…"
                  : "Finding the closest provider…"}
            </div>
          ) : (
            <>
              {triage && <TriageCard result={triage} />}
              <DispatchCard result={dispatch} noProviders={noProviders} />
            </>
          )}

          {settled && stage === "submit" && (
            <button type="button" onClick={() => setStage("done")} className={PRIMARY_BTN}>
              Done
            </button>
          )}

          {stage === "done" && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="font-display text-lg font-semibold tracking-tight">
                That&apos;s everything we need
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reference{" "}
                <span className="font-mono text-foreground">{incidentId}</span>. Keep an eye on
                it — the status and the provider&apos;s phone number appear as soon as they
                accept.
              </p>
              <Link href="/app#incidents" className={`mt-4 inline-block ${PRIMARY_BTN}`}>
                Track it in My Kaduna
              </Link>
            </div>
          )}
        </div>
      )}
    </PortalShell>
  );
}

export default function ReportPage() {
  return (
    <RequireAuth>
      <ReportFlow />
    </RequireAuth>
  );
}
