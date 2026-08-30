import type {
  AnalyticsFreshness,
  AnalyticsOverviewQueryV2,
  AnalyticsPortfolioAccount,
  AnalyticsPortfolioApp,
  AnalyticsPortfolioCatalogResponse,
  AnalyticsPortfolioReportRequest,
  AnalyticsPortfolioSource,
  AnalyticsPortfolioSourceCoverage,
  AnalyticsPortfolioStatusResponse,
  AnalyticsPortfolioSyncInput,
  AnalyticsPortfolioSyncResponse,
  AnalyticsPortfolioSyncSource,
  AnalyticsReportRequest,
  AnalyticsStatusResponse,
  AnalyticsSyncResponse,
  AppSummary,
  CreateAnalyticsPortfolioReportRequestMutationPlan,
  MutationPlan,
} from "@asc-studio/contracts";
import {
  AnalyticsPortfolioCatalogResponseSchema,
  AnalyticsPortfolioStatusResponseSchema,
  AnalyticsPortfolioSyncResponseSchema,
} from "@asc-studio/contracts";
import type {
  AnalyticsPortfolioOverviewContext,
  AnalyticsPortfolioOverviewSource,
  AnalyticsProvider,
  AnalyticsStore,
  AscProvider,
} from "@asc-studio/core";
import { AnalyticsSyncCoordinator } from "./analytics-sync.js";

export type AnalyticsPortfolioProvider = AscProvider & AnalyticsProvider;

export interface AnalyticsPortfolioConnection {
  connectionId: string;
  profileName: string;
  issuerId: string;
  active: boolean;
  provider: AnalyticsPortfolioProvider;
}

interface AnalyticsPortfolioStore extends AnalyticsStore {
  getLatestSuccessfulAnalyticsSyncRun(issuerId: string): Promise<AnalyticsSyncResponse | null>;
  getLatestSuccessfulAnalyticsSyncRunsForApps(
    issuerId: string,
    appIds: string[],
  ): Promise<AnalyticsSyncResponse[]>;
  getLatestAnalyticsSyncRunsByApp(
    issuerId: string,
    appIds: string[],
  ): Promise<Array<{ appId: string; run: AnalyticsSyncResponse }>>;
  savePortfolioChildAnalyticsSyncRun(run: AnalyticsSyncResponse, portfolioRunId: string): Promise<void>;
  getPortfolioChildAnalyticsSyncRun(runId: string): Promise<AnalyticsSyncResponse | null>;
  saveAnalyticsPortfolioSyncRun(response: AnalyticsPortfolioSyncResponse): void;
  getAnalyticsPortfolioSyncRun(runId: string): AnalyticsPortfolioSyncResponse | null;
  getActiveSyncRun(issuerId: string): { state: string } | null;
  getLatestSyncRun(issuerId: string): { state: string; errorMessage: string | null } | null;
  loadAnalyticsPortfolioCatalog(issuerIds: string[]): Array<{
    issuerId: string;
    discoveredAt: string;
    apps: Array<{ issuerId: string; appId: string; name: string; bundleId: string; platforms: string[] }>;
    accounts: Array<{ connectionId: string; appIds: string[] }>;
  }>;
  saveAnalyticsPortfolioCatalog(source: {
    issuerId: string;
    discoveredAt: string;
    apps: Array<{ issuerId: string; appId: string; name: string; bundleId: string; platforms: string[] }>;
    accounts: Array<{ connectionId: string; appIds: string[] }>;
  }): void;
  loadAnalyticsPortfolioReportRequests(issuerId: string, appIds: string[]): AnalyticsReportRequest[];
  saveAnalyticsPortfolioReportRequests(
    issuerId: string,
    inspectedAppIds: string[],
    requests: AnalyticsReportRequest[],
  ): void;
}

export interface AnalyticsPortfolioCoordinatorDependencies {
  listConnections: () => Promise<AnalyticsPortfolioConnection[]>;
  store: AnalyticsPortfolioStore;
  acquireAccountRead: () => Promise<() => void>;
  now: () => Date;
  id: () => string;
  digest: (value: string) => string;
  isIssuerSyncActive?: (issuerId: string) => boolean;
}

type ReportDiscoveryState = "READY" | "PARTIAL" | "ERROR";

interface InternalPortfolioApp extends AnalyticsPortfolioApp {
  rawAppId: string;
  connectionIds: string[];
  reportConnectionIds: string[];
  reportInspectionErrors: string[];
}

interface InternalPortfolioSource {
  id: string;
  issuerId: string;
  lastDiscoveredAt: string;
  state: AnalyticsPortfolioSource["state"];
  detail: string;
  accounts: AnalyticsPortfolioAccount[];
  accountAppIds: Map<string, string[]>;
  apps: InternalPortfolioApp[];
  connections: Map<string, AnalyticsPortfolioConnection>;
  reportRequests: AnalyticsReportRequest[];
  reportDiscoveryState: ReportDiscoveryState;
  reportDiscoveryDetail: string;
}

interface PortfolioSnapshot {
  catalog: AnalyticsPortfolioCatalogResponse;
  sources: InternalPortfolioSource[];
}

interface ConnectionDiscovery {
  connection: AnalyticsPortfolioConnection;
  apps: AppSummary[];
  appError: string | null;
  reportRequests: AnalyticsReportRequest[];
  reportSucceededAppIds: Set<string>;
  reportErrorsByAppId: Map<string, string>;
}

const noDataFreshness = (detail: string): AnalyticsFreshness => ({
  syncedAt: null,
  dataThrough: null,
  expectedDelayDays: null,
  partial: true,
  detail,
});

const noAppsFreshness = (): AnalyticsFreshness => ({
  syncedAt: null,
  dataThrough: null,
  expectedDelayDays: null,
  partial: false,
  detail: "This connected source has no apps, so no analytics facts are expected.",
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The account could not be inspected.";

const reportInspectionError = (error: unknown) => {
  const candidate = error as { code?: unknown; status?: unknown } | null;
  if (candidate?.code === "analytics_reports_role_required" || candidate?.status === 403) {
    return "Apple refused access to Analytics Reports even though the app itself is reachable.";
  }
  if (candidate?.status === 429) {
    return "Apple temporarily rate-limited the Analytics Reports check.";
  }
  if (typeof candidate?.status === "number" && candidate.status >= 500) {
    return "Apple's Analytics Reports service was temporarily unavailable.";
  }
  return "Apple did not return this app's Analytics Reports setup.";
};

const stableConnectionOrder = (left: AnalyticsPortfolioConnection, right: AnalyticsPortfolioConnection) => (
  Number(right.active) - Number(left.active)
  || left.connectionId.localeCompare(right.connectionId)
);

const combineFreshness = (
  values: AnalyticsFreshness[],
  partial: boolean,
  detail: string,
): AnalyticsFreshness => {
  if (values.length === 0) return partial ? noDataFreshness(detail) : { ...noAppsFreshness(), detail };
  const syncedAt = values.flatMap((value) => value.syncedAt ? [value.syncedAt] : []).sort();
  const dataThrough = values.flatMap((value) => value.dataThrough ? [value.dataThrough] : []).sort();
  const delays = values.flatMap((value) => value.expectedDelayDays === null ? [] : [value.expectedDelayDays]);
  return {
    syncedAt: syncedAt.length === values.length ? syncedAt[0] ?? null : null,
    dataThrough: dataThrough.length === values.length ? dataThrough[0] ?? null : null,
    expectedDelayDays: delays.length > 0 ? Math.max(...delays) : null,
    partial,
    detail,
  };
};

const uniqueBy = <T>(values: T[], key: (value: T) => string) => {
  const result = new Map<string, T>();
  for (const value of values) if (!result.has(key(value))) result.set(key(value), value);
  return [...result.values()];
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  limit: number,
  operation: (value: T, index: number) => Promise<R>,
) => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
};

export class AnalyticsPortfolioError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AnalyticsPortfolioError";
  }
}

