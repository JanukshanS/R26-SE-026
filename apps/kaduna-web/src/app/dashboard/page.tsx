"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Layers, MapPin, Flame, Target, Download, RotateCcw } from "lucide-react";

import PortalShell from "@/components/portal/PortalShell";
import DataSourceBadge from "@/components/DataSourceBadge";
import DayRibbon from "@/components/DayRibbon";
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

const TAB_LABELS = ["Live map", "What-if", "Scoring log", "Model accuracy"] as const;
type Tab = (typeof TAB_LABELS)[number];
const TABS = TAB_LABELS.map((label) => ({
  label,
  href: `#${label.toLowerCase().replace(/[^a-z]/g, "")}`,
}));

/**
 * What each view is for, in an evaluator's terms. The dashboard is the only
 * place the geo-intelligence component is visible to the people it was built
 * for — road authorities and ops, who never install the app — so every view
 * says what it shows and what it is good for before showing it.
 */
const TAB_INTRO: Record<Tab, { lead: string; body: string }> = {
  "Live map": {
    lead: "Every incident scored for what it does to the city, not to the driver.",
    body: "Scored incidents across Colombo, with accident blackspots and anything currently open in dispatch. Select a marker to see the five factors behind its score.",
  },
  "What-if": {
    lead: "Change one thing and watch the score move.",
    body: "The same breakdown costs the city more on a main road at 8am than on a side street at midnight. Move the inputs to see how much each one is worth.",
  },
  "Scoring log": {
    lead: "Every score this dashboard has requested, and why.",
    body: "Each incident that reaches dispatch is scored as it arrives. Open a row to see the road that was matched and the five factors that produced the number.",
  },
  "Model accuracy": {
    lead: "How well the score predicts real congestion — including where it falls short.",
    body: "Scores are checked against SUMO traffic simulation. Ordering dispatch by impact was tested and did not reduce vehicle-hours lost, so it is not used; the score sets priority and marks the areas worth watching.",
  },
};

/** The component's honest headline claims, stated once at the top. */
const CLAIMS = [
  { value: "25", label: "hotspot clusters", note: "mined from scored incidents on real OSM geometry" },
  { value: "5", label: "weighted factors", note: "capacity, volume, time, road class, severity" },
  { value: "r = 0.60", label: "against SUMO", note: "deployed expert weights, corridor grid" },
  { value: "~13 min", label: "median per trip", note: "rerouting insight, the validated operational win" },
];

function ClaimStrip() {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CLAIMS.map((c) => (
        <div key={c.label} className="rounded-xl border border-border bg-card p-4">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">{c.label}</dt>
          <dd className="mt-1 font-display text-2xl font-bold tracking-tight tabular-nums">
            {c.value}
          </dd>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.note}</p>
        </div>
      ))}
    </dl>
  );
}

function SectionIntro({ tab }: { tab: Tab }) {
  const { lead, body } = TAB_INTRO[tab];
  return (
    <div className="max-w-3xl">
      <p className="font-display text-lg font-semibold tracking-tight">{lead}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export default function OperationsPage() {
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
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by priority">
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
            <span className="text-sm">{p.charAt(0) + p.slice(1).toLowerCase()}</span>
          </Button>
        );
      })}
    </div>
  );

  const layerToggles = (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Map layers">
      {(
        [
          ["incidents", "Incidents", MapPin],
          ["hotspots", "Hotspots", Flame],
          ["heatmap", "Heatmap", Layers],
          ["blackspots", "Blackspots (NTC)", Target],
        ] as const
      ).map(([key, label, Icon]) => (
        <Button
          key={key}
          size="sm"
          variant={layers[key] ? "secondary" : "ghost"}
          onClick={() => setLayers((l) => ({ ...l, [key]: !l[key] }))}
          aria-pressed={layers[key]}
          className="h-8 gap-1.5 px-2.5"
        >
          <Icon className="size-3.5" aria-hidden />
          <span className="hidden text-sm xl:inline">{label}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <PortalShell
      title="Operations"
      tabs={TABS}
      active={tab}
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
            <span className="sr-only">Loading incident data</span>
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
                <SelectTrigger size="sm" className="w-[150px]" aria-label="Filter by road type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All road types</SelectItem>
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
                <SelectTrigger size="sm" className="w-[140px]" aria-label="Filter by day of week">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All days</SelectItem>
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
                  <span className="text-sm">Show all</span>
                </Button>
              )}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadIncidentsCsv(shown, describeFilters(filters))}
                  disabled={shownCount === 0}
                  className="h-8 gap-1.5 px-2.5"
                  title="Download the incidents currently on the map as a CSV"
                >
                  <Download className="size-3.5" aria-hidden />
                  <span className="text-sm">Export {shownCount.toLocaleString()}</span>
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
                />
              </div>

              {/* The rail scrolls on its own so the map never moves. Block
                  layout, not flex: as flex children the short cards were
                  shrunk to nothing by the tall stats panel below them. */}
              <aside
                aria-label="Readouts"
                className="space-y-3 pb-1 lg:min-h-0 lg:overflow-y-auto lg:pr-0.5"
              >
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {TAB_INTRO["Live map"].lead}
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
              {tab === "Scoring log" && <ScoringLogPanel />}
            </div>
          )}
        </div>
      )}
    </PortalShell>
  );
}
