import type {
  AgentStatus,
  AnalyticsFactBatch,
  AnalyticsMetricCoverage,
  AnalyticsObservation,
  AnalyticsOverviewQuery,
  AnalyticsReportRequest,
  AnalyticsStatusResponse,
  AnalyticsSyncResponse,
  AuditEvent,
  MutationPlan,
} from "@asc-studio/contracts";
import { describe, expect, it } from "vitest";
import {
  AnalyticsService,
  AscStudioService,
  DomainError,
  type AnalyticsProvider,
  type AnalyticsStore,
  type AscProvider,
  type PlanStore,
} from "./index.js";

const appOne = { id: "app-1", name: "First App", bundleId: "example.first", platforms: ["IOS"] };
const appTwo = { id: "app-2", name: "Second App", bundleId: "example.second", platforms: ["IOS"] };

const freshness = {
  syncedAt: "2026-08-22T10:00:00.000Z",
  dataThrough: "2026-08-02",
  expectedDelayDays: 2,
  partial: false,
  detail: "Complete through August 2.",
} as const;

const privacy = {
  aggregatedOnly: true,
  includesOptInUsageData: true,
  mayIncludePrivacyAdjustments: true,
  detail: "Apple privacy processing applies.",
} as const;

const observation = (
  date: string,
  appId: string,
  metric: AnalyticsObservation["metric"],
  value: AnalyticsObservation["value"],
): AnalyticsObservation => ({
  date,
  appId,
  metric,
  value,
  currency: metric === "PROCEEDS" ? "USD" : null,
  dimensions: { territory: appId === "app-1" ? "USA" : "GBR", source: "App Store Search" },
  reportName: metric === "PROCEEDS" ? "App Store Commerce" : "App Store Engagement",
  availability: "AVAILABLE",
  evidenceId: `fact:${date}:${appId}:${metric}`,
});

const observations: AnalyticsObservation[] = [
  observation("2026-07-30", "app-1", "DOWNLOADS", 10),
  observation("2026-07-30", "app-1", "PRODUCT_PAGE_VIEWS", 100),
  observation("2026-07-30", "app-1", "SESSIONS", 20),
  observation("2026-07-30", "app-1", "PROCEEDS", 12),
  observation("2026-07-31", "app-2", "DOWNLOADS", 15),
  observation("2026-07-31", "app-2", "PRODUCT_PAGE_VIEWS", 50),
  observation("2026-07-31", "app-2", "SESSIONS", 30),
  observation("2026-07-31", "app-2", "PROCEEDS", 8),
  observation("2026-08-01", "app-1", "DOWNLOADS", 20),
  observation("2026-08-01", "app-1", "PRODUCT_PAGE_VIEWS", 100),
  observation("2026-08-01", "app-1", "SESSIONS", 40),
  observation("2026-08-01", "app-1", "PROCEEDS", -5),
  observation("2026-08-02", "app-2", "DOWNLOADS", 30),
  observation("2026-08-02", "app-2", "PRODUCT_PAGE_VIEWS", 50),
  observation("2026-08-02", "app-2", "SESSIONS", 60),
  observation("2026-08-02", "app-2", "PROCEEDS", 15),
];

const status = (issuerId: string | null = "issuer-1"): AnalyticsStatusResponse => ({
  schemaVersion: 1,
  issuerId,
  state: issuerId ? "READY" : "NOT_CONFIGURED",
  reportRequests: [],
  freshness,
  detail: issuerId ? "Analytics is ready." : "Connect App Store Connect first.",
});

class AnalyticsMemoryStore implements AnalyticsStore {
  readonly runs = new Map<string, AnalyticsSyncResponse>();
  readonly batches: AnalyticsFactBatch[] = [];
  readCount = 0;

  constructor(
    private readonly snapshotObservations: AnalyticsObservation[] = observations,
    private readonly metricCoverage?: AnalyticsMetricCoverage[],
  ) {}

  async replaceAnalyticsFactBatch(batch: AnalyticsFactBatch) {
    this.batches.push(batch);
    return { observationCount: batch.observations.length, replaced: false };
  }

