import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Separate file because config snapshots the environment on import: this one
// loads the routes with SUPABASE_ANON_KEY unset to prove the check fails closed.
// Set to "" rather than deleted: config calls dotenv.config() at import, which
// would repopulate a deleted key from a developer's .env and silently turn this
// into a test of the configured path.
vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://test-project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "";
});

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    incident: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dispatchDecision: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { dispatchRouter } from "../src/routes/dispatch.routes";
import { incidentRouter } from "../src/routes/incident.routes";

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID = "33333333-3333-4333-8333-333333333333";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = "user-unconfigured";
    next();
  });
  app.use("/api/v1/incidents", incidentRouter);
  app.use("/api/v1/dispatch", dispatchRouter);
  return app;
}

describe("provider-scoped endpoints without SUPABASE_ANON_KEY", () => {
  it("refuses the assigned-jobs listing with 503", async () => {
    const res = await request(makeApp())
      .get(`/api/v1/incidents?assignedProviderId=${PROVIDER_ID}`)
      .set("Authorization", "Bearer test-access-token");

    expect(res.status).toBe(503);
    expect(mockPrisma.incident.findMany).not.toHaveBeenCalled();
  });

  it("refuses accept/decline with 503", async () => {
    const res = await request(makeApp())
      .post("/api/v1/dispatch/respond")
      .send({ incidentId: INCIDENT_ID, providerId: PROVIDER_ID, accepted: true })
      .set("Authorization", "Bearer test-access-token");

    expect(res.status).toBe(503);
    expect(mockPrisma.incident.findUnique).not.toHaveBeenCalled();
  });
});
