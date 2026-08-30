import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AnalyticsPortfolioSyncResponse,
  AnalyticsReportRequest,
  AnalyticsStatusResponse,
  AnalyticsSyncInput,
  AnalyticsSyncResult,
  AppSummary,
  MutationPlan,
} from "@asc-studio/contracts";
import { AnalyticsPortfolioReportRequestPlanResponseSchema } from "@asc-studio/contracts";
import { MockAscProvider } from "@asc-studio/provider-demo";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsPortfolioCoordinator, type AnalyticsPortfolioConnection } from "./analytics-portfolio.js";
import { SqliteAnalyticsStore } from "./analytics-store.js";

const directories: string[] = [];
const now = "2026-08-30T12:00:00.000Z";
const issuerA = "11111111-2222-3333-4444-555555555555";
const issuerB = "66666666-7777-8888-9999-000000000000";
const rawAppA = "1234567890";
const rawRequestA = "raw-analytics-request-a";

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const createStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-portfolio-test-"));
  directories.push(directory);
  const path = join(directory, "analytics.sqlite");
  return { path, store: new SqliteAnalyticsStore(path) };
};

const app = (id = rawAppA, name = "Orbit Notes"): AppSummary => ({
  id,
  name,
  bundleId: `com.example.${name.toLocaleLowerCase("en-US").replaceAll(" ", "-")}`,
  platforms: ["IOS"],
});

class PortfolioProvider extends MockAscProvider {
  listCalls = 0;
  syncCalls = 0;
  readonly syncInputs: AnalyticsSyncInput[] = [];
  readonly requests: AnalyticsReportRequest[];

  constructor(
    readonly issuerId: string,
    readonly portfolioApps: AppSummary[],
    readonly options: {
      failList?: boolean;
      listError?: string;
      failReportInspection?: boolean;
      syncGate?: Promise<void>;
      requestId?: string;
      requestAppIds?: string[];
    } = {},
  ) {
    super();
    this.requests = portfolioApps.filter((candidate) => (
      !options.requestAppIds || options.requestAppIds.includes(candidate.id)
    )).map((candidate, index) => ({
      id: options.requestId ?? `raw-request-${issuerId}-${index}`,
      appId: candidate.id,
      accessType: "ONGOING",
      createdAt: now,
      stoppedDueToInactivity: false,
    }));
  }

  override async listApps(): Promise<AppSummary[]> {
    this.listCalls += 1;
    if (this.options.failList) throw new Error(this.options.listError ?? "The credential was rejected.");
    return structuredClone(this.portfolioApps);
  }

  override async getAnalyticsStatus(): Promise<AnalyticsStatusResponse> {
    return {
      schemaVersion: 1,
      issuerId: this.issuerId,
      state: "WAITING_FOR_DATA",
      reportRequests: structuredClone(this.requests),
      freshness: {
        syncedAt: null,
        dataThrough: null,
        expectedDelayDays: 5,
        partial: true,
        detail: "No sync has completed yet.",
      },
      detail: "Analytics Reports are configured.",
    };
  }

  override async listAnalyticsReportRequests(appId?: string): Promise<AnalyticsReportRequest[]> {
    if (this.options.failReportInspection) {
      throw new Error(`Analytics report request inspection failed for ${appId ?? "the organization"}.`);
    }
    return structuredClone(appId ? this.requests.filter((request) => request.appId === appId) : this.requests);
  }

  override async syncAnalytics(input: AnalyticsSyncInput): Promise<AnalyticsSyncResult> {
    this.syncCalls += 1;
    this.syncInputs.push(structuredClone(input));
    await this.options.syncGate;
    return {
      schemaVersion: 1,
      issuerId: this.issuerId,
      runId: `raw-child-run-${this.issuerId}-${this.syncCalls}`,
      state: "SUCCEEDED",
      appIds: [...input.appIds],
      batches: [],
      reportRequests: this.requests.filter((request) => input.appIds.includes(request.appId)),
      startedAt: now,
      completedAt: now,
      snapshotId: `raw-snapshot-${this.issuerId}`,
      evidenceId: `raw-evidence-${this.issuerId}`,
      freshness: {
        syncedAt: now,
        dataThrough: "2026-08-27",
        expectedDelayDays: 5,
        partial: false,
        detail: "Fixture sync is complete through 2026-08-27.",
      },
      error: null,
    };
  }
}