  async readAnalyticsSnapshot() {
    this.readCount += 1;
    return {
      observations: this.snapshotObservations,
      freshness,
      privacy,
      provenance: {
        source: "APP_STORE_CONNECT_ANALYTICS_REPORTS" as const,
        reportNames: ["App Store Engagement", "App Store Commerce"],
        reportRequestIds: ["request-1"],
        snapshotId: "snapshot-1",
        evidenceId: "evidence-1",
      },
      ...(this.metricCoverage ? { metricCoverage: this.metricCoverage } : {}),
    };
  }

  async saveAnalyticsSyncRun(run: AnalyticsSyncResponse) {
    this.runs.set(run.runId, run);
  }

  async getAnalyticsSyncRun(runId: string) {
    return this.runs.get(runId) ?? null;
  }
}

const providerFor = (analyticsStatus = status()): AnalyticsProvider => ({
  getAnalyticsStatus: async () => analyticsStatus,
  listAnalyticsReportRequests: async () => [],
  createAnalyticsReportRequest: async (input) => ({
    id: "request-created",
    appId: input.appId,
    accessType: input.accessType,
    createdAt: "2026-08-22T12:00:00.000Z",
    stoppedDueToInactivity: false,
  }),
  syncAnalytics: async () => {
    throw new Error("not used");
  },
});

const query: AnalyticsOverviewQuery = {
  schemaVersion: 1,
  scope: "PORTFOLIO",
  appIds: ["app-1", "app-2"],
  startDate: "2026-08-01",
  endDate: "2026-08-02",
  compare: "PREVIOUS_PERIOD",
  granularity: "DAY",
  breakdowns: ["APP"],
  filters: { territories: [], sources: [], productPages: [], versions: [] },
};
const portfolioContext = { issuerId: "issuer-1", apps: [appOne, appTwo] };

