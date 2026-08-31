"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Layers, MapPin, Flame, Target, Download, RotateCcw } from "lucide-react";

import PortalShell from "@/components/portal/PortalShell";
import DataSourceBadge from "@/components/DataSourceBadge";
import DayRibbon from "@/components/DayRibbon";
import RecommendationsPanel from "@/components/RecommendationsPanel";
import ScoringLogPanel from "@/components/ScoringLogPanel";
import IncidentPanel from "@/components/IncidentPanel";
import MapLegend from "@/components/MapLegend";
import MetricCards from "@/components/MetricCards";
import StatsPanel from "@/components/StatsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import WhatIfSimulator from "@/components/WhatIfSimulator";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLiveIncidents } from "@/lib/liveData";
import { DAY_NAMES, NO_FILTERS, describeFilters, isFiltered, matchesFilters } from "@/lib/filters";
import { downloadIncidentsCsv } from "@/lib/exportCsv";
import { fetchHotspots, fetchStats, fetchGeoHealth, type DataSource } from "@/lib/geoData";
import { useT } from "@/lib/i18n";
import type { Recommendation } from "@/lib/recommendations";
import type { Blackspot, HotspotCluster, Incident, ModelConfig, Stats } from "@/lib/types";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const PRIORITY_TOKEN: Record<string, string> = {
  CRITICAL: "var(--priority-critical)",
  HIGH: "var(--priority-high)",
  MEDIUM: "var(--priority-medium)",
  LOW: "var(--priority-low)",
};
const ROAD_TYPES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential"];

const TAB_LABELS = ["Live map", "Where to station", "What-if", "Scoring log", "Model accuracy"] as const;
type Tab = (typeof TAB_LABELS)[number];

const TAB_KEYS: Record<Tab, string> = {
  "Live map": "dashboard.tab.liveMap",
  "Where to station": "dashboard.tab.whereToStation",
  "What-if": "dashboard.tab.whatIf",
  "Scoring log": "dashboard.tab.scoringLog",
  "Model accuracy": "dashboard.tab.modelAccuracy",
};

const TABS = TAB_LABELS.map((label) => ({
  labelKey: TAB_KEYS[label],
  href: `#${label.toLowerCase().replace(/[^a-z]/g, "")}`,
}));

const PRIORITY_LABEL: Record<string, string> = {
  CRITICAL: "dashboard.priority.critical",
  HIGH: "dashboard.priority.high",
  MEDIUM: "dashboard.priority.medium",
  LOW: "dashboard.priority.low",
};

/**
 * What each view is for, in an evaluator's terms. The dashboard is the only
 * place the geo-intelligence component is visible to the people it was built
 * for — road authorities and ops, who never install the app — so every view
 * says what it shows and what it is good for before showing it.
 */
const TAB_INTRO: Record<Tab, { leadKey: string; bodyKey: string }> = {
  "Live map": {
    leadKey: "dashboard.intro.liveMap.lead",
    bodyKey: "dashboard.intro.liveMap.body",
  },
  "Where to station": {
    leadKey: "dashboard.intro.whereToStation.lead",
    bodyKey: "dashboard.intro.whereToStation.body",
  },
  "What-if": {
    leadKey: "dashboard.intro.whatIf.lead",
    bodyKey: "dashboard.intro.whatIf.body",
  },
  "Scoring log": {
    leadKey: "dashboard.intro.scoringLog.lead",
    bodyKey: "dashboard.intro.scoringLog.body",
  },
  "Model accuracy": {
    leadKey: "dashboard.intro.modelAccuracy.lead",
    bodyKey: "dashboard.intro.modelAccuracy.body",
  },
};

