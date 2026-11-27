import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecute, mockGeo, mockPrisma } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockGeo: vi.fn(),
  mockPrisma: { incident: { findUnique: vi.fn() } },
}));
vi.mock("../src/services/dispatch-executor", () => ({ executeDispatch: (...a: unknown[]) => mockExecute(...a) }));
vi.mock("../src/services/geo-client", () => ({ fetchTrafficImpactScore: (...a: unknown[]) => mockGeo(...a) }));
vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));

import { config } from "../src/config";
import { queueDispatch } from "../src/services/dispatch-batcher";

const SCORES: Record<string, number | string> = { low: 2.9, high: 4.1, tieA: 5, tieB: 5, nogeo: "geo-timeout" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  config.dispatch.batchWindowMs = 6000;
  mockPrisma.incident.findUnique.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: where.id, latitude: 6.9, longitude: 79.97, triageResponse: { probabilities: { tag: where.id } } }));
  mockGeo.mockImplementation(({ probabilities }: any) => Promise.resolve(SCORES[probabilities.tag]));
  mockExecute.mockImplementation(({ incidentId }: any) => Promise.resolve({ status: "dispatched", incidentId }));
});
afterEach(() => vi.useRealTimers());

const order = () => mockExecute.mock.calls.map(([p]: any) => p.incidentId);

describe("queueDispatch", () => {
  it("dispatches on arrival when the window is 0", async () => {
    config.dispatch.batchWindowMs = 0;
    await expect(queueDispatch({ incidentId: "low" })).resolves.toEqual({ outcome: { status: "dispatched", incidentId: "low" }, batch: null });
    expect(mockGeo).not.toHaveBeenCalled();
  });

  it("serves the higher-impact incident first even though it arrived second", async () => {
    const a = queueDispatch({ incidentId: "low" });
    await vi.advanceTimersByTimeAsync(2000);
    const b = queueDispatch({ incidentId: "high" });
    expect(mockExecute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    const [ra, rb] = await Promise.all([a, b]);
    expect(order()).toEqual(["high", "low"]);
    expect(rb.batch).toEqual({ size: 2, position: 1, windowMs: 6000 });
    expect(ra.batch).toEqual({ size: 2, position: 2, windowMs: 6000 });
    expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({ incidentId: "high", trafficImpactScore: 4.1, trafficImpactSource: "geo-intelligence" }));
  });

  it("breaks ties by arrival and ranks an unscored incident last without a preset score", async () => {
    const n = queueDispatch({ incidentId: "nogeo" });
    const a = queueDispatch({ incidentId: "tieA" });
    const b = queueDispatch({ incidentId: "tieB" });
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.all([n, a, b]);
    expect(order()).toEqual(["tieA", "tieB", "nogeo"]);
    expect(mockExecute.mock.calls[2][0].trafficImpactScore).toBeUndefined();
  });

  it("isolates a failing item and starts a new batch for late arrivals", async () => {
    mockExecute.mockImplementation(({ incidentId }: any) =>
      incidentId === "high" ? Promise.reject(new Error("db down")) : Promise.resolve({ status: "dispatched", incidentId }));
    const bad = queueDispatch({ incidentId: "high" }).catch((e) => e);
    const good = queueDispatch({ incidentId: "low" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(await bad).toBeInstanceOf(Error);
    await expect(good).resolves.toMatchObject({ batch: { size: 2, position: 2 } });
    const late = queueDispatch({ incidentId: "low" });
    await vi.advanceTimersByTimeAsync(6000);
    await expect(late).resolves.toMatchObject({ batch: { size: 1, position: 1 } });
  });
});
