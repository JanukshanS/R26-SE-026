/**
 * The driver's confirmation, and the trust score it moves.
 *
 * Mocked rather than run against the database ON PURPOSE: recomputing trust
 * writes to a real `providers` row, and a test that drags a seeded provider's
 * score off its default would quietly change every ECM ranking the demo
 * depends on. The rules being tested are arithmetic, not persistence.
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

const confirm = (body: unknown) =>
  request(makeApp()).post(`/api/v1/incidents/${INCIDENT_ID}/confirm`).send(body);

const openJob = {
  incidentId: INCIDENT_ID,
  providerId: PROVIDER_ID,
  wasMatch: true,
  userRating: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.provider.update.mockResolvedValue({});
  mockPrisma.resolutionFeedback.update.mockResolvedValue({
    driverConfirmed: true,
    userRating: null,
  });
  mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
    { wasMatch: true, userRating: null, driverConfirmed: true },
  ]);
});

describe("POST /api/v1/incidents/:id/confirm", () => {
  it("records that the job was fixed, with no rating given", async () => {
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue(openJob);

    const res = await confirm({ resolved: true });

    expect(res.status).toBe(200);
    expect(mockPrisma.resolutionFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { driverConfirmed: true } })
    );
    expect(mockPrisma.provider.update).toHaveBeenCalledTimes(1);
  });

  it("records a rating alongside the confirmation when one is given", async () => {
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue(openJob);

    await confirm({ resolved: true, rating: 5 });

    expect(mockPrisma.resolutionFeedback.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { driverConfirmed: true, userRating: 5 } })
    );
  });

  it("does not wipe an existing rating when re-confirming without one", async () => {
    // A driver correcting their yes/no answer should not silently lose the
    // stars they already gave.
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue({ ...openJob, userRating: 4 });

    await confirm({ resolved: false });

    const data = mockPrisma.resolutionFeedback.update.mock.calls[0][0].data;
    expect(data).toEqual({ driverConfirmed: false });
    expect(data).not.toHaveProperty("userRating");
  });

  it("refuses a job the provider has not closed yet", async () => {
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue(null);

    const res = await confirm({ resolved: true });

    expect(res.status).toBe(409);
    expect(mockPrisma.provider.update).not.toHaveBeenCalled();
  });

  it("requires an explicit answer, and rejects impossible ratings", async () => {
    mockPrisma.resolutionFeedback.findUnique.mockResolvedValue(openJob);

    const rejected = [
      {},
      { rating: 5 },
      { resolved: true, rating: 0 },
      { resolved: true, rating: 6 },
      { resolved: true, rating: 3.5 },
    ];
    for (const body of rejected) {
      const res = await confirm(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(mockPrisma.resolutionFeedback.update).not.toHaveBeenCalled();
  });
});

describe("recomputeProviderTrust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.provider.update.mockResolvedValue({});
  });

  it("counts a matched job nobody confirmed as a success", async () => {
    // Most drivers close the app the moment their car starts. Treating that
    // silence as a complaint would drag every provider to the floor.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: null, driverConfirmed: null },
      { wasMatch: true, userRating: null, driverConfirmed: null },
    ]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.successfulJobs).toBe(2);
    expect(trust.trustScore).toBe(1);
    expect(trust.averageRating).toBeNull();
  });

  it("counts a job the driver says was NOT fixed as a failure", async () => {
    // The one signal that overrides the provider's own account of their work.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: null, driverConfirmed: false },
      { wasMatch: true, userRating: null, driverConfirmed: true },
    ]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.successfulJobs).toBe(1);
    expect(trust.trustScore).toBe(0.5);
  });

  it("lets a low rating nudge trust down, but never decide it", async () => {
    // Four confirmed-fixed jobs rated one star. The completion record carries
    // it; the stars take off a tenth at most.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue(
      Array.from({ length: 4 }, () => ({ wasMatch: true, userRating: 1, driverConfirmed: true }))
    );

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.successfulJobs).toBe(4);
    // completion 1.0, rating adjustment 0.1 * ((1 - 3) / 2) = -0.1
    expect(trust.trustScore).toBeCloseTo(0.9, 5);
  });

  it("lets a high rating nudge trust up", async () => {
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: 5, driverConfirmed: true },
      { wasMatch: false, userRating: 5, driverConfirmed: true },
    ]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    // completion 0.5, adjustment +0.1
    expect(trust.trustScore).toBeCloseTo(0.6, 5);
    expect(trust.averageRating).toBe(5);
  });

  it("never exceeds one however glowing the ratings", async () => {
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: 5, driverConfirmed: true },
    ]);

    const trust = await recomputeProviderTrust(PROVIDER_ID);

    expect(trust.trustScore).toBe(1);
  });

  it("never sinks below the floor, however bad the record", async () => {
    // Trust divides the ECM cost, so an unbounded score would price a provider
    // out of every future dispatch with no way back.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ wasMatch: false, userRating: 1, driverConfirmed: false }))
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

  it("is idempotent: recomputing the same history writes the same score", async () => {
    // Derived rather than incremented, which is what makes it safe to call
    // from both the resolve path and the confirmation path.
    mockPrisma.resolutionFeedback.findMany.mockResolvedValue([
      { wasMatch: true, userRating: 4, driverConfirmed: true },
      { wasMatch: false, userRating: null, driverConfirmed: null },
    ]);

    const first = await recomputeProviderTrust(PROVIDER_ID);
    const second = await recomputeProviderTrust(PROVIDER_ID);

    expect(second).toEqual(first);
  });
});
