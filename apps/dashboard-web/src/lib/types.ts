export interface Incident {
  id: string;
  lat: number;
  lng: number;
  roadType: string;
  roadName: string;
  totalLanes: number;
  lanesBlocked: number;
  incidentType: string;
  hour: number;
  dayOfWeek: number;
  dayName: string;
  impactScore: number;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  queueKm: number;
  vhl: number;
  recoveryMin: number;
  clf: number;
  tvf: number;
  tf: number;
  lf: number;
  isf: number;
}

export interface HotspotCluster {
  id: number;
  lat: number;
  lng: number;
  count: number;
  avgScore: number;
  risk: number;
  roadType: string;
  incidentType: string;
  peakHour: number;
  radiusM: number;
}

export interface Stats {
  totalIncidents: number;
  avgScore: number;
  totalVHL: number;
  totalQueueKm: number;
  priorityDist: Record<string, number>;
  byRoadType: Record<string, number>;
  byHour: Record<string, number>;
  byIncidentType: Record<string, number>;
}

export interface ModelConfig {
  weights: Record<string, number>;
  roadCapacity: Record<string, number>;
  roadLocationFactor: Record<string, number>;
  incidentSeverity: Record<string, number>;
  hourMultiplier: Record<string, number>;
  dayMultiplier: Record<string, number>;
}

export interface WhatIfInput {
  roadType: string;
  totalLanes: number;
  lanesBlocked: number;
  incidentType: string;
  hour: number;
  dayOfWeek: number;
}
