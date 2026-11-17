"use client";

/**
 * Request roadside help, right on the home page (#get-help). The whole flow
 * that used to live on /report, in the landing design:
 *
 *   what happened → (accident: emergency numbers, then a tow)
 *   → the problem (the triage's first question)
 *   → where you are and which car (signing in here if needed)
 *   → the follow-up questions the triage needs
 *   → file it, triage it, send the nearest provider → who's coming
 *
 * Same services and question model as before (lib/dispatchApi,
 * lib/triageFlow), and the same translated wording (report.*, triage.*).
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
  LockKeyhole,
  OctagonAlert,
  Settings2,
  Thermometer,
  TriangleAlert,
  WavesHorizontal,
  Zap,
  type LucideIcon,
} from "lucide-react";

import LocationPicker, { type Coords } from "@/components/LocationPicker";
import { useAuth } from "@/lib/auth";
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
import { useT, type Translate } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
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

import { I } from "./icons";
import { APK, EMERGENCY } from "./LandingShell";

const ICONS: Record<string, LucideIcon> = {
  BatteryWarning, CircleDot, CircleOff, CircleQuestionMark, CircleSlash2, CircleStop, Cog, Disc, Droplet, Droplets,
  Flame, Fuel, KeyRound, Lightbulb, LockKeyhole, OctagonAlert, Settings2, Thermometer, TriangleAlert, WavesHorizontal, Zap,
};
const TINT: Record<string, string> = { Disc: "t-rose", Fuel: "t-green", LockKeyhole: "t-violet", KeyRound: "t-violet", Droplets: "t-blue", Zap: "t-amber", Lightbulb: "t-amber", WavesHorizontal: "t-blue", Flame: "t-rose", CircleOff: "t-amber", Cog: "t-orange", CircleStop: "t-rose", Settings2: "t-blue", CircleQuestionMark: "t-violet" };
const FUEL_TYPES = ["PETROL", "DIESEL", "HYBRID", "ELECTRIC"];
const SAVED = "kl.help";

type Screen = "choose" | "accident" | "intent" | "where" | "questions" | "sending" | "done";

/** Where each screen sits on the progress bar (problem, location, questions, help sent). */
const STAGE: Record<Screen, number> = { choose: 0, accident: 1, intent: 1, where: 2, questions: 3, sending: 3, done: 4 };

function describe(err: unknown, t: Translate): string {
  if (err instanceof DispatchApiError) return err.status === 401 ? t("report.error.sessionExpired") : t("report.error.http", { message: err.message, status: err.status });
  return err instanceof Error ? err.message : String(err);
}

function Glyph({ name }: { name: string }) {
  const G = ICONS[name] ?? TriangleAlert;
  return <G className="ico" aria-hidden />;
}

