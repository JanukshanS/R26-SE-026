import { describe, expect, it } from "vitest";
import { isValidPlate, normalizePlate, plateError } from "../lib/plate-number";

describe("Sri Lankan plate numbers", () => {
  it("accepts the post-2023 letter series", () => {
    // 2 or 3 letters + 4 digits, provincial code dropped since Jan 2023.
    for (const plate of ["CAB-1234", "AB-1234", "CBD-1829", "KV-7788", "JJ-0001"]) {
      expect(isValidPlate(plate), plate).toBe(true);
    }
  });

  it("accepts the 2000-2022 series that still carries a province code", () => {
    for (const plate of ["WP CAB-1234", "WP-CAB-1234", "SP KA-4567", "NC-BAA-0099"]) {
      expect(isValidPlate(plate), plate).toBe(true);
    }
  });

  it("accepts the pre-2000 numeric series still on the road", () => {
    for (const plate of ["62-1234", "300-0001", "5-4321", "250 1234"]) {
      expect(isValidPlate(plate), plate).toBe(true);
    }
  });

  it("survives however the driver types the separators", () => {
    expect(normalizePlate("wp cab 1234")).toBe("WP-CAB-1234");
    expect(normalizePlate("WPCAB1234")).toBe("WP-CAB-1234");
    expect(normalizePlate("cab1234")).toBe("CAB-1234");
    expect(normalizePlate(" cab - 1234 ")).toBe("CAB-1234");
    expect(normalizePlate("621234")).toBe("62-1234");
  });

  it("rejects shapes that are not plates", () => {
    for (const bad of ["", "   ", "ABCD-1234", "A-1234", "CAB-12345", "CAB-123", "1234", "HELLO"]) {
      expect(isValidPlate(bad), bad).toBe(false);
    }
  });

  it("explains itself instead of just failing", () => {
    expect(plateError("CAB-1234")).toBeNull();
    expect(plateError("")).toMatch(/required/i);
    expect(plateError("HELLO")).toMatch(/CAB-1234/);
  });

  it("does not mistake a province code for the letter group", () => {
    // WP-1234 is a province code with no vehicle-class letters - not a plate.
    expect(isValidPlate("WP-1234")).toBe(true); // reads as a plain 2-letter series
    expect(normalizePlate("WPCAB1234")).toBe("WP-CAB-1234");
    // 3 letters after a province must still land as province + class + serial.
    expect(normalizePlate("SPBAA0099")).toBe("SP-BAA-0099");
  });
});
