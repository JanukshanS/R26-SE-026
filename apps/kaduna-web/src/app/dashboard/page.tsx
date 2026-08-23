"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Layers, MapPin, Flame, Target } from "lucide-react";

import { AppShell, DataSourceBadge, MobileNav, SECTIONS, type Section } from "@/components/shell/AppShell";
import { useSession } from "@/lib/auth";
import DayRibbon from "@/components/DayRibbon";
import DispatchPanel from "@/components/DispatchPanel";
import IncidentPanel from "@/components/IncidentPanel";
import MetricCards from "@/components/MetricCards";
import StatsPanel from "@/components/StatsPanel";
import ValidationPanel from "@/components/ValidationPanel";
import WhatIfSimulator from "@/components/WhatIfSimulator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchLiveIncidents } from "@/lib/liveData";
import { fetchHotspots, fetchStats, fetchGeoHealth, type DataSource } from "@/lib/geoData";
import { supabase } from "@/lib/supabase";
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

export default function Home() {
  const session = useSession();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hotspots, setHotspots] = useState<HotspotCluster[]>([]);
  const [blackspots, setBlackspots] = useState<Blackspot[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [model, setModel] = useState<ModelConfig | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [filters, setFilters] = useState({
    priority: [] as string[],
    roadType: "all",
    hour: null as number | null,
  });
  const [layers, setLayers] = useState({ incidents: true, hotspots: true, heatmap: true, blackspots: true });
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

  // Live overlay: poll the dispatch service for freshly-reported incidents, each
  // scored by geo. Only updates state when the set actually changes (so the
  // 500-marker base layer doesn't re-render every tick). Falls back to an empty
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

  const account = useMemo(() => {
    const email = session?.user.email ?? "signed in";
    const metaName = session?.user.user_metadata?.full_name as string | undefined;
    return {
      name: metaName || email.split("@")[0],
      email,
      role: "Operator",
    };
  }, [session]);

  if (!stats || !model) {
    return (
      <div className="flex h-screen flex-col gap-4 p-6">
        <Skeleton className="h-14 w-full" />
        <div className="grid flex-1 gap-4 md:grid-cols-[24rem_1fr]">
          <Skeleton className="h-full w-full" />
          <Skeleton className="h-full w-full" />
        </div>
        <span className="sr-only">Loading incident data</span>
      </div>
    );
  }

  const current = SECTIONS.find((s) => s.id === section)!;

  return (
    <AppShell
      section={section}
      onSectionChange={setSection}
      user={account}
      onSignOut={() => void supabase.auth.signOut()}
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4 md:px-6">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold leading-tight">{current.label}</h1>
          <p className="truncate text-sm text-muted-foreground leading-tight">{current.hint}</p>
        </div>
        <DataSourceBadge dataSource={dataSource} geoOk={geoOk} liveCount={liveOn ? live.length : 0} />
      </header>

      <MobileNav section={section} onSectionChange={setSection} />

      {section === "overview" ? (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <ScrollArea className="w-full shrink-0 border-b border-border lg:h-auto lg:w-96 lg:border-b-0 lg:border-r">
            <div className="space-y-4 p-4">
              <MetricCards stats={stats} shown={shownCount} />
              <DayRibbon
                byHour={stats.byHour}
                incidents={allIncidents}
                selectedHour={filters.hour}
                onSelectHour={(h) => setFilters((f) => ({ ...f, hour: h }))}
              />
              <StatsPanel stats={stats} />
            </div>
          </ScrollArea>

          <div className="flex min-h-[60vh] flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
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
                {([
                  ["incidents", "Incidents", MapPin],
                  ["hotspots", "Hotspots", Flame],
                  ["heatmap", "Heatmap", Layers],
                  ["blackspots", "Blackspots (NTC)", Target],
                ] as const).map(([key, label, Icon]) => (
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

            <div className="relative flex-1">
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
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
            <Card>
              <CardContent className="p-4 md:p-6">
                {section === "whatif" && <WhatIfSimulator model={model} />}
                {section === "validation" && <ValidationPanel />}
                {section === "dispatch" && <DispatchPanel />}
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      )}
    </AppShell>
  );
}
