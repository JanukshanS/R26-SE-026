import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("@lib/capture-api", () => ({ authHeaders: async () => ({}) }));

import { rulToLabel, type ComponentHealth, type ComponentStatus } from "@lib/maintenanceApi";

// Echo the key and any interpolated value, so assertions read as the key.
const t = (key: string, vars?: Record<string, unknown>) =>
  vars?.value !== undefined ? `${key}:${vars.value}` : key;

function component(status: ComponentStatus, health_pct: number, predicted_rul_km: number): ComponentHealth {
  return { status, health_pct, predicted_rul_km, max_lifespan_km: 80_000 };
}

describe("rulToLabel", () => {
  it("calls a Good part healthy", () => {
    expect(rulToLabel(component("Good", 97, 146_000), t)).toBe("driver.health.rulHealthy");
  });

  // The bug: any part with 10,000 km or more left read "Healthy", so a Fair
  // tyre showed "Healthy" in yellow and a Poor battery "Healthy" in red.
  it.each([
    ["Fair", 64, 32_000, "driver.health.statusFair"],
    ["Poor", 42, 33_500, "driver.health.statusPoor"],
    ["Critical", 21, 10_552, "driver.health.statusCritical"],
  ] as const)("names a %s part with plenty of km left by its status", (status, pct, km, key) => {
    expect(rulToLabel(component(status, pct, km), t)).toBe(key);
  });

  it("still gives a distance once the end is near", () => {
    expect(rulToLabel(component("Critical", 10, 4_000), t)).toBe("driver.health.rulThousandKm:4");
    expect(rulToLabel(component("Critical", 2, 300), t)).toBe("driver.health.rulUrgent");
  });

  it("says no data rather than healthy when nothing is recorded", () => {
    expect(rulToLabel(component("No data", 0, 0), t)).toBe("driver.health.rulNoData");
  });
});
