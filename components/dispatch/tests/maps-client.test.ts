import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// config reads GOOGLE_MAPS_API_KEY at import time, so pin it before the
// imports below run — same pattern as dispatch-optimize.geo.test.ts pinning
// TRAFFIC_LAMBDA.
vi.hoisted(() => {
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});

import { fetchRealTravelTimesMinutes } from "../src/services/maps-client";

// The client caches by rounded coordinate pair for 5 minutes (module-level,
// so it persists across tests in this file) — every test below uses its own
// unique coordinates so none of them can accidentally hit another test's
// cached entry.
const destination = { latitude: 6.9271, longitude: 79.8612 };

// One row per ORIGIN, each with exactly one element (we always query a
// single destination) — matches Google's actual response shape, where rows
// correspond to origins and each row's elements correspond to destinations.
function mockDistanceMatrixResponse(perOrigin: { status: string; seconds?: number }[]) {
  return {
    ok: true,
    json: async () => ({
      status: "OK",
      rows: perOrigin.map((e) => ({
        elements: [{
          status: e.status,
          ...(e.seconds !== undefined ? { duration: { value: e.seconds } } : {}),
        }],
      })),
    }),
  };
}

describe("fetchRealTravelTimesMinutes", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns real minutes for a resolved origin", async () => {
    (fetch as any).mockResolvedValueOnce(
      mockDistanceMatrixResponse([{ status: "OK", seconds: 600 }])
    );

    const result = await fetchRealTravelTimesMinutes(
      [{ latitude: 6.9301, longitude: 79.8701 }],
      destination,
    );

    expect(result).toEqual([10]); // 600s = 10min
  });

  it("batches multiple origins into one request", async () => {
    (fetch as any).mockResolvedValueOnce(
      mockDistanceMatrixResponse([
        { status: "OK", seconds: 300 },
        { status: "OK", seconds: 900 },
      ])
    );

    const result = await fetchRealTravelTimesMinutes(
      [{ latitude: 6.9401, longitude: 79.8801 }, { latitude: 6.9501, longitude: 79.8901 }],
      destination,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual([5, 15]);
  });

  it("leaves only the unresolved leg null when one element fails, not the whole batch", async () => {
    (fetch as any).mockResolvedValueOnce(
      mockDistanceMatrixResponse([
        { status: "OK", seconds: 300 },
        { status: "NOT_FOUND" },
      ])
    );

    const result = await fetchRealTravelTimesMinutes(
      [{ latitude: 6.9601, longitude: 79.9001 }, { latitude: 6.9701, longitude: 79.9101 }],
      destination,
    );

    expect(result).toEqual([5, null]);
  });

  it("returns null for the whole batch when the request fails outright", async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 403 });

    const result = await fetchRealTravelTimesMinutes(
      [{ latitude: 6.9801, longitude: 79.9201 }],
      destination,
    );

    expect(result).toBeNull();
  });

  it("returns null for the whole batch when the request throws (timeout/network)", async () => {
    (fetch as any).mockRejectedValueOnce(new Error("network error"));

    const result = await fetchRealTravelTimesMinutes(
      [{ latitude: 6.9901, longitude: 79.9301 }],
      destination,
    );

    expect(result).toBeNull();
  });

  it("never calls fetch when there are no origins", async () => {
    const result = await fetchRealTravelTimesMinutes([], destination);

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("serves a repeat lookup for the same pair from cache without a second fetch", async () => {
    const origin = { latitude: 7.0001, longitude: 80.0001 };
    (fetch as any).mockResolvedValueOnce(
      mockDistanceMatrixResponse([{ status: "OK", seconds: 120 }])
    );

    const first = await fetchRealTravelTimesMinutes([origin], destination);
    const second = await fetchRealTravelTimesMinutes([origin], destination);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual([2]);
    expect(second).toEqual([2]);
  });
});
