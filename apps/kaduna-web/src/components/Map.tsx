"use client";

import { useEffect, useRef, useState } from "react";
import type { Incident, HotspotCluster, Blackspot } from "@/lib/types";

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "oklch(0.68 0.20 22)",
  HIGH: "oklch(0.76 0.16 55)",
  MEDIUM: "oklch(0.85 0.15 92)",
  LOW: "oklch(0.78 0.16 158)",
};

interface MapProps {
  incidents: Incident[];
  hotspots: HotspotCluster[];
  blackspots: Blackspot[];
  onSelectIncident: (incident: Incident) => void;
  filters: { priority: string[]; roadType: string; hour: number | null };
  layers: { incidents: boolean; hotspots: boolean; heatmap: boolean; blackspots: boolean };
}

export default function Map({ incidents, hotspots, blackspots, onSelectIncident, filters, layers }: MapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<any>(null);
  const layersRef = useRef<any>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;
    let localMap: any = null;

    const initMap = async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !mapRef.current) return;
      const node = mapRef.current as HTMLDivElement & { _leaflet_id?: number };
      if (node._leaflet_id || leafletMap.current) return;

      const map = L.map(node, {
        center: [6.9271, 79.8612],
        zoom: 12,
        zoomControl: false,
      });

      L.control.zoom({ position: "topright" }).addTo(map);

      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      localMap = map;
      leafletMap.current = map;
      // Order matters: last-added wins z-order. We want incidents on top so
      // the user can click an incident marker that sits inside a hotspot.
      // Heatmap is decorative and goes underneath everything else.
      layersRef.current = {
        heatmap: L.layerGroup().addTo(map),
        hotspots: L.layerGroup().addTo(map),
        blackspots: L.layerGroup().addTo(map),
        incidents: L.layerGroup().addTo(map),
      };

      setReady(true);
    };

    initMap();

    return () => {
      cancelled = true;
      const m = localMap ?? leafletMap.current;
      if (m) {
        try { m.remove(); } catch { /* node already gone */ }
      }
      leafletMap.current = null;
      layersRef.current = {};
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !leafletMap.current) return;

    const renderLayers = async () => {
      const L = (await import("leaflet")).default;
      const map = leafletMap.current;

      layersRef.current.incidents.clearLayers();
      layersRef.current.hotspots.clearLayers();
      layersRef.current.blackspots.clearLayers();
      layersRef.current.heatmap.clearLayers();

      const filtered = incidents.filter((inc) => {
        if (filters.priority.length > 0 && !filters.priority.includes(inc.priority)) return false;
        if (filters.roadType && filters.roadType !== "all" && inc.roadType !== filters.roadType) return false;
        if (filters.hour !== null && inc.hour !== filters.hour) return false;
        return true;
      });

      if (layers.incidents) filtered.forEach((inc) => {
        const marker = L.circleMarker([inc.lat, inc.lng], {
          radius: (inc.live ? 7 : 4) + inc.impactScore * 0.5,
          fillColor: PRIORITY_COLORS[inc.priority] || "#888",
          color: inc.live ? "#111827" : "rgba(0,0,0,0.28)",
          weight: inc.live ? 3 : 1,
          fillOpacity: inc.live ? 0.95 : 0.8,
        });

        marker.bindPopup(
          `<div style="font-family:system-ui;font-size:12px;">
            ${inc.live ? '<strong style="color:#F97316">● LIVE REPORT</strong><br/>' : ""}
            <strong>${inc.id}</strong> — <span style="color:${PRIORITY_COLORS[inc.priority]}">${inc.priority}</span><br/>
            Score: <strong>${inc.impactScore}/10</strong><br/>
            ${inc.incidentType.replace(/_/g, " ")} on ${inc.roadType}<br/>
            ${inc.live && inc.providerName
              ? `Dispatched: <strong>${inc.providerName}</strong>`
              : `Queue: ${inc.queueKm}km | VHL: ${inc.vhl}`}
          </div>`,
          { className: "kaduna-popup" }
        );

        marker.on("click", () => onSelectIncident(inc));
        marker.addTo(layersRef.current.incidents);
      });

      if (layers.hotspots) hotspots.forEach((h) => {
        const color = h.risk > 35 ? "#ef4444" : h.risk > 25 ? "#f97316" : "#22c55e";
        const circle = L.circle([h.lat, h.lng], {
          radius: Math.max(h.radiusM, 300),
          color,
          fillColor: color,
          fillOpacity: 0.12,
          weight: 2,
          dashArray: "6 4",
        });

        circle.bindPopup(
          `<div style="font-family:system-ui;font-size:12px;">
            <strong>Hotspot #${h.id}</strong><br/>
            Incidents: ${h.count} | Risk: ${h.risk}<br/>
            Avg Score: ${h.avgScore} | Peak: ${h.peakHour}:00<br/>
            ${h.roadType} — ${h.incidentType.replace(/_/g, " ")}
          </div>`
        );
        circle.addTo(layersRef.current.hotspots);
      });

      // Real accident blackspots (NTC 2024 / data.gov.lk). Rendered as a dark
      // diamond + crosshair divIcon with a label so they read as "ground-truth
      // known blackspot" — visually distinct from the model's priority dots and
      // hotspot rings. Drawn under the incidents layer to keep incidents clickable.
      if (layers.blackspots) blackspots.forEach((b) => {
        const icon = L.divIcon({
          className: "blackspot-marker",
          html: `<div class="bs-diamond"><span class="bs-cross"></span></div><div class="bs-label">${b.name}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const marker = L.marker([b.lat, b.lng], { icon, keyboard: false });

        marker.bindPopup(
          `<div style="font-family:system-ui;font-size:12px;">
            <strong>${b.name}</strong><br/>
            <span style="color:#6B7280">${b.roadType}</span><br/>
            ${b.notes}<br/>
            <span style="color:#b91c1c;font-weight:600">Real accident blackspot — NTC 2024 / data.gov.lk</span>
          </div>`,
          { className: "kaduna-popup" }
        );
        marker.addTo(layersRef.current.blackspots);
      });

      try {
        if (!layers.heatmap) throw new Error("skip");
        await import("leaflet.heat");
        const heatData = filtered.map((inc) => [inc.lat, inc.lng, inc.impactScore / 10]);
        if (heatData.length > 0) {
          const heat = (L as any).heatLayer(heatData, {
            radius: 20,
            blur: 25,
            maxZoom: 15,
            minOpacity: 0.3,
            gradient: { 0.2: "#22c55e", 0.5: "#eab308", 0.8: "#f97316", 1.0: "#ef4444" },
          });
          heat.addTo(layersRef.current.heatmap);
        }
      } catch {
        // leaflet.heat not available — skip heatmap layer
      }
    };

    renderLayers();
  }, [ready, incidents, hotspots, blackspots, filters, layers, onSelectIncident]);

  return (
    <div ref={mapRef} className="w-full h-full rounded-xl" />
  );
}
