import Link from "next/link";
import { Button } from "@/components/ui/button";
import hotspots from "../../public/data/hotspots.json";
import stats from "../../public/data/stats.json";

/* Static data imported from public/data at build time — fetch() with a
   relative URL is not available inside a server component. */

const byHour = stats.byHour as Record<string, number>;

/* ── Scatter projection (equirectangular, Colombo core frame) ── */
const FRAME = { lngMin: 79.83, lngMax: 80.05, latMin: 6.73, latMax: 6.97 };
const W = 640;
const H = Math.round(
  (W * (FRAME.latMax - FRAME.latMin)) / (FRAME.lngMax - FRAME.lngMin)
);
const PX_PER_M = W / ((FRAME.lngMax - FRAME.lngMin) * 110_000);

const px = (lng: number) =>
  ((lng - FRAME.lngMin) / (FRAME.lngMax - FRAME.lngMin)) * W;
const py = (lat: number) =>
  ((FRAME.latMax - lat) / (FRAME.latMax - FRAME.latMin)) * H;

const inFrame = (h: { lat: number; lng: number }) =>
  h.lng >= FRAME.lngMin && h.lng <= FRAME.lngMax &&
  h.lat >= FRAME.latMin && h.lat <= FRAME.latMax;

const framed = hotspots.filter(inFrame);
const offFrame = hotspots.length - framed.length;
const ranked = [...hotspots].sort((a, b) => b.risk - a.risk);
const top5 = ranked.slice(0, 5);
const rankOf = new Map(ranked.map((h, i) => [h.id, i + 1]));

const scoreColor = (s: number) =>
  s >= 6.5
    ? "var(--priority-critical)"
    : s >= 5.5
      ? "var(--priority-high)"
      : s >= 4.5
        ? "var(--priority-medium)"
        : "var(--priority-low)";

const label = (s: string) => s.replace(/_/g, " ");
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/* 5-factor worked example. Weights and the 3.9 MEDIUM output are the model's
   real values; the per-factor sub-scores are illustrative and reconstruct the
   total exactly: Σ(weight × factor) = 3.90. */
const factors = [
  { name: "capacity_loss", weight: 0.25, value: 4.8 },
  { name: "traffic_volume", weight: 0.25, value: 4.4 },
  { name: "temporal", weight: 0.2, value: 3.5 },
  { name: "location", weight: 0.15, value: 4.0 },
  { name: "incident_severity", weight: 0.15, value: 2.0 },
];

const hours = Array.from({ length: 24 }, (_, h) => ({
  h,
  v: byHour[String(h)] ?? 0,
}));
const peak = hours.reduce((a, b) => (b.v > a.v ? b : a));

const gridLngs = [79.85, 79.9, 79.95, 80.0, 80.05];
const gridLats = [6.75, 6.8, 6.85, 6.9, 6.95];

const steps = [
  {
    n: "1",
    title: "Report the breakdown",
    body: "A stranded driver opens the app. Location comes from the phone; the symptom questionnaire and OBD telemetry, when a dongle is plugged in, come along with it.",
  },
  {
    n: "2",
    title: "Adaptive triage classifies it",
    body: "Answers and telemetry narrow the fault to a service type — tow, mechanic, battery, or fuel — so the request goes out already knowing what kind of help it needs.",
  },
  {
    n: "3",
    title: "The right provider responds",
    body: "Dispatch matches the classified request to a nearby provider of that type, while geo-intelligence scores the incident's traffic impact for the ops view.",
  },
];