export default function HelpFlow() {
  const t = useT();
  const { session, loading: authLoading } = useAuth();
  const [screen, setScreen] = useState<Screen>("choose");
  const [history, setHistory] = useState<Screen[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [qIndex, setQIndex] = useState(1);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [plate, setPlate] = useState("");
  const [description, setDescription] = useState("");

  const go = useCallback((next: Screen) => {
    setHistory((h) => [...h, screen]);
    setScreen(next);
  }, [screen]);

  const back = () => {
    if (screen === "questions" && qIndex > 1) {
      setQIndex(qIndex - 1);
      return;
    }
    const h = [...history];
    setScreen(h.pop() ?? "choose");
    setHistory(h);
  };

  // The hero's buttons open the flow on a given step.
  useEffect(() => {
    const open = (e: Event) => {
      const step = (e as CustomEvent<string>).detail;
      setHistory(["choose"]);
      setScreen(step === "accident" ? "accident" : "intent");
    };
    window.addEventListener("kl-help", open);
    return () => window.removeEventListener("kl-help", open);
  }, []);

  // Coming back from signing in with Google: pick up where the driver was.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SAVED);
      if (!raw) return;
      sessionStorage.removeItem(SAVED);
      const s = JSON.parse(raw) as { intent?: string; description?: string };
      if (s.intent) {
        setAnswers(answer(EMPTY_ANSWERS, "Q1_intent", s.intent));
        setDescription(s.description ?? "");
        setHistory(["choose", "intent"]);
        setScreen("where");
      }
    } catch {
      /* nothing saved, or storage blocked */
    }
  }, []);

  useEffect(() => {
    if (screen !== "choose") box.current?.querySelector<HTMLElement>(".scr:not([hidden]) h3")?.focus({ preventScroll: true });
  }, [screen, qIndex]);

  // The driver's cars, once signed in.
  const loadVehicles = useCallback(() => {
    setVehiclesError(null);
    listVehicles().then(
      (vs) => {
        setVehicles(vs);
        setVehicleId((cur) => cur ?? (vs.find((v) => v.isDefault) ?? vs[0])?.id ?? null);
      },
      (err) => setVehiclesError(describe(err, t))
    );
  }, [t]);
  useEffect(() => {
    if (session) loadVehicles();
  }, [session, loadVehicles]);

  const pickIntent = (value: string) => {
    setAnswers(answer(EMPTY_ANSWERS, "Q1_intent", value));
    setQIndex(1);
    go("where");
  };

  /** After the location: the follow-up questions, or straight to sending for a fast-path problem. */
  const afterWhere = () => {
    const steps = flowSteps(answers);
    if (isFastIntent(answers.Q1_intent) || steps.length <= 1) go("sending");
    else {
      setQIndex(1);
      go("questions");
    }
  };

  const advance = (from: Answers) => {
    const steps = flowSteps(from);
    const current = flowSteps(answers)[qIndex];
    const here = steps.findIndex((s) => s.key === current?.key);
    if (here < 0 || here >= steps.length - 1) go("sending");
    else setQIndex(here + 1);
  };

  // ── File it, triage it, dispatch. Refs let a retry resume, not duplicate. ──
  const incidentRef = useRef<string | null>(null);
  const triagedRef = useRef(false);
  const busyRef = useRef(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [dispatch, setDispatch] = useState<DispatchResultData | null>(null);
  const [noProviders, setNoProviders] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const selected = vehicles?.find((v) => v.id === vehicleId) ?? null;

  const run = useCallback(async () => {
    if (busyRef.current || !coords) return;
    busyRef.current = true;
    setPipelineError(null);
    try {
      let id = incidentRef.current;
      if (!id) {
        const fuel = selected?.fuelType?.toUpperCase();
        const vehicleInfo: VehicleInfo = selected
          ? { make: selected.make, model: selected.model, year: selected.year, fuelType: FUEL_TYPES.includes(fuel ?? "") ? (fuel as VehicleInfo["fuelType"]) : undefined, registrationNumber: selected.plateNumber }
          : { registrationNumber: plate.trim().toUpperCase() };
        const incident = await createIncident({ location: coords, vehicleInfo, description: description.trim() || "Roadside assistance requested via kaduna.lk" });
        id = incident.id;
        incidentRef.current = id;
        setIncidentId(id);
      }
      if (!triagedRef.current) {
        const result = await submitTriage({ incidentId: id, responses: buildTriageResponses(answers) });
        triagedRef.current = true;
        setTriage(result.result);
      }
      try {
        setDispatch(await runDispatch({ incidentId: id }));
      } catch (err) {
        // "No available providers" is an outcome: the request and its diagnosis are filed either way.
        if (err instanceof DispatchApiError && err.status === 404 && err.message.toLowerCase().includes("provider")) setNoProviders(true);
        else throw err;
      }
      setScreen("done");
    } catch (err) {
      setPipelineError(describe(err, t));
    } finally {
      busyRef.current = false;
    }
  }, [answers, coords, description, plate, selected, t]);

  useEffect(() => {
    if (screen === "sending") void run();
    // Only entering the screen starts it; retries call run() directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const restart = () => {
    incidentRef.current = null;
    triagedRef.current = false;
    setIncidentId(null);
    setTriage(null);
    setDispatch(null);
    setNoProviders(false);
    setPipelineError(null);
    setAnswers(EMPTY_ANSWERS);
    setDescription("");
    setCoords(null);
    setHistory([]);
    setScreen("choose");
  };

  const intent = [...FAST_TILES, ...ML_TILES].find((x) => x.value === answers.Q1_intent);
  const steps = flowSteps(answers);
  const step = steps[Math.min(qIndex, steps.length - 1)];
  const canGoBack = history.length > 0 && screen !== "sending" && screen !== "done";

  return (
    <section className="help" id="get-help" aria-labelledby="help-title">
      <div className="wrap">
        <div className="section-head center">
          <span className="eyebrow">{t("home.help.eyebrow")}</span>
          <h2 id="help-title">{t("home.help.title")}</h2>
          <p>{t("home.help.lead")}</p>
        </div>

        <div className="wiz" ref={box}>
          <div className="wiz-top">
            {canGoBack && <button className="wiz-back" type="button" onClick={back}><I n="arrow" />{t("home.help.back")}</button>}
            {screen !== "choose" && (
              <div className="prog-s" aria-hidden="true">
                {["problem", "where", "questions", "send"].map((k, i) => (
                  <div key={k}><i className={i < STAGE[screen] ? "on" : ""} /><span>{t(`home.flow.stage.${k}`)}</span></div>
                ))}
              </div>
            )}
            <span className="online">{t("home.flow.online")}</span>
          </div>

          {/* What happened */}
          <div className="scr" hidden={screen !== "choose"}>
            <header><h3 tabIndex={-1}>{t("home.help.what")}</h3></header>
            <div className="big2">
              <button className="bigbtn bd" type="button" onClick={() => go("intent")}>
                <span className="bi"><I n="car" /></span>
                <span><b>{t("home.help.breakdown")}</b><small>{t("home.help.breakdownSub")}</small></span>
                <span className="go"><I n="arrow" /></span>
              </button>
              <button className="bigbtn ac" type="button" onClick={() => go("accident")}>
                <span className="bi"><I n="alert" /></span>
                <span><b>{t("home.help.accident")}</b><small>{t("home.help.accidentSub")}</small></span>
                <span className="go"><I n="arrow" /></span>
              </button>
            </div>
            <p className="choose-foot">{t("home.help.notSure")}</p>
          </div>

          {/* Accident: people first */}
          <div className="scr" hidden={screen !== "accident"}>
            <header><h3 tabIndex={-1}>{t("home.help.hurt")}</h3><p>{t("home.help.hurtSub")}</p></header>
            <div className="sosgrid">
              {EMERGENCY.map((e) => (
                <a key={e.n} className="sosn" href={`tel:${e.n}`}>
                  <span className="num">{e.n}</span><b>{t(`home.sos.${e.key}`)}</b><small>{t(`home.sos.${e.key}Note`)}</small>
                  <span className="cl"><I n="phone" />{t("home.help.call", { n: e.n })}</span>
                </a>
              ))}
            </div>
            <div className="safe">
              <span><b>{t("home.help.safe")}</b><small>{t("home.help.safeSub")}</small></span>
              <button className="btn btn-primary" type="button" onClick={() => pickIntent("MAJOR_CRASH")}>{t("home.help.requestTow")} <I n="arrow" /></button>
            </div>
          </div>

          {/* The problem = the triage's first question */}
          <div className="scr" hidden={screen !== "intent"}>
            <header><h3 tabIndex={-1}>{t("home.help.problem")}</h3><p>{t("home.help.problemSub")}</p></header>
            <div className="ptiles">
              {FAST_TILES.filter((x) => x.value !== "MAJOR_CRASH").map((x) => <IntentButton key={x.value} tile={x} onPick={pickIntent} />)}
            </div>
            <div className="unsure">
              <h4>{t("report.intent.unsureTitle")}</h4>
              <p>{t("report.intent.unsureBody")}</p>
            </div>
            <div className="ptiles">
              {ML_TILES.map((x) => <IntentButton key={x.value} tile={x} onPick={pickIntent} />)}
            </div>
          </div>

          {/* Where, and which car */}
          <div className="scr" hidden={screen !== "where"}>
            <header>
              <h3 tabIndex={-1}>{t("home.flow.whereTitle")}</h3>
              {intent && <span className="chosen"><span>{t(intent.labelKey)}</span><button type="button" onClick={() => setScreen(answers.Q1_intent === "MAJOR_CRASH" ? "accident" : "intent")}>{t("home.help.change")}</button></span>}
            </header>
            {authLoading ? (
              <p className="fine">{t("home.dir.loading")}</p>
            ) : !session ? (
              <InlineSignIn intent={answers.Q1_intent} description={description} />
            ) : (
              <WhereForm
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
                onNext={afterWhere}
                willAsk={!isFastIntent(answers.Q1_intent) && steps.length > 1}
              />
            )}
          </div>

          {/* Follow-up questions */}
          <div className="scr" hidden={screen !== "questions"}>
            {screen === "questions" && step && (
              <>
                <header>
                  <span className="qcount">{t("report.question.stepCounter", { topic: t(step.titleKey), index: qIndex, total: steps.length - 1 })}</span>
                  <h3 tabIndex={-1}>{t(step.promptKey)}</h3>
                  {step.hintKey && <p>{t(step.hintKey)}</p>}
                </header>
                <Question step={step} answers={answers} setAnswers={setAnswers} />
                <div className="qfoot">
                  <button className="btn btn-primary send" type="button" disabled={!isAnswered(step, answers)} onClick={() => advance(answers)}>
                    {qIndex >= steps.length - 1 ? t("report.action.getHelp") : t("report.action.next")} <I n="arrow" />
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Sending */}
          <div className="scr" hidden={screen !== "sending"}>
            <header>
              <h3 tabIndex={-1}>{pipelineError ? t("report.pipeline.failedTitle") : t("home.flow.sendingTitle")}</h3>
              <p>{pipelineError ? t("report.pipeline.failedBody", { message: pipelineError }) : t("home.flow.sendingBody")}</p>
            </header>
            <ol className="handoff">
              {[
                { done: !!incidentId, label: t("report.pipeline.filing"), icon: "file" as const },
                { done: !!triage, label: t("report.pipeline.diagnosing"), icon: "spark" as const },
                { done: false, label: t("report.pipeline.matching"), icon: "truck" as const },
              ].map((s, i, all) => {
                const next = !s.done && (i === 0 || all[i - 1].done);
                const state = s.done ? "done" : !next ? "" : pipelineError ? "fail" : "now";
                return (
                  <li key={s.label} className={state}>
                    <span className="hn">{s.done ? <I n="check" /> : state === "fail" ? <I n="alert" /> : <I n={s.icon} />}</span>
                    <span><b>{s.label}</b></span>
                  </li>
                );
              })}
            </ol>
            {pipelineError && <div className="wfields"><button className="btn btn-primary send" type="button" onClick={() => void run()}>{t("report.action.retry")}</button></div>}
          </div>

          {/* Who's coming */}
          <div className="scr done" hidden={screen !== "done"} aria-live="polite">
            {screen === "done" && (
              <>
                <span className={`okb ${noProviders ? "wait" : ""}`}>{noProviders ? <I n="clock" /> : <I n="check" />}</span>
                <header>
                  <h3 tabIndex={-1}>{noProviders ? t("report.dispatch.noneTitle") : t("home.flow.doneTitle")}</h3>
                  <p>{noProviders ? t("report.dispatch.noneBody") : t("home.flow.doneBody")}</p>
                </header>
                {answers.Q1_intent === "MAJOR_CRASH" && <p className="crash"><b>{t("report.crash.title")}</b> {t("report.crash.body")}</p>}
                {dispatch && (
                  <div className="dprov">
                    <span className="av" style={{ background: "linear-gradient(140deg,#ff9a5c,#e8601c)" }}><I n="truck" /></span>
                    <span>
                      <b>{dispatch.selectedProvider.name}</b>
                      <small>{providerTypeLabel(dispatch.selectedProvider.type)} · {t("report.dispatch.providersEvaluated", { count: dispatch.metadata.providersEvaluated })}</small>
                    </span>
                    <span className="eta3">{Math.round(dispatch.selectedProvider.estimatedTravelTimeMin)}<small>{t("home.flow.minAway")}</small></span>
                  </div>
                )}
                {triage && (
                  <div className="diag">
                    <span className="lbl">{t("report.triage.heading")}</span>
                    <b>{enumLabel(triage.predictedServiceType)}</b>
                    <span className="bar"><i style={{ width: `${Math.round(triage.confidence * 100)}%` }} /></span>
                    <small>{t("report.triage.confidence", { percent: Math.round(triage.confidence * 100) })}</small>
                  </div>
                )}
                <div className="dact">
                  <button className="btn btn-ghost" type="button" onClick={restart}>{t("home.flow.another")}</button>
                  <Link className="btn btn-primary" href="/app#requests">{t("home.flow.follow")} <I n="arrow" /></Link>
                </div>
                {incidentId && <p className="fine">{t("home.flow.reference", { ref: incidentId.slice(0, 8).toUpperCase() })}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function IntentButton({ tile, onPick }: { tile: IntentTile; onPick: (v: string) => void }) {
  const t = useT();
  return (
    <button className={`ptile ${tile.urgent ? "urgent" : ""}`} type="button" onClick={() => onPick(tile.value)}>
      <span className={`pi ${tile.urgent ? "t-rose" : TINT[tile.icon] ?? "t-orange"}`}><Glyph name={tile.icon} /></span>
      <span>{t(tile.labelKey)}</span>
    </button>
  );
}

// ─── Signing in without leaving the page ────────────────────────────────

function InlineSignIn({ intent, description }: { intent: string | null; description: string }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remember = () => {
    try {
      sessionStorage.setItem(SAVED, JSON.stringify({ intent, description }));
    } catch {
      /* storage blocked: they'll pick the problem again */
    }
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message);
    setBusy(false);
  }

  async function google() {
    setBusy(true);
    setError(null);
    remember();
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/#get-help` } });
    if (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="wfields" onSubmit={submit}>
      <p className="fine signin-why">{t("home.flow.signInWhy")}</p>
      <button className="gps" type="button" onClick={google} disabled={busy}>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z" />
          <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.09A12 12 0 0 0 12 24Z" />
          <path fill="#FBBC05" d="M5.29 14.29a7.22 7.22 0 0 1 0-4.58V6.62H1.29a12 12 0 0 0 0 10.76l4-3.09Z" />
          <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l4 3.09C6.23 6.88 8.88 4.77 12 4.77Z" />
        </svg>
        {t("home.flow.google")}
      </button>
      <div className="or">{t("signin.or")}</div>
      <label className="inp"><I n="mail" /><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("signin.emailLabel")} aria-label={t("signin.emailLabel")} /></label>
      <label className="inp"><I n="key" /><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("signin.passwordLabel")} aria-label={t("signin.passwordLabel")} /></label>
      {error && <span className="msg bad" role="alert">{error}</span>}
      <button className="btn btn-primary send" type="submit" disabled={busy}>{busy ? t("signin.submitting") : t("home.flow.signInContinue")} <I n="arrow" /></button>
      <p className="fine">{t("home.flow.noAccount")} <a href={APK} download>{t("home.help.orApp")}</a></p>
    </form>
  );
}

// ─── Where and which car ─────────────────────────────────────────────────

function WhereForm(p: {
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
  willAsk: boolean;
}) {
  const t = useT();
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const noVehicles = p.vehicles?.length === 0;
  const ready = !!p.coords && (noVehicles ? p.plate.trim().length > 0 : !!p.vehicleId);

  const locate = () => {
    if (!navigator.geolocation) {
      setGeoError(t("report.where.geoUnsupported"));
      return;
    }
    setGeoError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        p.setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setGeoError(err.code === err.PERMISSION_DENIED ? t("report.where.geoDenied") : t("report.where.geoFailed", { message: err.message }));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  };

  return (
    <div className="wfields wide">
      <button className="gps" type="button" onClick={locate} disabled={locating}><I n="target" />{locating ? t("report.where.locating") : t("report.where.useMyLocation")}</button>
      {geoError && <span className="msg bad" role="status">{geoError}</span>}
      <div className="or">{t("home.flow.orPin")}</div>
      <div className="mapbox"><LocationPicker value={p.coords} onChange={p.setCoords} /></div>

      <span className="fl">{t("report.vehicle.title")}</span>
      {p.vehiclesError ? (
        <span className="msg bad">{p.vehiclesError} <button type="button" className="linkbtn" onClick={p.reloadVehicles}>{t("report.action.retry")}</button></span>
      ) : !p.vehicles ? (
        <span className="msg">{t("report.vehicle.loading")}</span>
      ) : noVehicles ? (
        <>
          <span className="msg">{t("report.vehicle.noneBody")}</span>
          <label className="inp"><I n="car" /><input value={p.plate} onChange={(e) => p.setPlate(e.target.value)} placeholder="CBD-3742" aria-label={t("report.vehicle.plateLabel")} style={{ textTransform: "uppercase" }} /></label>
        </>
      ) : (
        <div className="cars" role="radiogroup" aria-label={t("report.vehicle.groupLabel")}>
          {p.vehicles.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={p.vehicleId === v.id} className={`carpick ${p.vehicleId === v.id ? "on" : ""}`} onClick={() => p.setVehicleId(v.id)}>
              <I n="car" />
              <span><b>{vehicleTitle(v)}</b><small>{[v.plateNumber, v.color, v.fuelType].filter(Boolean).join(" · ")}</small></span>
              <span className="tick">{p.vehicleId === v.id && <Check className="ico" />}</span>
            </button>
          ))}
        </div>
      )}

      <span className="fl">{t("report.notes.title")} <small>{t("report.notes.optional")}</small></span>
      <label className="inp ta"><textarea rows={3} value={p.description} onChange={(e) => p.setDescription(e.target.value.slice(0, 500))} placeholder={t("report.notes.placeholder")} /></label>

      <button className="btn btn-primary send" type="button" disabled={!ready} onClick={p.onNext}>
        {p.willAsk ? t("home.flow.nextQuestions") : t("report.action.getHelp")} <I n="arrow" />
      </button>
      {!ready && <p className="fine">{!p.coords ? t("report.where.needLocation") : noVehicles ? t("report.vehicle.needPlate") : t("report.vehicle.needVehicle")}</p>}
    </div>
  );
}

// ─── One follow-up question ──────────────────────────────────────────────

function Question({ step, answers, setAnswers }: { step: Step; answers: Answers; setAnswers: (a: Answers) => void }) {
  const t = useT();

  if (step.kind === "lights") {
    const on = answers.Q5_lights;
    return (
      <div className="lamps">
        {LIGHT_TILES.map((lamp) => (
          <button key={lamp.id} type="button" role="checkbox" aria-checked={on.includes(lamp.id)} className={`lamp ${on.includes(lamp.id) ? "on" : ""}`} onClick={() => setAnswers({ ...answers, Q5_lights: toggle(on, lamp.id) })}>
            <Glyph name={lamp.icon} />
            {t(lamp.labelKey)}
          </button>
        ))}
      </div>
    );
  }

  if (step.kind === "context") {
    return (
      <div className="ctx">
        {step.groups!.map((g) => (
          <div key={g.key}>
            <span className="fl">{t(g.labelKey)}</span>
            <div className="fchips">
              {g.options.map((o) => (
                <button key={o.value} type="button" className="fchip" aria-pressed={answers.context[g.key] === o.value} onClick={() => setAnswers({ ...answers, context: { ...answers.context, [g.key]: o.value } as SLContext })}>
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const multi = step.kind === "multi";
  const picked = (v: string) => (multi ? (answers[step.key] as string[]).includes(v) : answers[step.key] === v);
  return (
    <div className="opts" role={multi ? "group" : "radiogroup"} aria-label={t(step.promptKey)}>
      {step.options!.map((o) => (
        <button
          key={o.value}
          type="button"
          role={multi ? "checkbox" : "radio"}
          aria-checked={picked(o.value)}
          className={`opt2 ${picked(o.value) ? "on" : ""} ${o.tone ?? ""}`}
          onClick={() => setAnswers(multi ? { ...answers, [step.key]: toggle(answers[step.key] as string[], o.value) } : answer(answers, step.key, o.value))}
        >
          <span><b>{t(o.titleKey)}</b>{o.descriptionKey && <small>{t(o.descriptionKey)}</small>}</span>
          <span className="tick">{picked(o.value) && <Check className="ico" />}</span>
        </button>
      ))}
    </div>
  );
}
