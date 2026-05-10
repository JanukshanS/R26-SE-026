"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import type { Incident, HotspotCluster, Stats, ModelConfig } from "@/lib/types";
import StatsPanel from "@/components/StatsPanel";
import IncidentPanel from "@/components/IncidentPanel";
import WhatIfSimulator from "@/components/WhatIfSimulator";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

type Tab = "stats" | "whatif";

export default function Home() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hotspots, setHotspots] = useState<HotspotCluster[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [model, setModel] = useState<ModelConfig | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);
  const [tab, setTab] = useState<Tab>("stats");
  const [filters, setFilters] = useState({ priority: [] as string[], roadType: "all" });
  const [layers, setLayers] = useState({ incidents: true, hotspots: true, heatmap: true });

  useEffect(() => {
    Promise.all([
      fetch("/data/incidents.json").then((r) => r.json()),
      fetch("/data/hotspots.json").then((r) => r.json()),
      fetch("/data/stats.json").then((r) => r.json()),
      fetch("/data/model.json").then((r) => r.json()),
    ]).then(([inc, hot, st, mod]) => {
      setIncidents(inc);
      setHotspots(hot);
      setStats(st);
      setModel(mod);
    });
  }, []);

  const handleSelectIncident = useCallback((inc: Incident) => setSelected(inc), []);

  const togglePriority = (p: string) => {
    setFilters((prev) => ({
      ...prev,
      priority: prev.priority.includes(p)
        ? prev.priority.filter((x) => x !== p)
        : [...prev.priority, p],
    }));
  };

  if (!stats || !model) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[var(--text-muted)] mt-3">Loading Geo-Intelligence data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-[var(--surface)] border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white font-bold text-sm">
            K
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">Kaduna.lk Geo-Intelligence</h1>
            <p className="text-[10px] text-[var(--text-muted)]">
              Traffic Impact Analysis — Colombo District
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => {
            const active = filters.priority.length === 0 || filters.priority.includes(p);
            const colors: Record<string, string> = {
              CRITICAL: "bg-red-500",
              HIGH: "bg-orange-500",
              MEDIUM: "bg-yellow-500",
              LOW: "bg-green-500",
            };
            return (
              <button
                key={p}
                onClick={() => togglePriority(p)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all border ${
                  active
                    ? `${colors[p]}/20 border-current opacity-100`
                    : "bg-transparent border-[var(--border)] opacity-40"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${colors[p]}`} />
                {p}
              </button>
            );
          })}

          <select
            className="ml-2 bg-[var(--bg)] border border-[var(--border)] rounded-md px-2 py-1 text-xs"
            value={filters.roadType}
            onChange={(e) => setFilters({ ...filters, roadType: e.target.value })}
          >
            <option value="all">All Roads</option>
            {["motorway", "trunk", "primary", "secondary", "tertiary", "residential"].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col overflow-hidden">
          <div className="flex border-b border-[var(--border)]">
            {(["stats", "whatif"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
                  tab === t
                    ? "text-orange-500 border-b-2 border-orange-500"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                {t === "stats" ? "Statistics" : "What-If"}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {tab === "stats" ? (
              <StatsPanel stats={stats} />
            ) : (
              <WhatIfSimulator model={model} />
            )}
          </div>
        </aside>

        {/* Map */}
        <main className="flex-1 relative">
          <Map
            incidents={incidents}
            hotspots={hotspots}
            onSelectIncident={handleSelectIncident}
            filters={filters}
            layers={layers}
          />
          <IncidentPanel incident={selected} onClose={() => setSelected(null)} />

          {/* Layer toggles */}
          <div className="absolute bottom-4 left-4 z-[1000] bg-[var(--surface)] border border-[var(--border)] rounded-lg p-2 flex gap-2">
            {(["incidents", "hotspots", "heatmap"] as const).map((layer) => (
              <button
                key={layer}
                onClick={() => setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))}
                className={`px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider transition-all border ${
                  layers[layer]
                    ? "bg-orange-500/20 border-orange-500 text-orange-500"
                    : "bg-transparent border-[var(--border)] text-[var(--text-muted)] opacity-50"
                }`}
              >
                {layer}
              </button>
            ))}
          </div>

          {/* Legend */}
          <div className="absolute bottom-4 right-4 z-[1000] bg-[var(--surface)]/90 backdrop-blur border border-[var(--border)] rounded-lg p-2">
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Legend</p>
            <div className="space-y-0.5">
              {[
                { color: "#ef4444", label: "Critical (8-10)" },
                { color: "#f97316", label: "High (5-7.9)" },
                { color: "#eab308", label: "Medium (3-4.9)" },
                { color: "#22c55e", label: "Low (1-2.9)" },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-[10px]">{item.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-[var(--border)]">
                <span className="w-2.5 h-2.5 rounded-full border-2 border-dashed border-red-500" />
                <span className="text-[10px]">Hotspot zone</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
