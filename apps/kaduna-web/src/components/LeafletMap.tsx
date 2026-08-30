"use client";

import { useEffect, useRef, useState } from "react";
import { matchesFilters } from "@/lib/filters";
import { PRIORITY_COLORS, type MapProps } from "@/components/Map";
import { useT } from "@/lib/i18n";

export default function LeafletMap({ incidents, hotspots, blackspots, onSelectIncident, filters, layers }: MapProps) {
  const t = useT();
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
        // Canvas renderer: 500 circle markers as SVG elements is 500 DOM nodes
        // to composite on every pan. The Google engine draws its incidents on
        // a canvas for the same reason.
        preferCanvas: true,
        center: [6.9271, 79.8612],
        zoom: 12,
        zoomControl: false,
      });

      L.control.zoom({ position: "topright" }).addTo(map);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
        return matchesFilters(inc, filters);
      });

      if (layers.incidents) filtered.forEach((inc) => {
        const marker = L.circleMarker([inc.lat, inc.lng], {
          radius: (inc.live ? 7 : 4) + inc.impactScore * 0.5,
          fillColor: PRIORITY_COLORS[inc.priority] || "#888",
          color: inc.live ? "#111827" : "rgba(0,0,0,0.28)",
          weight: inc.live ? 3 : 1,
          fillOpacity: inc.live ? 0.95 : 0.8,
        });

        // No popup: clicking selects the incident and the rail beside the map
        // shows the full factor breakdown. A popup here repeated it and covered
        // the markers the operator is comparing against.
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
            <strong>${t("dashboard.map.hotspotTitle", { id: h.id })}</strong><br/>
            ${t("dashboard.map.hotspotCounts", { n: h.count, risk: h.risk })}<br/>
            ${t("dashboard.map.hotspotScores", { score: h.avgScore, hour: h.peakHour })}<br/>
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
            <span style="color:#b91c1c;font-weight:600">${t("dashboard.map.blackspotSource")}</span>
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
  }, [ready, incidents, hotspots, blackspots, filters, layers, onSelectIncident, t]);

  return (
    <div ref={mapRef} className="w-full h-full rounded-xl" />
  );
}