describe("AnalyticsService", () => {
  it("serves portfolio and app overviews without consulting the analytics provider", async () => {
    let providerCalls = 0;
    const provider: AnalyticsProvider = {
      getAnalyticsStatus: async () => {
        providerCalls += 1;
        return status();
      },
      listAnalyticsReportRequests: async () => {
        providerCalls += 1;
        return [];
      },
      createAnalyticsReportRequest: async () => {
        providerCalls += 1;
        throw new Error("not used");
      },
      syncAnalytics: async () => {
        providerCalls += 1;
        throw new Error("not used");
      },
    };
    const service = new AnalyticsService({
      provider,
      store: new AnalyticsMemoryStore(),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "local-only",
    });

    await service.overview(query, portfolioContext);
    await service.overview(
      { ...query, scope: "APP", appIds: ["app-1"], breakdowns: ["TERRITORY"] },
      portfolioContext,
    );

    expect(providerCalls).toBe(0);
  });

  it("aggregates the whole portfolio and recomputes ratios from additive facts", async () => {
    const store = new AnalyticsMemoryStore();
    const service = new AnalyticsService({
      provider: providerFor(),
      store,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: (value) => `digest:${value.length}`,
    });

    const result = await service.overview(query, portfolioContext);
    expect(result.scope).toBe("PORTFOLIO");
    expect(result.comparisonPeriod).toEqual({ startDate: "2026-07-30", endDate: "2026-07-31" });
    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOADS")?.current.value).toBe(50);
    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOAD_RATE")?.current.value).toBeCloseTo(50 / 150);
    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOAD_RATE")?.previous?.value).toBeCloseTo(25 / 150);
    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOAD_RATE")?.formula).toBe("Total downloads ÷ product page views");
    expect(result.kpis.find((kpi) => kpi.metric === "SESSIONS")?.current.value).toBe(100);
    expect(result.kpis.find((kpi) => kpi.metric === "PROCEEDS")?.current.value).toBe(10);
    expect(result.breakdowns).toHaveLength(5);
    expect(result.breakdowns[0]?.rows.map((row) => [row.appId, row.share])).toEqual([
      ["app-2", 0.6],
      ["app-1", 0.4],
    ]);
    const rateByApp = result.breakdowns.find((breakdown) => (
      breakdown.dimension === "APP" && breakdown.metric === "DOWNLOAD_RATE"
    ));
    expect(rateByApp?.rows.map((row) => [row.appId, row.current.value, row.share])).toEqual([
      ["app-2", 0.6, null],
      ["app-1", 0.2, null],
    ]);
    expect(result.breakdowns.find((breakdown) => breakdown.metric === "SESSIONS")?.rows[0]).toMatchObject({
      appId: "app-2",
      current: { value: 60, availability: "AVAILABLE" },
    });
    expect(result.breakdowns.find((breakdown) => breakdown.metric === "PROCEEDS")?.rows.map((row) => [row.current.value, row.share])).toEqual([
      [15, 0.75],
      [-5, -0.25],
    ]);
    expect(result.appContributions.filter((item) => item.metric === "DOWNLOADS")[0]).toMatchObject({
      appId: "app-2",
      absoluteChange: 15,
      shareOfPortfolioChange: 0.6,
    });
    expect(result.appContributions.find((item) => item.metric === "PROCEEDS" && item.appId === "app-1")?.shareOfPortfolioChange)
      .toBeCloseTo(-17 / 24);
    expect(result.snapshotId).toBe("snapshot-1");
    expect(result.metricCoverage.find((coverage) => coverage.metric === "DOWNLOAD_RATE")).toMatchObject({
      source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
      formula: "Total downloads ÷ product page views",
      completeThrough: "2026-08-02",
    });
    expect(result.appliedFilters).toEqual({ territories: [], sources: [], productPages: [], versions: [] });
  });

  it("returns nullable unavailable metrics without reading another issuer's cache", async () => {
    const store = new AnalyticsMemoryStore();
    const service = new AnalyticsService({
      provider: providerFor(status(null)),
      store,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "empty-evidence",
    });

    const result = await service.overview(
      { ...query, compare: "NONE" },
      { ...portfolioContext, issuerId: null },
    );
    expect(store.readCount).toBe(0);
    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOADS")?.current).toEqual({
      value: null,
      availability: "UNAVAILABLE",
    });
    expect(result.comparisonPeriod).toBeNull();
    expect(result.provenance.reportNames).toEqual([]);
    expect(result.appContributions).toHaveLength(12);
    expect(result.appContributions.every((item) => (
      item.currentValue === null
      && item.currentAvailability === "UNAVAILABLE"
      && item.previousValue === null
      && item.previousAvailability === null
      && item.absoluteChange === null
      && item.direction === "UNAVAILABLE"
    ))).toBe(true);
  });

  it("exposes per-app contribution availability without requiring comparison data", async () => {
    const partial = observations.map((item) => (
      item.date === "2026-08-01" && item.appId === "app-1" && item.metric === "SESSIONS"
        ? { ...item, availability: "PARTIAL" as const }
        : item
    ));
    const store = new AnalyticsMemoryStore(partial);
    const service = new AnalyticsService({
      provider: providerFor(),
      store,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "evidence",
    });

    const result = await service.overview({ ...query, compare: "NONE" }, portfolioContext);
    expect(result.appContributions).toHaveLength(12);
    expect(result.appContributions.find((item) => item.appId === "app-1" && item.metric === "SESSIONS")).toMatchObject({
      currentValue: 40,
      currentAvailability: "PARTIAL",
      previousValue: null,
      previousAvailability: null,
      absoluteChange: null,
      shareOfPortfolioChange: null,
      direction: "UNAVAILABLE",
    });
  });

  it("never turns privacy-withheld null into zero while preserving a reported zero", async () => {
    const zero = observation("2026-08-01", "app-1", "SESSIONS", 0);
    const withheld = {
      ...observation("2026-08-01", "app-2", "SESSIONS", 1),
      value: null,
      availability: "PRIVACY_WITHHELD" as const,
    };
    const service = new AnalyticsService({
      provider: providerFor(),
      store: new AnalyticsMemoryStore([zero, withheld]),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "zero-truth",
    });

    const result = await service.overview(
      { ...query, startDate: "2026-08-01", endDate: "2026-08-01", compare: "NONE" },
      portfolioContext,
    );
    expect(result.kpis.find((kpi) => kpi.metric === "SESSIONS")?.current).toEqual({
      value: 0,
      availability: "PARTIAL",
    });
    expect(result.breakdowns.find((breakdown) => breakdown.metric === "SESSIONS")?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ appId: "app-1", current: { value: 0, availability: "AVAILABLE" } }),
      expect.objectContaining({ appId: "app-2", current: { value: null, availability: "PRIVACY_WITHHELD" } }),
    ]));
    expect(result.appContributions.find((item) => item.metric === "SESSIONS" && item.appId === "app-1")).toMatchObject({
      currentValue: 0,
      currentAvailability: "AVAILABLE",
    });
    expect(result.appContributions.find((item) => item.metric === "SESSIONS" && item.appId === "app-2")).toMatchObject({
      currentValue: null,
      currentAvailability: "PRIVACY_WITHHELD",
    });

    const withheldOnlyService = new AnalyticsService({
      provider: providerFor(),
      store: new AnalyticsMemoryStore([withheld]),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "withheld-only",
    });
    const withheldOnly = await withheldOnlyService.overview({
      ...query,
      scope: "APP",
      appIds: ["app-2"],
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      compare: "NONE",
    }, { issuerId: "issuer-1", apps: [appTwo] });
    expect(withheldOnly.kpis.find((kpi) => kpi.metric === "SESSIONS")?.current).toEqual({
      value: null,
      availability: "PRIVACY_WITHHELD",
    });
    expect(withheldOnly.series.find((series) => series.metric === "SESSIONS")?.points[0]?.current).toEqual({
      value: null,
      availability: "PRIVACY_WITHHELD",
    });
  });

  it("labels portfolio subtotals partial when a selected app is missing a required metric family", async () => {
    const incompletePortfolio = [
      observation("2026-08-01", "app-1", "DOWNLOADS", 10),
      observation("2026-08-01", "app-1", "PRODUCT_PAGE_VIEWS", 20),
      observation("2026-08-01", "app-2", "PRODUCT_PAGE_VIEWS", 30),
    ];
    const service = new AnalyticsService({
      provider: providerFor(),
      store: new AnalyticsMemoryStore(incompletePortfolio),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "missing-app-family",
    });
    const result = await service.overview({
      ...query,
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      compare: "NONE",
    }, portfolioContext);

    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOADS")?.current).toEqual({ value: 10, availability: "PARTIAL" });
    expect(result.kpis.find((kpi) => kpi.metric === "PRODUCT_PAGE_VIEWS")?.current).toEqual({ value: 50, availability: "AVAILABLE" });
    expect(result.kpis.find((kpi) => kpi.metric === "DOWNLOAD_RATE")?.current).toEqual({ value: 0.2, availability: "PARTIAL" });
    expect(result.series.find((series) => series.metric === "DOWNLOADS")?.points[0]?.current).toEqual({ value: 10, availability: "PARTIAL" });
    expect(result.breakdowns.find((breakdown) => breakdown.dimension === "APP" && breakdown.metric === "DOWNLOADS")?.rows)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ appId: "app-1", current: { value: 10, availability: "PARTIAL" }, share: null }),
        expect.objectContaining({ appId: "app-2", current: { value: null, availability: "UNAVAILABLE" }, share: null }),
      ]));
    expect(result.appContributions.find((item) => item.metric === "DOWNLOADS" && item.appId === "app-1")).toMatchObject({
      currentValue: 10,
      currentAvailability: "PARTIAL",
      shareOfPortfolioChange: null,
    });
    expect(result.metricCoverage.find((item) => item.metric === "DOWNLOADS")).toMatchObject({
      completeThrough: null,
      availability: "PARTIAL",
      expectedDelayDays: 2,
    });
  });

  it("keeps a numeric trailing subtotal partial when source partitions do not cover the selected period", async () => {
    const sparseDownloads = [observation("2026-08-20", "app-1", "DOWNLOADS", 10)];
    const sparseCoverage: AnalyticsMetricCoverage[] = [{
      metric: "DOWNLOADS",
      source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
      formula: "First-time downloads + redownloads",
      expectedDelayDays: 2,
      completeThrough: null,
      availability: "PARTIAL",
      detail: "The selected period does not have continuous settled download partitions.",
      reportFamilies: [{
        reportName: "App Store Downloads Standard",
        expectedDelayDays: 2,
        completeThrough: null,
        availability: "PARTIAL",
        detail: "Only the trailing five days are stored.",
      }],
    }];
    const service = new AnalyticsService({
      provider: providerFor(),
      store: new AnalyticsMemoryStore(sparseDownloads, sparseCoverage),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "sparse-period",
    });
    const result = await service.overview({
      ...query,
      appIds: ["app-1"],
      startDate: "2026-07-22",
      endDate: "2026-08-20",
      compare: "NONE",
    }, { issuerId: "issuer-1", apps: [appOne] });

    expect(result.kpis.find((item) => item.metric === "DOWNLOADS")?.current).toEqual({
      value: 10,
      availability: "PARTIAL",
    });
    expect(result.series.find((item) => item.metric === "DOWNLOADS")?.points.at(-1)?.current).toEqual({
      value: 10,
      availability: "PARTIAL",
    });
    expect(result.breakdowns.find((item) => item.metric === "DOWNLOADS")?.rows[0]?.current).toEqual({
      value: 10,
      availability: "PARTIAL",
    });
    expect(result.appContributions.find((item) => item.metric === "DOWNLOADS")).toMatchObject({
      currentValue: 10,
      currentAvailability: "PARTIAL",
      shareOfPortfolioChange: null,
    });
  });

  it("offers sessions breakdowns only for dimensions retained by the sessions report", async () => {
    const session = {
      ...observation("2026-08-01", "app-1", "SESSIONS", 12),
      dimensions: {
        territory: "USA",
        source: "App Store Search",
        productPage: "Product Page",
        version: "2.5.0",
      },
    };
    const service = new AnalyticsService({
      provider: providerFor(),
      store: new AnalyticsMemoryStore([session]),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      digest: () => "sessions-dimensions",
    });
    const result = await service.overview({
      ...query,
      scope: "APP",
      appIds: ["app-1"],
      startDate: "2026-08-01",
      endDate: "2026-08-01",
      compare: "NONE",
      breakdowns: ["TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"],
    }, { issuerId: "issuer-1", apps: [appOne] });

    expect(result.breakdowns.filter((item) => item.metric === "SESSIONS").map((item) => item.dimension)).toEqual([
      "TERRITORY",
      "SOURCE",
      "PRODUCT_PAGE",
      "VERSION",
    ]);
  });
});

