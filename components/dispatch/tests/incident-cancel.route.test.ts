/**
 * Cancelling a request the driver no longer needs.
 *
 * The behaviour worth protecting is the BOUNDARY, not the happy path: a
 * request can be called off while it is still being offered around, and must
 * stop being cancellable the moment a provider accepts and starts driving.
 * Getting that wrong strands a provider mid-journey with no job at the end.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { incidentRouter } from "../src/routes/incident.routes";
import { prisma } from "../src/utils/prisma";
import testIncident from "./test-incident.json";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/incidents", incidentRouter);
  return app;
}

async function newIncident(): Promise<string> {
  const res = await request(makeApp())
    .post("/api/v1/incidents")
    .send(testIncident)
    .set("Content-Type", "application/json");
  expect(res.status).toBe(201);
  return res.body.data.id;
}

describe("POST /api/v1/incidents/:id/cancel", () => {
  it("cancels a request nobody has accepted yet", async () => {
    const id = await newIncident();

    const res = await request(makeApp()).post(`/api/v1/incidents/${id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("CANCELLED");
  });

  it("releases the provider the job was being offered to", async () => {
    // A provider holding an unanswered offer must not keep it on their job
    // list after the driver walks away.
    const id = await newIncident();
    const provider = await prisma.provider.findFirst({ where: { status: "AVAILABLE" } });
    expect(provider, "seeded providers required").toBeTruthy();

    await prisma.incident.update({
      where: { id },
      data: { status: "PROVIDER_ASSIGNED", assignedProviderId: provider!.id },
    });

    const res = await request(makeApp()).post(`/api/v1/incidents/${id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CANCELLED");
    expect(res.body.data.assignedProviderId).toBeNull();
  });

  it("treats a repeated cancel as success, not an error", async () => {
    // A retried tap on a flaky roadside connection is the common case; the
    // driver already got what they asked for.
    const id = await newIncident();
    await request(makeApp()).post(`/api/v1/incidents/${id}/cancel`);

    const again = await request(makeApp()).post(`/api/v1/incidents/${id}/cancel`);

    expect(again.status).toBe(200);
    expect(again.body.success).toBe(true);
  });

  it("refuses once a provider has accepted and is driving", async () => {
    const id = await newIncident();
    await prisma.incident.update({ where: { id }, data: { status: "EN_ROUTE" } });

    const res = await request(makeApp()).post(`/api/v1/incidents/${id}/cancel`);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    // The incident must be left exactly as it was.
    const after = await prisma.incident.findUnique({ where: { id } });
    expect(after?.status).toBe("EN_ROUTE");
  });

  it("refuses a job that is already finished", async () => {
    const id = await newIncident();
    await prisma.incident.update({ where: { id }, data: { status: "RESOLVED" } });

    const res = await request(makeApp()).post(`/api/v1/incidents/${id}/cancel`);

    expect(res.status).toBe(409);
  });

  it("404s an incident that does not exist", async () => {
    const res = await request(makeApp())
      .post("/api/v1/incidents/00000000-0000-0000-0000-000000000000/cancel");

    expect(res.status).toBe(404);
  });
});