export class AnalyticsPortfolioCoordinator {
  private snapshot: PortfolioSnapshot | null = null;
  private refreshTask: Promise<AnalyticsPortfolioCatalogResponse> | null = null;
  private activeSync: { runId: string; task: Promise<void> } | null = null;
  private readonly reservedIssuers = new Set<string>();
  private readonly syncRuns = new Map<string, AnalyticsPortfolioSyncResponse>();

  constructor(private readonly dependencies: AnalyticsPortfolioCoordinatorDependencies) {}

  invalidate() {
    this.snapshot = null;
  }

  catalog() {
    return this.snapshot?.catalog ?? null;
  }

  refresh(): Promise<AnalyticsPortfolioCatalogResponse> {
    if (this.refreshTask) return this.refreshTask;
    // A refresh is live Apple discovery, not a local-cache operation. Keep the
    // stable snapshot while ingestion is running instead of issuing a second
    // burst of account/report requests against the same keys.
    if ((this.activeSync || this.reservedIssuers.size > 0) && this.snapshot) {
      return Promise.resolve(this.snapshot.catalog);
    }
    const task = this.performRefresh().finally(() => {
      if (this.refreshTask === task) this.refreshTask = null;
    });
    this.refreshTask = task;
    return task;
  }

  private async performRefresh(): Promise<AnalyticsPortfolioCatalogResponse> {
    const connections = (await this.dependencies.listConnections()).sort(stableConnectionOrder);
    const duplicateConnectionIds = connections.filter((connection, index) => (
      connections.findIndex((candidate) => candidate.connectionId === connection.connectionId) !== index
    ));
    if (duplicateConnectionIds.length > 0) {
      throw new AnalyticsPortfolioError(
        "analytics_catalog_invalid",
        "A saved Apple account appeared more than once while building the Analytics portfolio.",
        500,
      );
    }

    const discoveries = await mapWithConcurrency(connections, 4, (connection) => this.discover(connection));
    const byIssuer = new Map<string, ConnectionDiscovery[]>();
    for (const discovery of discoveries) {
      const current = byIssuer.get(discovery.connection.issuerId) ?? [];
      current.push(discovery);
      byIssuer.set(discovery.connection.issuerId, current);
    }
    const previousBySource = new Map(this.dependencies.store
      .loadAnalyticsPortfolioCatalog([...byIssuer.keys()])
      .map((record): [string, InternalPortfolioSource] => {
        const sourceId = this.opaque("source", record.issuerId);
        const cachedReportRequests = this.dependencies.store.loadAnalyticsPortfolioReportRequests(
          record.issuerId,
          record.apps.map((app) => app.appId),
        );
        return [sourceId, {
          id: sourceId,
          issuerId: record.issuerId,
          lastDiscoveredAt: record.discoveredAt,
          state: "READY",
          detail: `Cached app membership last refreshed at ${record.discoveredAt}.`,
          accounts: [],
          accountAppIds: new Map(record.accounts.map((account) => [
            account.connectionId,
            [...account.appIds],
          ])),
          apps: record.apps.map((app) => ({
            id: this.opaque("app", record.issuerId, app.appId),
            sourceId,
            rawAppId: app.appId,
            name: app.name,
            bundleId: app.bundleId,
            platforms: app.platforms,
            connectionIds: [],
            reportConnectionIds: [],
            reportInspectionErrors: ["Analytics Reports have not been checked since ASC Studio restarted."],
          })),
          connections: new Map(),
          reportRequests: cachedReportRequests,
          reportDiscoveryState: "PARTIAL",
          reportDiscoveryDetail: "Analytics report setup has not been refreshed in this process.",
        }];
      }));
    for (const source of this.snapshot?.sources ?? []) previousBySource.set(source.id, source);
    const generatedAt = this.dependencies.now().toISOString();
    const sources = [...byIssuer.entries()].map(([issuerId, group]) => (
      this.buildSource(issuerId, group, previousBySource.get(this.opaque("source", issuerId)) ?? null, generatedAt)
    )).sort((left, right) => left.id.localeCompare(right.id));
    this.assertOpaqueCollisions(sources);
    const catalogRevision = this.revisionForSources(sources);

    const publicSources: AnalyticsPortfolioSource[] = sources.map((source) => ({
      id: source.id,
      accounts: source.accounts,
      state: source.state,
      appCount: source.apps.length,
      lastDiscoveredAt: source.lastDiscoveredAt,
      detail: source.detail,
    }));
    const apps = sources.flatMap((source) => source.apps.map(({
      rawAppId: _raw,
      connectionIds: _connections,
      reportConnectionIds: _reportConnections,
      reportInspectionErrors: _reportInspectionErrors,
      ...app
    }) => app));
    const catalog = AnalyticsPortfolioCatalogResponseSchema.parse({
      schemaVersion: 2,
      catalogRevision,
      complete: connections.length > 0 && sources.every((source) => source.state === "READY"),
      generatedAt,
      sources: publicSources,
      apps,
    });
    for (const source of sources) {
      if (source.state === "ERROR") continue;
      this.dependencies.store.saveAnalyticsPortfolioCatalog({
        issuerId: source.issuerId,
        discoveredAt: source.lastDiscoveredAt,
        apps: source.apps.map((app) => ({
          issuerId: source.issuerId,
          appId: app.rawAppId,
          name: app.name,
          bundleId: app.bundleId,
          platforms: app.platforms,
        })),
        accounts: [...source.accountAppIds.entries()].map(([connectionId, appIds]) => ({
          connectionId,
          appIds,
        })),
      });
      const sourceDiscoveries = byIssuer.get(source.issuerId) ?? [];
      const inspectedAppIds = [...new Set(sourceDiscoveries.flatMap((discovery) => (
        [...discovery.reportSucceededAppIds]
      )))].sort();
      const liveRequests = uniqueBy(
        sourceDiscoveries.flatMap((discovery) => discovery.reportRequests)
          .filter((request) => inspectedAppIds.includes(request.appId)),
        (request) => request.id,
      );
      this.dependencies.store.saveAnalyticsPortfolioReportRequests(
        source.issuerId,
        inspectedAppIds,
        liveRequests,
      );
    }
    this.snapshot = { catalog, sources };
    return catalog;
  }