const services = [
  {
    name: "Dispatch",
    desc: "Symptom-and-telemetry triage classifies the fault, then matches the request to an available provider of the right service type.",
  },
  {
    name: "Geo-Intelligence",
    desc: "Scores every incident's traffic impact on a 1–10 scale from five weighted factors, and clusters Colombo's history into 25 hotspots.",
  },
  {
    name: "Predictive Maintenance",
    desc: "Reads OBD trip data to track component health and estimate remaining useful life — a warning before the breakdown, not after it.",
  },
  {
    name: "Claims Capture",
    desc: "Guides the driver through photographing the scene so the evidence an insurer needs is captured correctly the first time.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Header ── */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Kaduna<span style={{ color: "var(--priority-high)" }}>.lk</span>
        </Link>
        <nav className="flex items-center gap-2">
          <a
            href="#how"
            className="hidden px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block"
          >
            How it works
          </a>
          <a
            href="#intelligence"
            className="hidden px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block"
          >
            Intelligence
          </a>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Live Dashboard</Link>
          </Button>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24">
        <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground uppercase">
          Colombo · Sri Lanka
        </p>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-[-0.03em] text-balance sm:text-7xl">
          Roadside assistance,{" "}
          <span style={{ color: "var(--priority-high)" }}>
            intelligently dispatched.
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          Kaduna.lk connects stranded drivers with tow trucks, mechanics,
          battery and fuel providers across Colombo — and understands each
          breakdown before help is sent: what went wrong, how urgent it is, and
          what it does to the traffic around it.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/dashboard">Open Live Dashboard</Link>
          </Button>
          <Button asChild variant="ghost" size="lg">
            <a href="#how">How it works ↓</a>
          </Button>
        </div>
        <dl className="mt-14 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-6 border-t border-border pt-6 font-mono text-sm sm:grid-cols-4">
          {[
            [`${stats.totalIncidents}`, "incidents scored*"],
            [`${hotspots.length}`, "hotspot clusters"],
            ["5-factor", "impact model"],
            [hh(peak.h), `peak hour · avg ${peak.v.toFixed(1)}`],
          ].map(([v, k]) => (
            <div key={k}>
              <dt className="sr-only">{k}</dt>
              <dd className="text-2xl text-foreground">{v}</dd>
              <dd className="mt-1 text-xs text-muted-foreground">{k}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 font-mono text-xs text-muted-foreground/70">
          *synthetic incident set generated on real Colombo OSM road geometry
        </p>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground uppercase">
            How it works
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            From breakdown to the right help
          </h2>
          <ol className="mt-12 grid gap-10 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n}>
                <div
                  className="flex size-8 items-center justify-center rounded-full font-mono text-sm"
                  style={{
                    color: "var(--priority-high)",
                    border: "1px solid var(--priority-high)",
                  }}
                >
                  {s.n}
                </div>
                <h3 className="mt-4 text-lg font-medium">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Intelligence showcase ── */}
      <section id="intelligence" className="mx-auto max-w-6xl px-6 py-20">
        <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground uppercase">
          Geo-Intelligence
        </p>
        <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          The platform sees the city.
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Every incident gets a 1–10 traffic-impact score, and the history
          clusters into hotspots. The result is severity triage and hotspot
          awareness for the ops team — the data below is the model&apos;s
          actual output on the modelled incident set.
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          {/* Scatter */}
          <figure className="rounded-lg border border-border bg-card p-4">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Scatter plot of ${framed.length} incident hotspot clusters across Colombo, drawn to geographic scale and colored by average impact score`}
              className="w-full"
            >
              {gridLngs.map((g) => (
                <g key={`lng${g}`}>
                  <line
                    x1={px(g)}
                    y1={0}
                    x2={px(g)}
                    y2={H}
                    stroke="var(--border)"
                  />
                  <text
                    x={px(g) + 4}
                    y={H - 6}
                    fontSize="10"
                    fill="var(--muted-foreground)"
                    fontFamily="var(--font-mono)"
                  >
                    {g.toFixed(2)}°E
                  </text>
                </g>
              ))}
              {gridLats.map((g) => (
                <g key={`lat${g}`}>
                  <line
                    x1={0}
                    y1={py(g)}
                    x2={W}
                    y2={py(g)}
                    stroke="var(--border)"
                  />
                  <text
                    x={6}
                    y={py(g) - 4}
                    fontSize="10"
                    fill="var(--muted-foreground)"
                    fontFamily="var(--font-mono)"
                  >
                    {g.toFixed(2)}°N
                  </text>
                </g>
              ))}
              {framed.map((h) => {
                const c = scoreColor(h.avgScore);
                const r = Math.max(6, h.radiusM * PX_PER_M);
                const rank = rankOf.get(h.id)!;
                return (
                  <g key={h.id}>
                    <circle
                      cx={px(h.lng)}
                      cy={py(h.lat)}
                      r={r}
                      fill={c}
                      fillOpacity="0.14"
                      stroke={c}
                      strokeOpacity="0.55"
                    />
                    <circle cx={px(h.lng)} cy={py(h.lat)} r={3.5} fill={c} />
                    {rank <= 5 && (
                      <text
                        x={px(h.lng) + 7}
                        y={py(h.lat) - 7}
                        fontSize="12"
                        fontWeight="700"
                        fill={c}
                        fontFamily="var(--font-mono)"
                      >
                        #{rank}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
              <span>ring = cluster radius, to scale</span>
              <span className="flex items-center gap-1.5">
                avg score
                {(["low", "medium", "high", "critical"] as const).map((b) => (
                  <span
                    key={b}
                    className="size-2.5 rounded-full"
                    style={{ background: `var(--priority-${b})` }}
                  />
                ))}
              </span>
              {offFrame > 0 && <span>+{offFrame} clusters east of frame</span>}
            </figcaption>
          </figure>

          {/* Ranked hotspots + hourly profile */}
          <div className="flex flex-col gap-8">
            <div>
              <h3 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                Highest-risk clusters
              </h3>
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {top5.map((h, i) => (
                  <li key={h.id} className="flex items-center gap-4 py-3">
                    <span className="font-mono text-sm text-muted-foreground">
                      #{i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize">
                        {label(h.incidentType)} · {h.roadType}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {h.count} incidents · avg {h.avgScore.toFixed(1)} ·
                        peak {hh(h.peakHour)}
                      </p>
                    </div>
                    <span
                      className="font-mono text-sm"
                      style={{ color: scoreColor(h.avgScore) }}
                    >
                      {h.risk.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 font-mono text-xs text-muted-foreground/70">
                risk = incident count × avg impact score
              </p>
            </div>

            <div>
              <h3 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                Avg impact by hour
              </h3>
              <div
                className="mt-3 flex h-20 items-end gap-[3px]"
                role="img"
                aria-label={`Average impact score by hour of day, peaking at ${hh(peak.h)} with ${peak.v.toFixed(1)}`}
              >
                {hours.map(({ h, v }) => (
                  <div
                    key={h}
                    className="flex-1 rounded-t-xs"
                    style={{
                      height: `${(v / 7.5) * 100}%`,
                      background:
                        h === peak.h
                          ? "var(--priority-high)"
                          : "var(--secondary)",
                    }}
                  />
                ))}
              </div>
              <div className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
              </div>
            </div>
          </div>
        </div>

        {/* Worked example */}
        <div className="mt-12 rounded-lg border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h3 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                One score, worked
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Flat tire on a secondary road, mid-afternoon. Five weighted
                factors, one number.
              </p>
            </div>
            <p className="font-mono text-sm">
              <span className="text-3xl" style={{ color: "var(--priority-medium)" }}>
                3.9
              </span>{" "}
              <span className="text-muted-foreground">/ 10 ·</span>{" "}
              <span style={{ color: "var(--priority-medium)" }}>MEDIUM</span>
            </p>
          </div>
          <div className="mt-6 space-y-3 font-mono text-xs sm:text-sm">
            {factors.map((f) => (
              <div key={f.name} className="grid grid-cols-[10rem_1fr_5.5rem] items-center gap-3 sm:grid-cols-[13rem_1fr_6rem]">
                <span className="truncate text-muted-foreground">
                  {f.name}{" "}
                  <span className="text-muted-foreground/60">× {f.weight}</span>
                </span>
                <div className="h-2 rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${f.value * 10}%`,
                      background: "var(--priority-medium)",
                      opacity: 0.45 + f.weight,
                    }}
                  />
                </div>
                <span className="text-right">
                  {f.value.toFixed(1)} → {(f.value * f.weight).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="grid grid-cols-[10rem_1fr_5.5rem] gap-3 border-t border-border pt-3 sm:grid-cols-[13rem_1fr_6rem]">
              <span className="text-muted-foreground">Σ weighted</span>
              <span />
              <span className="text-right font-semibold">3.90</span>
            </div>
          </div>
          <p className="mt-4 font-mono text-xs text-muted-foreground/70">
            Weights and the 3.9 MEDIUM output are the deployed model&apos;s;
            per-factor sub-scores shown are illustrative.
          </p>
        </div>
      </section>

      {/* ── Components ── */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="font-mono text-xs tracking-[0.25em] text-muted-foreground uppercase">
            The platform
          </p>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Four services, one spine
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {services.map((s) => (
              <div
                key={s.name}
                className="rounded-lg border border-border bg-card p-6"
              >
                <h3 className="font-medium">{s.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 font-mono text-xs text-muted-foreground">
          <p>R26-SE-026 · SLIIT · team Kaduna.lk</p>
          <a
            href="https://github.com/JanukshanS/R26-SE-026"
            className="hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            github.com/JanukshanS/R26-SE-026
          </a>
        </div>
      </footer>
    </div>
  );
}
