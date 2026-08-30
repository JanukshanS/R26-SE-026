"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, usingGoogleMaps } from "@/lib/googleMaps";
import { useT } from "@/lib/i18n";

export type Coords = { latitude: number; longitude: number };

/** Colombo Fort, used only as the initial view before a pin exists. */
const DEFAULT_CENTER: [number, number] = [6.9271, 79.8612];

/**
 * Street address for a pin, from OpenStreetMap's Nominatim. Coordinates mean
 * nothing to the person reporting a breakdown — a road name is what tells them
 * the pin is in the right place. Returns null on any failure; the caller falls
 * back to showing the coordinates, which are still what gets sent.
 *
 * Stays on Nominatim even when the basemap is Google: the Geocoding API is not
 * enabled on the project key, and this call is not on the critical path.
 */
async function reverseGeocode(c: Coords, signal: AbortSignal): Promise<string | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17` +
      `&lat=${c.latitude}&lon=${c.longitude}`;
    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    const a = body?.address ?? {};
    // Build a short "road, neighbourhood, city" line rather than Nominatim's
    // full display_name, which runs to the country and postcode.
    const parts = [
      a.road ?? a.pedestrian ?? a.footway,
      a.neighbourhood ?? a.suburb ?? a.village,
      a.city ?? a.town ?? a.county,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : (body?.display_name ?? null);
  } catch {
    return null;
  }
}

interface PinMapProps {
  value: Coords | null;
  onChange: (c: Coords) => void;
}

const MAP_CLASS = "h-72 w-full overflow-hidden rounded-lg border border-border";

/**
 * Preferred pin map. Google's road geometry and junction names are closer to
 * what the driver sees out of the windscreen than the OSM/CARTO tiles, which
 * is the whole point of a pin the tow truck has to find.
 */
function GooglePinMap({ value, onChange }: PinMapProps) {
  const t = useT();
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!nodeRef.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !nodeRef.current || mapRef.current) return;

        const start = value
          ? { lat: value.latitude, lng: value.longitude }
          : { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };

        const map = new maps.Map(nodeRef.current, {
          center: start,
          zoom: value ? 16 : 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          // POI pins are clickable by default and swallow the map click that
          // is supposed to place the pin.
          clickableIcons: false,
        });

        const marker = new maps.Marker({
          position: start,
          map,
          draggable: true,
          visible: Boolean(value),
          title: t("dashboard.locationPicker.dragTitle"),
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: "#dc2626",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });

        marker.addListener("dragend", (e: any) => {
          onChangeRef.current({ latitude: e.latLng.lat(), longitude: e.latLng.lng() });
        });
        map.addListener("click", (e: any) => {
          onChangeRef.current({ latitude: e.latLng.lat(), longitude: e.latLng.lng() });
        });

        mapRef.current = map;
        markerRef.current = marker;
      })
      .catch(() => {
        /* The panel below still shows the coordinates, which is what gets sent. */
      });

    return () => {
      cancelled = true;
      markerRef.current?.setMap(null);
      mapRef.current = null;
      markerRef.current = null;
    };
    // Mount-only: `value` updates are pushed to the existing map by the effect
    // below, so a new pin never tears down the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow externally-set coordinates ("Use my location").
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !value) return;
    const p = { lat: value.latitude, lng: value.longitude };
    marker.setPosition(p);
    marker.setVisible(true);
    map.setCenter(p);
    if (map.getZoom() < 16) map.setZoom(16);
  }, [value]);

  return (
    <div
      ref={nodeRef}
      role="application"
      aria-label={t("dashboard.locationPicker.mapLabel")}
      className={MAP_CLASS}
    />
  );
}

/** Fallback pin map for deployments with no Google Maps key configured. */
function LeafletPinMap({ value, onChange }: PinMapProps) {
  const t = useT();
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!nodeRef.current) return;
    let cancelled = false;
    let localMap: any = null;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !nodeRef.current) return;
      const node = nodeRef.current as HTMLDivElement & { _leaflet_id?: number };
      if (node._leaflet_id || mapRef.current) return;

      const map = L.map(node, {
        center: value ? [value.latitude, value.longitude] : DEFAULT_CENTER,
        zoom: value ? 16 : 12,
        zoomControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      // A divIcon rather than L.marker's default: the default pulls PNG sprites
      // from a CDN path that a static export doesn't serve.
      const icon = L.divIcon({
        className: "pin-marker",
        html: '<span class="pin-dot"></span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });

      const marker = L.marker(value ? [value.latitude, value.longitude] : DEFAULT_CENTER, {
        icon,
        draggable: true,
        opacity: value ? 1 : 0,
        keyboard: true,
        title: t("dashboard.locationPicker.dragTitle"),
      }).addTo(map);

      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onChangeRef.current({ latitude: p.lat, longitude: p.lng });
      });
      map.on("click", (e: any) => {
        onChangeRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng });
      });

      localMap = map;
      mapRef.current = map;
      markerRef.current = marker;
      // Leaflet measures the container on creation; inside a card that is still
      // being laid out it can come up zero-height and render grey tiles.
      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      cancelled = true;
      const m = mapRef.current ?? localMap;
      if (m) {
        m.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !value) return;
    marker.setLatLng([value.latitude, value.longitude]);
    marker.setOpacity(1);
    map.setView([value.latitude, value.longitude], Math.max(map.getZoom(), 16));
  }, [value]);

  return (
    <div
      ref={nodeRef}
      role="application"
      aria-label={t("dashboard.locationPicker.mapLabel")}
      className={MAP_CLASS}
    />
  );
}

const PinMap = usingGoogleMaps ? GooglePinMap : LeafletPinMap;

/**
 * Click-or-drag map pin for the breakdown location.
 *
 * Phone GPS in Colombo is routinely off by a block, and a wrong pin sends the
 * tow truck to the wrong road — so the pin is always movable, and the map is
 * the primary input rather than a preview of typed coordinates.
 */
export default function LocationPicker({
  value,
  onChange,
  hint,
  confirmLabel,
}: {
  value: Coords | null;
  onChange: (c: Coords) => void;
  /** Overrides the driver-facing prompt for surfaces that are not a call for help. */
  hint?: React.ReactNode;
  /** Overrides the label above the chosen place, for the same reason. */
  confirmLabel?: string;
}) {
  const t = useT();
  const [place, setPlace] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  // Name the pin. Debounced because dragging fires this on every drop and
  // Nominatim asks for at most one request a second.
  useEffect(() => {
    if (!value) {
      setPlace(null);
      return;
    }
    const controller = new AbortController();
    setLooking(true);
    const t = setTimeout(() => {
      reverseGeocode(value, controller.signal).then((name) => {
        setPlace(name);
        setLooking(false);
      });
    }, 600);
    return () => {
      clearTimeout(t);
      controller.abort();
      setLooking(false);
    };
  }, [value]);

  return (
    <div>
      <PinMap value={value} onChange={onChange} />
      <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
        {value ? (
          <>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {confirmLabel ?? t("dashboard.locationPicker.sendingTo")}
            </p>
            <p className="mt-0.5 font-medium">
              {place ??
                (looking
                  ? t("dashboard.locationPicker.looking")
                  : t("dashboard.locationPicker.pinPlaced"))}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {t(
                confirmLabel
                  ? "dashboard.locationPicker.coordsDrag"
                  : "dashboard.locationPicker.coordsDragHere",
                { lat: value.latitude.toFixed(5), lng: value.longitude.toFixed(5) }
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {hint ?? t("dashboard.locationPicker.hint")}
          </p>
        )}
      </div>
    </div>
  );
}
