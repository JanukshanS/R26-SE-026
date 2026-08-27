/**
 * Google Maps JavaScript API loader.
 *
 * Google is the preferred basemap: its Sri Lankan road geometry and place
 * names are better than the OSM/CARTO tiles, which matters when an operator is
 * reading a pin against a real junction. The Leaflet components stay in the
 * tree as the fallback for any deployment that has no key configured — see
 * `components/Map.tsx`.
 *
 * Hand-rolled rather than `@googlemaps/js-api-loader`: the whole job is
 * injecting one script tag once, and the promise below is the singleton guard
 * that React Strict Mode's double-effect would otherwise defeat.
 */

export const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

/** Google is preferred, but only when a key was actually configured. */
export const usingGoogleMaps = GOOGLE_MAPS_API_KEY.length > 0;

const CALLBACK = "__kadunaGoogleMapsReady";

/** `geometry` only. The heatmap is our own canvas overlay — Google removed
 *  `visualization.HeatmapLayer` in v3.65. See lib/googleHeatmap.ts. */
const LIBRARIES = "geometry";

/** The `google.maps` namespace. Untyped: `@types/google.maps` is not a
 *  dependency, and the Leaflet components it sits beside are `any` too. */
type GoogleMaps = any;

let loading: Promise<GoogleMaps> | null = null;

export function loadGoogleMaps(): Promise<GoogleMaps> {
  if (loading) return loading;

  loading = new Promise((resolve, reject) => {
    if (!usingGoogleMaps) {
      reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set"));
      return;
    }
    if (typeof window === "undefined") {
      reject(new Error("loadGoogleMaps must run in the browser"));
      return;
    }
    const w = window as unknown as Record<string, any>;
    if (w.google?.maps) {
      resolve(w.google.maps);
      return;
    }

    // `loading=async` is what makes the callback form non-blocking; without it
    // Google logs a performance warning on every page load.
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_API_KEY,
      libraries: LIBRARIES,
      v: "weekly",
      loading: "async",
      callback: CALLBACK,
    });

    w[CALLBACK] = () => resolve(w.google.maps);

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    // A rejected key, a referrer restriction or an offline browser all surface
    // here; the caller falls back to its own error state rather than spinning.
    script.onerror = () => {
      loading = null;
      reject(new Error("Failed to load the Google Maps JavaScript API"));
    };
    document.head.appendChild(script);
  });

  return loading;
}
