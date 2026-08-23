import { describe, expect, it } from "vitest";
import {
  AnalyticsFactBatchSchema,
  AnalyticsMetricValueSchema,
  AnalyticsObservationSchema,
  AnalyticsPortfolioOverviewQuerySchema,
} from "./index.js";

describe("analytics contracts", () => {
  it("accepts a portfolio larger than the old 200-app UI limit", () => {
    const result = AnalyticsPortfolioOverviewQuerySchema.safeParse({
      schemaVersion: 1,
      scope: "PORTFOLIO",
      appIds: Array.from({ length: 1_000 }, (_, index) => `app-${index}`),
      startDate: "2026-08-01",
      endDate: "2026-08-21",
      compare: "PREVIOUS_PERIOD",
      granularity: "DAY",
      breakdowns: ["APP"],
    });
    expect(result.success).toBe(true);
  });

  it("preserves negative proceeds from refunds but rejects negative count metrics", () => {
    const base = {
      date: "2026-08-01",
      appId: "app-1",
      currency: "USD" as const,
      dimensions: {},
      reportName: "App Store Commerce",
      availability: "AVAILABLE" as const,
      evidenceId: "evidence-1",
    };
    expect(AnalyticsObservationSchema.safeParse({ ...base, metric: "PROCEEDS", value: -4.25 }).success).toBe(true);
    expect(AnalyticsObservationSchema.safeParse({ ...base, metric: "DOWNLOADS", value: -1 }).success).toBe(false);
  });

  it("keeps real zero distinct from withheld and unavailable null values", () => {
    const base = {
      date: "2026-08-01",
      appId: "app-1",
      metric: "SESSIONS" as const,
      currency: null,
      dimensions: { territory: "USA" },
      reportName: "App Sessions Standard",
      evidenceId: "evidence-zero-truth",
    };
    expect(AnalyticsObservationSchema.safeParse({ ...base, value: 0, availability: "AVAILABLE" }).success).toBe(true);
    expect(AnalyticsObservationSchema.safeParse({ ...base, value: null, availability: "PRIVACY_WITHHELD" }).success).toBe(true);
    expect(AnalyticsObservationSchema.safeParse({ ...base, value: null, availability: "UNAVAILABLE" }).success).toBe(true);
    expect(AnalyticsObservationSchema.safeParse({ ...base, value: 0, availability: "PRIVACY_WITHHELD" }).success).toBe(false);
    expect(AnalyticsObservationSchema.safeParse({ ...base, value: null, availability: "AVAILABLE" }).success).toBe(false);
    expect(AnalyticsObservationSchema.safeParse({ ...base, value: null, availability: "PARTIAL" }).success).toBe(false);
  });

  it("requires aggregate available and partial values to be numeric without inventing zero for missing data", () => {
    expect(AnalyticsMetricValueSchema.safeParse({ value: 0, availability: "AVAILABLE" }).success).toBe(true);
    expect(AnalyticsMetricValueSchema.safeParse({ value: 12, availability: "PARTIAL" }).success).toBe(true);
    expect(AnalyticsMetricValueSchema.safeParse({ value: null, availability: "UNAVAILABLE" }).success).toBe(true);
    expect(AnalyticsMetricValueSchema.safeParse({ value: null, availability: "PRIVACY_WITHHELD" }).success).toBe(true);
    expect(AnalyticsMetricValueSchema.safeParse({ value: null, availability: "AVAILABLE" }).success).toBe(false);
    expect(AnalyticsMetricValueSchema.safeParse({ value: null, availability: "PARTIAL" }).success).toBe(false);
    expect(AnalyticsMetricValueSchema.safeParse({ value: 0, availability: "UNAVAILABLE" }).success).toBe(false);
    expect(AnalyticsMetricValueSchema.safeParse({ value: 0, availability: "PRIVACY_WITHHELD" }).success).toBe(false);
  });

  it("rejects incomplete report-instance batches", () => {
    const result = AnalyticsFactBatchSchema.safeParse({
      schemaVersion: 1,
      issuerId: "issuer-1",
      appId: "app-1",
      accessType: "ONGOING",
      reportRequestId: "request-1",
      reportId: "report-1",
      reportName: "App Store Downloads",
      category: "APP_STORE_ENGAGEMENT",
      granularity: "DAILY",
      instanceId: "instance-1",
      processingDate: "2026-08-21",
      partitionDates: ["2026-08-20"],
      segmentIds: ["segment-1", "segment-2"],
      segments: [{ segmentId: "segment-1", checksumSha256: "a".repeat(64), byteCount: 40, rowCount: 1 }],
      expectedSegmentCount: 2,
      verifiedSegmentCount: 1,
      observations: [],
      snapshotId: "snapshot-1",
      evidenceId: "evidence-1",
    });
    expect(result.success).toBe(false);
  });

  it("requires canonical raw partition dates even when a batch has no supported observations", () => {
    const base = {
      schemaVersion: 1,
      issuerId: "issuer-1",
      appId: "app-1",
      accessType: "ONGOING" as const,
      reportRequestId: "request-1",
      reportId: "report-1",
      reportName: "App Store Pre-Orders Standard",
      category: "COMMERCE",
      granularity: "DAILY" as const,
      instanceId: "instance-1",
      processingDate: "2026-08-21",
      partitionDates: ["2026-08-20"],
      segmentIds: ["segment-1"],
      segments: [{ segmentId: "segment-1", checksumSha256: "a".repeat(64), byteCount: 40, rowCount: 1 }],
      expectedSegmentCount: 1,
      verifiedSegmentCount: 1,
      observations: [],
      snapshotId: "snapshot-1",
      evidenceId: "evidence-1",
    };

    expect(AnalyticsFactBatchSchema.safeParse(base).success).toBe(true);
    expect(AnalyticsFactBatchSchema.safeParse({
      ...base,
      partitionDates: ["2026-08-20", "2026-08-20"],
    }).success).toBe(false);
    expect(AnalyticsFactBatchSchema.safeParse({
      ...base,
      partitionDates: ["2026-08-22"],
    }).success).toBe(false);
  });

  it("keeps versioned analytics objects strict", () => {
    const result = AnalyticsPortfolioOverviewQuerySchema.safeParse({
      schemaVersion: 1,
      scope: "PORTFOLIO",
      appIds: ["app-1"],
      startDate: "2026-08-01",
      endDate: "2026-08-21",
      compare: "NONE",
      granularity: "DAY",
      breakdowns: [],
      unexpected: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts bounded typed analytics filters and rejects duplicate values", () => {
    const base = {
      schemaVersion: 1,
      scope: "PORTFOLIO" as const,
      appIds: ["app-1"],
      startDate: "2026-08-01",
      endDate: "2026-08-21",
      compare: "NONE" as const,
      granularity: "DAY" as const,
      breakdowns: ["TERRITORY"] as const,
    };
    const parsed = AnalyticsPortfolioOverviewQuerySchema.safeParse({
      ...base,
      filters: { territories: ["USA"], sources: ["App Store Search & Browse / Today"], productPages: ["Product Page"], versions: [] },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.filters?.sources).toEqual(["App Store Search & Browse / Today"]);
    expect(AnalyticsPortfolioOverviewQuerySchema.safeParse({
      ...base,
      filters: { territories: ["USA", "USA"], sources: [], productPages: [], versions: [] },
    }).success).toBe(false);
    expect(AnalyticsPortfolioOverviewQuerySchema.safeParse({
      ...base,
      filters: { territories: Array.from({ length: 101 }, (_, index) => `T-${index}`), sources: [], productPages: [], versions: [] },
    }).success).toBe(false);
  });
});
