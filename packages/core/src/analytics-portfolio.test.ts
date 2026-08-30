import { createHash } from "node:crypto";
import type {
  AnalyticsFactBatch,
  AnalyticsMetricCoverage,
  AnalyticsObservation,
  AnalyticsObservationQuery,
  AnalyticsOverviewQueryV2,
  AnalyticsStatusResponse,
  AnalyticsSyncResponse,
} from "@asc-studio/contracts";
import { describe, expect, it } from "vitest";
import {
  AnalyticsService,
  type AnalyticsFactBatchWriteResult,
  type AnalyticsPortfolioOverviewContext,
  type AnalyticsPortfolioOverviewSource,
  type AnalyticsProvider,
  type AnalyticsStore,
  type AnalyticsStoredSnapshot,
} from "./index.js";

const currentDate = "2026-08-27";
const previousDate = "2026-08-26";
const sharedRawAppId = "1234567890";

const query: AnalyticsOverviewQueryV2 = {
  schemaVersion: 2,
  scope: "PORTFOLIO",
  selection: { kind: "ALL_CONNECTED" },
  startDate: currentDate,
  endDate: currentDate,
  compare: "PREVIOUS_PERIOD",
  granularity: "DAY",
  breakdowns: ["APP"],
  filters: { territories: [], sources: [], productPages: [], versions: [] },
};

const observation = (
  issuer: "a" | "b",
  date: string,
  metric: AnalyticsObservation["metric"],
  value: number,
): AnalyticsObservation => ({
  date,
  appId: sharedRawAppId,
  metric,
  value,
  currency: metric === "PROCEEDS" ? "USD" : null,
  dimensions: {
    territory: issuer === "a" ? "USA" : "GBR",
    source: issuer === "a" ? "App Store Search" : "Web Referral",
  },
  reportName: metric === "DOWNLOADS"
    ? "App Store Downloads Standard"
    : metric === "PRODUCT_PAGE_VIEWS"
      ? "App Store Discovery and Engagement Standard"
      : "App Store Purchases Standard",
  availability: "AVAILABLE",
  evidenceId: `fact:${issuer}:${date}:${metric}`,
});

const metricCoverage = (completeThrough: string): AnalyticsMetricCoverage[] => ([
  ["DOWNLOADS", "App Store Downloads Standard", 2, "First-time downloads + redownloads"],
  ["PRODUCT_PAGE_VIEWS", "App Store Discovery and Engagement Standard", 3, null],
  ["PROCEEDS", "App Store Purchases Standard", 2, "Sum of USD-normalized proceeds"],
] as const).map(([metric, reportName, expectedDelayDays, formula]) => ({
  metric,
  source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
  formula,
  expectedDelayDays,
  completeThrough,
  availability: "AVAILABLE",
  detail: `${reportName} is complete through ${completeThrough}.`,
  reportFamilies: [{
    reportName,
    expectedDelayDays,
    completeThrough,
    availability: "AVAILABLE",
    detail: `${reportName} is complete through ${completeThrough}.`,
  }],
}));

const snapshot = (
  issuer: "a" | "b",
  values: {
    currentDownloads: number;
    currentViews: number;
    currentProceeds: number;
    previousDownloads: number;
    previousViews: number;
    previousProceeds: number;
  },
  completeThrough: string,
  syncedAt: string,
): AnalyticsStoredSnapshot => ({
  observations: [
    observation(issuer, previousDate, "DOWNLOADS", values.previousDownloads),
    observation(issuer, previousDate, "PRODUCT_PAGE_VIEWS", values.previousViews),
    observation(issuer, previousDate, "PROCEEDS", values.previousProceeds),
    observation(issuer, currentDate, "DOWNLOADS", values.currentDownloads),
    observation(issuer, currentDate, "PRODUCT_PAGE_VIEWS", values.currentViews),
    observation(issuer, currentDate, "PROCEEDS", values.currentProceeds),
  ],
  freshness: {
    syncedAt,
    dataThrough: completeThrough,
    expectedDelayDays: 5,
    partial: false,
    detail: `Complete through ${completeThrough}.`,
  },
  privacy: {
    aggregatedOnly: true,
    includesOptInUsageData: false,
    mayIncludePrivacyAdjustments: false,
    detail: "No usage metrics are included in this fixture.",
  },
  provenance: {
    source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
    reportNames: [
      "App Store Discovery and Engagement Standard",
      "App Store Downloads Standard",
      "App Store Purchases Standard",
    ],
    // Deliberately identical across issuers: public portfolio provenance must
    // namespace request IDs instead of collapsing them.
    reportRequestIds: ["request-1"],
    snapshotId: `snapshot-${issuer}`,
    evidenceId: `evidence-${issuer}`,
  },
  metricCoverage: metricCoverage(completeThrough),
  facets: {
    territories: [issuer === "a" ? "USA" : "GBR"],
    sources: [issuer === "a" ? "App Store Search" : "Web Referral"],
    productPages: [],
    versions: [],
  },
});

