/**
 * A provider who cannot perform the predicted service is not a candidate.
 *
 * Regression test for a real production incident on 2026-08-31: a mobile
 * mechanic 0.0 minutes away was ranked #1 for an incident whose most likely
 * diagnosis was SEVERE_MECHANICAL_TOW, a service it has no capability for,
 * beating four tow trucks that did. It won because the ECM PRICES mismatch
 * (assessment delay + re-dispatch penalty + service time, ~40 cost units at
 * 50% risk) and that did not cover being 34 minutes closer.
 *
 * Pricing is right for substitutable work and wrong for a tow: a mechanic
 * with no tow gear achieves nothing on scene, so the driver waits the full
 * assessment-plus-re-dispatch delay to learn it. Hence a hard gate on the
 * predicted type, asserted here at the query level.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    incident: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    provider: { findMany: vi.fn() },
    dispatchDecision: { create: vi.fn() },
  },
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../src/services/geo-client", () => ({ fetchTrafficImpactScore: vi.fn(async () => 5) }));

import { executeDispatch } from "../src/services/dispatch-executor";
import { SERVICE_TYPES } from "../src/types";

const INCIDENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** A distribution whose argmax is SEVERE_MECHANICAL_TOW, shaped like the real one. */
function towLikely() {
  const p: Record<string, number> = {};
  for (const st of SERVICE_TYPES) p[st] = 0;
  p.SEVERE_MECHANICAL_TOW = 0.5;
  p.ENGINE_OVERHEAT_SEVERE = 0.33;
  p.COOLANT_LOW = 0.17;
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.incident.findUnique.mockResolvedValue({
    id: INCIDENT_ID, latitude: 6.9147, longitude: 79.9724,
    triageResponse: { probabilities: towLikely(), tier: "QUESTIONNAIRE_ONLY", confidence: 0.657 },
  });
  mockPrisma.incident.findMany.mockResolvedValue([]); // nobody busy
  mockPrisma.dispatchDecision.create.mockResolvedValue({});
  mockPrisma.incident.update.mockResolvedValue({});
  mockPrisma.incident.updateMany.mockResolvedValue({ count: 1 });
});

describe("dispatch candidate selection", () => {
  it("asks the database only for providers who can do the predicted service", async () => {
    mockPrisma.provider.findMany.mockResolvedValue([{
      id: "tow-1", name: "Heavy Recovery", type: "TOW_HEAVY",
      latitude: 6.95, longitude: 79.86,
      capabilities: ["SEVERE_MECHANICAL_TOW", "ENGINE_OVERHEAT_SEVERE"],
      trustScore: 0.75, serviceTimes: {},
    }]);

    await executeDispatch({ incidentId: INCIDENT_ID });

    const where = mockPrisma.provider.findMany.mock.calls[0][0].where;
    expect(where.capabilities).toEqual({ has: "SEVERE_MECHANICAL_TOW" });
    expect(where.status).toBe("AVAILABLE");
  });

  it("escalates rather than sending someone who cannot help", async () => {
    // The whole fleet is mechanics; none can tow. Dispatching one anyway is
    // the bug, not a fallback.
    mockPrisma.provider.findMany.mockResolvedValue([]);

    const outcome = await executeDispatch({ incidentId: INCIDENT_ID });

    expect(outcome.status).toBe("no_providers");
    expect(mockPrisma.dispatchDecision.create).not.toHaveBeenCalled();
  });

  it("still excludes providers already holding a job", async () => {
    // The capability gate must not have displaced the busy-provider rule.
    mockPrisma.incident.findMany.mockResolvedValue([{ assignedProviderId: "busy-1" }]);
    mockPrisma.provider.findMany.mockResolvedValue([{
      id: "tow-2", name: "Free Tow", type: "TOW_HEAVY",
      latitude: 6.95, longitude: 79.86,
      capabilities: ["SEVERE_MECHANICAL_TOW"], trustScore: 0.75, serviceTimes: {},
    }]);

    await executeDispatch({ incidentId: INCIDENT_ID });

    const where = mockPrisma.provider.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ notIn: ["busy-1"] });
    expect(where.capabilities).toEqual({ has: "SEVERE_MECHANICAL_TOW" });
  });
});
