import { describe, expect, it } from "vitest";
import {
  AnalyticsFactBatchSchema,
  AnalyticsMetricValueSchema,
  AnalyticsObservationSchema,
  AnalyticsOverviewQueryV2Schema,
  AnalyticsOverviewResponseV2Schema,
  AnalyticsPortfolioCatalogResponseSchema,
  AnalyticsPortfolioOverviewQuerySchema,
  AnalyticsPortfolioReportRequestCreateInputSchema,
  AnalyticsPortfolioStatusResponseSchema,
  AnalyticsPortfolioSyncInputSchema,
  AnalyticsPortfolioSyncResponseSchema,
} from "./index.js";

const portfolioFreshness = {
  syncedAt: "2026-08-29T12:00:00.000Z",
  dataThrough: "2026-08-27",
  expectedDelayDays: 5,
  partial: false,
  detail: "Every connected source is complete through August 27.",
} as const;

const portfolioSource = {
  id: "source:issuer-a",
  accounts: [{
    id: "account-a",
    profileName: "Studio A",
    active: true,
    state: "READY" as const,
    appCount: 1,
    detail: "Connected.",
  }],
  state: "READY" as const,
  appCount: 1,
  lastDiscoveredAt: "2026-08-29T12:00:00.000Z",
  detail: "One connected account is available.",
};

const portfolioApp = {
  id: "portfolio-app:source-a:1234567890",
  sourceId: portfolioSource.id,
  name: "Orbit Notes",
  bundleId: "com.example.orbit-notes",
  platforms: ["IOS"],
};

const portfolioCoverage = {
  sourceId: portfolioSource.id,
  state: "READY" as const,
  selectedAppCount: 1,
  freshness: portfolioFreshness,
  detail: "Source is complete for the selected range.",
};

const catalogRevision = "catalog_0123456789abcdef0123456789abcdef0123456789abcdef";

const portfolioOverviewResponse = {
  schemaVersion: 2 as const,
  catalogRevision,
  scope: "PORTFOLIO" as const,
  appIds: [portfolioApp.id],
  apps: [portfolioApp],
  sourceCoverage: [portfolioCoverage],
  period: { startDate: "2026-08-01", endDate: "2026-08-27" },
  comparisonPeriod: null,
  kpis: [],
  series: [],
  breakdowns: [],
  appContributions: [],
  freshness: portfolioFreshness,
  privacy: {
    aggregatedOnly: true as const,
    includesOptInUsageData: true,
    mayIncludePrivacyAdjustments: false,
    detail: "Usage data remains subject to Apple privacy processing.",
  },
  provenance: {
    source: "APP_STORE_CONNECT_ANALYTICS_REPORTS" as const,
    reportNames: ["App Store Downloads Standard"],
    reportRequestIds: ["source:issuer-a:request-1"],
    snapshotId: "portfolio-snapshot-1",
    evidenceId: "portfolio-evidence-1",
  },
  metricCoverage: [],
  appliedFilters: { territories: [], sources: [], productPages: [], versions: [] },
  facets: { territories: [], sources: [], productPages: [], versions: [] },
  snapshotId: "portfolio-snapshot-1",
  evidenceId: "portfolio-evidence-1",
};

