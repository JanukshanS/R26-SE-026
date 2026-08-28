import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapServiceTypeToIncidentType,
  mapServiceTypeToLanesBlocked,
  SERVICE_TO_INCIDENT_TYPE,
} from "../src/contracts/geo-service-mapping";
import { SERVICE_TYPES } from "../src/types";

vi.mock("../src/config", () => ({
  config: { geoIntelligenceUrl: "http://geo.test:5001" },
}));

vi.mock("../src/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { fetchTrafficImpactScore } from "../src/services/geo-client";
import { logger } from "../src/utils/logger";

const MALABE = { latitude: 6.9271, longitude: 79.8612 };
const GEO_URL = "http://geo.test:5001";

function mockFetchJson(status: number, body: unknown) {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function lastFetchBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls.at(-1);
  expect(call).toBeDefined();
  return JSON.parse(String(call![1]?.body));
}

// Fixture instants are always written in UTC so the expectations describe the
// Colombo wall clock the model is asked about, never the CI runner's zone.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-07T09:00:00Z")); // Tue 14:30 in Asia/Colombo
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SERVICE_TO_INCIDENT_TYPE mapping", () => {
  it("maps MAJOR_ACCIDENT to major_accident", async () => {
    mockFetchJson(200, { score: 7.2 });
    await fetchTrafficImpactScore({
      ...MALABE,
      probabilities: { MAJOR_ACCIDENT: 0.9, FLAT_TIRE_CHANGE: 0.1 },
    });
    expect(lastFetchBody().incident_type).toBe("major_accident");
  });

  it("maps FLAT_TIRE_CHANGE to flat_tire", async () => {
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { FLAT_TIRE_CHANGE: 1.0 } });
    expect(lastFetchBody().incident_type).toBe("flat_tire");
  });

  it("maps COOLANT_LOW to overheating", async () => {
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { COOLANT_LOW: 0.8 } });
    expect(lastFetchBody().incident_type).toBe("overheating");
  });

  it("maps LOCKOUT to lockout", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { LOCKOUT: 1.0 } });
    expect(lastFetchBody().incident_type).toBe("lockout");
  });

  it("maps KEY_LOST to lockout", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { KEY_LOST: 1.0 } });
    expect(lastFetchBody().incident_type).toBe("lockout");
  });

  it("unmapped ServiceType falls back to engine_failure", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { ALTERNATOR_ISSUE: 1.0 } });
    expect(lastFetchBody().incident_type).toBe("engine_failure");
  });

  it("empty probabilities falls back to engine_failure", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: {} });
    expect(lastFetchBody().incident_type).toBe("engine_failure");
  });

  it("picks highest-probability ServiceType when multiple", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({
      ...MALABE,
      probabilities: { FUEL_EMPTY: 0.4, BATTERY_JUMP: 0.6 },
    });
    expect(lastFetchBody().incident_type).toBe("battery_dead");
  });

  it("shared helper maps LOCKOUT to lockout (regression)", () => {
    expect(mapServiceTypeToIncidentType("LOCKOUT")).toBe("lockout");
    expect(SERVICE_TO_INCIDENT_TYPE.LOCKOUT).toBe("lockout");
  });
});

describe("ScoreRequest body shape (OpenAPI contract)", () => {
  it("includes required ScoreRequest fields per OpenAPI", async () => {
    mockFetchJson(200, { score: 7.2 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { MAJOR_ACCIDENT: 1 } });
    const body = lastFetchBody();
    expect(body).toMatchObject({
      latitude: MALABE.latitude,
      longitude: MALABE.longitude,
      lanes_blocked: 2,
      incident_type: "major_accident",
      hour: 14,
      day_of_week: 1,
    });
  });

  it("sends the Colombo hour, not the process-local one", async () => {
    vi.setSystemTime(new Date("2026-07-07T02:30:00Z")); // Tue 08:00 in Asia/Colombo
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody().hour).toBe(8);
  });

  it("keeps the Colombo hour and weekday across the UTC date boundary", async () => {
    vi.setSystemTime(new Date("2026-07-06T19:30:00Z")); // Mon in UTC, Tue 01:00 in Colombo
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody()).toMatchObject({ hour: 1, day_of_week: 1 });

    vi.setSystemTime(new Date("2026-07-07T00:30:00Z")); // Tue 06:00 in Colombo
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody()).toMatchObject({ hour: 6, day_of_week: 1 });
  });

  it("sends Sunday as model day_of_week 6", async () => {
    vi.setSystemTime(new Date("2026-07-12T04:30:00Z")); // Sun 10:00 in Colombo
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody().day_of_week).toBe(6);
  });

  it("sends Monday as model day_of_week 0", async () => {
    vi.setSystemTime(new Date("2026-07-06T04:30:00Z")); // Mon 10:00 in Colombo
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody().day_of_week).toBe(0);
  });
});

