import { describe, expect, it } from "vitest";
import { subscriptionParityBand } from "./subscription-pricing.js";

describe("subscriptionParityBand", () => {
  it("softens a measured purchasing-power gap and applies the hard floor", () => {
    expect(subscriptionParityBand("IND", "USA", 70, 50)).toMatchObject({
      factorPercent: 70,
      reason: "floor",
      dataYear: 2025,
    });
  });

  it("normalizes price levels to a non-US base storefront before rounding upward", () => {
    const band = subscriptionParityBand("IND", "GBR", 60, 50);
    expect(band.priceLevelRatio).toBeCloseTo(0.2585, 3);
    expect(band).toMatchObject({ factorPercent: 65, reason: "ppp" });
  });

  it("never adds a purchasing-power surcharge above the base storefront", () => {
    expect(subscriptionParityBand("CHE", "USA", 70, 75)).toMatchObject({
      factorPercent: 100,
      reason: "ppp",
    });
  });

  it("holds an unsupported storefront instead of guessing a local price", () => {
    expect(subscriptionParityBand("ZZZ", "USA", 70, 50)).toMatchObject({
      priceLevelRatio: null,
      dataYear: null,
      factorPercent: 100,
      reason: "no_data",
    });
  });
});
