"use client";

import { useEffect, useRef, useState } from "react";
import { matchesFilters } from "@/lib/filters";
import { PRIORITY_COLORS, type MapProps } from "@/components/Map";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { useT } from "@/lib/i18n";
import { createHeatmapOverlay } from "@/lib/googleHeatmap";
import { createIncidentOverlay } from "@/lib/googleIncidentLayer";

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
  focus,
}: MapProps) {
  const t = useT();
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

  // Its own effect, not part of the render pass: the map loads asynchronously
  // after the tab switch that brings the operator here, so a fit applied while
  // the layers are drawn would race the load and be dropped.
  useEffect(() => {
    if (!ready || !focus) return;
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;
    // A Circle with no map attached is the cheapest way to get the bounds of a
    // radius in metres. 1.6x leaves the cluster surrounded by the roads it sits
    // on rather than filling the frame edge to edge.
    const bounds = new maps.Circle({
      center: { lat: focus.lat, lng: focus.lng },
      radius: focus.radiusM * 1.6,
    }).getBounds();
    map.fitBounds(bounds);
  }, [ready, focus]);

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
      return matchesFilters(inc, filters);
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
              `<strong>${t("dashboard.map.hotspotTitle", { id: h.id })}</strong><br/>
               ${t("dashboard.map.hotspotCounts", { n: h.count, risk: h.risk })}<br/>
               ${t("dashboard.map.hotspotScores", { score: h.avgScore, hour: h.peakHour })}<br/>
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
             <span style="color:#b91c1c;font-weight:600">${t("dashboard.map.blackspotSource")}</span>`
          )
        );
      });
    }

    if (layers.incidents && filtered.length > 0) {
      // One canvas, not one map object per incident. The canvas cannot take
      // pointer events without swallowing drags, so the map owns the click and
      // the overlay resolves which incident it landed on.
      const layer = createIncidentOverlay(maps, filtered, PRIORITY_COLORS);
      layer.setMap(map);
      keep(layer);

      // A hotspot ring drawn under the canvas still wins its own clicks; those
      // layers are off by default, so an incident hidden beneath one is an
      // accepted edge rather than something to arbitrate here.
      const click = map.addListener("click", (e: any) => {
        const hit = e?.latLng ? layer.hitTest(e.latLng) : null;
        if (hit) onSelectIncident(hit);
      });
      keep({ setMap: () => click.remove() } as any);
    }
  }, [ready, incidents, hotspots, blackspots, filters, layers, onSelectIncident, t]);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-border bg-muted/40 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t("dashboard.map.googleFailed", { message: failed })}
        </p>
      </div>
    );
  }

  return <div ref={nodeRef} className="h-full w-full rounded-xl" />;
}
