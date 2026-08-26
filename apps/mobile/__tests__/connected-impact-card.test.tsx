function impactLabel(score: number | null, source?: string) {
  if (score === null) return "";
  const p = score >= 8 ? "CRITICAL" : score >= 5 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW";
  return `${p} priority${source === "geo-intelligence" ? " · live" : ""}`;
}

describe("connected impact card", () => {
  it("shows '· live' only when from geo-intelligence", () => {
    expect(impactLabel(7.4, "geo-intelligence")).toBe("HIGH priority · live");
    expect(impactLabel(7.4, "default")).toBe("HIGH priority");
    expect(impactLabel(9.1, "geo-intelligence")).toBe("CRITICAL priority · live");
  });
});
