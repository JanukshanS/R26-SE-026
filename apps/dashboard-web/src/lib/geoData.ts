// Geo data layer: fetches hotspots and stats from the geo-intelligence API with
// graceful fallback to static JSON under public/data/. Mirrors the fail-open
// pattern in liveData.ts — the dashboard never blanks when geo is down.
import type { HotspotCluster, Stats } from "./types";

const GEO_URL = process.env.NEXT_PUBLIC_GEO_URL ?? "http://localhost:5001";
const FETCH_TIMEOUT_MS = 3000;

export type DataSource = "api" | "static";

export type GeoHealth = {
  ok: boolean;
  weights?: Record<string, number>;
};

interface ApiHotspot {
  cluster_id: number;
  centroid_lat: number;
  centroid_lon: number;
  incident_count: number;
  avg_score: number;
  composite_risk: number;
  road_type?: string | null;
  incident_type?: string | null;
  peak_hour?: number | null;
  radius_m?: number | null;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function apiHotspotToDashboard(row: ApiHotspot): HotspotCluster {
  return {
    id: row.cluster_id,
    lat: row.centroid_lat,
    lng: row.centroid_lon,
    count: row.incident_count,
    avgScore: row.avg_score,
    risk: row.composite_risk,
    roadType: row.road_type ?? "primary",
    incidentType: row.incident_type ?? "unknown",
    peakHour: row.peak_hour ?? 0,
    radiusM: row.radius_m ?? 500,
  };
}

export async function fetchGeoHealth(): Promise<GeoHealth> {
  try {
    const res = await fetchWithTimeout(`${GEO_URL}/v1/health`);
    if (!res.ok) return { ok: false };
    const body = await res.json();
    return { ok: body.status === "ok", weights: body.weights };
  } catch {
    return { ok: false };
  }
}

export async function fetchHotspots(): Promise<{ data: HotspotCluster[]; source: DataSource }> {
  try {
    const res = await fetchWithTimeout(`${GEO_URL}/v1/hotspots`);
    if (!res.ok) throw new Error(`hotspots ${res.status}`);
    const rows: ApiHotspot[] = await res.json();
    if (process.env.NODE_ENV === "development") {
      console.info("[geoData] hotspots from API", rows.length);
    }
    return { data: rows.map(apiHotspotToDashboard), source: "api" };
  } catch {
    const res = await fetch("/data/hotspots.json");
    const data: HotspotCluster[] = await res.json();
    if (process.env.NODE_ENV === "development") {
      console.info("[geoData] hotspots from static fallback", data.length);
    }
    return { data, source: "static" };
  }
}

export async function fetchStats(): Promise<{ data: Stats; source: DataSource }> {
  try {
    const res = await fetchWithTimeout(`${GEO_URL}/v1/stats`);
    if (!res.ok) throw new Error(`stats ${res.status}`);
    const data: Stats = await res.json();
    if (process.env.NODE_ENV === "development") {
      console.info("[geoData] stats from API");
    }
    return { data, source: "api" };
  } catch {
    const res = await fetch("/data/stats.json");
    const data: Stats = await res.json();
    if (process.env.NODE_ENV === "development") {
      console.info("[geoData] stats from static fallback");
    }
    return { data, source: "static" };
  }
}
