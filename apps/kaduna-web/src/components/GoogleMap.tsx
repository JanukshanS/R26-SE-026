"use client";

import { useEffect, useRef, useState } from "react";
import { PRIORITY_COLORS, type MapProps } from "@/components/Map";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { createHeatmapOverlay } from "@/lib/googleHeatmap";

/**
 * Ops map on the Google Maps JavaScript API — the preferred engine.
 *
 * Same four layers and the same popup copy as `LeafletMap.tsx`, which remains
 * the fallback when no key is configured. Kept deliberately parallel to that
 * file: if a layer changes there it has to change here, and a side-by-side
 * diff is the cheapest way to see that it did.
 *
 * Untyped `any` throughout because `@types/google.maps` is not a dependency,
 * matching how the Leaflet component handles its own untyped instance refs.
 */

/** Colombo Fort. */
const CENTER = { lat: 6.9271, lng: 79.8612 };

/**
 * Muted basemap so the incident dots carry the colour. Google's default
 * palette competes with the priority scale — business POIs in particular read
 * as data points when they aren't.
 */
const BASE_STYLE = [
  // Every POI category off, not just poi.business: hospital, temple and
  // attraction pins are the same size and saturation as an incident dot, and
  // an operator should never have to work out which red circle is data.
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "landscape", stylers: [{ saturation: -40 }, { lightness: 15 }] },
  { featureType: "water", stylers: [{ saturation: -30 }, { lightness: 20 }] },
  // Roads keep their labels — the road name is what an operator dispatches to.
  { featureType: "road", elementType: "geometry", stylers: [{ saturation: -30 }] },
];

function popupHtml(body: string): string {
  return `<div style="font-family:system-ui;font-size:12px;line-height:1.5;">${body}</div>`;
}