describe("analytics contracts", () => {
  it("keeps V2 portfolio scope server-owned instead of accepting a client app list or issuer", () => {
    const base = {
      schemaVersion: 2,
      scope: "PORTFOLIO",
      selection: { kind: "ALL_CONNECTED" },
      startDate: "2026-08-01",
      endDate: "2026-08-27",
      compare: "PREVIOUS_PERIOD",
      granularity: "DAY",
      breakdowns: ["APP"],
    };

    expect(AnalyticsOverviewQueryV2Schema.safeParse(base).success).toBe(true);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({
      ...base,
      selection: { kind: "APP", appId: portfolioApp.id },
    }).success).toBe(false);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({ ...base, appIds: [portfolioApp.id] }).success).toBe(false);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({ ...base, issuerId: "issuer-a" }).success).toBe(false);
  });

  it("requires one opaque portfolio app selection for a V2 app query", () => {
    const base = {
      schemaVersion: 2,
      scope: "APP",
      selection: { kind: "APP", appId: portfolioApp.id },
      startDate: "2026-08-01",
      endDate: "2026-08-27",
      compare: "NONE",
      granularity: "DAY",
      breakdowns: ["TERRITORY"],
    };

    expect(AnalyticsOverviewQueryV2Schema.safeParse(base).success).toBe(true);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({
      ...base,
      selection: { kind: "ALL_CONNECTED" },
    }).success).toBe(false);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({ ...base, selection: { kind: "APP", appId: "" } }).success).toBe(false);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({ ...base, appIds: ["1234567890"] }).success).toBe(false);
    expect(AnalyticsOverviewQueryV2Schema.safeParse({ ...base, issuerId: "issuer-a" }).success).toBe(false);
  });

  it("requires a coherent multi-source portfolio catalog and preserves account failures", () => {
    const failedSource = {
      id: "source:issuer-b",
      accounts: [{
        id: "account-b",
        profileName: "Studio B",
        active: false,
        state: "ERROR" as const,
        appCount: 0,
        detail: "Apple rejected this credential.",
      }],
      state: "ERROR" as const,
      appCount: 0,
      lastDiscoveredAt: "2026-08-29T12:00:00.000Z",
      detail: "This source could not be refreshed.",
    };
    const catalog = {
      schemaVersion: 2,
      catalogRevision,
      complete: false,
      generatedAt: "2026-08-29T12:00:00.000Z",
      sources: [portfolioSource, failedSource],
      apps: [portfolioApp],
    };

    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse(catalog).success).toBe(true);
    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse({
      ...catalog,
      apps: [portfolioApp, { ...portfolioApp, sourceId: failedSource.id }],
    }).success).toBe(false);
    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse({
      ...catalog,
      apps: [{ ...portfolioApp, sourceId: "source:unknown" }],
    }).success).toBe(false);
    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse({
      ...catalog,
      sources: [{ ...portfolioSource, appCount: 2 }, failedSource],
    }).success).toBe(false);
  });

  it("requires V2 overview responses to disclose selected apps and every source's coverage", () => {
    expect(AnalyticsOverviewResponseV2Schema.safeParse(portfolioOverviewResponse).success).toBe(true);
    const { apps: _apps, ...withoutApps } = portfolioOverviewResponse;
    const { sourceCoverage: _sourceCoverage, ...withoutCoverage } = portfolioOverviewResponse;
    expect(AnalyticsOverviewResponseV2Schema.safeParse(withoutApps).success).toBe(false);
    expect(AnalyticsOverviewResponseV2Schema.safeParse(withoutCoverage).success).toBe(false);
    expect(AnalyticsOverviewResponseV2Schema.safeParse({
      ...portfolioOverviewResponse,
      issuerId: "issuer-a",
    }).success).toBe(false);
  });

  it("represents portfolio status and sync failures explicitly without exposing issuer IDs", () => {
    const failedFreshness = {
      syncedAt: null,
      dataThrough: null,
      expectedDelayDays: null,
      partial: true,
      detail: "No current cache is available for this source.",
    };
    const failedCoverage = {
      sourceId: "source:issuer-b",
      state: "ERROR" as const,
      selectedAppCount: 0,
      freshness: failedFreshness,
      detail: "Apple rejected this credential.",
    };
    const status = {
      schemaVersion: 2,
      catalogRevision,
      state: "PARTIAL",
      sources: [portfolioCoverage, failedCoverage],
      reportRequests: [],
      reportRequestInspections: [{
        appId: portfolioApp.id,
        sourceId: portfolioSource.id,
        state: "INSPECTED",
        detail: "Report requests were inspected for this app.",
      }],
      freshness: { ...portfolioFreshness, partial: true, detail: "One connected source is unavailable." },
      detail: "One of two connected sources is unavailable.",
    };
    expect(AnalyticsPortfolioStatusResponseSchema.safeParse(status).success).toBe(true);
    expect(AnalyticsPortfolioStatusResponseSchema.safeParse({ ...status, issuerId: "issuer-a" }).success).toBe(false);

    const sync = {
      schemaVersion: 2,
      runId: "portfolio-sync-1",
      state: "PARTIAL",
      sources: [{
        sourceId: portfolioSource.id,
        state: "SUCCEEDED",
        appIds: [portfolioApp.id],
        runIds: ["source-sync-a"],
        freshness: portfolioFreshness,
        batchCount: 4,
        observationCount: 200,
        error: null,
      }, {
        sourceId: failedCoverage.sourceId,
        state: "FAILED",
        appIds: [],
        runIds: ["source-sync-b"],
        freshness: failedFreshness,
        batchCount: 0,
        observationCount: 0,
        error: "Apple rejected this credential.",
      }],
      startedAt: "2026-08-29T12:00:00.000Z",
      completedAt: "2026-08-29T12:01:00.000Z",
      freshness: status.freshness,
      batchCount: 4,
      observationCount: 200,
      error: "Studio B could not be synced.",
    };
    expect(AnalyticsPortfolioSyncResponseSchema.safeParse(sync).success).toBe(true);
    expect(AnalyticsPortfolioSyncResponseSchema.safeParse({ ...sync, issuerId: "issuer-a" }).success).toBe(false);
  });

  it("keeps workspace sync and report-request inputs server-scoped and strict", () => {
    expect(AnalyticsPortfolioSyncInputSchema.safeParse({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: true,
    }).success).toBe(true);
    expect(AnalyticsPortfolioSyncInputSchema.safeParse({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      appIds: [portfolioApp.id],
      force: true,
    }).success).toBe(false);
    expect(AnalyticsPortfolioSyncInputSchema.safeParse({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      issuerId: "issuer-a",
      force: true,
    }).success).toBe(false);

    const reportRequest = {
      schemaVersion: 2,
      appId: portfolioApp.id,
      accessType: "ONGOING",
    };
    expect(AnalyticsPortfolioReportRequestCreateInputSchema.safeParse(reportRequest).success).toBe(true);
    expect(AnalyticsPortfolioReportRequestCreateInputSchema.safeParse({
      ...reportRequest,
      issuerId: "issuer-a",
    }).success).toBe(false);
    expect(AnalyticsPortfolioReportRequestCreateInputSchema.safeParse({
      ...reportRequest,
      appKey: portfolioApp.id,
    }).success).toBe(false);
  });

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
