import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnalyticsSyncInput, AnalyticsSyncResult } from "@asc-studio/contracts";
import { MockAscProvider } from "@asc-studio/provider-demo";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteAnalyticsStore } from "./analytics-store.js";
import { AnalyticsSyncBusyError, AnalyticsSyncCoordinator } from "./analytics-sync.js";

const temporaryDirectories: string[] = [];

const createStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-analytics-sync-"));
  temporaryDirectories.push(directory);
  return new SqliteAnalyticsStore(join(directory, "analytics.sqlite"));
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

class DeferredAnalyticsProvider extends MockAscProvider {
  calls = 0;
  private release: (() => void) | null = null;

  finish() {
    this.release?.();
  }

  override async syncAnalytics(input: AnalyticsSyncInput): Promise<AnalyticsSyncResult> {
    this.calls += 1;
    await new Promise<void>((resolve) => { this.release = resolve; });
    return super.syncAnalytics(input);
  }
}

const syncInput: AnalyticsSyncInput = {
  schemaVersion: 1,
  appIds: ["demo-app-orbit-notes", "demo-app-field-log"],
  force: false,
};

describe("AnalyticsSyncCoordinator", () => {
  it("reserves an issuer before the queued run is persisted under concurrent starts", async () => {
    const store = await createStore();
    const saveAnalyticsSyncRun = store.saveAnalyticsSyncRun.bind(store);
    let releaseQueuedSave: () => void = () => {};
    const queuedSave = new Promise<void>((resolve) => { releaseQueuedSave = resolve; });
    store.saveAnalyticsSyncRun = async (run) => {
      if (run.state === "QUEUED") await queuedSave;
      await saveAnalyticsSyncRun(run);
    };
    const provider = new DeferredAnalyticsProvider();
    let generatedIds = 0;
    const coordinator = new AnalyticsSyncCoordinator({
      provider,
      store,
      acquireAccountRead: async () => () => undefined,
      activeIssuerId: async () => "demo-issuer",
      now: () => new Date("2026-08-22T16:00:00.000Z"),
      id: () => `concurrent-sync-${++generatedIds}`,
    });
    const status = await provider.getAnalyticsStatus();

    const first = coordinator.start("demo-issuer", syncInput, status);
    const sameScope = coordinator.start("demo-issuer", {
      ...syncInput,
      appIds: [...syncInput.appIds].reverse(),
    }, status);
    await expect(coordinator.start("demo-issuer", {
      ...syncInput,
      appIds: ["demo-app-orbit-notes"],
    }, status)).rejects.toMatchObject({
      code: "analytics_sync_scope_busy",
      activeAppIds: syncInput.appIds,
      requestedAppIds: ["demo-app-orbit-notes"],
    });
    expect(generatedIds).toBe(1);

    releaseQueuedSave();
    const [firstRun, sameRun] = await Promise.all([first, sameScope]);
    expect(firstRun.runId).toBe("concurrent-sync-1");
    expect(sameRun.runId).toBe(firstRun.runId);
    for (let attempt = 0; provider.calls === 0 && attempt < 10; attempt += 1) await Promise.resolve();
    expect(provider.calls).toBe(1);

    provider.finish();
    await coordinator.waitForIdle("demo-issuer");
    await expect(coordinator.get(firstRun.runId)).resolves.toMatchObject({ state: "SUCCEEDED" });
    store.close();
  });

  it("returns a pollable job, single-flights by issuer, and holds an account read lease", async () => {
    const store = await createStore();
    const provider = new DeferredAnalyticsProvider();
    let acquired = 0;
    let released = 0;
    const coordinator = new AnalyticsSyncCoordinator({
      provider,
      store,
      acquireAccountRead: async () => {
        acquired += 1;
        return () => { released += 1; };
      },
      activeIssuerId: async () => "demo-issuer",
      now: () => new Date("2026-08-22T16:00:00.000Z"),
      id: () => "local-sync-1",
    });
    const status = await provider.getAnalyticsStatus();

    const first = await coordinator.start("demo-issuer", syncInput, status);
    const second = await coordinator.start("demo-issuer", syncInput, status);
    for (let attempt = 0; provider.calls === 0 && attempt < 10; attempt += 1) await Promise.resolve();
    expect(first).toMatchObject({ runId: "local-sync-1", state: "QUEUED" });
    expect(second.runId).toBe(first.runId);
    expect(provider.calls).toBe(1);
    expect(acquired).toBe(1);
    await expect(coordinator.start("demo-issuer", {
      ...syncInput,
      appIds: ["demo-app-orbit-notes"],
    }, status)).rejects.toMatchObject({
      name: "AnalyticsSyncBusyError",
      code: "analytics_sync_scope_busy",
      status: 409,
      activeAppIds: syncInput.appIds,
      requestedAppIds: ["demo-app-orbit-notes"],
    } satisfies Partial<AnalyticsSyncBusyError>);

    provider.finish();
    await coordinator.waitForIdle("demo-issuer");
    expect(released).toBe(1);
    await expect(coordinator.get(first.runId)).resolves.toMatchObject({
      issuerId: "demo-issuer",
      runId: "local-sync-1",
      state: "SUCCEEDED",
      appIds: syncInput.appIds,
      batchCount: 8,
    });
    await expect(store.getLatestSuccessfulAnalyticsSyncRun("demo-issuer")).resolves.toMatchObject({
      runId: "local-sync-1",
      state: "SUCCEEDED",
      freshness: { dataThrough: "2026-08-17" },
    });
    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: syncInput.appIds,
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    });
    expect(snapshot?.observations.length).toBeGreaterThan(0);
    expect(snapshot?.freshness.partial).toBe(true);
    store.close();
  });

  it("fails safely if the account changes before the background lease is usable", async () => {
    const store = await createStore();
    const provider = new DeferredAnalyticsProvider();
    let released = 0;
    const coordinator = new AnalyticsSyncCoordinator({
      provider,
      store,
      acquireAccountRead: async () => () => { released += 1; },
      activeIssuerId: async () => "another-issuer",
      now: () => new Date("2026-08-22T16:00:00.000Z"),
      id: () => "local-sync-account-changed",
    });
    const status = await provider.getAnalyticsStatus();

    const queued = await coordinator.start("demo-issuer", syncInput, status);
    await coordinator.waitForIdle("demo-issuer");
    expect(provider.calls).toBe(0);
    expect(released).toBe(1);
    await expect(coordinator.get(queued.runId)).resolves.toMatchObject({
      state: "FAILED",
      error: expect.stringContaining("issuer changed"),
    });
    store.close();
  });
});
