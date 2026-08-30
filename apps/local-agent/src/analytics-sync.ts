import type {
  AnalyticsFactBatch,
  AnalyticsStatusResponse,
  AnalyticsSyncInput,
  AnalyticsSyncResponse,
} from "@asc-studio/contracts";
import type { AnalyticsProvider, AnalyticsStore } from "@asc-studio/core";

export interface AnalyticsSyncCoordinatorDependencies {
  provider: AnalyticsProvider;
  store: AnalyticsStore;
  acquireAccountRead: () => Promise<() => void>;
  activeIssuerId: () => Promise<string | null>;
  now: () => Date;
  id: () => string;
}

const unique = (values: string[]) => [...new Set(values)];
const sameMembers = (left: string[], right: string[]) => (
  JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
);

export class AnalyticsSyncBusyError extends Error {
  readonly code = "analytics_sync_scope_busy";
  readonly status = 409;

  constructor(readonly activeAppIds: string[], readonly requestedAppIds: string[]) {
    super("Another analytics sync is already running for a different app selection. Wait for it to finish before starting this sync.");
    this.name = "AnalyticsSyncBusyError";
  }
}

export class AnalyticsSyncCoordinator {
  private readonly active = new Map<string, {
    runId: string;
    appIds: string[];
    response: AnalyticsSyncResponse;
    ready: Promise<void>;
    task: Promise<void>;
  }>();

  constructor(private readonly dependencies: AnalyticsSyncCoordinatorDependencies) {}

  async start(
    issuerId: string,
    input: AnalyticsSyncInput,
    status: AnalyticsStatusResponse,
  ): Promise<AnalyticsSyncResponse> {
    const running = this.active.get(issuerId);
    if (running) {
      if (sameMembers(running.appIds, input.appIds)) {
        await running.ready;
        return await this.dependencies.store.getAnalyticsSyncRun(running.runId) ?? running.response;
      }
      throw new AnalyticsSyncBusyError(running.appIds, unique(input.appIds));
    }
    if (status.issuerId !== issuerId) {
      throw new Error("The active App Store Connect issuer changed before analytics sync could start.");
    }
    const runId = this.dependencies.id();
    const startedAt = this.dependencies.now().toISOString();
    const appIds = unique(input.appIds);
    const queued: AnalyticsSyncResponse = {
      schemaVersion: 1,
      issuerId,
      runId,
      state: "QUEUED",
      appIds,
      reportRequests: status.reportRequests.filter((request) => appIds.includes(request.appId)),
      startedAt,
      completedAt: null,
      snapshotId: null,
      evidenceId: `sync:${runId}`,
      freshness: status.freshness,
      error: null,
      batchCount: 0,
      observationCount: 0,
    };
    const saved = Promise.resolve().then(() => this.dependencies.store.saveAnalyticsSyncRun(queued));
    const task = saved.then(() => this.execute(queued, input)).catch(() => undefined).finally(() => {
      if (this.active.get(issuerId)?.runId === runId) this.active.delete(issuerId);
    });
    this.active.set(issuerId, { runId, appIds, response: queued, ready: saved, task });
    await saved;
    return queued;
  }

  get(runId: string) {
    return this.dependencies.store.getAnalyticsSyncRun(runId);
  }

  isActive(issuerId: string) {
    return this.active.has(issuerId);
  }

  async waitForIdle(issuerId: string) {
    await this.active.get(issuerId)?.task;
  }

  async waitForAll() {
    await Promise.all([...this.active.values()].map(({ task }) => task));
  }

  private async execute(queued: AnalyticsSyncResponse, input: AnalyticsSyncInput) {
    let releaseAccountRead: (() => void) | null = null;
    try {
      releaseAccountRead = await this.dependencies.acquireAccountRead();
      if (await this.dependencies.activeIssuerId() !== queued.issuerId) {
        throw new Error("The active App Store Connect issuer changed before analytics sync acquired its account lease.");
      }
      await this.dependencies.store.saveAnalyticsSyncRun({ ...queued, state: "RUNNING" });
      const result = await this.dependencies.provider.syncAnalytics({
        ...input,
        appIds: queued.appIds,
      });
      if (result.issuerId !== queued.issuerId) {
        throw new Error("App Store Connect returned analytics for a different issuer.");
      }
      if (!sameMembers(result.appIds, queued.appIds)) {
        throw new Error("App Store Connect returned analytics for a different app selection.");
      }
      let observationCount = 0;
      let batchCount = 0;
      for (const batch of result.batches) {
        this.assertBatchScope(batch, queued);
        const write = await this.dependencies.store.replaceAnalyticsFactBatch(batch);
        observationCount += write.observationCount;
        batchCount += 1;
      }
      await this.dependencies.store.saveAnalyticsSyncRun({
        schemaVersion: 1,
        issuerId: queued.issuerId,
        runId: queued.runId,
        state: result.state,
        appIds: queued.appIds,
        reportRequests: result.reportRequests,
        startedAt: queued.startedAt,
        completedAt: result.completedAt ?? this.dependencies.now().toISOString(),
        snapshotId: result.snapshotId,
        evidenceId: result.evidenceId,
        freshness: result.freshness,
        error: result.error,
        batchCount,
        observationCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analytics sync failed.";
      await this.dependencies.store.saveAnalyticsSyncRun({
        ...queued,
        state: "FAILED",
        completedAt: this.dependencies.now().toISOString(),
        error: message,
      });
    } finally {
      releaseAccountRead?.();
    }
  }

  private assertBatchScope(batch: AnalyticsFactBatch, queued: AnalyticsSyncResponse) {
    if (batch.issuerId !== queued.issuerId || !queued.appIds.includes(batch.appId)) {
      throw new Error("An analytics report batch escaped the active issuer or app scope.");
    }
  }
}