  requireOverviewContext(query?: AnalyticsOverviewQueryV2): AnalyticsPortfolioOverviewContext {
    const snapshot = this.requireSnapshot();
    if (query?.scope === "APP" && !snapshot.catalog.apps.some((app) => app.id === query.selection.appId)) {
      throw new AnalyticsPortfolioError(
        "analytics_app_not_found",
        "That app is not part of the current connected Analytics portfolio.",
        404,
      );
    }
    if (query?.scope === "PORTFOLIO" && snapshot.catalog.apps.length === 0) {
      throw new AnalyticsPortfolioError(
        "analytics_portfolio_empty",
        "The connected App Store Connect portfolio currently exposes no apps to analyze.",
        409,
      );
    }
    return {
      catalogRevision: snapshot.catalog.catalogRevision,
      sources: snapshot.sources.map((source): AnalyticsPortfolioOverviewSource => ({
        id: source.id,
        issuerId: source.issuerId,
        state: source.state,
        detail: source.detail,
        apps: source.apps.map(({
          connectionIds: _connections,
          reportConnectionIds: _reportConnections,
          reportInspectionErrors: _reportInspectionErrors,
          ...app
        }) => app),
      })),
    };
  }

  resolveApp(appId: string) {
    const snapshot = this.requireSnapshot();
    for (const source of snapshot.sources) {
      const app = source.apps.find((candidate) => candidate.id === appId);
      if (!app) continue;
      const connection = app.reportConnectionIds
        .map((connectionId) => source.connections.get(connectionId))
        .filter((candidate): candidate is AnalyticsPortfolioConnection => candidate !== undefined)
        .sort(stableConnectionOrder)[0];
      if (!connection) {
        throw new AnalyticsPortfolioError(
          "analytics_app_unavailable",
          "That app is only present in stale catalog data, or no connected credential can currently inspect its Analytics report requests. Refresh or reconnect the affected Apple account before changing Analytics setup.",
          409,
        );
      }
      return {
        source,
        app,
        connection,
        connections: this.appConnections(source, app),
      };
    }
    throw new AnalyticsPortfolioError(
      "analytics_app_not_found",
      "That app is not part of the connected Analytics portfolio.",
      404,
    );
  }

  sourceForIssuer(issuerId: string) {
    return this.snapshot?.sources.find((source) => source.issuerId === issuerId) ?? null;
  }

  resolvePlanConnections(issuerId: string, rawAppId: string, preferredConnectionId: string) {
    const source = this.requireSnapshot().sources.find((candidate) => candidate.issuerId === issuerId);
    const app = source?.apps.find((candidate) => candidate.rawAppId === rawAppId);
    if (!source || !app) {
      throw new AnalyticsPortfolioError(
        "analytics_app_not_found",
        "The app in this Analytics plan is no longer part of the connected portfolio.",
        404,
      );
    }
    const connections = this.appConnections(source, app).sort((left, right) => (
      Number(right.connectionId === preferredConnectionId) - Number(left.connectionId === preferredConnectionId)
      || stableConnectionOrder(left, right)
    ));
    if (!connections.some((connection) => connection.connectionId === preferredConnectionId)) {
      throw new AnalyticsPortfolioError(
        "analytics_plan_connection_unavailable",
        "The Apple account used to review this Analytics plan can no longer inspect the app. Review a fresh plan.",
        409,
      );
    }
    return { source, app, connections };
  }

  publicRequestId(issuerId: string, requestId: string) {
    return `report-request_${this.dependencies.digest(JSON.stringify({
      sourceId: this.publicSourceId(issuerId),
      requestId,
    })).slice(0, 48)}`;
  }

  publicAccountId(issuerId: string, connectionId: string) {
    return this.opaque("account", issuerId, connectionId);
  }

  publicSourceId(issuerId: string) {
    return this.opaque("source", issuerId);
  }

  publicAppId(issuerId: string, rawAppId: string) {
    return this.opaque("app", issuerId, rawAppId);
  }

  sanitizeReportRequestPlan(
    plan: Extract<MutationPlan, { operation: "analytics.report_request.create" }>,
    issuerId: string,
  ): CreateAnalyticsPortfolioReportRequestMutationPlan {
    const sourceId = this.publicSourceId(issuerId);
    return {
      ...plan,
      context: {
        ...plan.context,
        connectionId: plan.context.connectionId
          ? this.publicAccountId(issuerId, plan.context.connectionId)
          : null,
      },
      target: {
        appId: this.publicAppId(issuerId, plan.target.appId),
        sourceId,
        appName: plan.target.appName,
        accessType: plan.target.accessType,
      },
      before: {
        matchingReportRequestIds: plan.before.matchingReportRequestIds.map((requestId) => (
          this.publicRequestId(issuerId, requestId)
        )),
        activeOngoingReportRequestIds: plan.before.activeOngoingReportRequestIds.map((requestId) => (
          this.publicRequestId(issuerId, requestId)
        )),
      },
      after: {
        schemaVersion: 2,
        appId: this.publicAppId(issuerId, plan.after.appId),
        accessType: plan.after.accessType,
      },
    };
  }

