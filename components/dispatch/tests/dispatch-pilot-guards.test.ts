/**
 * Pilot guards on who may be offered a real job:
 *  - review/demo accounts listed in DISPATCH_EXCLUDED_PROVIDER_IDS never are;
 *  - providers further than DISPATCH_MAX_DISTANCE_KM from the incident are not
 *    candidates, and if that leaves nobody the job escalates instead.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockConfig } = vi.hoisted(() => ({
  mockPrisma: {
    incident: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    provider: { findMany: vi.fn() },
    dispatchDecision: { create: vi.fn() },
  },
  mockConfig: { maxDistanceKm: 50, excludedProviderIds: [] as string[] },
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../src/services/geo-client", () => ({ fetchTrafficImpactScore: vi.fn(async () => 5) }));
vi.mock("../src/config", async (importOriginal) => {
  const real = (await importOriginal()) as { config: { dispatch: Record<string, unknown> } };
  return { config: { ...real.config, dispatch: new Proxy(real.config.dispatch, { get: (t, k) => (k in mockConfig ? (mockConfig as Record<string, unknown>)[k as string] : t[k as string]) }) } };
});

import { executeDispatch } from "../src/services/dispatch-executor";
import { SERVICE_TYPES } from "../src/types";

const INCIDENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// Colombo Fort.
const INCIDENT = { latitude: 6.9344, longitude: 79.8428 };

function batteryLikely() {
  const p: Record<string, number> = {};
  for (const st of SERVICE_TYPES) p[st] = 0;
  p.BATTERY_JUMP = 0.8;
  p.ALTERNATOR_ISSUE = 0.2;
  return p;
}

const mechanic = (id: string, latitude: number, longitude: number) => ({
  id, name: id, type: "MOBILE_MECHANIC", latitude, longitude,
  capabilities: ["BATTERY_JUMP", "ALTERNATOR_ISSUE"], trustScore: 0.75, serviceTimes: {},
});

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.maxDistanceKm = 50;
  mockConfig.excludedProviderIds = [];
  mockPrisma.incident.findUnique.mockResolvedValue({
    id: INCIDENT_ID, ...INCIDENT,
    triageResponse: { probabilities: batteryLikely(), tier: "QUESTIONNAIRE_ONLY", confidence: 0.8 },
  });
  mockPrisma.incident.findMany.mockResolvedValue([]);
  mockPrisma.dispatchDecision.create.mockResolvedValue({});
  mockPrisma.incident.update.mockResolvedValue({});
});

describe("excluded review/demo providers", () => {
  it("leaves them out of the candidate query", async () => {
    mockConfig.excludedProviderIds = ["play-test-mechanic"];
    mockPrisma.provider.findMany.mockResolvedValue([mechanic("real-1", 6.93, 79.85)]);

    await executeDispatch({ incidentId: INCIDENT_ID, excludeProviderIds: ["decliner"] });

    const where = mockPrisma.provider.findMany.mock.calls[0][0].where;
    expect(where.id.notIn).toEqual(expect.arrayContaining(["play-test-mechanic", "decliner"]));
  });
});

describe("distance limit", () => {
  it("dispatches the provider in range and ignores one 110 km away", async () => {
    mockPrisma.provider.findMany.mockResolvedValue([
      mechanic("kandy", 7.2906, 80.6337), // ~95 km away by straight line
      mechanic("nugegoda", 6.8649, 79.8997), // ~10 km away
    ]);

    const outcome = await executeDispatch({ incidentId: INCIDENT_ID });

    expect(outcome.status).toBe("dispatched");
    const evaluated = mockPrisma.dispatchDecision.create.mock.calls.map((c) => c[0].data.providerId);
    expect(evaluated).toEqual(["nugegoda"]);
    expect(mockPrisma.incident.update.mock.calls[0][0].data.assignedProviderId).toBe("nugegoda");
  });

  it("escalates when the only capable provider is out of range", async () => {
    mockPrisma.provider.findMany.mockResolvedValue([mechanic("kandy", 7.2906, 80.6337)]);

    const outcome = await executeDispatch({ incidentId: INCIDENT_ID });

    expect(outcome.status).toBe("no_providers");
    expect(mockPrisma.incident.update).not.toHaveBeenCalled();
  });

  it("has no limit when set to 0", async () => {
    mockConfig.maxDistanceKm = 0;
    mockPrisma.provider.findMany.mockResolvedValue([mechanic("kandy", 7.2906, 80.6337)]);

    expect((await executeDispatch({ incidentId: INCIDENT_ID })).status).toBe("dispatched");
  });
});