describe("road geometry and lanes_blocked derivation", () => {
  it("omits road class and lane count so geo resolves them from the GPS fix", async () => {
    // Sending a guess here is worse than sending nothing: geo cannot tell a real
    // primary road from our placeholder, so the Location Factor goes constant.
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { MAJOR_ACCIDENT: 1 } });
    const body = lastFetchBody();
    expect(body).not.toHaveProperty("road_type");
    expect(body).not.toHaveProperty("total_lanes");
  });

  it("blocks both lanes for a service type needing recovery on scene", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { MAJOR_ACCIDENT: 1 } });
    expect(lastFetchBody().lanes_blocked).toBe(2);
  });

  it("never derives zero blocked lanes, which the model cannot represent", async () => {
    for (const serviceType of SERVICE_TYPES) {
      expect(mapServiceTypeToLanesBlocked(serviceType)).toBeGreaterThanOrEqual(1);
    }
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { LOCKOUT: 1 } });
    expect(lastFetchBody().lanes_blocked).toBe(1);
  });

  it("blocks one lane by default", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { BATTERY_JUMP: 1 } });
    expect(lastFetchBody().lanes_blocked).toBe(1);

    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody().lanes_blocked).toBe(1);
  });

  it("never derives more blocked lanes than the road has", () => {
    for (const serviceType of SERVICE_TYPES) {
      const lanes = mapServiceTypeToLanesBlocked(serviceType);
      expect(lanes).toBeGreaterThanOrEqual(0);
      expect(lanes).toBeLessThanOrEqual(2);
    }
  });
});

describe("HTTP behavior and graceful degradation", () => {
  it("returns score number on 200", async () => {
    mockFetchJson(200, { score: 8.4, priority: "HIGH", factors: {}, prediction: {} });
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBe(8.4);
  });

  it("reports geo-unavailable on 400 lanes_blocked validation", async () => {
    mockFetchJson(400, { detail: "lanes_blocked cannot exceed total_lanes" });
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBe("geo-unavailable");
  });

  it("distinguishes a 503 misconfiguration from an unreachable service", async () => {
    mockFetchJson(503, { detail: "SUPABASE_URL is not configured." });
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBe("geo-unavailable");
    expect(vi.mocked(logger.warn).mock.calls.at(-1)?.[0]).toContain("503");

    vi.mocked(fetch).mockRejectedValueOnce(
      Object.assign(new Error("TimeoutError"), { name: "TimeoutError" }),
    );
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBeNull();
  });

  it("returns null on fetch timeout", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error("TimeoutError"), { name: "TimeoutError" }));
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBeNull();
  });

  it("returns null on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBeNull();
  });

  it("POSTs to GEO /v1/score", async () => {
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore(MALABE);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`${GEO_URL}/v1/score`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("forwards the caller's Authorization header to geo", async () => {
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore({ ...MALABE, authorization: "Bearer caller-token" });
    const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(init?.headers).toMatchObject({ Authorization: "Bearer caller-token" });
  });

  it("omits Authorization when the caller sent none", async () => {
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore(MALABE);
    const [, init] = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(init?.headers).not.toHaveProperty("Authorization");
  });

  it("uses 2s abort timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue({} as AbortSignal);
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore(MALABE);
    expect(timeoutSpy).toHaveBeenCalledWith(2000);
    timeoutSpy.mockRestore();
  });
});
