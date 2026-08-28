import { describe, expect, it } from "vitest";
import { runDispatchOptimizer, type ECMProvider } from "../src/services/dispatch-optimizer";
import { SERVICE_TYPES, type ServiceTypeProbabilities } from "../src/types";

/**
 * Covers two behavior changes from the multi-type-capabilities feature:
 *   1. Match/mismatch is decided by a provider's own `capabilities` array,
 *      not re-derived from `type` via the fixed matrix — so a provider can
 *      offer a service type outside their type's default set (e.g. a
 *      Locksmith who also carries jump-start cables).
 *   2. A provider's own `serviceTimes` override is used in the cost/ETA
 *      calculation instead of the platform-wide default when set.
 */

function probFor(serviceType: string, value = 1.0): ServiceTypeProbabilities {
  return Object.fromEntries(
    SERVICE_TYPES.map((st) => [st, st === serviceType ? value : 0]),
  ) as ServiceTypeProbabilities;
}

const incidentLocation = { latitude: 6.9271, longitude: 79.8612 };

describe("runDispatchOptimizer — provider capabilities are the real source of truth, not type", () => {
  it("treats a service outside the provider's type matrix as a MATCH when it's in their own capabilities", () => {
    // LOCKSMITH's matrix ceiling is only LOCKOUT/KEY_LOST — BATTERY_JUMP is
    // outside it — but this provider has explicitly added BATTERY_JUMP.
    const locksmithWithJumpStart: ECMProvider = {
      id: "p1",
      name: "Colombo Locksmith",
      type: "LOCKSMITH",
      latitude: 6.93,
      longitude: 79.87,
      capabilities: ["LOCKOUT", "KEY_LOST", "BATTERY_JUMP"],
      trustScore: 0.8,
    };

    const result = runDispatchOptimizer(
      [locksmithWithJumpStart],
      incidentLocation,
      probFor("BATTERY_JUMP"),
      5,
    );

    // A mismatch would add assessmentDelay + reDispatchPenalty on top of
    // travel+service time — asserting zero mismatch cost is the cleanest
    // way to prove this was scored as a match.
    expect(result.rankedProviders[0].costBreakdown.expectedMismatchCost).toBe(0);
    expect(result.rankedProviders[0].mismatchRisk).toBe(0);
  });

  it("still scores a mismatch for a service truly outside the provider's own capabilities", () => {
    const lockOnly: ECMProvider = {
      id: "p2",
      name: "Lock-Only Locksmith",
      type: "LOCKSMITH",
      latitude: 6.93,
      longitude: 79.87,
      capabilities: ["LOCKOUT", "KEY_LOST"],
      trustScore: 0.8,
    };

    const result = runDispatchOptimizer(
      [lockOnly],
      incidentLocation,
      probFor("BATTERY_JUMP"),
      5,
    );

    expect(result.rankedProviders[0].costBreakdown.expectedMismatchCost).toBeGreaterThan(0);
    expect(result.rankedProviders[0].mismatchRisk).toBe(1);
  });
});

describe("runDispatchOptimizer — provider-set service times override the platform default", () => {
  it("uses the provider's own serviceTimes entry over the global average", () => {
    // Global default for BATTERY_JUMP is 15 minutes (config/index.ts).
    // This provider claims they're twice as fast.
    const fastMechanic: ECMProvider = {
      id: "p3",
      name: "Quick Fix Mobile Mechanic",
      type: "MOBILE_MECHANIC",
      latitude: 6.93,
      longitude: 79.87,
      capabilities: ["BATTERY_JUMP"],
      trustScore: 0.8,
      serviceTimes: { BATTERY_JUMP: 7 },
    };
    const defaultMechanic: ECMProvider = {
      id: "p4",
      name: "Standard Mobile Mechanic",
      type: "MOBILE_MECHANIC",
      latitude: 6.93,
      longitude: 79.87,
      capabilities: ["BATTERY_JUMP"],
      trustScore: 0.8,
    };

    const result = runDispatchOptimizer(
      [fastMechanic, defaultMechanic],
      incidentLocation,
      probFor("BATTERY_JUMP"),
      5,
    );

    const fast = result.rankedProviders.find((p) => p.provider.id === "p3")!;
    const standard = result.rankedProviders.find((p) => p.provider.id === "p4")!;

    expect(fast.estimatedServiceTimeMin).toBe(7);
    expect(standard.estimatedServiceTimeMin).toBe(15);
    // Same location, same trust — the only difference is service time, so
    // the faster provider must cost strictly less and rank first.
    expect(fast.costBreakdown.totalCost).toBeLessThan(standard.costBreakdown.totalCost);
    expect(result.rankedProviders[0].provider.id).toBe("p3");
  });

  it("falls back to the platform default when a provider has no override for a service they offer", () => {
    const noOverride: ECMProvider = {
      id: "p5",
      name: "No Custom Times Mechanic",
      type: "MOBILE_MECHANIC",
      latitude: 6.93,
      longitude: 79.87,
      capabilities: ["BATTERY_JUMP"],
      trustScore: 0.8,
      serviceTimes: {}, // set, but empty — must still fall back per-key
    };

    const result = runDispatchOptimizer(
      [noOverride],
      incidentLocation,
      probFor("BATTERY_JUMP"),
      5,
    );

    expect(result.rankedProviders[0].estimatedServiceTimeMin).toBe(15);
  });
});