  async status(): Promise<AnalyticsPortfolioStatusResponse> {
    if (this.refreshTask) await this.refreshTask;
    else if (!this.snapshot) await this.refresh();
    const snapshot = this.requireSnapshot();
    const sourceResults = await Promise.all(snapshot.sources.map(async (source) => {
      const active = this.reservedIssuers.has(source.issuerId)
        || this.dependencies.store.getActiveSyncRun(source.issuerId) !== null;
      const rawAppIds = source.apps.map((app) => app.rawAppId);
      const [coverageRuns, latestRunsByApp] = await Promise.all([
        this.dependencies.store.getLatestSuccessfulAnalyticsSyncRunsForApps(source.issuerId, rawAppIds),
        this.dependencies.store.getLatestAnalyticsSyncRunsByApp(source.issuerId, rawAppIds),
      ]);
      const selectedAppIds = new Set(rawAppIds);
      const coveredAppIds = new Set(coverageRuns.flatMap((run) => (
        run.appIds.filter((appId) => selectedAppIds.has(appId))
      )));
      const invalidatedAppIds = new Set(latestRunsByApp.flatMap(({ appId, run }) => (
        run.state === "SUCCEEDED" && !run.freshness.partial ? [] : [appId]
      )));
      return { source, active, coverageRuns, coveredAppIds, invalidatedAppIds };
    }));
    const coverage: AnalyticsPortfolioSourceCoverage[] = sourceResults.map(({
      source,
      active,
      coverageRuns,
      coveredAppIds,
      invalidatedAppIds,
    }) => {
      const noApps = source.state === "READY" && source.apps.length === 0;
      const everyAppCovered = coveredAppIds.size === source.apps.length && invalidatedAppIds.size === 0;
      const cachedRunPartial = invalidatedAppIds.size > 0
        || coverageRuns.some((run) => run.state === "PARTIAL" || run.freshness.partial);
      const state: AnalyticsPortfolioSourceCoverage["state"] = noApps
        ? "READY"
        : active
          ? "SYNCING"
          : source.state === "ERROR" && coverageRuns.length === 0
            ? "ERROR"
            : source.state !== "READY" || source.reportDiscoveryState !== "READY"
              ? "PARTIAL"
              : coverageRuns.length === 0
                ? "NO_DATA"
                : !everyAppCovered || cachedRunPartial
                  ? "PARTIAL"
                  : "READY";
      const freshness = noApps
        ? noAppsFreshness()
        : coverageRuns.length > 0
          ? combineFreshness(
            coverageRuns.map((run) => run.freshness),
            state !== "READY" || cachedRunPartial,
            invalidatedAppIds.size > 0
              ? `Cached facts remain available, but the latest relevant sync is incomplete for ${invalidatedAppIds.size} current app${invalidatedAppIds.size === 1 ? "" : "s"}.`
              : everyAppCovered
              ? "Every current app has cached Analytics coverage; dates use the oldest app-group watermark."
              : `Cached Analytics coverage includes ${coveredAppIds.size} of ${source.apps.length} current apps. Missing apps are not zero.`,
          )
          : noDataFreshness(
            state === "ERROR"
              ? source.detail
              : "No successful Analytics sync is cached for this connected source yet.",
          );
      const details = [
        noApps ? "This connected source currently has no apps and is fully covered." : source.detail,
        source.reportDiscoveryState === "READY" ? "" : source.reportDiscoveryDetail,
        invalidatedAppIds.size > 0
          ? `The latest relevant Analytics sync is incomplete for ${invalidatedAppIds.size} current app${invalidatedAppIds.size === 1 ? "" : "s"}.`
          : "",
        freshness.detail,
      ].filter(Boolean);
      return {
        sourceId: source.id,
        state,
        selectedAppCount: source.apps.length,
        freshness: state === "READY" && noApps ? freshness : { ...freshness, partial: state !== "READY" || freshness.partial },
        detail: [...new Set(details)].join(" "),
      };
    });
    const reportRequests = snapshot.sources.flatMap((source) => this.publicReportRequests(source));
    const reportRequestInspections = snapshot.sources.flatMap((source) => source.apps.map((app) => ({
      appId: app.id,
      sourceId: source.id,
      state: app.reportConnectionIds.length > 0 ? "INSPECTED" as const : "UNKNOWN" as const,
      detail: app.reportConnectionIds.length > 0
        ? "Analytics report requests were inspected successfully for this app."
        : app.connectionIds.length > 0
          ? `${app.reportInspectionErrors[0] ?? "Apple did not return this app's Analytics Reports setup."} The app connection itself is working, and absence of a cached request does not prove setup is missing.`
          : "This app is retained from an earlier account refresh, so its Analytics report setup could not be checked.",
    })));
    const relevantCoverage = coverage.filter((item) => item.selectedAppCount > 0 || item.state !== "READY");
    const state: AnalyticsPortfolioStatusResponse["state"] = snapshot.sources.length === 0
      ? "NOT_CONFIGURED"
      : relevantCoverage.length === 0
        ? "READY"
        : relevantCoverage.some((item) => item.state === "SYNCING")
          ? "SYNCING"
          : relevantCoverage.every((item) => item.state === "ERROR")
            ? "ERROR"
            : relevantCoverage.some((item) => item.state === "ERROR" || item.state === "PARTIAL")
              ? "PARTIAL"
              : reportRequests.length === 0
                ? "NOT_CONFIGURED"
                : relevantCoverage.some((item) => item.state === "NO_DATA")
                  ? "WAITING_FOR_DATA"
                  : "READY";
    const freshness = combineFreshness(
      relevantCoverage.map((item) => item.freshness),
      state !== "READY",
      state === "READY"
        ? "Every connected Analytics source is covered; dates use the oldest source watermark."
        : "Portfolio coverage is incomplete for one or more connected sources. Missing data is not zero.",
    );
    return AnalyticsPortfolioStatusResponseSchema.parse({
      schemaVersion: 2,
      catalogRevision: snapshot.catalog.catalogRevision,
      state,
      sources: coverage,
      reportRequests,
      reportRequestInspections,
      freshness,
      detail: this.statusDetail(state, snapshot.sources.length),
    });
  }

  async startSync(input: AnalyticsPortfolioSyncInput): Promise<AnalyticsPortfolioSyncResponse> {
    if (this.activeSync) return this.syncRuns.get(this.activeSync.runId)!;
    const releaseAccountRead = await this.dependencies.acquireAccountRead();
    let issuerIds: string[] = [];
    try {
      const activeAfterLease = this.activeSync as { runId: string; task: Promise<void> } | null;
      if (activeAfterLease) {
        releaseAccountRead();
        return this.syncRuns.get(activeAfterLease.runId)!;
      }
      if (this.reservedIssuers.size > 0) {
        throw new AnalyticsPortfolioError(
          "analytics_sync_scope_busy",
          "A portfolio Analytics sync is already being prepared. Wait for it to finish before starting another sync.",
          409,
        );
      }
      // Account mutations invalidate the snapshot while holding the write
      // lease. Refreshing only after this read lease is acquired guarantees
      // that no removed or replaced credential can be captured for the job.
      if (this.refreshTask) await this.refreshTask;
      else if (!this.snapshot) await this.refresh();
      const snapshot = this.requireSnapshot();
      // Multiple readers may share the account lease and the same in-flight
      // catalog refresh. Re-check after that await, then reserve every issuer
      // without another yield so only one caller can cross this boundary.
      if (this.activeSync || this.reservedIssuers.size > 0) {
        throw new AnalyticsPortfolioError(
          "analytics_sync_scope_busy",
          "A portfolio Analytics sync is already being prepared. Wait for it to finish before starting another sync.",
          409,
        );
      }
      if (snapshot.sources.length === 0) {
        throw new AnalyticsPortfolioError(
          "analytics_not_configured",
          "Connect at least one App Store Connect account before syncing Analytics.",
          409,
        );
      }
      issuerIds = snapshot.sources.map((source) => source.issuerId);
      this.assertNoIssuerSyncOverlap(issuerIds);
      issuerIds.forEach((issuerId) => this.reservedIssuers.add(issuerId));
      const runId = this.dependencies.id();
      const startedAt = this.dependencies.now().toISOString();
      const status = await this.status();
      const statusBySource = new Map(status.sources.map((source) => [source.sourceId, source]));
      const queued = AnalyticsPortfolioSyncResponseSchema.parse({
        schemaVersion: 2,
        runId,
        state: "QUEUED",
        sources: snapshot.sources.map((source) => ({
          sourceId: source.id,
          state: "QUEUED",
          appIds: source.apps.map((app) => app.id),
          runIds: [],
          freshness: statusBySource.get(source.id)?.freshness ?? noDataFreshness("This source has not synced yet."),
          batchCount: 0,
          observationCount: 0,
          error: null,
        })),
        startedAt,
        completedAt: null,
        freshness: status.freshness,
        batchCount: 0,
        observationCount: 0,
        error: null,
      });
      this.rememberSync(queued);
      const task = this.executeSync(snapshot, queued, input, releaseAccountRead)
        .catch(() => undefined)
        .finally(() => {
          issuerIds.forEach((issuerId) => this.reservedIssuers.delete(issuerId));
          if (this.activeSync?.runId === runId) this.activeSync = null;
        });
      this.activeSync = { runId, task };
      return queued;
    } catch (error) {
      issuerIds.forEach((issuerId) => this.reservedIssuers.delete(issuerId));
      releaseAccountRead();
      throw error;
    }
  }

