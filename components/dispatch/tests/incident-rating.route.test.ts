/**
 * The driver's rating, and the trust score it moves.
 *
 * Mocked rather than run against the database ON PURPOSE: recomputing trust
 * writes to a real `providers` row, and a test that drags a seeded provider's
 * score from 0.75 to the floor would quietly change every ECM ranking the
 * demo depends on. The rule being tested is arithmetic, not persistence.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    resolutionFeedback: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    provider: { update: vi.fn() },
    incident: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    dispatchDecision: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { incidentRouter } from "../src/routes/incident.routes";
import { recomputeProviderTrust } from "../src/services/provider-trust";

const INCIDENT_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/incidents", incidentRouter);
  return app;
}

function rate(body: unknown) {
  return request(makeApp()).post(`/api/v1/incidents/${INCIDENT_ID}/rating`).send(body);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.provider.update.mockResolvedValue({});
  mockPrisma.resolutionFeedback.update.mockResolvedValue({ userRating: 5 });
});

describe("POST /api/v1/incidents/:id/rating", () => {
  it("records the rating and recomputes the provider's trust", async () => {
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue({
      incidentId: INCIDENT_ID, providerId: PROVIDER_ID, wasMatch: true, userRating: null,
    });
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: 5 },
    ]);

    const res = await rate({ rating: 5 });

    expect(res.status).toBe(200);
    expect(mockPrisma.resolutionFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userRating: 5 } })
    );
    expect(mockPrisma.provider.update).toHaveBeenCalledTimes(1);
  });

  it("refuses to rate a job the provider has not closed yet", async () => {
    // No feedback row means the job was never resolved, so there is nothing
    // for the rating to attach to.
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue(null);

    const res = await rate({ rating: 4 });

    expect(res.status).toBe(409);
    expect(mockPrisma.provider.update).not.toHaveBeenCalled();
  });

  it("rejects ratings outside one to five, and fractions", async () => {
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue({
      incidentId: INCIDENT_ID, providerId: PROVIDER_ID, wasMatch: true, userRating: null,
    });

    for (const rating of [0, 6, -1, 3.5]) {
      const res = await rate({ rating });
      expect(res.status, `rating ${rating}`).toBe(400);
    }
    expect(mockPrisma.resolutionFeedback.update).not.toHaveBeenCalled();
  });
});

describe("recomputeProviderTrust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.provider.update.mockResolvedValue({});
  });

  it("counts an unrated matched job as a success", async () => {
    // Most drivers never rate. Treating silence as dissatisfaction would drag
    // every provider to the floor.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: null },
      { wasMatch: true, userRating: null },
    ]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.trustScore).toBe(1);
    expect(trust.averageRating).toBeNull();
  });

  it("treats a low rating as a failed job even when the diagnosis matched", async () => {
    // This is the whole point of collecting the rating: the right provider
    // can still do a bad job, and only the driver can say so.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: 2 },
      { wasMatch: true, userRating: 5 },
    ]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.successfulJobs).toBe(1);
    expect(trust.trustScore).toBe(0.5);
    expect(trust.averageRating).toBe(3.5);
  });

  it("never sinks below the floor, however bad the record", async () => {
    // Trust divides the ECM's cost, so an unbounded score would price a
    // provider out of every future dispatch with no way back.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ wasMatch: false, userRating: 1 }))
    );

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.trustScore).toBe(0.5);
  });

  it("leaves a provider with no history on the default, not on zero", async () => {
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.trustScore).toBe(0.75);
    expect(trust.totalJobs).toBe(0);
  });

  it("is idempotent — recomputing the same history writes the same score", async () => {
    // Derived rather than incremented, which is what makes it safe to call
    // from both the resolve path and the rating path.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: 4 },
      { wasMatch: false, userRating: null },
    ]);

    const first = await recomputeProviderTrust(PROVIDER_ID);
    const second = await recomputeProviderTrust(PROVIDER_ID);

    expect(second).toEqual(first);
    expect(first.trustScore).toBe(0.5);
  });
});