const connection = (
  connectionId: string,
  profileName: string,
  issuerId: string,
  provider: PortfolioProvider,
  active = false,
): AnalyticsPortfolioConnection => ({ connectionId, profileName, issuerId, provider, active });

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const coordinatorFor = (
  store: SqliteAnalyticsStore,
  listConnections: () => Promise<AnalyticsPortfolioConnection[]>,
  overrides: Partial<ConstructorParameters<typeof AnalyticsPortfolioCoordinator>[0]> = {},
) => new AnalyticsPortfolioCoordinator({
  listConnections,
  store,
  acquireAccountRead: async () => () => undefined,
  now: () => new Date(now),
  id: (() => {
    let sequence = 0;
    return () => `portfolio-run-${++sequence}`;
  })(),
  digest,
  ...overrides,
});

const expectNoRawIdentity = (value: unknown, rawValues: string[]) => {
  const serialized = JSON.stringify(value);
  for (const raw of rawValues) expect(serialized).not.toContain(raw);
};

describe("AnalyticsPortfolioCoordinator", () => {
  it("deduplicates issuer aliases, uses a working fallback, and keeps a failed saved credential partial", async () => {
    const { store } = await createStore();
    const rejected = new PortfolioProvider(issuerA, [app()], {
      listError: `Issuer ${issuerA}, app ${rawAppA}, connection raw-connection-primary, request ${rawRequestA} was rejected.`,
      requestId: rawRequestA,
    });
    const fallback = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const connections = [
      connection("raw-connection-primary", "Primary", issuerA, rejected, true),
      connection("raw-connection-fallback", "Fallback", issuerA, fallback),
    ];
    const coordinator = coordinatorFor(store, async () => connections);

    await coordinator.refresh();
    rejected.options.failList = true;
    coordinator.invalidate();
    const catalog = await coordinator.refresh();
    expect(catalog.sources).toHaveLength(1);
    expect(catalog).toMatchObject({
      complete: false,
      sources: [expect.objectContaining({ state: "PARTIAL", appCount: 1 })],
    });
    expect(catalog.sources[0]?.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileName: "Primary", state: "ERROR" }),
      expect.objectContaining({ profileName: "Fallback", state: "READY" }),
    ]));
    expect(catalog.sources[0]?.detail).not.toContain("redundant");
    expect(catalog.sources[0]?.detail).not.toContain("fully covered");
    expect(new Set(catalog.sources[0]?.accounts.map((account) => account.id)).size).toBe(2);
    expect(catalog.apps).toHaveLength(1);

    const status = await coordinator.status();
    expect(status.state).toBe("PARTIAL");
    expect(status.reportRequests).toHaveLength(1);
    const queued = await coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await coordinator.waitForAll();
    const completed = coordinator.getSync(queued.runId);
    expect(completed).toMatchObject({ state: "PARTIAL", sources: [expect.objectContaining({ state: "PARTIAL" })] });
    expect(rejected.syncCalls).toBe(0);
    expect(fallback.syncCalls).toBe(1);
    const settledStatus = await coordinator.status();
    expect(settledStatus.sources[0]).toMatchObject({
      state: "PARTIAL",
      freshness: expect.objectContaining({ partial: true }),
    });

    const internalPlan: Extract<MutationPlan, { operation: "analytics.report_request.create" }> = {
      id: "plan-raw",
      operation: "analytics.report_request.create",
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: now,
      expiresAt: "2026-08-30T12:10:00.000Z",
      digest: "d".repeat(64),
      summary: "Create a one-time Analytics report request.",
      context: {
        profile: "Fallback",
        connectionId: "raw-connection-fallback",
        appleAdsAdAccountId: null,
        appleAdsMode: null,
      },
      target: {
        appId: rawAppA,
        appName: "Orbit Notes",
        accessType: "ONE_TIME_SNAPSHOT",
      },
      before: {
        matchingReportRequestIds: [rawRequestA],
        activeOngoingReportRequestIds: [rawRequestA],
      },
      after: { appId: rawAppA, accessType: "ONE_TIME_SNAPSHOT" },
      error: null,
    };
    const publicPlan = coordinator.sanitizeReportRequestPlan(internalPlan, issuerA);
    expect(AnalyticsPortfolioReportRequestPlanResponseSchema.safeParse({ plan: publicPlan }).success).toBe(true);

    const rawValues = [issuerA, rawAppA, rawRequestA, "raw-connection-primary", "raw-connection-fallback"];
    [catalog, status, settledStatus, completed, publicPlan].forEach((value) => expectNoRawIdentity(value, rawValues));
    store.close();
  });

  it("marks a never-proven failed same-issuer credential partial instead of assuming it is redundant", async () => {
    const { store } = await createStore();
    const unknown = new PortfolioProvider(issuerA, [], {
      failList: true,
      listError: `Unknown credential raw-unknown-connection for ${issuerA} failed.`,
    });
    const working = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-unknown-connection", "Unknown key", issuerA, unknown, true),
      connection("raw-working-connection", "Working key", issuerA, working),
    ]);

    const catalog = await coordinator.refresh();
    expect(catalog).toMatchObject({
      complete: false,
      sources: [expect.objectContaining({
        state: "PARTIAL",
        appCount: 1,
        accounts: expect.arrayContaining([
          expect.objectContaining({ profileName: "Unknown key", state: "ERROR" }),
        ]),
      })],
    });
    const status = await coordinator.status();
    expect(status).toMatchObject({
      state: "PARTIAL",
      sources: [expect.objectContaining({ state: "PARTIAL", freshness: expect.objectContaining({ partial: true }) })],
    });
    expectNoRawIdentity(catalog, [issuerA, rawAppA, "raw-unknown-connection", "raw-working-connection"]);
    store.close();
  });

  it("retains a failed credential's known extra app as stale and keeps the issuer partial", async () => {
    const { path, store } = await createStore();
    const extraRawApp = "9876543210";
    const broad = new PortfolioProvider(issuerA, [app(), app(extraRawApp, "Legacy App")]);
    const narrow = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-broad-connection", "Broad key", issuerA, broad, true),
      connection("raw-narrow-connection", "Narrow key", issuerA, narrow),
    ]);
    await coordinator.refresh();
    store.close();

    broad.options.failList = true;
    broad.options.listError = `App ${extraRawApp} is no longer reachable by raw-broad-connection.`;
    const reopened = new SqliteAnalyticsStore(path);
    const restarted = coordinatorFor(reopened, async () => [
      connection("raw-broad-connection", "Broad key", issuerA, broad, true),
      connection("raw-narrow-connection", "Narrow key", issuerA, narrow),
    ]);
    const partial = await restarted.refresh();
    const staleApp = partial.apps.find((candidate) => candidate.name === "Legacy App")!;

    expect(partial).toMatchObject({
      complete: false,
      sources: [expect.objectContaining({ state: "PARTIAL", appCount: 2 })],
      apps: expect.arrayContaining([expect.objectContaining({ id: staleApp.id, name: "Legacy App" })]),
    });
    expect(() => restarted.resolveApp(staleApp.id)).toThrow("stale catalog data");
    expectNoRawIdentity(partial, [issuerA, rawAppA, extraRawApp, "raw-broad-connection", "raw-narrow-connection"]);
    reopened.close();
  });

  it("keeps status partial until successful app-scoped runs collectively cover the current source app set", async () => {
    const { store } = await createStore();
    const secondRawApp = "9876543210";
    const provider = new PortfolioProvider(issuerA, [app(), app(secondRawApp, "Field Log")]);
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, provider, true),
    ]);
    await coordinator.refresh();
    const saveSuccessfulRun = (
      runId: string,
      appIds: string[],
      syncedAt = now,
      dataThrough = "2026-08-27",
    ) => store.saveAnalyticsSyncRun({
      schemaVersion: 1,
      issuerId: issuerA,
      runId,
      state: "SUCCEEDED",
      appIds,
      reportRequests: provider.requests.filter((request) => appIds.includes(request.appId)),
      startedAt: now,
      completedAt: now,
      snapshotId: `snapshot-${runId}`,
      evidenceId: `evidence-${runId}`,
      freshness: {
        syncedAt,
        dataThrough,
        expectedDelayDays: 5,
        partial: false,
        detail: "The scoped sync is complete.",
      },
      error: null,
      batchCount: 0,
      observationCount: 0,
    });

    await saveSuccessfulRun("app-scoped-run", [rawAppA]);
    const scoped = await coordinator.status();
    expect(scoped).toMatchObject({
      state: "PARTIAL",
      sources: [expect.objectContaining({
        state: "PARTIAL",
        selectedAppCount: 2,
        freshness: expect.objectContaining({ partial: true }),
      })],
    });

    await saveSuccessfulRun(
      "second-split-run",
      [secondRawApp],
      "2026-08-29T11:00:00.000Z",
      "2026-08-26",
    );
    const split = await coordinator.status();
    expect(split).toMatchObject({
      state: "READY",
      sources: [expect.objectContaining({
        state: "READY",
        selectedAppCount: 2,
        freshness: expect.objectContaining({
          syncedAt: "2026-08-29T11:00:00.000Z",
          dataThrough: "2026-08-26",
          partial: false,
        }),
      })],
    });

    await saveSuccessfulRun("full-source-run", [rawAppA, secondRawApp]);
    const complete = await coordinator.status();
    expect(complete).toMatchObject({
      state: "READY",
      sources: [expect.objectContaining({
        state: "READY",
        selectedAppCount: 2,
        freshness: expect.objectContaining({ partial: false }),
      })],
    });

    await store.saveAnalyticsSyncRun({
      schemaVersion: 1,
      issuerId: issuerA,
      runId: "failed-current-app",
      state: "FAILED",
      appIds: [rawAppA],
      reportRequests: [],
      startedAt: "2026-08-30T12:01:00.000Z",
      completedAt: "2026-08-30T12:01:01.000Z",
      snapshotId: null,
      evidenceId: "evidence-failed-current-app",
      freshness: {
        syncedAt: null,
        dataThrough: null,
        expectedDelayDays: 5,
        partial: true,
        detail: "The current app sync failed.",
      },
      error: "Fixture sync failure.",
      batchCount: 0,
      observationCount: 0,
    });
    const invalidated = await coordinator.status();
    expect(invalidated).toMatchObject({
      state: "PARTIAL",
      sources: [expect.objectContaining({
        state: "PARTIAL",
        freshness: expect.objectContaining({ partial: true }),
      })],
    });
    store.close();
  });

  it("fans sync out to every issuer and keeps identical Apple app IDs source scoped across active-account changes", async () => {
    const { store } = await createStore();
    const providerA = new PortfolioProvider(issuerA, [app(rawAppA, "Orbit Notes")], {
      requestId: rawRequestA,
    });
    const providerB = new PortfolioProvider(issuerB, [app(rawAppA, "Field Log")], {
      requestId: "raw-analytics-request-b",
    });
    let connections = [
      connection("raw-connection-a", "Studio A", issuerA, providerA, true),
      connection("raw-connection-b", "Studio B", issuerB, providerB),
    ];
    const coordinator = coordinatorFor(store, async () => connections);
    const firstCatalog = await coordinator.refresh();

    expect(firstCatalog.sources).toHaveLength(2);
    expect(firstCatalog.apps).toHaveLength(2);
    expect(new Set(firstCatalog.apps.map((candidate) => candidate.id)).size).toBe(2);
    expect(new Set(firstCatalog.apps.map((candidate) => candidate.sourceId)).size).toBe(2);

    connections = [
      connection("raw-connection-a", "Studio A", issuerA, providerA),
      connection("raw-connection-b", "Studio B", issuerB, providerB, true),
    ];
    coordinator.invalidate();
    const switchedCatalog = await coordinator.refresh();
    expect(switchedCatalog.catalogRevision).toBe(firstCatalog.catalogRevision);
    expect(switchedCatalog.apps.map((candidate) => candidate.id)).toEqual(
      firstCatalog.apps.map((candidate) => candidate.id),
    );

    const queued = await coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await coordinator.waitForAll();
    const completed = coordinator.getSync(queued.runId);
    expect(completed).toMatchObject({
      state: "SUCCEEDED",
      sources: [
        expect.objectContaining({ state: "SUCCEEDED" }),
        expect.objectContaining({ state: "SUCCEEDED" }),
      ],
    });
    expect(providerA.syncCalls).toBe(1);
    expect(providerB.syncCalls).toBe(1);
    [firstCatalog, switchedCatalog, completed].forEach((value) => expectNoRawIdentity(value, [
      issuerA,
      issuerB,
      rawAppA,
      rawRequestA,
      "raw-analytics-request-b",
      "raw-connection-a",
      "raw-connection-b",
    ]));
    store.close();
  });

  it("restores a terminal parent portfolio sync for polling after a coordinator and SQLite restart", async () => {
    const { path, store } = await createStore();
    const provider = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const first = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, provider, true),
    ]);
    await first.refresh();
    const queued = await first.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await first.waitForAll();
    const terminal = first.getSync(queued.runId)!;
    expect(terminal.state).toBe("SUCCEEDED");
    store.close();

    const reopened = new SqliteAnalyticsStore(path);
    const restarted = coordinatorFor(reopened, async () => []);
    expect(restarted.getSync(queued.runId)).toEqual(terminal);
    expectNoRawIdentity(restarted.getSync(queued.runId), [
      issuerA,
      rawAppA,
      rawRequestA,
      "raw-connection-a",
    ]);
    reopened.close();
  });

  it("fails interrupted parent jobs and unfinished sources closed with retry guidance after restart", async () => {
    const { path, store } = await createStore();
    const partialFreshness = {
      syncedAt: null,
      dataThrough: null,
      expectedDelayDays: 5,
      partial: true,
      detail: "The fixture portfolio job is still running.",
    };
    const completedFreshness = {
      syncedAt: "2026-08-30T11:55:00.000Z",
      dataThrough: "2026-08-27",
      expectedDelayDays: 5,
      partial: false,
      detail: "The first source completed before interruption.",
    };
    const queuedParent: AnalyticsPortfolioSyncResponse = {
      schemaVersion: 2,
      runId: "portfolio-parent-queued",
      state: "QUEUED",
      sources: [{
        sourceId: "source_public_queued",
        state: "QUEUED",
        appIds: ["app_public_queued"],
        runIds: [],
        freshness: partialFreshness,
        batchCount: 0,
        observationCount: 0,
        error: null,
      }],
      startedAt: "2026-08-30T11:58:00.000Z",
      completedAt: null,
      freshness: partialFreshness,
      batchCount: 0,
      observationCount: 0,
      error: null,
    };
    const runningParent: AnalyticsPortfolioSyncResponse = {
      schemaVersion: 2,
      runId: "portfolio-parent-running",
      state: "RUNNING",
      sources: [{
        sourceId: "source_public_finished",
        state: "SUCCEEDED",
        appIds: ["app_public_finished"],
        runIds: ["sync_public_finished"],
        freshness: completedFreshness,
        batchCount: 3,
        observationCount: 30,
        error: null,
      }, {
        sourceId: "source_public_unfinished",
        state: "RUNNING",
        appIds: ["app_public_unfinished"],
        runIds: [],
        freshness: partialFreshness,
        batchCount: 0,
        observationCount: 0,
        error: null,
      }],
      startedAt: "2026-08-30T11:57:00.000Z",
      completedAt: null,
      freshness: partialFreshness,
      batchCount: 3,
      observationCount: 30,
      error: null,
    };
    store.saveAnalyticsPortfolioSyncRun(queuedParent);
    store.saveAnalyticsPortfolioSyncRun(runningParent);
    store.close();

    const reopened = new SqliteAnalyticsStore(path);
    const interruptedAt = "2026-08-30T12:05:00.000Z";
    expect(reopened.failInterruptedAnalyticsPortfolioSyncRuns(interruptedAt)).toBe(2);
    expect(reopened.failInterruptedAnalyticsPortfolioSyncRuns(interruptedAt)).toBe(0);
    const restarted = coordinatorFor(reopened, async () => []);
    const recoveredQueued = restarted.getSync(queuedParent.runId);
    const recoveredRunning = restarted.getSync(runningParent.runId);

    expect(recoveredQueued).toMatchObject({
      state: "FAILED",
      completedAt: interruptedAt,
      freshness: { partial: true, detail: expect.stringContaining("Start a new sync") },
      sources: [expect.objectContaining({ state: "FAILED", freshness: expect.objectContaining({ partial: true }) })],
      error: expect.stringContaining("retry safely"),
    });
    expect(recoveredRunning).toMatchObject({
      state: "FAILED",
      completedAt: interruptedAt,
      batchCount: 3,
      observationCount: 30,
      sources: [
        expect.objectContaining({ sourceId: "source_public_finished", state: "SUCCEEDED" }),
        expect.objectContaining({ sourceId: "source_public_unfinished", state: "FAILED" }),
      ],
      error: expect.stringContaining("retry safely"),
    });
    for (const recovered of [recoveredQueued, recoveredRunning]) {
      expect(JSON.stringify(recovered)).not.toContain('"issuerId"');
      expectNoRawIdentity(recovered, [issuerA, issuerB, rawAppA, rawRequestA, "raw-connection-a"]);
    }
    reopened.close();
  });

  it("restores a stale issuer-scoped roster after a coordinator and SQLite restart", async () => {
    const { path, store } = await createStore();
    const firstProvider = new PortfolioProvider(issuerB, [app(rawAppA, "Field Log")], {
      requestId: "raw-request-b",
    });
    const first = coordinatorFor(store, async () => [
      connection("raw-connection-b", "Studio B", issuerB, firstProvider, true),
    ]);
    const initial = await first.refresh();
    const publicAppId = initial.apps[0]!.id;
    store.saveAnalyticsPortfolioPlan("pending-plan-1", issuerB, now);
    store.close();

    const reopened = new SqliteAnalyticsStore(path);
    expect(reopened.getAnalyticsPortfolioPlanIssuer("pending-plan-1")).toBe(issuerB);
    const unavailableProvider = new PortfolioProvider(issuerB, [], {
      failList: true,
      listError: "Apple is temporarily unavailable.",
    });
    const restarted = coordinatorFor(reopened, async () => [
      connection("raw-connection-b", "Studio B", issuerB, unavailableProvider, true),
    ]);
    const stale = await restarted.refresh();

    expect(stale).toMatchObject({
      complete: false,
      sources: [expect.objectContaining({ state: "ERROR", appCount: 1 })],
      apps: [expect.objectContaining({ id: publicAppId, name: "Field Log" })],
    });
    expect(() => restarted.resolveApp(publicAppId)).toThrow("stale catalog data");
    expectNoRawIdentity(stale, [issuerB, rawAppA, "raw-connection-b", "raw-request-b"]);
    reopened.close();
  });

  it("restores cached report-request provenance after restart when live request inspection fails", async () => {
    const { path, store } = await createStore();
    const initialProvider = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const initial = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, initialProvider, true),
    ]);
    await initial.refresh();
    const initialStatus = await initial.status();
    expect(initialStatus.reportRequests).toHaveLength(1);
    const publicRequestId = initialStatus.reportRequests[0]!.id;
    const publicAppId = initialStatus.reportRequests[0]!.appId;
    store.close();

    const reopened = new SqliteAnalyticsStore(path);
    const unavailableProvider = new PortfolioProvider(issuerA, [app()], {
      requestId: rawRequestA,
      failReportInspection: true,
    });
    const restarted = coordinatorFor(reopened, async () => [
      connection("raw-connection-a", "Studio A", issuerA, unavailableProvider, true),
    ]);
    const catalog = await restarted.refresh();
    const partial = await restarted.status();

    expect(catalog).toMatchObject({
      sources: [expect.objectContaining({ state: "READY", appCount: 1 })],
      apps: [expect.objectContaining({ id: publicAppId, name: "Orbit Notes" })],
    });
    expect(partial).toMatchObject({
      state: "PARTIAL",
      sources: [expect.objectContaining({
        state: "PARTIAL",
        freshness: expect.objectContaining({ partial: true }),
      })],
      reportRequests: [expect.objectContaining({ id: publicRequestId, appId: publicAppId })],
      reportRequestInspections: [expect.objectContaining({
        appId: publicAppId,
        state: "UNKNOWN",
        detail: expect.stringContaining("app connection itself is working"),
      })],
    });
    const queued = await restarted.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await restarted.waitForAll();
    const completed = restarted.getSync(queued.runId);
    expect(unavailableProvider.syncCalls).toBe(1);
    expect(unavailableProvider.syncInputs[0]?.appIds).toEqual([rawAppA]);
    expect(completed).toMatchObject({ state: "PARTIAL" });
    expect(completed?.error).not.toContain("unreachable");
    expectNoRawIdentity([catalog, partial, completed], [
      issuerA,
      rawAppA,
      rawRequestA,
      "raw-connection-a",
    ]);
    reopened.close();
  });

  it("syncs only apps with active report requests and leaves setup-required apps out of the run", async () => {
    const { store } = await createStore();
    const appIds = Array.from({ length: 6 }, (_, index) => `${1234567890 + index}`);
    const apps = appIds.map((id, index) => app(id, `Portfolio App ${index + 1}`));
    const provider = new PortfolioProvider(issuerA, apps, { requestAppIds: [appIds[0]!] });
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, provider, true),
    ]);

    const catalog = await coordinator.refresh();
    const status = await coordinator.status();
    expect(status.reportRequests).toHaveLength(1);
    expect(status.reportRequestInspections).toHaveLength(6);
    expect(status.reportRequestInspections.every((inspection) => inspection.state === "INSPECTED")).toBe(true);

    const queued = await coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await coordinator.waitForAll();
    const completed = coordinator.getSync(queued.runId);

    expect(provider.syncCalls).toBe(1);
    expect(provider.syncInputs[0]?.appIds).toEqual([appIds[0]]);
    expect(completed).toMatchObject({
      state: "SUCCEEDED",
      sources: [expect.objectContaining({ state: "SUCCEEDED", error: null })],
    });
    expect(JSON.stringify(completed)).not.toContain("has no Analytics Reports request");
    expectNoRawIdentity([catalog, status, completed], [issuerA, ...appIds, "raw-connection-a"]);
    store.close();
  });

  it("returns the stable catalog instead of rediscovering Apple accounts during an active sync", async () => {
    const { store } = await createStore();
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
    const provider = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA, syncGate });
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, provider, true),
    ]);
    const initial = await coordinator.refresh();
    expect(provider.listCalls).toBe(1);

    const queued = await coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    for (let attempt = 0; attempt < 20 && provider.syncCalls === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(provider.syncCalls).toBe(1);
    await expect(coordinator.refresh()).resolves.toEqual(initial);
    expect(provider.listCalls).toBe(1);

    releaseSync();
    await coordinator.waitForAll();
    expect(coordinator.getSync(queued.runId)?.state).toBe("SUCCEEDED");
    store.close();
  });

  it("keeps the two-account setup-and-waiting state partial instead of reporting credential failures", async () => {
    const { store } = await createStore();
    const uncheckedAppIds = Array.from({ length: 5 }, (_, index) => `${2234567890 + index}`);
    const checkedAppIds = Array.from({ length: 6 }, (_, index) => `${3234567890 + index}`);
    const uncheckedProvider = new PortfolioProvider(
      issuerA,
      uncheckedAppIds.map((id, index) => app(id, `Unchecked App ${index + 1}`)),
      { failReportInspection: true },
    );
    const checkedProvider = new PortfolioProvider(
      issuerB,
      checkedAppIds.map((id, index) => app(id, `Checked App ${index + 1}`)),
      { requestAppIds: [checkedAppIds[0]!] },
    );
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-account-a", "UM", issuerA, uncheckedProvider, true),
      connection("raw-account-b", "FL", issuerB, checkedProvider),
    ]);

    const catalog = await coordinator.refresh();
    const status = await coordinator.status();
    expect(catalog).toMatchObject({ complete: true });
    expect(catalog.sources).toHaveLength(2);
    expect(catalog.apps).toHaveLength(11);
    expect(status.reportRequests).toHaveLength(1);
    expect(status.reportRequestInspections.filter((inspection) => inspection.state === "UNKNOWN")).toHaveLength(5);
    expect(status.reportRequestInspections.filter((inspection) => inspection.state === "INSPECTED")).toHaveLength(6);

    const queued = await coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await coordinator.waitForAll();
    const completed = coordinator.getSync(queued.runId)!;

    expect(uncheckedProvider.syncCalls).toBe(0);
    expect(checkedProvider.syncInputs).toEqual([expect.objectContaining({ appIds: [checkedAppIds[0]] })]);
    expect(completed.state).toBe("PARTIAL");
    expect(completed.sources.some((source) => source.state === "FAILED")).toBe(false);
    expect(JSON.stringify(completed)).not.toMatch(/unreachable|credential/i);
    expectNoRawIdentity([catalog, status, completed], [
      issuerA,
      issuerB,
      ...uncheckedAppIds,
      ...checkedAppIds,
      "raw-account-a",
      "raw-account-b",
    ]);
    store.close();
  });

  it("captures a replacement snapshot only after acquiring its read lease and never calls a stale provider", async () => {
    const { store } = await createStore();
    const staleProvider = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const replacementProvider = new PortfolioProvider(issuerA, [app()], { requestId: "raw-request-replacement" });
    let connections = [connection("raw-stale-connection", "Stale", issuerA, staleProvider, true)];
    let announceLeaseRequest!: () => void;
    const leaseRequested = new Promise<void>((resolve) => { announceLeaseRequest = resolve; });
    let grantLease!: (release: () => void) => void;
    const lease = new Promise<() => void>((resolve) => { grantLease = resolve; });
    let releases = 0;
    const coordinator = coordinatorFor(store, async () => connections, {
      acquireAccountRead: async () => {
        announceLeaseRequest();
        return lease;
      },
    });
    await coordinator.refresh();

    const starting = coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    });
    await leaseRequested;
    connections = [connection("raw-replacement-connection", "Replacement", issuerA, replacementProvider, true)];
    coordinator.invalidate();
    grantLease(() => { releases += 1; });

    const queued = await starting;
    await coordinator.waitForAll();
    expect(coordinator.getSync(queued.runId)?.state).toBe("SUCCEEDED");
    expect(staleProvider.syncCalls).toBe(0);
    expect(replacementProvider.listCalls).toBeGreaterThan(0);
    expect(replacementProvider.syncCalls).toBe(1);
    expect(releases).toBe(1);
    store.close();
  });

  it("atomically reserves the initial portfolio sync when two starts race before catalog discovery", async () => {
    const { store } = await createStore();
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
    const provider = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA, syncGate });
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, provider, true),
    ]);
    const input = {
      schemaVersion: 2 as const,
      selection: { kind: "ALL_CONNECTED" as const },
      force: false,
    };

    const outcomes = await Promise.allSettled([
      coordinator.startSync(input),
      coordinator.startSync(input),
    ]);
    const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof coordinator.startSync>>> => (
      outcome.status === "fulfilled"
    ));
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "analytics_sync_scope_busy", status: 409 });
    const winner = fulfilled[0]!.value;
    const activeWinner = coordinator.getSync(winner.runId);
    expect(activeWinner?.runId).toBe(winner.runId);
    expect(["QUEUED", "RUNNING"]).toContain(activeWinner?.state);

    releaseSync();
    await coordinator.waitForAll();
    expect(provider.syncCalls).toBe(1);
    expect(coordinator.getSync(winner.runId)).toMatchObject({ runId: winner.runId, state: "SUCCEEDED" });
    store.close();
  });

  it("rejects a portfolio sync before provider work when a V1 sync already owns an issuer", async () => {
    const { store } = await createStore();
    const provider = new PortfolioProvider(issuerA, [app()], { requestId: rawRequestA });
    const coordinator = coordinatorFor(store, async () => [
      connection("raw-connection-a", "Studio A", issuerA, provider, true),
    ], {
      isIssuerSyncActive: (issuerId) => issuerId === issuerA,
    });
    await coordinator.refresh();

    await expect(coordinator.startSync({
      schemaVersion: 2,
      selection: { kind: "ALL_CONNECTED" },
      force: false,
    })).rejects.toMatchObject({ code: "analytics_sync_scope_busy", status: 409 });
    expect(provider.syncCalls).toBe(0);
    store.close();
  });
});