const sourceASnapshot = snapshot("a", {
  currentDownloads: 100,
  currentViews: 1_000,
  currentProceeds: 125,
  previousDownloads: 80,
  previousViews: 800,
  previousProceeds: 100,
}, "2026-08-29", "2026-08-30T10:00:00.000Z");

const sourceBSnapshot = snapshot("b", {
  currentDownloads: 300,
  currentViews: 500,
  currentProceeds: -25,
  previousDownloads: 200,
  previousViews: 400,
  previousProceeds: 20,
}, currentDate, "2026-08-29T09:00:00.000Z");

const sourceA: AnalyticsPortfolioOverviewSource = {
  id: "source-a",
  issuerId: "issuer-a",
  state: "READY" as const,
  detail: "Studio A is ready.",
  apps: [{
    id: "portfolio-app:source-a:shared",
    sourceId: "source-a",
    rawAppId: sharedRawAppId,
    name: "Orbit Notes",
    bundleId: "com.example.orbit",
    platforms: ["IOS"],
  }],
};

const sourceB: AnalyticsPortfolioOverviewSource = {
  id: "source-b",
  issuerId: "issuer-b",
  state: "READY" as const,
  detail: "Studio B is ready.",
  apps: [{
    id: "portfolio-app:source-b:shared",
    sourceId: "source-b",
    rawAppId: sharedRawAppId,
    name: "Field Log",
    bundleId: "com.example.field-log",
    platforms: ["IOS"],
  }],
};

const portfolioContext = (
  sources: AnalyticsPortfolioOverviewSource[] = [sourceA, sourceB],
): AnalyticsPortfolioOverviewContext => ({ catalogRevision: "catalog-revision-a", sources });

class PortfolioMemoryStore implements AnalyticsStore {
  readonly reads: AnalyticsObservationQuery[] = [];

  constructor(private readonly snapshots: ReadonlyMap<string, AnalyticsStoredSnapshot | null>) {}

  async readAnalyticsSnapshot(input: AnalyticsObservationQuery) {
    this.reads.push(input);
    return this.snapshots.get(input.issuerId) ?? null;
  }

  async replaceAnalyticsFactBatch(_batch: AnalyticsFactBatch): Promise<AnalyticsFactBatchWriteResult> {
    throw new Error("Portfolio overview tests must remain read-only.");
  }

  async saveAnalyticsSyncRun(_run: AnalyticsSyncResponse) {
    throw new Error("Portfolio overview tests must not create sync runs.");
  }

  async getAnalyticsSyncRun(_runId: string) {
    return null;
  }
}

const unusedProvider: AnalyticsProvider = {
  getAnalyticsStatus: async (): Promise<AnalyticsStatusResponse> => {
    throw new Error("Portfolio cache reads must not call the provider.");
  },
  listAnalyticsReportRequests: async () => {
    throw new Error("Portfolio cache reads must not call the provider.");
  },
  createAnalyticsReportRequest: async () => {
    throw new Error("Portfolio cache reads must not call the provider.");
  },
  syncAnalytics: async () => {
    throw new Error("Portfolio cache reads must not call the provider.");
  },
};

const serviceFor = (store: AnalyticsStore) => new AnalyticsService({
  provider: unusedProvider,
  store,
  now: () => new Date("2026-08-30T12:00:00.000Z"),
  digest: (value) => createHash("sha256").update(value).digest("hex"),
});

