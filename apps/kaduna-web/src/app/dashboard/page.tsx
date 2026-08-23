"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Layers, MapPin, Flame, Target } from "lucide-react";

import PortalShell from "@/components/portal/PortalShell";
import DataSourceBadge from "@/components/DataSourceBadge";
import DayRibbon from "@/components/DayRibbon";
import DispatchPanel from "@/components/DispatchPanel";
import IncidentPanel from "@/components/IncidentPanel";
import MetricCards from "@/components/MetricCards";
import StatsPanel from "@/components/StatsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import WhatIfSimulator from "@/components/WhatIfSimulator";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLiveIncidents } from "@/lib/liveData";
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

const TAB_LABELS = ["Live map", "What-if", "Validation", "Dispatch"] as const;
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
    body: "500 scored incidents on real Colombo road geometry, 25 mined hotspot clusters, NTC accident blackspots, and any live report currently open in dispatch. Click a marker for its five factors.",
  },
  "What-if": {
    lead: "Move one input and watch the score move.",
    body: "The same breakdown scores differently on a trunk road at 8am than on a side street at midnight. This is the model itself, running in the browser — the clearest way to see what the five factors actually weigh.",
  },
  Validation: {
    lead: "What the model was tested against, including what failed.",
    body: "The deployed model uses the original expert weights and scores r = 0.60 against SUMO simulation. Impact-ordered dispatch was tested and rejected — it does not reduce vehicle-hours lost. The validated value is severity triage and hotspot awareness.",
  },
  Dispatch: {
    lead: "Where the score reaches the running platform.",
    body: "Dispatch fetches an impact score per optimise call and carries it as priority metadata on the incident. It colours the decision; it does not make it.",
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
  const [filters, setFilters] = useState({
    priority: [] as string[],
    roadType: "all",
    hour: null as number | null,
  });
  const [layers, setLayers] = useState({
    incidents: true,
    hotspots: true,
    heatmap: true,
    blackspots: true,
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

  const shownCount = useMemo(
    () =>
      allIncidents.filter((i) => {
        if (filters.priority.length > 0 && !filters.priority.includes(i.priority)) return false;
        if (filters.roadType !== "all" && i.roadType !== filters.roadType) return false;
        if (filters.hour !== null && i.hour !== filters.hour) return false;
        return true;
      }).length,
    [allIncidents, filters]
  );

  return (
    <PortalShell title="Operations" tabs={TABS} active={tab}>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionIntro tab={tab} />
          <DataSourceBadge
            dataSource={dataSource}
            geoOk={geoOk}
            liveCount={liveOn ? live.length : 0}
          />
        </div>

        {tab === "Live map" && <ClaimStrip />}

        {!stats || !model ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-[32rem] w-full" />
            <span className="sr-only">Loading incident data</span>
          </div>
        ) : tab === "Live map" ? (
          <div className="space-y-4">
            <MetricCards stats={stats} shown={shownCount} />

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label="Filter by priority"
                >
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

                <div className="ml-auto flex items-center gap-1.5">
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
                      <span className="hidden text-sm sm:inline">{label}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="relative h-[34rem]">
                <Map
                  incidents={allIncidents}
                  hotspots={hotspots}
                  blackspots={blackspots}
                  onSelectIncident={handleSelectIncident}
                  filters={filters}
                  layers={layers}
                />
                <IncidentPanel incident={selected} onClose={() => setSelected(null)} />
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <DayRibbon
                byHour={stats.byHour}
                incidents={allIncidents}
                selectedHour={filters.hour}
                onSelectHour={(h) => setFilters((f) => ({ ...f, hour: h }))}
              />
              <StatsPanel stats={stats} />
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 md:p-6">
            {tab === "What-if" && <WhatIfSimulator model={model} />}
            {tab === "Validation" && <ValidationPanel />}
            {tab === "Dispatch" && <DispatchPanel />}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