class MemoryPlanStore implements PlanStore {
  readonly plans = new Map<string, MutationPlan>();
  readonly events: AuditEvent[] = [];

  async savePlan(plan: MutationPlan) { this.plans.set(plan.id, plan); }
  async getPlan(id: string) { return this.plans.get(id) ?? null; }
  async listPlans(state: MutationPlan["state"], limit: number) {
    return [...this.plans.values()].filter((plan) => plan.state === state).slice(0, limit);
  }
  async claimPlan(id: string, expectedState: MutationPlan["state"], next: MutationPlan) {
    if (this.plans.get(id)?.state !== expectedState) return false;
    this.plans.set(id, next);
    return true;
  }
  async appendAudit(event: Omit<AuditEvent, "sequence">) {
    const saved = { ...event, sequence: this.events.length + 1 };
    this.events.push(saved);
    return saved;
  }
  async listAudit(limit: number) { return this.events.slice(-limit); }
}

const connectedStatus: AgentStatus = {
  mode: "live",
  connected: true,
  provider: "app-store-connect-api",
  connectionId: "connection-1",
  profile: "Main team",
  authBackend: "macos-keychain",
  detail: "Connected.",
};

describe("analytics report-request plans", () => {
  it("requires a reviewed plan before creating an ongoing Apple report request", async () => {
    const requests: AnalyticsReportRequest[] = [];
    const analyticsProvider: AnalyticsProvider = {
      ...providerFor(),
      listAnalyticsReportRequests: async () => [...requests],
      createAnalyticsReportRequest: async (input) => {
        const created = {
          id: "request-created",
          appId: input.appId,
          accessType: input.accessType,
          createdAt: "2026-08-22T12:00:00.000Z",
          stoppedDueToInactivity: false,
        } satisfies AnalyticsReportRequest;
        requests.push(created);
        return created;
      },
    };
    const planStore = new MemoryPlanStore();
    const service = new AscStudioService({
      provider: {
        getStatus: async () => connectedStatus,
        listApps: async () => [appOne, appTwo],
      } as unknown as AscProvider,
      analyticsProvider,
      store: planStore,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      id: () => "plan-1",
      digest: (value) => value,
    });

    const plan = await service.createAnalyticsReportRequestPlan({ appId: "app-1", accessType: "ONGOING" }, "gui");
    expect(plan).toMatchObject({
      operation: "analytics.report_request.create",
      state: "awaiting_confirmation",
      target: { appId: "app-1", appName: "First App", accessType: "ONGOING" },
    });
    expect(requests).toHaveLength(0);

    const confirmed = await service.confirmPlan(plan.id, plan.digest, "gui");
    expect(confirmed.state).toBe("succeeded");
    expect(requests).toHaveLength(1);
  });

  it("marks a plan stale if an equivalent request appears before confirmation", async () => {
    const requests: AnalyticsReportRequest[] = [];
    const analyticsProvider: AnalyticsProvider = {
      ...providerFor(),
      listAnalyticsReportRequests: async () => [...requests],
    };
    const planStore = new MemoryPlanStore();
    const service = new AscStudioService({
      provider: {
        getStatus: async () => connectedStatus,
        listApps: async () => [appOne],
      } as unknown as AscProvider,
      analyticsProvider,
      store: planStore,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      id: () => "plan-stale",
      digest: (value) => value,
    });
    const plan = await service.createAnalyticsReportRequestPlan({ appId: "app-1", accessType: "ONE_TIME_SNAPSHOT" }, "gui");
    requests.push({
      id: "request-raced",
      appId: "app-1",
      accessType: "ONE_TIME_SNAPSHOT",
      createdAt: "2026-08-22T12:01:00.000Z",
      stoppedDueToInactivity: false,
    });

    await expect(service.confirmPlan(plan.id, plan.digest, "gui")).rejects.toMatchObject({
      code: "stale_plan",
    } satisfies Partial<DomainError>);
    expect(planStore.plans.get(plan.id)?.state).toBe("stale");
  });

  it("blocks only an active ongoing request and permits replacing a stopped one", async () => {
    const active: AnalyticsReportRequest = {
      id: "ongoing-active",
      appId: "app-1",
      accessType: "ONGOING",
      createdAt: "2026-07-01T00:00:00.000Z",
      stoppedDueToInactivity: false,
    };
    const stopped = { ...active, id: "ongoing-stopped", stoppedDueToInactivity: true };
    let requests = [active];
    const analyticsProvider: AnalyticsProvider = {
      ...providerFor(),
      listAnalyticsReportRequests: async () => [...requests],
    };
    const provider = {
      getStatus: async () => connectedStatus,
      listApps: async () => [appOne],
    } as unknown as AscProvider;
    const activeService = new AscStudioService({
      provider,
      analyticsProvider,
      store: new MemoryPlanStore(),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      id: () => "active-plan",
      digest: (value) => value,
    });
    await expect(activeService.createAnalyticsReportRequestPlan({ appId: "app-1", accessType: "ONGOING" }, "gui"))
      .rejects.toMatchObject({ code: "analytics_report_request_exists" });

    requests = [stopped];
    const stoppedStore = new MemoryPlanStore();
    const stoppedService = new AscStudioService({
      provider,
      analyticsProvider,
      store: stoppedStore,
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      id: () => "stopped-plan",
      digest: (value) => value,
    });
    const plan = await stoppedService.createAnalyticsReportRequestPlan({ appId: "app-1", accessType: "ONGOING" }, "gui");
    expect(plan).toMatchObject({
      before: {
        matchingReportRequestIds: ["ongoing-stopped"],
        activeOngoingReportRequestIds: [],
      },
    });
    expect((await stoppedService.confirmPlan(plan.id, plan.digest, "gui")).state).toBe("succeeded");
  });

  it("allows another one-time snapshot while retaining existing IDs for stale detection", async () => {
    const requests: AnalyticsReportRequest[] = [{
      id: "snapshot-existing",
      appId: "app-1",
      accessType: "ONE_TIME_SNAPSHOT",
      createdAt: "2026-07-01T00:00:00.000Z",
      stoppedDueToInactivity: false,
    }];
    const analyticsProvider: AnalyticsProvider = {
      ...providerFor(),
      listAnalyticsReportRequests: async () => [...requests],
    };
    const service = new AscStudioService({
      provider: {
        getStatus: async () => connectedStatus,
        listApps: async () => [appOne],
      } as unknown as AscProvider,
      analyticsProvider,
      store: new MemoryPlanStore(),
      now: () => new Date("2026-08-22T12:00:00.000Z"),
      id: () => "snapshot-plan",
      digest: (value) => value,
    });

    const plan = await service.createAnalyticsReportRequestPlan({ appId: "app-1", accessType: "ONE_TIME_SNAPSHOT" }, "gui");
    expect(plan).toMatchObject({
      before: {
        matchingReportRequestIds: ["snapshot-existing"],
        activeOngoingReportRequestIds: [],
      },
    });
    expect(plan.summary).toContain("frequency limit");
    expect((await service.confirmPlan(plan.id, plan.digest, "gui")).state).toBe("succeeded");
  });
});