describe("AnalyticsService multi-account portfolio", () => {
  it("aggregates two issuers exactly, recomputes ratios, preserves refunds, and uses conservative freshness", async () => {
    const store = new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, sourceASnapshot],
      [sourceB.issuerId, sourceBSnapshot],
    ]));
    const result = await serviceFor(store).portfolioOverview(query, portfolioContext());

    expect(store.reads).toEqual(expect.arrayContaining([
      expect.objectContaining({ issuerId: "issuer-a", appIds: [sharedRawAppId] }),
      expect.objectContaining({ issuerId: "issuer-b", appIds: [sharedRawAppId] }),
    ]));
    expect(result.apps.map((app) => app.id)).toEqual([
      sourceA.apps[0]!.id,
      sourceB.apps[0]!.id,
    ]);
    expect(result.kpis.find((item) => item.metric === "DOWNLOADS")).toMatchObject({
      current: { value: 400, availability: "AVAILABLE" },
      previous: { value: 280, availability: "AVAILABLE" },
      change: { absolute: 120 },
    });
    expect(result.kpis.find((item) => item.metric === "DOWNLOAD_RATE")?.current.value).toBeCloseTo(400 / 1_500);
    expect(result.kpis.find((item) => item.metric === "DOWNLOAD_RATE")?.previous?.value).toBeCloseTo(280 / 1_200);
    expect(result.kpis.find((item) => item.metric === "PROCEEDS")).toMatchObject({
      current: { value: 100, availability: "AVAILABLE" },
      previous: { value: 120, availability: "AVAILABLE" },
      change: { absolute: -20 },
    });
    expect(result.freshness).toMatchObject({
      syncedAt: "2026-08-29T09:00:00.000Z",
      dataThrough: currentDate,
      partial: false,
    });
    expect(result.metricCoverage.find((item) => item.metric === "DOWNLOADS")).toMatchObject({
      completeThrough: currentDate,
      availability: "AVAILABLE",
    });
    expect(result.facets.territories).toEqual(["GBR", "USA"]);
    expect(result.provenance.reportRequestIds).toHaveLength(2);
    expect(new Set(result.provenance.reportRequestIds).size).toBe(2);
    expect(result.provenance.reportRequestIds.every((id) => !id.includes("request-1"))).toBe(true);
    expect(result.breakdowns.find((item) => item.metric === "DOWNLOADS")?.rows.map((row) => row.appId))
      .toEqual([sourceB.apps[0]!.id, sourceA.apps[0]!.id]);
  });

  it("keeps cached values but marks the whole portfolio partial when one source fails", async () => {
    const failedSourceB = { ...sourceB, state: "ERROR" as const, detail: "Studio B credential was rejected." };
    const result = await serviceFor(new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, sourceASnapshot],
      [sourceB.issuerId, sourceBSnapshot],
    ]))).portfolioOverview(query, portfolioContext([sourceA, failedSourceB]));

    expect(result.kpis.find((item) => item.metric === "DOWNLOADS")?.current).toEqual({
      value: 400,
      availability: "PARTIAL",
    });
    expect(result.kpis.find((item) => item.metric === "DOWNLOAD_RATE")?.current).toEqual({
      value: 400 / 1_500,
      availability: "PARTIAL",
    });
    expect(result.kpis.find((item) => item.metric === "PROCEEDS")?.current).toEqual({
      value: 100,
      availability: "PARTIAL",
    });
    expect(result.freshness).toMatchObject({
      dataThrough: currentDate,
      syncedAt: "2026-08-29T09:00:00.000Z",
      partial: true,
    });
    expect(result.sourceCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: "source-a", state: "READY" }),
      expect.objectContaining({
        sourceId: "source-b",
        state: "ERROR",
        freshness: expect.objectContaining({
          syncedAt: "2026-08-29T09:00:00.000Z",
          dataThrough: currentDate,
          partial: true,
        }),
      }),
    ]));
    expect(result.appContributions.every((item) => item.shareOfPortfolioChange === null)).toBe(true);
  });

  it("returns an explicitly partial subtotal when an unavailable source has no cache", async () => {
    const failedSourceB = { ...sourceB, state: "ERROR" as const, detail: "Studio B has no readable cache." };
    const result = await serviceFor(new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, sourceASnapshot],
      [sourceB.issuerId, null],
    ]))).portfolioOverview(query, portfolioContext([sourceA, failedSourceB]));

    expect(result.kpis.find((item) => item.metric === "DOWNLOADS")?.current).toEqual({
      value: 100,
      availability: "PARTIAL",
    });
    expect(result.kpis.find((item) => item.metric === "DOWNLOAD_RATE")?.current).toEqual({
      value: 0.1,
      availability: "PARTIAL",
    });
    expect(result.sourceCoverage.find((item) => item.sourceId === "source-b")).toMatchObject({
      state: "ERROR",
      selectedAppCount: 1,
      freshness: { dataThrough: null, partial: true },
    });
    expect(result.metricCoverage.find((item) => item.metric === "DOWNLOADS")).toMatchObject({
      completeThrough: null,
      availability: "PARTIAL",
    });
  });

  it("does not present privacy-only evidence as complete when another source is missing", async () => {
    const sessionCoverage: AnalyticsMetricCoverage = {
      metric: "SESSIONS",
      source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
      formula: null,
      expectedDelayDays: 3,
      completeThrough: currentDate,
      availability: "PRIVACY_WITHHELD",
      detail: "Every reported session value for this source is privacy withheld.",
      reportFamilies: [{
        reportName: "App Sessions Standard",
        expectedDelayDays: 3,
        completeThrough: currentDate,
        availability: "PRIVACY_WITHHELD",
        detail: "Session values are privacy withheld.",
      }],
    };
    const privacyOnlySourceA: AnalyticsStoredSnapshot = {
      ...sourceASnapshot,
      observations: [...sourceASnapshot.observations, {
        ...observation("a", currentDate, "SESSIONS", 0),
        value: null,
        reportName: "App Sessions Standard",
        availability: "PRIVACY_WITHHELD",
      }],
      metricCoverage: [...(sourceASnapshot.metricCoverage ?? []), sessionCoverage],
    };
    const failedSourceB = { ...sourceB, state: "ERROR" as const, detail: "Studio B has no readable cache." };
    const result = await serviceFor(new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, privacyOnlySourceA],
      [sourceB.issuerId, null],
    ]))).portfolioOverview(query, portfolioContext([sourceA, failedSourceB]));

    expect(result.metricCoverage.find((item) => item.metric === "SESSIONS")).toMatchObject({
      availability: "PRIVACY_WITHHELD",
      completeThrough: null,
    });
    expect(result.kpis.find((item) => item.metric === "SESSIONS")?.current).toEqual({
      value: null,
      availability: "PRIVACY_WITHHELD",
    });
    expect(result.freshness.partial).toBe(true);
  });

  it("treats a ready source with zero apps as complete without diluting portfolio coverage", async () => {
    const emptyReadySource: AnalyticsPortfolioOverviewSource = {
      id: "source-empty",
      issuerId: "issuer-empty",
      state: "READY",
      detail: "The connected organization currently contains no apps.",
      apps: [],
    };
    const store = new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, sourceASnapshot],
    ]));
    const result = await serviceFor(store).portfolioOverview(
      query,
      portfolioContext([sourceA, emptyReadySource]),
    );

    expect(store.reads).toHaveLength(1);
    expect(store.reads[0]).toMatchObject({ issuerId: sourceA.issuerId });
    expect(result.apps.map((app) => app.id)).toEqual([sourceA.apps[0]!.id]);
    expect(result.kpis.find((item) => item.metric === "DOWNLOADS")?.current).toEqual({
      value: 100,
      availability: "AVAILABLE",
    });
    expect(result.freshness).toMatchObject({
      syncedAt: "2026-08-30T10:00:00.000Z",
      dataThrough: "2026-08-29",
      partial: false,
    });
    expect(result.sourceCoverage.find((item) => item.sourceId === emptyReadySource.id)).toMatchObject({
      state: "READY",
      selectedAppCount: 0,
      freshness: {
        syncedAt: null,
        dataThrough: null,
        expectedDelayDays: null,
        partial: false,
      },
    });
  });

  it("makes merged evidence deterministic while keeping same-named source request IDs distinct", async () => {
    const store = new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, sourceASnapshot],
      [sourceB.issuerId, sourceBSnapshot],
    ]));
    const service = serviceFor(store);
    const forward = await service.portfolioOverview(query, portfolioContext([sourceA, sourceB]));
    const reversed = await service.portfolioOverview(query, portfolioContext([sourceB, sourceA]));

    expect(reversed.snapshotId).toBe(forward.snapshotId);
    expect(reversed.evidenceId).toBe(forward.evidenceId);
    expect(reversed.provenance.reportRequestIds).toEqual(forward.provenance.reportRequestIds);
    expect(new Set(forward.provenance.reportRequestIds).size).toBe(2);
  });

  it("rejects duplicate issuer aliases and duplicate public app identities before reading facts", async () => {
    const store = new PortfolioMemoryStore(new Map([
      [sourceA.issuerId, sourceASnapshot],
      [sourceB.issuerId, sourceBSnapshot],
    ]));
    const service = serviceFor(store);
    const duplicateIssuer = {
      ...sourceB,
      issuerId: sourceA.issuerId,
      detail: "A second credential for the same organization.",
    };
    const duplicatePublicApp = {
      ...sourceB,
      apps: [{ ...sourceB.apps[0]!, id: sourceA.apps[0]!.id }],
    };

    await expect(service.portfolioOverview(query, portfolioContext([sourceA, duplicateIssuer])))
      .rejects.toThrow("unique by source and issuer");
    await expect(service.portfolioOverview(query, portfolioContext([sourceA, duplicatePublicApp])))
      .rejects.toThrow("unique source-scoped identity");
    expect(store.reads).toEqual([]);
  });

});