  hasActiveIssuer(issuerId: string) {
    return this.reservedIssuers.has(issuerId);
  }

  getSync(runId: string) {
    return this.syncRuns.get(runId) ?? this.dependencies.store.getAnalyticsPortfolioSyncRun(runId);
  }

  async waitForAll() {
    await this.activeSync?.task;
  }

  private async discover(connection: AnalyticsPortfolioConnection): Promise<ConnectionDiscovery> {
    let apps: AppSummary[];
    try {
      apps = await connection.provider.listApps({ paginate: true });
    } catch (error) {
      return {
        connection,
        apps: [],
        appError: errorMessage(error),
        reportRequests: [],
        reportSucceededAppIds: new Set(),
        reportErrorsByAppId: new Map(),
      };
    }
    const reportResults = await mapWithConcurrency(apps, 2, async (app) => {
      try {
        return {
          appId: app.id,
          requests: await connection.provider.listAnalyticsReportRequests(app.id),
          error: null,
        };
      } catch (error) {
        return {
          appId: app.id,
          requests: [] as AnalyticsReportRequest[],
          error: reportInspectionError(error),
        };
      }
    });
    return {
      connection,
      apps,
      appError: null,
      reportRequests: reportResults.flatMap((result) => result.requests),
      reportSucceededAppIds: new Set(reportResults.filter((result) => result.error === null).map((result) => result.appId)),
      reportErrorsByAppId: new Map(reportResults.flatMap((result) => (
        result.error === null ? [] : [[result.appId, result.error] as const]
      ))),
    };
  }