/** The component's honest headline claims, stated once at the top. */
const CLAIMS = [
  {
    valueKey: "dashboard.claim.clustersValue",
    labelKey: "dashboard.claim.clustersLabel",
    noteKey: "dashboard.claim.clustersNote",
  },
  {
    valueKey: "dashboard.claim.factorsValue",
    labelKey: "dashboard.claim.factorsLabel",
    noteKey: "dashboard.claim.factorsNote",
  },
  {
    valueKey: "dashboard.claim.correlationValue",
    labelKey: "dashboard.claim.correlationLabel",
    noteKey: "dashboard.claim.correlationNote",
  },
  {
    valueKey: "dashboard.claim.reroutingValue",
    labelKey: "dashboard.claim.reroutingLabel",
    noteKey: "dashboard.claim.reroutingNote",
  },
];

function ClaimStrip() {
  const t = useT();
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CLAIMS.map((c) => (
        <div key={c.labelKey} className="rounded-xl border border-border bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            {t(c.labelKey)}
          </dt>
          <dd className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums">
            {t(c.valueKey)}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(c.noteKey)}</p>
        </div>
      ))}
    </dl>
  );
}

function SectionIntro({ tab }: { tab: Tab }) {
  const t = useT();
  const { leadKey, bodyKey } = TAB_INTRO[tab];
  return (
    <div className="max-w-3xl">
      <p className="font-display text-lg font-semibold tracking-tight">{t(leadKey)}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{t(bodyKey)}</p>
    </div>
  );
}

