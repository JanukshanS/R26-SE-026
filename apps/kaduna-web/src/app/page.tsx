"use client";

import Link from "next/link";
import {
  BatteryCharging,
  Camera,
  Download,
  Fuel,
  Truck,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import LanguagePicker from "@/components/LanguagePicker";
import SignInLink from "@/components/SignInLink";
import { useT } from "@/lib/i18n";
import hotspots from "../../public/data/hotspots.json";

/* Static data imported from public/data at build time — fetch() with a
   relative URL is not available inside a server component. */

/* ── Hotspot map projection (equirectangular, Colombo core frame) ── */
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
const ranked = [...hotspots].sort((a, b) => b.avgScore - a.avgScore);
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

const gridLngs = [79.85, 79.9, 79.95, 80.0];
const gridLats = [6.75, 6.8, 6.85, 6.9, 6.95];

const APK = "/downloads/kaduna-beta.apk";

const services = [
  {
    icon: Truck,
    nameKey: "landing.services.towingName",
    descKey: "landing.services.towingDesc",
  },
  {
    icon: Wrench,
    nameKey: "landing.services.mechanicName",
    descKey: "landing.services.mechanicDesc",
  },
  {
    icon: BatteryCharging,
    nameKey: "landing.services.batteryName",
    descKey: "landing.services.batteryDesc",
  },
  {
    icon: Fuel,
    nameKey: "landing.services.fuelName",
    descKey: "landing.services.fuelDesc",
  },
  {
    icon: Camera,
    nameKey: "landing.services.claimName",
    descKey: "landing.services.claimDesc",
  },
];

const steps = [
  {
    n: "1",
    titleKey: "landing.how.step1Title",
    bodyKey: "landing.how.step1Body",
  },
  {
    n: "2",
    titleKey: "landing.how.step2Title",
    bodyKey: "landing.how.step2Body",
  },
  {
    n: "3",
    titleKey: "landing.how.step3Title",
    bodyKey: "landing.how.step3Body",
  },
];

const providerPoints = [
  {
    titleKey: "landing.providers.point1Title",
    bodyKey: "landing.providers.point1Body",
  },
  {
    titleKey: "landing.providers.point2Title",
    bodyKey: "landing.providers.point2Body",
  },
  {
    titleKey: "landing.providers.point3Title",
    bodyKey: "landing.providers.point3Body",
  },
];

const scoreBands = [
  {
    name: "low",
    labelKey: "landing.tech.scoreBandLow",
    color: "var(--priority-low)",
  },
  {
    name: "medium",
    labelKey: "landing.tech.scoreBandMedium",
    color: "var(--priority-medium)",
  },
  {
    name: "high",
    labelKey: "landing.tech.scoreBandHigh",
    color: "var(--priority-high)",
  },
  {
    name: "critical",
    labelKey: "landing.tech.scoreBandCritical",
    color: "var(--priority-critical)",
  },
];

export default function LandingPage() {
  const t = useT();

  return (
    <div className="min-h-screen bg-background text-foreground [--radius:0.9rem]">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="font-display text-xl font-bold tracking-tight"
          >
            Kaduna<span className="text-primary">.lk</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a
              href="#how"
              className="hidden px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {t("landing.nav.how")}
            </a>
            <a
              href="#providers"
              className="hidden px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {t("landing.nav.providers")}
            </a>
            <a
              href="#technology"
              className="hidden px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block"
            >
              {t("landing.nav.technology")}
            </a>
            <LanguagePicker className="ml-1" />
            <SignInLink className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground" />
            <Button asChild size="sm" className="ml-2">
              <a href="#download">{t("landing.nav.getApp")}</a>
            </Button>
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <svg
          viewBox="0 0 520 560"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 -right-16 hidden h-full w-auto lg:block"
        >
          <path
            d="M60 600 C 150 440, 60 340, 200 265 S 420 185, 450 110"
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity="0.07"
            strokeWidth="52"
            strokeLinecap="round"
          />
          <path
            d="M60 600 C 150 440, 60 340, 200 265 S 420 185, 450 110"
            fill="none"
            stroke="var(--primary)"
            strokeOpacity="0.55"
            strokeWidth="3.5"
            strokeDasharray="16 20"
          />
          <circle cx="450" cy="110" r="13" fill="var(--primary)" />
          <circle cx="450" cy="110" r="4.5" fill="var(--primary-foreground)" />
        </svg>

        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-24 sm:pt-28">
          <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
            {t("landing.hero.eyebrow")}
          </p>
          <h1 className="font-display mt-6 max-w-3xl text-5xl leading-[1.02] font-bold tracking-[-0.02em] text-balance sm:text-7xl">
            {t("landing.hero.title")}{" "}
            <span className="text-primary">{t("landing.hero.titleHighlight")}</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t("landing.hero.subtitle")}
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Button asChild size="lg" className="h-12 px-6 text-base">
              <a href={APK} download>
                <Download data-icon="inline-start" />
                {t("landing.download.cta")}
              </a>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="lg"
              className="h-12 px-5 text-base"
            >
              <a href="#how">{t("landing.hero.howLink")}</a>
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("landing.download.meta")}
          </p>
        </div>
      </section>

      {/* ── Services ── */}
      <section className="border-y border-border bg-secondary/60">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="font-display max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            {t("landing.services.title")}
          </h2>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {services.map((s) => (
              <div
                key={s.nameKey}
                className="rounded-xl border border-border bg-card p-5"
              >
                <s.icon className="size-6 text-primary" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{t(s.nameKey)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {t(s.descKey)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
            {t("landing.how.eyebrow")}
          </p>
          <h2 className="font-display mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            {t("landing.how.title")}
          </h2>
          <ol className="mt-14 grid gap-12 sm:grid-cols-3">
            {steps.map((s) => (
              <li key={s.n}>
                <span className="font-display flex size-10 items-center justify-center rounded-full border-2 border-primary text-lg font-bold text-primary">
                  {s.n}
                </span>
                <h3 className="mt-5 text-lg font-semibold">{t(s.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t(s.bodyKey)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Technology (the one dark band) ── */}
      <section
        id="technology"
        className="dark scroll-mt-16 bg-background text-foreground"
      >
        <div className="mx-auto max-w-6xl px-6 py-24">
          <p
            className="text-sm font-medium tracking-[0.18em] uppercase"
            style={{ color: "var(--priority-high)" }}
          >
            {t("landing.tech.eyebrow")}
          </p>
          <h2 className="font-display mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            {t("landing.tech.title")}
          </h2>
          <p className="mt-5 max-w-2xl leading-relaxed text-muted-foreground">
            {t("landing.tech.body")}
          </p>

          <div className="mt-14 grid gap-10 lg:grid-cols-[1.25fr_1fr]">
            {/* Hotspot map */}
            <figure className="rounded-xl border border-border bg-card p-4">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                role="img"
                aria-label={t("landing.tech.mapA11y", { count: hotspots.length })}
                className="w-full"
              >
                {gridLngs.map((g) => (
                  <line
                    key={`lng${g}`}
                    x1={px(g)}
                    y1={0}
                    x2={px(g)}
                    y2={H}
                    stroke="var(--border)"
                  />
                ))}
                {gridLats.map((g) => (
                  <line
                    key={`lat${g}`}
                    x1={0}
                    y1={py(g)}
                    x2={W}
                    y2={py(g)}
                    stroke="var(--border)"
                  />
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
                        className={rank <= 5 ? "hotspot-pulse" : undefined}
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
              <figcaption className="mt-3 font-mono text-xs text-muted-foreground">
                {t("landing.tech.mapCaption", { count: hotspots.length })}
              </figcaption>
            </figure>

            {/* Impact scale + top clusters */}
            <div className="flex flex-col gap-10">
              <div>
                <h3 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                  {t("landing.tech.scaleHeading")}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t("landing.tech.scaleBody")}
                </p>
                <div className="mt-4 flex h-2.5 overflow-hidden rounded-full">
                  {scoreBands.map((b) => (
                    <div
                      key={b.name}
                      className="flex-1"
                      style={{ background: b.color }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between font-mono text-xs">
                  {scoreBands.map((b) => (
                    <span key={b.name} style={{ color: b.color }}>
                      {t(b.labelKey)}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
                  {t("landing.tech.clustersHeading")}
                </h3>
                <ul className="mt-3 divide-y divide-border border-y border-border">
                  {top5.map((h, i) => (
                    <li key={h.id} className="flex items-center gap-4 py-3">
                      <span className="font-mono text-sm text-muted-foreground">
                        #{i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium capitalize">
                          {t("landing.tech.clusterRow", {
                            incident: label(h.incidentType),
                            roadType: h.roadType,
                          })}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {t("landing.tech.peaksAround", { time: hh(h.peakHour) })}
                        </p>
                      </div>
                      <span
                        className="font-mono text-sm font-semibold"
                        style={{ color: scoreColor(h.avgScore) }}
                      >
                        {h.avgScore.toFixed(1)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-mono text-xs text-muted-foreground/70">
                  {t("landing.tech.clustersCaption")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── For providers ── */}
      <section id="providers" className="scroll-mt-16">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="text-sm font-medium tracking-[0.18em] text-primary uppercase">
                {t("landing.providers.eyebrow")}
              </p>
              <h2 className="font-display mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
                {t("landing.providers.title")}
              </h2>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Button asChild size="lg" className="h-12 px-6 text-base">
                  <a href="#download">{t("landing.providers.cta")}</a>
                </Button>
              </div>
              <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                {t("landing.providers.note")}
              </p>
            </div>
            <ul className="flex flex-col justify-center gap-8">
              {providerPoints.map((p) => (
                <li key={p.titleKey} className="border-l-2 border-primary pl-5">
                  <h3 className="font-semibold">{t(p.titleKey)}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {t(p.bodyKey)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Download strip ── */}
      <section
        id="download"
        className="scroll-mt-16 border-y border-border bg-accent/60"
      >
        <div className="mx-auto flex max-w-6xl flex-col items-center px-6 py-16 text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {t("landing.download.title")}
          </h2>
          <p className="mt-3 max-w-md text-muted-foreground">
            {t("landing.download.body")}
          </p>
          <Button asChild size="lg" className="mt-7 h-12 px-6 text-base">
            <a href={APK} download>
              <Download data-icon="inline-start" />
              {t("landing.download.cta")}
            </a>
          </Button>
          <p className="mt-3 text-sm text-muted-foreground">
            {t("landing.download.meta")}
          </p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer>
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <p className="font-display text-lg font-bold tracking-tight">
                Kaduna<span className="text-primary">.lk</span>
              </p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                {t("landing.footer.tagline")}
              </p>
            </div>
            <nav className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:gap-6">
              <a href="#how" className="hover:text-foreground">
                {t("landing.nav.how")}
              </a>
              <a href="#providers" className="hover:text-foreground">
                {t("landing.nav.providers")}
              </a>
              <a href="#technology" className="hover:text-foreground">
                {t("landing.nav.technology")}
              </a>
              <Link href="/dashboard" className="hover:text-foreground">
                {t("landing.footer.dashboard")}
              </Link>
              <a
                href="mailto:hello@kaduna.lk"
                className="hover:text-foreground"
              >
                hello@kaduna.lk
              </a>
            </nav>
          </div>
          <p className="mt-10 text-xs text-muted-foreground">
            © 2026 Kaduna.lk
          </p>
        </div>
      </footer>
    </div>
  );
}
