import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapServiceTypeToIncidentType,
  SERVICE_TO_INCIDENT_TYPE,
} from "../../../contracts/geo-service-mapping";

vi.mock("../src/config", () => ({
  config: { geoIntelligenceUrl: "http://geo.test:5001" },
}));

vi.mock("../src/utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { fetchTrafficImpactScore } from "../src/services/geo-client";

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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-07T14:30:00+05:30"));
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
      road_type: "primary",
      total_lanes: 2,
      lanes_blocked: 1,
      incident_type: "major_accident",
      hour: 14,
      day_of_week: 1,
    });
  });

  it("converts JS Sunday=0 to model Monday=0 day_of_week", async () => {
    vi.setSystemTime(new Date("2026-07-12T10:00:00+05:30"));
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody().day_of_week).toBe(6);
  });

  it("converts JS Monday to model Monday=0", async () => {
    vi.setSystemTime(new Date("2026-07-06T10:00:00+05:30"));
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE });
    expect(lastFetchBody().day_of_week).toBe(0);
  });
});

describe("G-004 — documented default road geometry", () => {
  it("uses documented default road geometry until G-004 enrichment", async () => {
    mockFetchJson(200, { score: 5 });
    await fetchTrafficImpactScore({ ...MALABE, probabilities: { MAJOR_ACCIDENT: 1 } });
    const body = lastFetchBody();
    expect(body.road_type).toBe("primary");
    expect(body.total_lanes).toBe(2);
    expect(body.lanes_blocked).toBe(1);
  });
});

describe("HTTP behavior and graceful degradation", () => {
  it("returns score number on 200", async () => {
    mockFetchJson(200, { score: 8.4, priority: "HIGH", factors: {}, prediction: {} });
    await expect(fetchTrafficImpactScore(MALABE)).resolves.toBe(8.4);
  });

  it("returns null on 400 lanes_blocked validation", async () => {
    mockFetchJson(400, { detail: "lanes_blocked cannot exceed total_lanes" });
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

  it("uses 2s abort timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue({} as AbortSignal);
    mockFetchJson(200, { score: 6 });
    await fetchTrafficImpactScore(MALABE);
    expect(timeoutSpy).toHaveBeenCalledWith(2000);
    timeoutSpy.mockRestore();
  });
});
