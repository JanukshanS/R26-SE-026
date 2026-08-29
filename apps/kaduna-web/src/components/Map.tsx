"use client";

import type { MapFilters } from "@/lib/filters";
import dynamic from "next/dynamic";
import type { Incident, HotspotCluster, Blackspot } from "@/lib/types";
import { usingGoogleMaps } from "@/lib/googleMaps";

export interface MapProps {
  incidents: Incident[];
  hotspots: HotspotCluster[];
  blackspots: Blackspot[];
  onSelectIncident: (incident: Incident) => void;
  filters: MapFilters;
  layers: { incidents: boolean; hotspots: boolean; heatmap: boolean; blackspots: boolean };
}

/** Shared by both engines so a CRITICAL dot is the same red on either basemap. */
export const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: "oklch(0.68 0.20 22)",
  HIGH: "oklch(0.76 0.16 55)",
  MEDIUM: "oklch(0.85 0.15 92)",
  LOW: "oklch(0.78 0.16 158)",
};

/**
 * Google is the preferred basemap — better Sri Lankan road geometry and place
 * names than the OSM/CARTO tiles, which is what an operator reads a pin
 * against. Leaflet stays as the fallback so a deployment without
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` still gets a working map instead of an
 * empty panel.
 *
 * The choice is made at module scope from a build-time env var, so only the
 * chosen engine is ever fetched.
 */
const Engine = usingGoogleMaps
  ? dynamic(() => import("@/components/GoogleMap"), { ssr: false })
  : dynamic(() => import("@/components/LeafletMap"), { ssr: false });

export default function Map(props: MapProps) {
  return <Engine {...props} />;
}