  private buildSource(
    issuerId: string,
    discoveries: ConnectionDiscovery[],
    previous: InternalPortfolioSource | null,
    discoveredAt: string,
  ): InternalPortfolioSource {
    const sourceId = this.opaque("source", issuerId);
    const successful = discoveries.filter((discovery) => discovery.appError === null);
    const failed = discoveries.filter((discovery) => discovery.appError !== null);
    const connections = new Map(discoveries.map((discovery) => [discovery.connection.connectionId, discovery.connection]));
    const previousAppById = new Map(previous?.apps.map((app) => [app.rawAppId, app]) ?? []);
    const previousAccountApps = previous?.accountAppIds ?? new Map<string, string[]>();
    const currentlyDiscoveredAppIds = new Set(successful.flatMap((discovery) => discovery.apps.map((app) => app.id)));
    const failedWithUnknownRoster = failed.filter((discovery) => (
      !previousAccountApps.has(discovery.connection.connectionId)
    ));
    const missingKnownAppsByConnection = new Map<string, string[]>();
    const failedWithLastKnownCoveredRoster = new Set<string>();
    for (const discovery of failed) {
      const knownAppIds = previousAccountApps.get(discovery.connection.connectionId);
      if (!knownAppIds) continue;
      const missing = knownAppIds.filter((appId) => !currentlyDiscoveredAppIds.has(appId));
      if (missing.length === 0) failedWithLastKnownCoveredRoster.add(discovery.connection.connectionId);
      else missingKnownAppsByConnection.set(discovery.connection.connectionId, missing);
    }

    // A prior equal roster is useful recovery evidence, but cannot prove the
    // credential's current Apple authorization scope. Any failed credential
    // therefore keeps the source partial. Retain known missing apps as stale; a
    // never-proven credential keeps the prior union because silently dropping
    // potentially real apps would turn missing data into an apparent zero.
    const staleAppIds = new Set<string>();
    for (const appIds of missingKnownAppsByConnection.values()) {
      appIds.forEach((appId) => staleAppIds.add(appId));
    }
    if (failedWithUnknownRoster.length > 0 || successful.length === 0 && previousAccountApps.size === 0) {
      previous?.apps.forEach((app) => {
        if (!currentlyDiscoveredAppIds.has(app.rawAppId)) staleAppIds.add(app.rawAppId);
      });
    } else if (successful.length === 0) {
      for (const discovery of failed) {
        previousAccountApps.get(discovery.connection.connectionId)?.forEach((appId) => staleAppIds.add(appId));
      }
    }

    const appCandidates = new Map<string, {
      app: AppSummary;
      connectionIds: string[];
      reportConnectionIds: string[];
      reportInspectionErrors: string[];
    }>();
    for (const discovery of successful) {
      for (const app of discovery.apps) {
        const current = appCandidates.get(app.id);
        if (current) {
          current.connectionIds.push(discovery.connection.connectionId);
          if (discovery.reportSucceededAppIds.has(app.id)) {
            current.reportConnectionIds.push(discovery.connection.connectionId);
          }
          const inspectionError = discovery.reportErrorsByAppId.get(app.id);
          if (inspectionError) current.reportInspectionErrors.push(inspectionError);
        } else {
          appCandidates.set(app.id, {
            app,
            connectionIds: [discovery.connection.connectionId],
            reportConnectionIds: discovery.reportSucceededAppIds.has(app.id)
              ? [discovery.connection.connectionId]
              : [],
            reportInspectionErrors: discovery.reportErrorsByAppId.has(app.id)
              ? [discovery.reportErrorsByAppId.get(app.id)!]
              : [],
          });
        }
      }
    }
    for (const appId of staleAppIds) {
      if (appCandidates.has(appId)) continue;
      const previousApp = previousAppById.get(appId);
      if (!previousApp) continue;
      appCandidates.set(appId, {
        app: {
          id: previousApp.rawAppId,
          name: previousApp.name,
          bundleId: previousApp.bundleId,
          platforms: previousApp.platforms,
        },
        // Cached-only membership is safe for read aggregation, but it must
        // never inherit a route from a failed discovery attempt.
        connectionIds: [],
        reportConnectionIds: [],
        reportInspectionErrors: ["The app is only available in the previous account roster."],
      });
    }
    const apps: InternalPortfolioApp[] = [...appCandidates.values()].map(({
      app,
      connectionIds,
      reportConnectionIds,
      reportInspectionErrors,
    }) => ({
      id: this.opaque("app", issuerId, app.id),
      sourceId,
      rawAppId: app.id,
      name: app.name,
      bundleId: app.bundleId,
      platforms: app.platforms,
      connectionIds: [...new Set(connectionIds)].sort(),
      reportConnectionIds: [...new Set(reportConnectionIds)].sort(),
      reportInspectionErrors: [...new Set(reportInspectionErrors)],
    })).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));

    const retainedAppIds = new Set(apps.map((app) => app.rawAppId));
    const accountAppIds = new Map<string, string[]>();
    for (const discovery of successful) {
      accountAppIds.set(
        discovery.connection.connectionId,
        [...new Set(discovery.apps.map((app) => app.id))].sort(),
      );
    }
    for (const discovery of failed) {
      const known = previousAccountApps.get(discovery.connection.connectionId);
      if (!known) continue;
      accountAppIds.set(
        discovery.connection.connectionId,
        [...new Set(known.filter((appId) => retainedAppIds.has(appId)))].sort(),
      );
    }

    const accounts = discoveries.map((discovery): AnalyticsPortfolioAccount => {
      const knownAppIds = previousAccountApps.get(discovery.connection.connectionId);
      const missingKnownAppIds = missingKnownAppsByConnection.get(discovery.connection.connectionId) ?? [];
      return {
        id: this.publicAccountId(issuerId, discovery.connection.connectionId),
        profileName: discovery.connection.profileName,
        active: discovery.connection.active,
        state: discovery.appError ? "ERROR" : "READY",
        appCount: discovery.appError ? knownAppIds?.length ?? 0 : discovery.apps.length,
        detail: discovery.appError
          ? knownAppIds === undefined
            ? "ASC Studio could not inspect this saved Apple account and has no prior successful roster to prove its coverage. Reconnect it or verify its API role."
            : missingKnownAppIds.length > 0
              ? `ASC Studio could not inspect this saved Apple account; ${missingKnownAppIds.length} previously visible app${missingKnownAppIds.length === 1 ? " is" : "s are"} not covered by another working credential.`
              : "ASC Studio could not inspect this saved Apple account. Another credential exposes its last known apps, but the failed credential's current Apple authorization scope cannot be verified."
          : discovery.apps.length === 0
            ? "This saved Apple account is connected and currently contains no apps."
            : `This saved Apple account exposes ${discovery.apps.length} app${discovery.apps.length === 1 ? "" : "s"}.`,
      };
    }).sort((left, right) => Number(right.active) - Number(left.active) || left.profileName.localeCompare(right.profileName));

    const rosterIncomplete = failed.length > 0;
    const state: AnalyticsPortfolioSource["state"] = successful.length === 0
      ? "ERROR"
      : rosterIncomplete
        ? "PARTIAL"
        : "READY";
    const reportCoveredAppIds = new Set(apps
      .filter((app) => app.reportConnectionIds.length > 0)
      .map((app) => app.rawAppId));
    const reportUncoveredAppIds = new Set(apps
      .map((app) => app.rawAppId)
      .filter((appId) => !reportCoveredAppIds.has(appId)));
    const reportDiscoveryState: ReportDiscoveryState = successful.length === 0
      ? "ERROR"
      : reportUncoveredAppIds.size > 0
        ? "PARTIAL"
        : "READY";
    const discoveredRequests = uniqueBy(
      successful.flatMap((discovery) => discovery.reportRequests),
      (request) => `${request.appId}\0${request.id}`,
    );
    const cachedUncoveredRequests = previous?.reportRequests.filter((request) => reportUncoveredAppIds.has(request.appId)) ?? [];
    const reportRequests = uniqueBy(
      [...discoveredRequests, ...cachedUncoveredRequests],
      (request) => `${request.appId}\0${request.id}`,
    );
    const duplicateCredentialDetail = discoveries.length > 1
      ? `${discoveries.length} saved credentials map to this same App Store Connect organization and are deduplicated.`
      : "";
    const coveredPriorRosterFailureDetail = failedWithLastKnownCoveredRoster.size > 0
      ? `${failedWithLastKnownCoveredRoster.size} saved credential${failedWithLastKnownCoveredRoster.size === 1 ? " failed" : "s failed"} inspection. Another credential covers ${failedWithLastKnownCoveredRoster.size === 1 ? "its" : "their"} last known apps, but current Apple authorization scope cannot be verified.`
      : "";
    const unknownFailureDetail = failedWithUnknownRoster.length > 0
      ? `${failedWithUnknownRoster.length} failed saved credential${failedWithUnknownRoster.length === 1 ? " has" : "s have"} no prior successful roster, so organization coverage cannot be assumed complete.`
      : "";
    const missingFailureDetail = missingKnownAppsByConnection.size > 0
      ? `${staleAppIds.size} previously visible app${staleAppIds.size === 1 ? " is" : "s are"} retained as stale because no working credential currently covers ${staleAppIds.size === 1 ? "it" : "them"}.`
      : "";
    const detail = [
      state === "READY"
        ? apps.length === 0
          ? "The connected organization currently has no apps."
          : `The connected organization contributes ${apps.length} unique app${apps.length === 1 ? "" : "s"}.`
        : state === "PARTIAL"
          ? `Working credentials contribute ${currentlyDiscoveredAppIds.size} app${currentlyDiscoveredAppIds.size === 1 ? "" : "s"}, but the full organization roster could not be verified.`
          : "This organization could not be discovered with any saved credential; its last known app roster remains visible as stale cache.",
      duplicateCredentialDetail,
      coveredPriorRosterFailureDetail,
      unknownFailureDetail,
      missingFailureDetail,
    ].filter(Boolean).join(" ");
    const hasStaleApps = apps.some((app) => app.connectionIds.length === 0);
    return {
      id: sourceId,
      issuerId,
      lastDiscoveredAt: state === "READY" || !hasStaleApps
        ? discoveredAt
        : previous?.lastDiscoveredAt ?? discoveredAt,
      state,
      detail,
      accounts,
      accountAppIds,
      apps,
      connections,
      reportRequests,
      reportDiscoveryState,
      reportDiscoveryDetail: reportDiscoveryState === "ERROR"
        ? "Analytics report setup could not be checked because the account's current app roster was unavailable."
        : reportUncoveredAppIds.size > 0
          ? `Apple did not return Analytics report setup for ${reportUncoveredAppIds.size} app${reportUncoveredAppIds.size === 1 ? "" : "s"}. Their app connections remain available.`
          : "Analytics report setup was inspected for every discovered app.",
    };
  }

  private publicReportRequests(source: InternalPortfolioSource): AnalyticsPortfolioReportRequest[] {
    const appByRawId = new Map(source.apps.map((app) => [app.rawAppId, app]));
    return source.reportRequests.flatMap((request) => {
      const app = appByRawId.get(request.appId);
      if (!app) return [];
      return [{
        ...request,
        id: this.publicRequestId(source.issuerId, request.id),
        appId: app.id,
        sourceId: source.id,
      }];
    }).sort((left, right) => left.appId.localeCompare(right.appId) || left.id.localeCompare(right.id));
  }

  private async executeSync(
    snapshot: PortfolioSnapshot,
    queued: AnalyticsPortfolioSyncResponse,
    input: AnalyticsPortfolioSyncInput,
    releaseAccountRead: () => void,
  ) {
    try {
      this.rememberSync({ ...queued, state: "RUNNING" });
      const sourceResults = await mapWithConcurrency(snapshot.sources, 3, async (source) => {
        const result = await this.syncSource(source, input.force, queued.runId);
        const current = this.syncRuns.get(queued.runId) ?? queued;
        this.rememberSync({
          ...current,
          state: "RUNNING",
          sources: current.sources.map((candidate) => candidate.sourceId === result.sourceId ? result : candidate),
        });
        return result;
      });
      const successful = sourceResults.filter((source) => source.state === "SUCCEEDED").length;
      const state: AnalyticsPortfolioSyncResponse["state"] = successful === sourceResults.length
        ? "SUCCEEDED"
        : successful > 0 || sourceResults.some((source) => source.state === "PARTIAL")
          ? "PARTIAL"
          : "FAILED";
      const relevant = sourceResults.filter((source) => source.appIds.length > 0 || source.state !== "SUCCEEDED");
      const freshness = combineFreshness(
        relevant.map((source) => source.freshness),
        state !== "SUCCEEDED" || relevant.some((source) => source.freshness.partial),
        state === "SUCCEEDED"
          ? "Every connected Analytics source finished syncing; dates use the oldest source watermark."
          : "The portfolio sync is incomplete for one or more connected sources. Existing cached facts remain available.",
      );
      this.rememberSync(AnalyticsPortfolioSyncResponseSchema.parse({
        ...queued,
        state,
        sources: sourceResults,
        completedAt: this.dependencies.now().toISOString(),
        freshness,
        batchCount: sourceResults.reduce((total, source) => total + source.batchCount, 0),
        observationCount: sourceResults.reduce((total, source) => total + source.observationCount, 0),
        error: state === "SUCCEEDED"
          ? null
          : sourceResults.filter((source) => source.error).map((source) => source.error).join(" ")
            || "One or more connected Analytics sources did not finish syncing.",
      }));
    } catch (error) {
      const current = this.syncRuns.get(queued.runId) ?? queued;
      const failedSources = current.sources.map((source): AnalyticsPortfolioSyncSource => (
        source.state === "SUCCEEDED" || source.state === "PARTIAL" || source.state === "FAILED"
          ? source
          : {
            ...source,
            state: "FAILED",
            freshness: {
              ...source.freshness,
              partial: true,
              detail: "This source did not finish before the portfolio sync stopped.",
            },
            error: source.error ?? "This connected source did not finish syncing.",
          }
      ));
      this.rememberSync(AnalyticsPortfolioSyncResponseSchema.parse({
        ...current,
        state: "FAILED",
        sources: failedSources,
        completedAt: this.dependencies.now().toISOString(),
        freshness: {
          ...current.freshness,
          partial: true,
          detail: "The portfolio sync stopped before every connected source completed; finished source results remain attributed below.",
        },
        batchCount: failedSources.reduce((total, source) => total + source.batchCount, 0),
        observationCount: failedSources.reduce((total, source) => total + source.observationCount, 0),
        error: "The portfolio Analytics sync failed before every connected source could be completed.",
      }));
    } finally {
      releaseAccountRead();
    }
  }

  private async syncSource(
    source: InternalPortfolioSource,
    force: boolean,
    portfolioRunId: string,
  ): Promise<AnalyticsPortfolioSyncSource> {
    if (source.state === "READY" && source.apps.length === 0) {
      return {
        sourceId: source.id,
        state: "SUCCEEDED",
        appIds: [],
        runIds: [],
        freshness: noAppsFreshness(),
        batchCount: 0,
        observationCount: 0,
        error: null,
      };
    }
    const activeRequestAppIds = new Set(source.reportRequests
      .filter((request) => !request.stoppedDueToInactivity)
      .map((request) => request.appId));
    const groups = new Map<string, InternalPortfolioApp[]>();
    const unroutable: InternalPortfolioApp[] = [];
    const unverified: InternalPortfolioApp[] = [];
    for (const app of source.apps) {
      if (!activeRequestAppIds.has(app.rawAppId)) {
        if (app.reportConnectionIds.length === 0) unverified.push(app);
        continue;
      }
      // A successful app-list request proves that this credential can still
      // reach the app. Prefer a connection that inspected report setup, but
      // fall back to the current app connection when that narrower Apple call
      // was transiently unavailable so the sync itself can retry it.
      const candidateConnectionIds = app.reportConnectionIds.length > 0
        ? app.reportConnectionIds
        : app.connectionIds;
      const connection = candidateConnectionIds
        .map((connectionId) => source.connections.get(connectionId))
        .filter((candidate): candidate is AnalyticsPortfolioConnection => candidate !== undefined)
        .sort(stableConnectionOrder)[0];
      if (!connection) {
        unroutable.push(app);
        continue;
      }
      const current = groups.get(connection.connectionId) ?? [];
      current.push(app);
      groups.set(connection.connectionId, current);
    }
    const childRuns: AnalyticsSyncResponse[] = [];
    for (const [connectionId, apps] of groups) {
      const connection = source.connections.get(connectionId)!;
      const childStore: AnalyticsStore = {
        replaceAnalyticsFactBatch: (batch) => this.dependencies.store.replaceAnalyticsFactBatch(batch),
        readAnalyticsSnapshot: (query) => this.dependencies.store.readAnalyticsSnapshot(query),
        saveAnalyticsSyncRun: (run) => (
          this.dependencies.store.savePortfolioChildAnalyticsSyncRun(run, portfolioRunId)
        ),
        getAnalyticsSyncRun: (runId) => this.dependencies.store.getPortfolioChildAnalyticsSyncRun(runId),
      };
      const coordinator = new AnalyticsSyncCoordinator({
        provider: connection.provider,
        store: childStore,
        acquireAccountRead: async () => () => undefined,
        activeIssuerId: async () => source.issuerId,
        now: this.dependencies.now,
        id: this.dependencies.id,
      });
      const rawAppIds = apps.map((app) => app.rawAppId);
      const status: AnalyticsStatusResponse = {
        schemaVersion: 1,
        issuerId: source.issuerId,
        state: "WAITING_FOR_DATA",
        reportRequests: source.reportRequests.filter((request) => rawAppIds.includes(request.appId)),
        freshness: noDataFreshness("This app group is queued for Analytics sync."),
        detail: "This app group is queued for Analytics sync.",
      };
      const queued = await coordinator.start(source.issuerId, {
        schemaVersion: 1,
        appIds: rawAppIds,
        force,
      }, status);
      await coordinator.waitForIdle(source.issuerId);
      childRuns.push(await coordinator.get(queued.runId) ?? queued);
    }
    const succeeded = childRuns.filter((run) => run.state === "SUCCEEDED").length;
    const partiallySucceeded = childRuns.filter((run) => run.state === "PARTIAL").length;
    const failedChildren = childRuns.filter((run) => run.state === "FAILED").length;
    const hardFailure = failedChildren > 0 || unroutable.length > 0 || source.state === "ERROR";
    const needsPartial = hardFailure
      || partiallySucceeded > 0
      || source.state === "PARTIAL"
      || source.reportDiscoveryState !== "READY"
      || unverified.length > 0;
    const state: AnalyticsPortfolioSyncSource["state"] = hardFailure && succeeded === 0 && partiallySucceeded === 0
      ? "FAILED"
      : needsPartial
        ? "PARTIAL"
        : "SUCCEEDED";
    const freshness = childRuns.length > 0
      ? combineFreshness(
        childRuns.map((run) => run.freshness),
        state !== "SUCCEEDED" || childRuns.some((run) => run.freshness.partial),
        state === "SUCCEEDED"
          ? "Every app with an active Analytics report was checked."
          : "Some Analytics reports could not be checked; existing data remains available.",
      )
      : noDataFreshness(
        unverified.length > 0
          ? "Apple did not return Analytics report setup for every app; their app connections remain available."
          : "No apps with active Analytics reports are ready to update yet.",
      );
    const errors = [
      failedChildren > 0
        ? `Apple could not update Analytics for ${failedChildren} app group${failedChildren === 1 ? "" : "s"}.`
        : "",
      unroutable.length > 0
        ? `${unroutable.length} app${unroutable.length === 1 ? " is" : "s are"} only present in an older account roster and could not be updated.`
        : "",
      unverified.length > 0
        ? `Apple did not return Analytics report setup for ${unverified.length} app${unverified.length === 1 ? "" : "s"}; their app connections are still working.`
        : "",
      source.state !== "READY" ? source.detail : "",
    ].filter(Boolean);
    return {
      sourceId: source.id,
      state,
      appIds: source.apps.map((app) => app.id),
      // Child V1 runs remain issuer/raw-app scoped in SQLite. Only emit an
      // irreversible public reference so V2 callers cannot traverse the legacy
      // run endpoint and recover raw issuer, app, or report-request identities.
      runIds: childRuns.map((run) => (
        `sync_${this.dependencies.digest(JSON.stringify({ sourceId: source.id, runId: run.runId })).slice(0, 48)}`
      )),
      freshness,
      batchCount: childRuns.reduce((total, run) => total + run.batchCount, 0),
      observationCount: childRuns.reduce((total, run) => total + run.observationCount, 0),
      error: errors.length > 0 ? [...new Set(errors)].join(" ") : null,
    };
  }

  private rememberSync(response: AnalyticsPortfolioSyncResponse) {
    const parsed = AnalyticsPortfolioSyncResponseSchema.parse(response);
    this.dependencies.store.saveAnalyticsPortfolioSyncRun(parsed);
    this.syncRuns.set(response.runId, parsed);
    while (this.syncRuns.size > 100) this.syncRuns.delete(this.syncRuns.keys().next().value!);
  }

  private assertNoIssuerSyncOverlap(issuerIds: string[]) {
    const activeIssuer = issuerIds.find((issuerId) => (
      this.dependencies.isIssuerSyncActive?.(issuerId)
      || this.dependencies.store.getActiveSyncRun(issuerId) !== null
    ));
    if (activeIssuer) {
      throw new AnalyticsPortfolioError(
        "analytics_sync_scope_busy",
        "Another Analytics sync is already running for one of the connected sources. Wait for it to finish before starting a portfolio sync.",
        409,
      );
    }
  }

  private requireSnapshot() {
    if (!this.snapshot) {
      throw new AnalyticsPortfolioError(
        "analytics_portfolio_not_loaded",
        "Load the connected Analytics portfolio before reading cached facts.",
        409,
      );
    }
    return this.snapshot;
  }

  private opaque(kind: string, ...parts: string[]) {
    const payload = ["asc-studio-analytics-v2", kind, ...parts]
      .map((part) => `${Buffer.byteLength(part, "utf8")}:${part}`)
      .join("|");
    return `${kind}_${this.dependencies.digest(payload).slice(0, 48)}`;
  }

  private revisionForSources(sources: InternalPortfolioSource[]) {
    const publicRoster = sources.map((source) => ({
      id: source.id,
      state: source.state,
      reportDiscoveryState: source.reportDiscoveryState,
      accounts: source.accounts.map((account) => ({
        id: account.id,
        profileName: account.profileName,
        state: account.state,
        appCount: account.appCount,
      })).sort((left, right) => left.id.localeCompare(right.id)),
      apps: source.apps.map((app) => ({
        id: app.id,
        name: app.name,
        bundleId: app.bundleId,
        platforms: [...app.platforms].sort(),
      })).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.id.localeCompare(right.id));
    return `catalog_${this.dependencies.digest(JSON.stringify(publicRoster)).slice(0, 48)}`;
  }

  private appConnections(source: InternalPortfolioSource, app: InternalPortfolioApp) {
    return app.reportConnectionIds
      .map((connectionId) => source.connections.get(connectionId))
      .filter((candidate): candidate is AnalyticsPortfolioConnection => candidate !== undefined)
      .sort(stableConnectionOrder);
  }

  private assertOpaqueCollisions(sources: InternalPortfolioSource[]) {
    const sourceIds = new Set<string>();
    const appIds = new Set<string>();
    const accountIds = new Set<string>();
    for (const source of sources) {
      if (sourceIds.has(source.id)) throw new AnalyticsPortfolioError("analytics_identity_collision", "Two Apple organizations resolved to the same public Analytics identity.", 500);
      sourceIds.add(source.id);
      for (const app of source.apps) {
        if (appIds.has(app.id)) throw new AnalyticsPortfolioError("analytics_identity_collision", "Two apps resolved to the same public Analytics identity.", 500);
        appIds.add(app.id);
      }
      for (const account of source.accounts) {
        if (accountIds.has(account.id)) throw new AnalyticsPortfolioError("analytics_identity_collision", "Two credentials resolved to the same public Analytics identity.", 500);
        accountIds.add(account.id);
      }
    }
  }

  private statusDetail(state: AnalyticsPortfolioStatusResponse["state"], sourceCount: number) {
    switch (state) {
      case "NOT_CONFIGURED": return sourceCount === 0
        ? "Connect App Store Connect to use portfolio Analytics."
        : "Create an Analytics Reports request for each app that should contribute data.";
      case "WAITING_FOR_DATA": return "Analytics Reports are configured, but at least one connected source has no successful local sync yet.";
      case "SYNCING": return "Analytics reports are syncing across connected sources. Existing cached portfolio data remains available.";
      case "PARTIAL": return "Portfolio Analytics is a subtotal because one or more connected sources is incomplete or unavailable.";
      case "ERROR": return "ASC Studio could not inspect or sync any connected Analytics source.";
      case "READY": return "Every connected Analytics source is represented in the local portfolio cache.";
    }
  }
}
