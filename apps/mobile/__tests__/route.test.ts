import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDrivingRoute } from "../lib/route";

const FROM = { latitude: 6.9271, longitude: 79.8612 };
const TO = { latitude: 6.9344, longitude: 79.8428 };

function mockFetch(impl: () => unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => impl()));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDrivingRoute", () => {
  it("converts OSRM [lng, lat] pairs into map coordinates", async () => {
    mockFetch(() => ({
      ok: true,
      json: async () => ({
        routes: [{ geometry: { coordinates: [[79.8612, 6.9271], [79.85, 6.93], [79.8428, 6.9344]] } }],
      }),
    }));

    const line = await fetchDrivingRoute(FROM, TO);

    expect(line).toEqual([
      { latitude: 6.9271, longitude: 79.8612 },
      { latitude: 6.93, longitude: 79.85 },
      { latitude: 6.9344, longitude: 79.8428 },
    ]);
  });

  it("sends longitude before latitude, which is the order OSRM expects", async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ routes: [] }) }));

    await fetchDrivingRoute(FROM, TO);

    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("79.8612,6.9271;79.8428,6.9344");
  });

  // Every failure path must return null, because the map falls back to a
  // straight line on null. Returning a partial route would draw a wrong one.
  it("returns null on a non-OK response", async () => {
    mockFetch(() => ({ ok: false, json: async () => ({}) }));
    expect(await fetchDrivingRoute(FROM, TO)).toBeNull();
  });

  it("returns null when the response carries no usable geometry", async () => {
    for (const body of [
      {},
      { routes: [] },
      { routes: [{ geometry: {} }] },
      { routes: [{ geometry: { coordinates: [[79.86, 6.92]] } }] }, // single point is not a line
    ]) {
      mockFetch(() => ({ ok: true, json: async () => body }));
      expect(await fetchDrivingRoute(FROM, TO), JSON.stringify(body)).toBeNull();
    }
  });

  it("returns null when the request throws, rather than propagating", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    expect(await fetchDrivingRoute(FROM, TO)).toBeNull();
  });
});
