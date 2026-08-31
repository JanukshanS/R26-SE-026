import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// config reads these at import time and the ownership check 503s without them,
// so they must be set before the route modules below are loaded.
vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://test-project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    incident: {
      findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
      // findFirst backs the one-job-at-a-time guard on accept.
      findFirst: vi.fn(),
    },
    dispatchDecision: { findFirst: vi.fn(), update: vi.fn() },
    // findMany + provider.update back recomputeProviderTrust, which /resolve
    // calls once the feedback row is written.
    resolutionFeedback: { create: vi.fn(), findMany: vi.fn() },
    provider: { update: vi.fn() },
  },
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { dispatchRouter } from "../src/routes/dispatch.routes";
import { incidentRouter } from "../src/routes/incident.routes";

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROVIDER_ID = "22222222-2222-4222-8222-222222222222";
const INCIDENT_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "Bearer test-access-token";

/** The verified Supabase subject, which requireUser sets in production. */
function makeApp(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = userId;
    next();
  });
  app.use("/api/v1/incidents", incidentRouter);
  app.use("/api/v1/dispatch", dispatchRouter);
  return app;
}

/** Stands in for the PostgREST read of the caller's own profile row. */
function mockProfile(rows: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => rows });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const assignedIncident = {
  id: INCIDENT_ID,
  status: "PROVIDER_ASSIGNED",
  assignedProviderId: PROVIDER_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  // Default: this provider is not already holding another job. Tests that
  // care about the one-job-at-a-time rule override it.
  mockPrisma.incident.findFirst.mockResolvedValue(null);
});

describe("GET /api/v1/incidents?assignedProviderId", () => {
  it("returns the caller's own assigned jobs with triage and provider attached", async () => {
    const fetchMock = mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findMany.mockResolvedValue([assignedIncident]);
    mockPrisma.incident.count.mockResolvedValue(1);

    const res = await request(makeApp("user-owner"))
      .get(`/api/v1/incidents?assignedProviderId=${PROVIDER_ID}`)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data.incidents).toHaveLength(1);
    expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignedProviderId: PROVIDER_ID },
        include: { triageResponse: true, assignedProvider: true },
      }),
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://test-project.supabase.co/rest/v1/profiles?select=provider_id&id=eq.user-owner",
    );
    expect(init.headers).toMatchObject({ apikey: "test-anon-key", Authorization: TOKEN });
  });

  it("rejects a caller who does not own the provider with 403", async () => {
    mockProfile([{ provider_id: OTHER_PROVIDER_ID }]);

    const res = await request(makeApp("user-nonowner"))
      .get(`/api/v1/incidents?assignedProviderId=${PROVIDER_ID}`)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockPrisma.incident.findMany).not.toHaveBeenCalled();
  });

  it("rejects a caller with no profile row with 403", async () => {
    mockProfile([]);

    const res = await request(makeApp("user-noprofile"))
      .get(`/api/v1/incidents?assignedProviderId=${PROVIDER_ID}`)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(403);
    expect(mockPrisma.incident.findMany).not.toHaveBeenCalled();
  });

  it("denies with 502 when the profile lookup cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const res = await request(makeApp("user-unreachable"))
      .get(`/api/v1/incidents?assignedProviderId=${PROVIDER_ID}`)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(502);
    expect(mockPrisma.incident.findMany).not.toHaveBeenCalled();
  });

  it("caches the lookup so a polling client does not re-query Supabase", async () => {
    const fetchMock = mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findMany.mockResolvedValue([]);
    mockPrisma.incident.count.mockResolvedValue(0);

    const app = makeApp("user-poller");
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .get(`/api/v1/incidents?assignedProviderId=${PROVIDER_ID}`)
        .set("Authorization", TOKEN);
      expect(res.status).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/v1/incidents (unfiltered)", () => {
  it("keeps the dashboard listing unscoped and unverified", async () => {
    const fetchMock = mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findMany.mockResolvedValue([assignedIncident]);
    mockPrisma.incident.count.mockResolvedValue(7);

    const res = await request(makeApp("user-dashboard"))
      .get("/api/v1/incidents?limit=15")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { total: 7, limit: 15, offset: 0 },
    });
    expect(res.body.data.incidents).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 15, skip: 0 }),
    );
  });

  it("still filters by status alone", async () => {
    const fetchMock = mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findMany.mockResolvedValue([]);
    mockPrisma.incident.count.mockResolvedValue(0);

    const res = await request(makeApp("user-dashboard-status"))
      .get("/api/v1/incidents?status=CREATED")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPrisma.incident.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "CREATED" } }),
    );
  });
});

