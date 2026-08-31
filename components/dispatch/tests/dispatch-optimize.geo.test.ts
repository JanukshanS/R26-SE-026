import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// config reads TRAFFIC_LAMBDA at import time, so pin it before the imports below
// run — the ranking assertions compare costs whose margins depend on lambda.
vi.hoisted(() => {
  process.env.TRAFFIC_LAMBDA = "0.3";
});

const { mockFetchGeo, mockPrisma } = vi.hoisted(() => ({
  mockFetchGeo: vi.fn(),
  mockPrisma: {
    // findMany backs the busy-provider exclusion: a provider already
    // holding a job is not a candidate for another one.
    incident: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    provider: { findMany: vi.fn() },
    dispatchDecision: { create: vi.fn() },
  },
}));

vi.mock("../src/services/geo-client", () => ({
  fetchTrafficImpactScore: (...args: unknown[]) => mockFetchGeo(...args),
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { dispatchRouter } from "../src/routes/dispatch.routes";
import { ECMProvider, runDispatchOptimizer } from "../src/services/dispatch-optimizer";
import { SERVICE_TYPES, ServiceTypeProbabilities } from "../src/types";

function probFor(serviceType: string, value = 1.0): ServiceTypeProbabilities {
  return Object.fromEntries(
    SERVICE_TYPES.map((st) => [st, st === serviceType ? value : 0]),
  ) as ServiceTypeProbabilities;
}

const INCIDENT_ID = "550e8400-e29b-41d4-a716-446655440001";
const triageProbabilities = probFor("MAJOR_ACCIDENT");

const mockIncident = {
  id: INCIDENT_ID,
  latitude: 6.9271,
  longitude: 79.8612,
  status: "DISPATCHING",
  triageResponse: {
    tier: "CRITICAL",
    confidence: 0.92,
    probabilities: triageProbabilities,
  },
};

const mockProviders = [
  {
    id: "p1",
    name: "Alpha Tow",
    type: "TOW_HEAVY",
    latitude: 6.93,
    longitude: 79.87,
    capabilities: ["MAJOR_ACCIDENT", "URGENT_TOW"],
    trustScore: 0.9,
    status: "AVAILABLE",
  },
  {
    id: "p2",
    name: "Beta Rescue",
    type: "MOBILE_MECHANIC",
    latitude: 6.91,
    longitude: 79.85,
    capabilities: ["BATTERY_JUMP"],
    trustScore: 0.85,
    status: "AVAILABLE",
  },
];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/dispatch", dispatchRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.incident.findUnique.mockResolvedValue(mockIncident);
  mockPrisma.provider.findMany.mockResolvedValue(mockProviders);
  mockPrisma.incident.findMany.mockResolvedValue([]); // nobody is busy
  mockPrisma.incident.update.mockResolvedValue({});
  mockPrisma.dispatchDecision.create.mockResolvedValue({});
});

describe("POST /api/v1/dispatch/optimize — geo-intelligence wiring", () => {
  it("sets trafficImpactSource geo-intelligence when geo returns score", async () => {
    mockFetchGeo.mockResolvedValueOnce(7.8);
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.metadata.trafficImpactSource).toBe("geo-intelligence");
    expect(res.body.data.metadata.trafficImpactScore).toBe(7.8);
    expect(mockFetchGeo).toHaveBeenCalledWith({
      latitude: mockIncident.latitude,
      longitude: mockIncident.longitude,
      probabilities: triageProbabilities,
    });
  });

  it("sets trafficExternalityCost > 0 when geo score > 0", async () => {
    mockFetchGeo.mockResolvedValueOnce(7.8);
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(res.status).toBe(200);
    const breakdown = res.body.data.selectedProvider.costBreakdown;
    expect(breakdown).toBeDefined();
    expect(typeof breakdown.trafficExternalityCost).toBe("number");
    expect(breakdown.trafficExternalityCost).toBeGreaterThan(0);
  });

  it("falls back to default score 5 when geo returns null (timeout/unreachable)", async () => {
    mockFetchGeo.mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.metadata.trafficImpactSource).toBe("default");
    expect(res.body.data.metadata.trafficImpactScore).toBe(5);
  });

  it("does not call geo when client supplies trafficImpactScore", async () => {
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID, trafficImpactScore: 9 });

    expect(res.status).toBe(200);
    expect(mockFetchGeo).not.toHaveBeenCalled();
    expect(res.body.data.metadata.trafficImpactSource).toBe("client");
    expect(res.body.data.metadata.trafficImpactScore).toBe(9);
  });

  it("returns 404 when incident not found", async () => {
    mockPrisma.incident.findUnique.mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(res.status).toBe(404);
    expect(mockFetchGeo).not.toHaveBeenCalled();
  });

  it("returns 400 when triage not completed", async () => {
    mockPrisma.incident.findUnique.mockResolvedValueOnce({
      ...mockIncident,
      triageResponse: null,
    });
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(res.status).toBe(400);
    expect(mockFetchGeo).not.toHaveBeenCalled();
  });

  it("returns 404 when no available providers", async () => {
    mockFetchGeo.mockResolvedValueOnce(6.0);
    mockPrisma.provider.findMany.mockResolvedValueOnce([]);
    const res = await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No available providers/i);
  });

  it("returns 400 on invalid body", async () => {
    const res = await request(makeApp()).post("/api/v1/dispatch/optimize").send({});
    expect(res.status).toBe(400);
    expect(mockFetchGeo).not.toHaveBeenCalled();
  });

  it("persists dispatch decision with trafficImpactScore", async () => {
    mockFetchGeo.mockResolvedValueOnce(7.0);
    await request(makeApp())
      .post("/api/v1/dispatch/optimize")
      .send({ incidentId: INCIDENT_ID });

    expect(mockPrisma.dispatchDecision.create).toHaveBeenCalled();
    const payload = mockPrisma.dispatchDecision.create.mock.calls[0][0].data;
    expect(payload.trafficImpactScore).toBe(7);
  });
});

describe("runDispatchOptimizer — traffic impact influences ranking", () => {
  // Both providers are MOBILE_MECHANIC and the incident is 100% BATTERY_JUMP,
  // so neither carries a mismatch term and the only difference is travel time
  // vs trust. The nearer provider is the less trusted one.
  const incidentLocation = { latitude: 6.9271, longitude: 79.8612 };
  const batteryOnly = probFor("BATTERY_JUMP");

  const nearLowTrust: ECMProvider = {
    id: "near",
    name: "Near Low-Trust Mechanic",
    type: "MOBILE_MECHANIC",
    latitude: 6.9361,
    longitude: 79.8612,
    capabilities: ["BATTERY_JUMP"],
    trustScore: 0.25,
  };

  const farHighTrust: ECMProvider = {
    id: "far",
    name: "Far High-Trust Mechanic",
    type: "MOBILE_MECHANIC",
    latitude: 7.1071,
    longitude: 79.8612,
    capabilities: ["BATTERY_JUMP"],
    trustScore: 1.0,
  };

  const providers = [nearLowTrust, farHighTrust];
  const rankedIds = async (score: number) =>
    (await runDispatchOptimizer(providers, incidentLocation, batteryOnly, score))
      .rankedProviders.map((p) => p.provider.id);

  it("ranks providers differently at low vs high traffic impact", async () => {
    expect(await rankedIds(1)).not.toEqual(await rankedIds(10));
  });

  it("prefers the far high-trust provider at low traffic impact", async () => {
    expect((await rankedIds(1))[0]).toBe("far");
  });

  it("prefers the near provider at high traffic impact", async () => {
    expect((await rankedIds(10))[0]).toBe("near");
  });
});