export default function OperationsPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("Live map");

  // Read on mount (not during render) so the prerendered HTML always matches.
  useEffect(() => {
    const sync = () => {
      const want = window.location.hash.replace("#", "").toLowerCase();
      setTab(
        TAB_LABELS.find((t) => t.toLowerCase().replace(/[^a-z]/g, "") === want) ?? "Live map"
      );
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hotspots, setHotspots] = useState<HotspotCluster[]>([]);
  const [blackspots, setBlackspots] = useState<Blackspot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [model, setModel] = useState<ModelConfig | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  // Incidents only to begin with. With every layer on at once the heatmap
  // washes out the markers it is derived from and the hotspot rings sit over
  // both, so the first thing an operator sees is the least readable one. Each
  // layer is one click away.
  const [layers, setLayers] = useState({
    incidents: true,
    hotspots: false,
    heatmap: false,
    blackspots: false,
  });
  // Set when a placement recommendation is opened, so the live map arrives
  // already framed on the cluster the operator was reading about.
  const [focus, setFocus] = useState<{ lat: number; lng: number; radiusM: number } | null>(null);
  const [live, setLive] = useState<Incident[]>([]);
  const [liveOn, setLiveOn] = useState(false);
  const [dataSource, setDataSource] = useState<DataSource>("static");
  const [geoOk, setGeoOk] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/data/incidents.json").then((r) => r.json()),
      fetchHotspots(),
      fetchStats(),
      fetch("/data/model.json").then((r) => r.json()),
      fetch("/data/blackspots.json")
        .then((r) => r.json())
        .catch(() => [] as Blackspot[]),
    ]).then(([inc, hotResult, statsResult, mod, bs]) => {
      setIncidents(inc);
      setHotspots(hotResult.data);
      setStats(statsResult.data);
      setModel(mod);
      setBlackspots(bs);
      setDataSource(
        hotResult.source === "api" && statsResult.source === "api" ? "api" : "static"
      );
    });
  }, []);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const health = await fetchGeoHealth();
      if (active) setGeoOk(health.ok);
    };
    check();
    const h = setInterval(check, 30000);
    return () => {
      active = false;
      clearInterval(h);
    };
  }, []);

  // Live incidents are polled separately from the static dataset so the
  // 500-marker base layer doesn't re-render every tick. Falls back to an empty
  // overlay if the backends are down — the static dataset still shows.
  useEffect(() => {
    let active = true;
    const poll = async () => {
      const l = await fetchLiveIncidents();
      if (!active) return;
      setLiveOn(l.length > 0);
      setLive((prev) => {
        const same =
          prev.length === l.length &&
          prev.every((p, i) => p.id === l[i].id && p.impactScore === l[i].impactScore);
        return same ? prev : l;
      });
    };
    poll();
    const h = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(h);
    };
  }, []);

  const allIncidents = useMemo(() => [...incidents, ...live], [incidents, live]);

  const handleSelectIncident = useCallback((inc: Incident) => setSelected(inc), []);

  // A recommendation is about a cluster, so the hotspot rings have to come on
  // with it — landing on the map with the ring still hidden would show the
  // operator a patch of dots and no reason they were sent there. The hash
  // change is what switches the tab; the listener above picks it up.
  const showOnMap = useCallback((r: Recommendation) => {
    setFocus({ lat: r.lat, lng: r.lng, radiusM: r.radiusM });
    setLayers((l) => ({ ...l, hotspots: true }));
    window.location.hash = "#livemap";
  }, []);

  const togglePriority = (p: string) =>
    setFilters((prev) => ({
      ...prev,
      priority: prev.priority.includes(p)
        ? prev.priority.filter((x) => x !== p)
        : [...prev.priority, p],
    }));

  const shown = useMemo(
    () => allIncidents.filter((i) => matchesFilters(i, filters)),
    [allIncidents, filters]
  );
  const shownCount = shown.length;

  const isMap = tab === "Live map";
  const loading = !stats || !model;

  const priorityFilter = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("dashboard.filter.priorityLabel")}>
      {PRIORITIES.map((p) => {
        const on = filters.priority.includes(p);
        return (
          <Button
            key={p}
            size="sm"
            variant={on ? "secondary" : "ghost"}
            onClick={() => togglePriority(p)}
            aria-pressed={on}
            className="h-8 gap-2 px-2.5"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: PRIORITY_TOKEN[p] }}
              aria-hidden
            />
            <span className="text-sm">{t(PRIORITY_LABEL[p])}</span>
          </Button>
        );
      })}
    </div>
  );

  const layerToggles = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("dashboard.layers.groupLabel")}>
      {(
        [
          ["incidents", "dashboard.layers.incidents", MapPin],
          ["hotspots", "dashboard.layers.hotspots", Flame],
          ["heatmap", "dashboard.layers.heatmap", Layers],
          ["blackspots", "dashboard.layers.blackspots", Target],
        ] as const
      ).map(([key, labelKey, Icon]) => (
        <Button
          key={key}
          size="sm"
          variant={layers[key] ? "secondary" : "ghost"}
          onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
          aria-pressed={layers[key]}
          className="h-8 gap-1.5 px-2.5"
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="hidden text-sm xl:inline">{t(labelKey)}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <PortalShell
      title={t("dashboard.title")}
      tabs={TABS.map((tb) => ({ label: t(tb.labelKey), href: tb.href }))}
      active={t(TAB_KEYS[tab])}
      fullWidth={isMap}
      stretch={isMap}
    >
      {isMap ? (
        loading ? (
          <div className="flex flex-col gap-3 lg:h-full">
            <Skeleton className="h-12 w-full shrink-0" />
            <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Skeleton className="h-[26rem] lg:h-full" />
              <Skeleton className="hidden h-full lg:block" />
            </div>
            <span className="sr-only">{t("dashboard.map.loading")}</span>
          </div>
        ) : (
          /* Console layout: one toolbar, then the map takes every remaining
             pixel with the readouts in a rail beside it. The numbers used to
             stack above the map, which pushed the only interactive thing on
             the page below the fold. */
          <div className="flex flex-col gap-3 lg:h-full lg:overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-3 py-2">
              {priorityFilter}

              <Separator orientation="vertical" className="hidden h-6 sm:block" />

              <Select
                value={filters.roadType}
                onValueChange={(v) => setFilters((f) => ({ ...f, roadType: v }))}
              >
                <SelectTrigger size="sm" className="w-[150px]" aria-label={t("dashboard.filter.roadTypeLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("dashboard.filter.allRoadTypes")}</SelectItem>
                  {ROAD_TYPES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.day === null ? "all" : String(filters.day)}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, day: v === "all" ? null : Number(v) }))
                }
              >
                <SelectTrigger size="sm" className="w-[140px]" aria-label={t("dashboard.filter.dayLabel")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("dashboard.filter.allDays")}</SelectItem>
                  {DAY_NAMES.map((d, i) => (
                    <SelectItem key={d} value={String(i)}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {isFiltered(filters) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFilters(NO_FILTERS)}
                  className="h-8 gap-1.5 px-2.5"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  <span className="text-sm">{t("dashboard.filter.showAll")}</span>
                </Button>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadIncidentsCsv(shown, describeFilters(filters))}
                  disabled={shownCount === 0}
                  className="h-8 gap-1.5 px-2.5"
                  title={t("dashboard.action.exportTitle")}
                >
                  <Download className="size-3.5" aria-hidden />
                  <span className="text-sm">
                    {t("dashboard.action.export", { n: shownCount.toLocaleString() })}
                  </span>
                </Button>

                <Separator orientation="vertical" className="hidden h-6 lg:block" />

                {layerToggles}
                <Separator orientation="vertical" className="hidden h-6 lg:block" />
                <DataSourceBadge
                  dataSource={dataSource}
                  geoOk={geoOk}
                  liveCount={liveOn ? live.length : 0}
                />
              </div>
            </div>

            {/* Below lg the two stack and the console itself scrolls, so the
                rail stays reachable instead of being clipped by the fixed
                viewport height the desktop layout relies on. */}
            <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="relative h-[26rem] overflow-hidden rounded-xl border border-border bg-card lg:h-auto">
                <Map
                  incidents={allIncidents}
                  hotspots={hotspots}
                  blackspots={blackspots}
                  onSelectIncident={handleSelectIncident}
                  filters={filters}
                  layers={layers}
                  focus={focus}
                />
              </div>

              {/* The rail scrolls on its own so the map never moves. Block
                  layout, not flex: as flex children the short cards were
                  shrunk to nothing by the tall stats panel below them. */}
              <aside
                aria-label={t("dashboard.rail.label")}
                className="space-y-3 pb-1 lg:min-h-0 lg:overflow-y-auto lg:pr-0.5"
              >
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(TAB_INTRO["Live map"].leadKey)}
                </p>

                <MetricCards
                  stats={stats}
                  shown={shownCount}
                  total={allIncidents.length}
                  live={liveOn ? live.length : 0}
                />

                <IncidentPanel incident={selected} onClose={() => setSelected(null)} />

                <MapLegend />

                <DayRibbon
                  byHour={stats.byHour}
                  incidents={allIncidents}
                  selectedHour={filters.hour}
                  onSelectHour={(h) => setFilters((f) => ({ ...f, hour: h }))}
                />

                <StatsPanel stats={stats} />
              </aside>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionIntro tab={tab} />
            <DataSourceBadge
              dataSource={dataSource}
              geoOk={geoOk}
              liveCount={liveOn ? live.length : 0}
            />
          </div>

          {/* The headline claims are provenance, not operations: they belong
              where someone is checking whether to believe the model. */}
          {tab === "Model accuracy" && <ClaimStrip />}

          {loading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <div className="rounded-xl border border-border bg-card p-4 md:p-6">
              {tab === "What-if" && <WhatIfSimulator model={model} />}
              {tab === "Model accuracy" && <ValidationPanel />}
              {tab === "Where to station" && (
                <RecommendationsPanel
                  hotspots={hotspots}
                  incidents={incidents}
                  onShowOnMap={showOnMap}
                />
              )}
              {tab === "Scoring log" && <ScoringLogPanel />}
            </div>
          )}
        </div>
      )}
    </PortalShell>
  );
}
