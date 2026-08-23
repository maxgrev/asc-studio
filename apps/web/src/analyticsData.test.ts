import { describe, expect, it } from "vitest";
import {
  analyticsDateRange,
  analyticsFilterCount,
  analyticsFiltersFromSearchParams,
  analyticsQueryKey,
  emptyAnalyticsFilters,
  chartPoints,
  chartSegments,
  formatAnalyticsChange,
  formatAnalyticsValue,
  formatAnalyticsValueWithAvailability,
  shiftIsoDate,
  writeAnalyticsFiltersToSearchParams,
} from "./analyticsData.js";

describe("analyticsData", () => {
  it("builds calendar ranges without local-time drift", () => {
    expect(analyticsDateRange("30d", "2026-03-01")).toEqual({
      startDate: "2026-01-31",
      endDate: "2026-03-01",
    });
    expect(shiftIsoDate("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("keeps request identity sensitive to every visible query control", () => {
    const base = { appIds: ["app-1", "app-2"], scopeId: "all", range: "30d" as const, compare: "PREVIOUS_PERIOD" as const, filters: emptyAnalyticsFilters() };
    expect(analyticsQueryKey(base)).not.toBe(analyticsQueryKey({ ...base, scopeId: "app-1" }));
    expect(analyticsQueryKey(base)).not.toBe(analyticsQueryKey({ ...base, range: "90d" }));
    expect(analyticsQueryKey(base)).not.toBe(analyticsQueryKey({ ...base, compare: "NONE" }));
    expect(analyticsQueryKey(base)).not.toBe(analyticsQueryKey({ ...base, appIds: ["app-1"] }));
    expect(analyticsQueryKey(base)).not.toBe(analyticsQueryKey({ ...base, filters: { ...base.filters, territories: ["US"] } }));
  });

  it("round-trips one exact facet per dimension and clears empty filters", () => {
    const parameters = new URLSearchParams("analyticsTerritory=US&analyticsSource=Search");
    const filters = analyticsFiltersFromSearchParams(parameters);
    expect(filters).toEqual({ territories: ["US"], sources: ["Search"], productPages: [], versions: [] });
    expect(analyticsFilterCount(filters)).toBe(2);

    writeAnalyticsFiltersToSearchParams(parameters, emptyAnalyticsFilters());
    expect(parameters.has("analyticsTerritory")).toBe(false);
    expect(parameters.has("analyticsSource")).toBe(false);
  });

  it("does not format unavailable or privacy-withheld values as zero", () => {
    expect(formatAnalyticsValue({ value: null, availability: "UNAVAILABLE" }, "COUNT")).toBe("—");
    expect(formatAnalyticsValue({ value: null, availability: "PRIVACY_WITHHELD" }, "COUNT")).toBe("—");
    expect(formatAnalyticsValue({ value: 0, availability: "AVAILABLE" }, "COUNT")).toBe("0");
    expect(formatAnalyticsValueWithAvailability({ value: null, availability: "UNAVAILABLE" }, "COUNT")).toBe("Unavailable");
    expect(formatAnalyticsValueWithAvailability({ value: null, availability: "PRIVACY_WITHHELD" }, "COUNT")).toBe("Withheld for privacy");
    expect(formatAnalyticsValueWithAvailability({ value: 12, availability: "PARTIAL" }, "COUNT")).toBe("12 · Partial");
  });

  it("formats ratios and their point changes explicitly", () => {
    expect(formatAnalyticsValue({ value: 0.327, availability: "AVAILABLE" }, "RATIO")).toBe("32.7%");
    expect(formatAnalyticsChange({ absolute: 0.016, relative: 0.051 }, "RATIO")).toBe("+1.6 pt");
    expect(formatAnalyticsValue({ value: 0.49, availability: "AVAILABLE" }, "CURRENCY_USD")).toBe("$0.49");
    expect(formatAnalyticsValue({ value: 18_503, availability: "AVAILABLE" }, "CURRENCY_USD")).toBe("$18,503");
  });

  it("preserves gaps in chart paths", () => {
    const points = chartPoints([
      { date: "2026-08-01", current: { value: 2, availability: "AVAILABLE" }, previous: null },
      { date: "2026-08-02", current: { value: null, availability: "PRIVACY_WITHHELD" }, previous: null },
      { date: "2026-08-03", current: { value: 4, availability: "AVAILABLE" }, previous: null },
    ]);
    const chart = chartSegments(points, "current", 300, 120);
    expect(chart.segments).toHaveLength(2);
    expect(chart.segments.every((segment) => !segment.path.includes(" L "))).toBe(true);
  });
});
