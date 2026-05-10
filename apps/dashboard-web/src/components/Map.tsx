"use client";

import { useEffect, useRef, useState } from "react";
import type { Incident, HotspotCluster } from "@/lib/types";

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MEDIUM: "#eab308",
  LOW: "#22c55e",
};

interface MapProps {
  incidents: Incident[];
  hotspots: HotspotCluster[];
  onSelectIncident: (incident: Incident) => void;
  filters: { priority: string[]; roadType: string };
  layers: { incidents: boolean; hotspots: boolean; heatmap: boolean };
}

export default function Map({ incidents, hotspots, onSelectIncident, filters, layers }: MapProps) {
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

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
          subdomains: "abcd",
          maxZoom: 20,
        },
      ).addTo(map);

      localMap = map;
      leafletMap.current = map;
      layersRef.current = {
        incidents: L.layerGroup().addTo(map),
        hotspots: L.layerGroup().addTo(map),
        heatmap: L.layerGroup().addTo(map),
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
      layersRef.current.heatmap.clearLayers();

      const filtered = incidents.filter((inc) => {
        if (filters.priority.length > 0 && !filters.priority.includes(inc.priority)) return false;
        if (filters.roadType && filters.roadType !== "all" && inc.roadType !== filters.roadType) return false;
        return true;
      });

      if (layers.incidents) filtered.forEach((inc) => {
        const marker = L.circleMarker([inc.lat, inc.lng], {
          radius: 4 + inc.impactScore * 0.5,
          fillColor: PRIORITY_COLORS[inc.priority] || "#888",
          color: "rgba(255,255,255,0.3)",
          weight: 1,
          fillOpacity: 0.8,
        });

        marker.bindPopup(
          `<div style="font-family:system-ui;font-size:12px;">
            <strong>${inc.id}</strong> — <span style="color:${PRIORITY_COLORS[inc.priority]}">${inc.priority}</span><br/>
            Score: <strong>${inc.impactScore}/10</strong><br/>
            ${inc.incidentType.replace(/_/g, " ")} on ${inc.roadType}<br/>
            Queue: ${inc.queueKm}km | VHL: ${inc.vhl}
          </div>`,
          { className: "dark-popup" }
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
          interactive: false,
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
  }, [ready, incidents, hotspots, filters, layers, onSelectIncident]);

  return (
    <div ref={mapRef} className="w-full h-full rounded-xl" />
  );
}