export default function GoogleMap({
  incidents,
  hotspots,
  blackspots,
  onSelectIncident,
  filters,
  layers,
}: MapProps) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapsRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const infoRef = useRef<any>(null);
  /** Everything drawn for the current render, cleared wholesale on the next. */
  const overlaysRef = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!nodeRef.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !nodeRef.current) return;
        mapsRef.current = maps;
        mapRef.current = new maps.Map(nodeRef.current, {
          center: CENTER,
          zoom: 12,
          styles: BASE_STYLE,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          zoomControlOptions: { position: maps.ControlPosition.RIGHT_TOP },
          clickableIcons: false,
        });
        infoRef.current = new maps.InfoWindow();
        setReady(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setFailed(e.message);
      });

    return () => {
      cancelled = true;
      infoRef.current?.close();
      overlaysRef.current.forEach((o) => o.setMap?.(null));
      overlaysRef.current = [];
      mapRef.current = null;
      infoRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const maps = mapsRef.current;
    const map = mapRef.current;
    const info = infoRef.current;
    if (!maps || !map) return;

    overlaysRef.current.forEach((o) => o.setMap?.(null));
    overlaysRef.current = [];
    info?.close();

    const keep = (o: any) => {
      overlaysRef.current.push(o);
      return o;
    };
    const openInfo = (anchor: any, html: string) => {
      info.setContent(popupHtml(html));
      info.open({ map, anchor });
    };

    const filtered = incidents.filter((inc) => {
      if (filters.priority.length > 0 && !filters.priority.includes(inc.priority)) return false;
      if (filters.roadType && filters.roadType !== "all" && inc.roadType !== filters.roadType) return false;
      if (filters.hour !== null && inc.hour !== filters.hour) return false;
      return true;
    });

    // Heatmap first so it sits under everything; z-index rather than add-order
    // decides stacking here, and incidents have to stay clickable.
    if (layers.heatmap && filtered.length > 0) {
      // Not google.maps.visualization.HeatmapLayer — that was removed in Maps
      // JS v3.65 and now throws on construction. See lib/googleHeatmap.ts.
      const heat = createHeatmapOverlay(
        maps,
        filtered.map((inc) => ({ lat: inc.lat, lng: inc.lng, weight: inc.impactScore / 10 })),
        { radius: 24, opacity: 0.6 }
      );
      heat.setMap(map);
      keep(heat);
    }

    if (layers.hotspots) {
      hotspots.forEach((h) => {
        const color = h.risk > 35 ? "#ef4444" : h.risk > 25 ? "#f97316" : "#22c55e";
        const circle = keep(
          new maps.Circle({
            center: { lat: h.lat, lng: h.lng },
            // Already metres in the dataset, which is what Circle wants.
            radius: Math.max(h.radiusM, 300),
            strokeColor: color,
            strokeWeight: 2,
            strokeOpacity: 0.9,
            fillColor: color,
            fillOpacity: 0.12,
            zIndex: 10,
            map,
          })
        );
        circle.addListener("click", () => {
          info.setContent(
            popupHtml(
              `<strong>Hotspot #${h.id}</strong><br/>
               Incidents: ${h.count} | Risk: ${h.risk}<br/>
               Avg Score: ${h.avgScore} | Peak: ${h.peakHour}:00<br/>
               ${h.roadType} — ${h.incidentType.replace(/_/g, " ")}`
            )
          );
          // close() first: a circle has no anchor, and an InfoWindow that was
          // last opened against a marker keeps that anchor over setPosition.
          info.close();
          info.setPosition({ lat: h.lat, lng: h.lng });
          info.open({ map });
        });
      });
    }

    // Real accident blackspots (NTC 2024 / data.gov.lk) — ground truth, drawn
    // as a dark diamond with the junction name underneath so they never read
    // as one of the model's own priority dots.
    if (layers.blackspots) {
      blackspots.forEach((b) => {
        const marker = keep(
          new maps.Marker({
            position: { lat: b.lat, lng: b.lng },
            title: b.name,
            zIndex: 20,
            icon: {
              // Unit diamond centred on the point; scale is the half-diagonal.
              path: "M 0,-1 L 1,0 L 0,1 L -1,0 Z",
              scale: 8,
              fillColor: "#7f1d1d",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 1.5,
              // Pushes the label clear of the diamond instead of inside it.
              labelOrigin: new maps.Point(0, 2.4),
            },
            label: {
              text: b.name,
              color: "#7f1d1d",
              fontSize: "10px",
              fontWeight: "600",
            },
            map,
          })
        );
        marker.addListener("click", () =>
          openInfo(
            marker,
            `<strong>${b.name}</strong><br/>
             <span style="color:#6B7280">${b.roadType}</span><br/>
             ${b.notes}<br/>
             <span style="color:#b91c1c;font-weight:600">Real accident blackspot — NTC 2024 / data.gov.lk</span>`
          )
        );
      });
    }

    // Incidents last and highest so one inside a hotspot ring stays clickable.
    if (layers.incidents) {
      filtered.forEach((inc) => {
        const marker = keep(
          new maps.Marker({
            position: { lat: inc.lat, lng: inc.lng },
            zIndex: 30,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              // Pixel radius, same formula as the Leaflet circleMarker.
              scale: (inc.live ? 7 : 4) + inc.impactScore * 0.5,
              fillColor: PRIORITY_COLORS[inc.priority] || "#888",
              fillOpacity: inc.live ? 0.95 : 0.8,
              strokeColor: inc.live ? "#111827" : "rgba(0,0,0,0.28)",
              strokeWeight: inc.live ? 3 : 1,
            },
            map,
          })
        );
        marker.addListener("click", () => {
          openInfo(
            marker,
            `${inc.live ? '<strong style="color:#F97316">● LIVE REPORT</strong><br/>' : ""}
             <strong>${inc.id}</strong> — <span style="color:${PRIORITY_COLORS[inc.priority]}">${inc.priority}</span><br/>
             Score: <strong>${inc.impactScore}/10</strong><br/>
             ${inc.incidentType.replace(/_/g, " ")} on ${inc.roadType}<br/>
             ${
               inc.live && inc.providerName
                 ? `Dispatched: <strong>${inc.providerName}</strong>`
                 : `Queue: ${inc.queueKm}km | VHL: ${inc.vhl}`
             }`
          );
          onSelectIncident(inc);
        });
      });
    }
  }, [ready, incidents, hotspots, blackspots, filters, layers, onSelectIncident]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-border bg-muted/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Google Maps could not load ({failed}). Check
          <span className="font-mono"> NEXT_PUBLIC_GOOGLE_MAPS_API_KEY </span>
          and that the key allows this domain.
        </p>
      </div>
    );
  }

  return <div ref={nodeRef} className="h-full w-full rounded-xl" />;
}
