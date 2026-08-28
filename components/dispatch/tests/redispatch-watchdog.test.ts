import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DISPATCH_TIMEOUT_SECONDS = "120";
});

const { mockPrisma, mockExecuteDispatch } = vi.hoisted(() => ({
  mockPrisma: {
    incident: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    dispatchDecision: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
  mockExecuteDispatch: vi.fn(),
}));

vi.mock("../src/utils/prisma", () => ({ prisma: mockPrisma }));
vi.mock("../src/services/dispatch-executor", () => ({ executeDispatch: mockExecuteDispatch }));

// Import after mocks/env are wired, and reach into the module's internal
// tick via the exported start/stop pair — we drive it manually with fake
// timers rather than asserting on the private tick function directly.
import { startRedispatchWatchdog, stopRedispatchWatchdog } from "../src/services/redispatch-watchdog";

const INCIDENT_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("redispatch watchdog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockPrisma.incident.findMany.mockResolvedValue([]);
    mockPrisma.incident.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.incident.update.mockResolvedValue({});
    mockPrisma.dispatchDecision.findMany.mockResolvedValue([]);
    mockPrisma.dispatchDecision.findFirst.mockResolvedValue(null);
    mockPrisma.dispatchDecision.update.mockResolvedValue({});
  });

  afterEach(() => {
    stopRedispatchWatchdog();
    vi.useRealTimers();
  });

  async function fireOneTick() {
    startRedispatchWatchdog();
    await vi.advanceTimersByTimeAsync(15_000);
  }

  it("releases a PROVIDER_ASSIGNED incident whose updatedAt is past the timeout cutoff", async () => {
    mockPrisma.incident.findMany.mockImplementation(({ where }: any) => {
      if (where.status === "PROVIDER_ASSIGNED") {
        return Promise.resolve([{ id: INCIDENT_ID, assignedProviderId: "provider-timed-out" }]);
      }
      return Promise.resolve([]);
    });
    mockPrisma.dispatchDecision.findFirst.mockResolvedValue({
      id: "decision-1",
      createdAt: new Date(Date.now() - 130_000),
    });

    await fireOneTick();

    expect(mockPrisma.incident.updateMany).toHaveBeenCalledWith({
      where: { id: INCIDENT_ID, assignedProviderId: "provider-timed-out", status: "PROVIDER_ASSIGNED" },
      data: { status: "DISPATCHING", assignedProviderId: null },
    });
    expect(mockPrisma.dispatchDecision.update).toHaveBeenCalledWith({
      where: { id: "decision-1" },
      data: expect.objectContaining({ accepted: false, declineReason: "TIMEOUT_NO_RESPONSE" }),
    });
  });

  it("does not touch an assignment when the conditional release loses the race", async () => {
    mockPrisma.incident.findMany.mockImplementation(({ where }: any) => {
      if (where.status === "PROVIDER_ASSIGNED") {
        return Promise.resolve([{ id: INCIDENT_ID, assignedProviderId: "provider-x" }]);
      }
      return Promise.resolve([]);
    });
    mockPrisma.incident.updateMany.mockResolvedValue({ count: 0 }); // provider just responded

    await fireOneTick();

    expect(mockPrisma.dispatchDecision.update).not.toHaveBeenCalled();
  });

  it("retries a DISPATCHING incident with prior decisions, excluding previously-tried providers", async () => {
    mockPrisma.incident.findMany.mockImplementation(({ where }: any) => {
      if (where.status === "DISPATCHING") {
        return Promise.resolve([{ id: INCIDENT_ID }]);
      }
      return Promise.resolve([]);
    });
    mockPrisma.dispatchDecision.findMany.mockResolvedValue([
      { providerId: "declined-provider" },
    ]);
    mockExecuteDispatch.mockResolvedValue({
      status: "dispatched",
      result: { selectedProvider: { provider: { name: "Backup Mechanic" } } },
    });

    await fireOneTick();

    expect(mockExecuteDispatch).toHaveBeenCalledWith({
      incidentId: INCIDENT_ID,
      excludeProviderIds: ["declined-provider"],
    });
  });

  it("never retries a brand-new DISPATCHING incident with no dispatch history", async () => {
    // The Prisma query itself filters via dispatchDecisions:{some:{}}, so a
    // fresh incident is never returned — assert the watchdog queried with
    // that filter rather than relying on the (already-empty) mock result.
    await fireOneTick();

    const dispatchingCall = mockPrisma.incident.findMany.mock.calls.find(
      ([args]: any[]) => args.where.status === "DISPATCHING",
    );
    expect(dispatchingCall[0].where.dispatchDecisions).toEqual({ some: {} });
    expect(mockExecuteDispatch).not.toHaveBeenCalled();
  });

  it("escalates the incident when no providers remain to retry", async () => {
    mockPrisma.incident.findMany.mockImplementation(({ where }: any) => {
      if (where.status === "DISPATCHING") {
        return Promise.resolve([{ id: INCIDENT_ID }]);
      }
      return Promise.resolve([]);
    });
    mockExecuteDispatch.mockResolvedValue({ status: "no_providers" });

    await fireOneTick();

    expect(mockPrisma.incident.update).toHaveBeenCalledWith({
      where: { id: INCIDENT_ID },
      data: { status: "ESCALATED" },
    });
  });
});