describe("POST /api/v1/dispatch/respond", () => {
  const body = { incidentId: INCIDENT_ID, providerId: PROVIDER_ID, accepted: true };

  /** The where clause that makes the transition conditional on the read state. */
  const conditionalWhere = {
    id: INCIDENT_ID,
    assignedProviderId: PROVIDER_ID,
    status: "PROVIDER_ASSIGNED",
  };

  it("refuses a second job while one is already in progress", async () => {
    // A provider driving to one roadside cannot be at another, and a second
    // acceptance strands whichever driver they do not reach.
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue(assignedIncident);
    mockPrisma.incident.findFirst.mockResolvedValue({ id: "other-job-in-progress" });

    const res = await request(makeApp("user-busy"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already have a job/i);
    // The offer must be left untouched, not silently declined on their behalf.
    expect(mockPrisma.incident.updateMany).not.toHaveBeenCalled();
  });

  it("still lets a busy provider DECLINE an offer", async () => {
    // Declining while busy is exactly what a busy provider should be doing.
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique
      .mockResolvedValueOnce(assignedIncident)
      .mockResolvedValueOnce({ ...assignedIncident, status: "DISPATCHING", assignedProviderId: null });
    mockPrisma.incident.findFirst.mockResolvedValue({ id: "other-job-in-progress" });
    mockPrisma.incident.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.dispatchDecision.findFirst.mockResolvedValue({
      id: "decision-1",
      createdAt: new Date(Date.now() - 30_000),
    });

    const res = await request(makeApp("user-busy-decline"))
      .post("/api/v1/dispatch/respond")
      .send({ ...body, accepted: false, declineReason: "BUSY" })
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
  });

  it("accepts a job and moves the incident to EN_ROUTE", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique
      .mockResolvedValueOnce(assignedIncident)
      .mockResolvedValueOnce({ ...assignedIncident, status: "EN_ROUTE" });
    mockPrisma.incident.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.dispatchDecision.findFirst.mockResolvedValue({
      id: "decision-1",
      createdAt: new Date(Date.now() - 30_000),
    });

    const res = await request(makeApp("user-accept"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data.incident.status).toBe("EN_ROUTE");
    expect(mockPrisma.incident.updateMany).toHaveBeenCalledWith({
      where: conditionalWhere,
      data: { status: "EN_ROUTE" },
    });
    expect(mockPrisma.dispatchDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "decision-1" },
        data: expect.objectContaining({ accepted: true, declineReason: null }),
      }),
    );
  });

  it("is idempotent — a second accept does not rewrite the incident", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue({ ...assignedIncident, status: "EN_ROUTE" });

    const res = await request(makeApp("user-accept-twice"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data.incident.status).toBe("EN_ROUTE");
    expect(mockPrisma.incident.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.dispatchDecision.update).not.toHaveBeenCalled();
  });

  it("declines by unassigning the provider and returning the incident to DISPATCHING", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique
      .mockResolvedValueOnce(assignedIncident)
      .mockResolvedValueOnce({ ...assignedIncident, status: "DISPATCHING", assignedProviderId: null });
    mockPrisma.incident.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.dispatchDecision.findFirst.mockResolvedValue({
      id: "decision-2",
      createdAt: new Date(Date.now() - 10_000),
    });

    const res = await request(makeApp("user-decline"))
      .post("/api/v1/dispatch/respond")
      .send({ ...body, accepted: false, declineReason: "Too far" })
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(mockPrisma.incident.updateMany).toHaveBeenCalledWith({
      where: conditionalWhere,
      data: { status: "DISPATCHING", assignedProviderId: null },
    });
    expect(mockPrisma.dispatchDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accepted: false, declineReason: "Too far" }),
      }),
    );
  });

  it("rejects responding for an incident assigned to someone else with 409", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue({
      ...assignedIncident, assignedProviderId: OTHER_PROVIDER_ID,
    });

    const res = await request(makeApp("user-wrong-incident"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(409);
    expect(mockPrisma.incident.updateMany).not.toHaveBeenCalled();
  });

  it("rejects responding on behalf of a provider the caller does not own with 403", async () => {
    mockProfile([{ provider_id: OTHER_PROVIDER_ID }]);

    const res = await request(makeApp("user-impersonator"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(403);
    expect(mockPrisma.incident.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a resolved incident with 409 rather than reopening it", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue({ ...assignedIncident, status: "RESOLVED" });

    const res = await request(makeApp("user-resolved"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(409);
    expect(mockPrisma.incident.updateMany).not.toHaveBeenCalled();
  });

  it("answers 409 when a concurrent response already moved the incident", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue(assignedIncident);
    mockPrisma.incident.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(makeApp("user-race"))
      .post("/api/v1/dispatch/respond")
      .send(body)
      .set("Authorization", TOKEN);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(mockPrisma.dispatchDecision.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.dispatchDecision.update).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    const res = await request(makeApp("user-badbody"))
      .post("/api/v1/dispatch/respond")
      .send({ incidentId: "not-a-uuid", accepted: "yes" })
      .set("Authorization", TOKEN);

    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });
});

describe("POST /api/v1/incidents/:id/resolve — ownership", () => {
  const report = {
    incidentId: INCIDENT_ID,
    providerId: PROVIDER_ID,
    actualServiceType: "BATTERY_JUMP",
    resolutionTimeMinutes: 20,
  };

  it("rejects a caller who does not own the provider, before reading the incident", async () => {
    mockProfile([{ provider_id: OTHER_PROVIDER_ID }]);

    const res = await request(makeApp("u-stranger"))
      .post(`/api/v1/incidents/${INCIDENT_ID}/resolve`)
      .set("Authorization", TOKEN)
      .send(report);

    expect(res.status).toBe(403);
    expect(mockPrisma.incident.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.resolutionFeedback.create).not.toHaveBeenCalled();
  });

  it("rejects resolving an incident assigned to someone else", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue({
      ...assignedIncident,
      assignedProviderId: OTHER_PROVIDER_ID,
      triageResponse: null,
    });

    const res = await request(makeApp("u-owner"))
      .post(`/api/v1/incidents/${INCIDENT_ID}/resolve`)
      .set("Authorization", TOKEN)
      .send(report);

    expect(res.status).toBe(409);
    expect(mockPrisma.incident.update).not.toHaveBeenCalled();
  });

  it("rejects re-resolving an already resolved incident", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue({
      ...assignedIncident,
      status: "RESOLVED",
      triageResponse: null,
    });

    const res = await request(makeApp("u-owner"))
      .post(`/api/v1/incidents/${INCIDENT_ID}/resolve`)
      .set("Authorization", TOKEN)
      .send(report);

    expect(res.status).toBe(409);
    expect(mockPrisma.incident.update).not.toHaveBeenCalled();
    expect(mockPrisma.resolutionFeedback.create).not.toHaveBeenCalled();
  });

  it("lets the assigned owner resolve and writes the Bayesian feedback row", async () => {
    mockProfile([{ provider_id: PROVIDER_ID }]);
    mockPrisma.incident.findUnique.mockResolvedValue({
      ...assignedIncident,
      triageResponse: {
        probabilities: { BATTERY_JUMP: 0.8 },
        predictedServiceType: "BATTERY_JUMP",
        confidence: 0.8,
      },
    });
    mockPrisma.incident.update.mockResolvedValue({ ...assignedIncident, status: "RESOLVED" });
    mockPrisma.resolutionFeedback.create.mockResolvedValue({});
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: null },
      { wasMatch: false, userRating: 2 },
    ]);
    mockPrisma.provider.update.mockResolvedValue({});

    const res = await request(makeApp("u-owner"))
      .post(`/api/v1/incidents/${INCIDENT_ID}/resolve`)
      .set("Authorization", TOKEN)
      .send(report);

    expect(res.status).toBe(200);
    expect(mockPrisma.resolutionFeedback.create).toHaveBeenCalledTimes(1);
    const written = mockPrisma.resolutionFeedback.create.mock.calls[0][0].data;
    expect(written.providerId).toBe(PROVIDER_ID);
    expect(written.wasMatch).toBe(true);

    // Closing a job must move the provider's trust, since the ECM divides
    // expected cost by it. One matched job of two, floored at 0.5.
    expect(mockPrisma.provider.update).toHaveBeenCalledTimes(1);
    const trustWrite = mockPrisma.provider.update.mock.calls[0][0];
    expect(trustWrite.where.id).toBe(PROVIDER_ID);
    expect(trustWrite.data.totalJobs).toBe(2);
    expect(trustWrite.data.successfulJobs).toBe(1);
    expect(trustWrite.data.trustScore).toBe(0.5);
    expect(trustWrite.data.averageRating).toBe(2);
  });
});
