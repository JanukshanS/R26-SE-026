import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { incidentRouter } from "../src/routes/incident.routes";
import testIncident from "./test-incident.json";
function makeApp() { const app = express(); app.use(express.json()); app.use("/api/v1/incidents", incidentRouter); return app; }
describe("POST /api/v1/incidents", () => {
  it("creates an incident", async () => {
    const res = await request(makeApp()).post("/api/v1/incidents").send(testIncident).set("Content-Type", "application/json");
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("id");
    expect(res.body.data.status).toBe("CREATED");
  });
  it("rejects a malformed body with 400", async () => {
    const res = await request(makeApp()).post("/api/v1/incidents").send({ nope: true });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toBeDefined();
  });
});
