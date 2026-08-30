import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AnalyticsSyncResponse } from "@asc-studio/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { demoAnalyticsFactBatches } from "@asc-studio/provider-demo";
import {
  SqliteAnalyticsStore,
  type AnalyticsInstanceInput,
  type AnalyticsObservationInput,
} from "./analytics-store.js";

const temporaryDirectories: string[] = [];

const createStore = async () => {
  const directory = await mkdtemp(join(tmpdir(), "asc-analytics-store-"));
  temporaryDirectories.push(directory);
  return new SqliteAnalyticsStore(join(directory, "analytics.sqlite"));
};

const legacyAnalyticsSchema = `
  CREATE TABLE analytics_reports (
    issuer_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    request_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    PRIMARY KEY (issuer_id, report_id)
  );
  CREATE TABLE analytics_partitions (
    issuer_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    granularity TEXT NOT NULL,
    date TEXT NOT NULL,
    processing_date TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('ONGOING', 'ONE_TIME_SNAPSHOT')),
    instance_id TEXT NOT NULL,
    promoted_at TEXT NOT NULL,
    PRIMARY KEY (issuer_id, report_id, app_id, granularity, date)
  );
  CREATE TABLE analytics_facts (
    issuer_id TEXT NOT NULL,
    report_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    granularity TEXT NOT NULL,
    date TEXT NOT NULL,
    metric TEXT NOT NULL,
    dimensions_key TEXT NOT NULL,
    dimensions_json TEXT NOT NULL,
    value REAL,
    unit TEXT NOT NULL,
    unavailable_reason TEXT,
    availability TEXT NOT NULL DEFAULT 'AVAILABLE',
    currency TEXT,
    evidence_id TEXT,
    snapshot_id TEXT,
    report_request_id TEXT,
    processing_date TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('ONGOING', 'ONE_TIME_SNAPSHOT')),
    instance_id TEXT NOT NULL,
    PRIMARY KEY (issuer_id, report_id, app_id, granularity, date, metric, dimensions_key)
  );
`;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const instance = (overrides: Partial<AnalyticsInstanceInput["instance"]> = {}): AnalyticsInstanceInput => ({
  issuerId: "issuer-a",
  request: {
    appId: "app-orbit",
    requestId: "request-1",
    accessType: "ONE_TIME_SNAPSHOT",
    createdAt: "2026-08-20T10:00:00.000Z",
  },
  report: {
    id: "report-downloads",
    name: "App Store Downloads",
    category: "COMMERCE",
  },
  instance: {
    id: "instance-snapshot",
    granularity: "DAILY",
    processingDate: "2026-08-20",
    source: "ONE_TIME_SNAPSHOT",
    partitionDates: ["2026-08-18"],
    segmentIds: ["segment-1", "segment-2"],
    ...overrides,
  },
});

const observation = (overrides: Partial<AnalyticsObservationInput> = {}): AnalyticsObservationInput => ({
  appId: "app-orbit",
  date: "2026-08-18",
  metric: "downloads",
  value: 120,
  unit: "COUNT",
  dimensions: { territory: "USA" },
  unavailableReason: null,
  ...overrides,
});

const syncRun = (overrides: Partial<AnalyticsSyncResponse> = {}): AnalyticsSyncResponse => ({
  schemaVersion: 1,
  issuerId: "issuer-a",
  runId: "legacy-active-run",
  state: "SUCCEEDED",
  appIds: ["app-orbit"],
  reportRequests: [{
    id: "active-request",
    appId: "app-orbit",
    accessType: "ONGOING",
    createdAt: "2026-08-29T10:00:00.000Z",
    stoppedDueToInactivity: false,
  }],
  startedAt: "2026-08-29T10:00:00.000Z",
  completedAt: "2026-08-29T10:01:00.000Z",
  snapshotId: "active-snapshot",
  evidenceId: "active-evidence",
  freshness: {
    syncedAt: "2026-08-29T10:01:00.000Z",
    dataThrough: "2026-08-27",
    expectedDelayDays: 5,
    partial: false,
    detail: "The active app sync is complete.",
  },
  error: null,
  batchCount: 1,
  observationCount: 10,
  ...overrides,
});

describe("SqliteAnalyticsStore", () => {
  it("atomically marks portfolio children and excludes them from legacy run and status fallbacks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asc-analytics-child-marker-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "analytics.sqlite");
    const store = new SqliteAnalyticsStore(path);
    const legacyRun = syncRun();
    const childRun = syncRun({
      runId: "inactive-portfolio-child",
      appIds: ["app-field-log"],
      reportRequests: [{
        id: "inactive-request",
        appId: "app-field-log",
        accessType: "ONGOING",
        createdAt: "2026-08-30T10:00:00.000Z",
        stoppedDueToInactivity: false,
      }],
      startedAt: "2026-08-30T10:00:00.000Z",
      completedAt: "2026-08-30T10:01:00.000Z",
      snapshotId: "inactive-snapshot",
      evidenceId: "inactive-evidence",
      freshness: {
        syncedAt: "2026-08-30T10:01:00.000Z",
        dataThrough: "2026-08-29",
        expectedDelayDays: 5,
        partial: false,
        detail: "The inactive portfolio child is complete.",
      },
    });

    await store.saveAnalyticsSyncRun(legacyRun);
    await store.savePortfolioChildAnalyticsSyncRun(childRun, "portfolio-parent-run");
    await expect(store.getAnalyticsSyncRun(childRun.runId)).resolves.toBeNull();
    await expect(store.getPortfolioChildAnalyticsSyncRun(childRun.runId)).resolves.toEqual(childRun);
    await expect(store.getLatestSuccessfulAnalyticsSyncRun("issuer-a")).resolves.toEqual(legacyRun);

    const triggerWriter = new DatabaseSync(path);
    triggerWriter.exec(`
      CREATE TRIGGER reject_portfolio_child_marker
      BEFORE INSERT ON analytics_portfolio_sync_children
      BEGIN
        SELECT RAISE(ABORT, 'fixture child marker failure');
      END;
    `);
    triggerWriter.close();
    const rolledBackChild = syncRun({ runId: "rolled-back-portfolio-child" });
    await expect(store.savePortfolioChildAnalyticsSyncRun(
      rolledBackChild,
      "portfolio-parent-run",
    )).rejects.toThrow("fixture child marker failure");
    await expect(store.getAnalyticsSyncRun(rolledBackChild.runId)).resolves.toBeNull();
    await expect(store.getPortfolioChildAnalyticsSyncRun(rolledBackChild.runId)).resolves.toBeNull();
    store.close();
  });

  it("upgrades the previous report-id-keyed schema without losing cached analytics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asc-analytics-store-legacy-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "analytics.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(legacyAnalyticsSchema);
    legacy.exec(`
      INSERT INTO analytics_reports (
        issuer_id, report_id, request_id, app_id, name, category
      ) VALUES (
        'issuer-a', 'legacy-report-downloads', 'legacy-request', 'app-orbit',
        'App Store Downloads', 'COMMERCE'
      );
      INSERT INTO analytics_partitions (
        issuer_id, report_id, app_id, granularity, date, processing_date,
        source, instance_id, promoted_at
      ) VALUES (
        'issuer-a', 'legacy-report-downloads', 'app-orbit', 'DAILY', '2026-08-18',
        '2026-08-20', 'ONE_TIME_SNAPSHOT', 'legacy-instance', '2026-08-20T10:06:00.000Z'
      );
      INSERT INTO analytics_facts (
        issuer_id, report_id, app_id, granularity, date, metric, dimensions_key,
        dimensions_json, value, unit, unavailable_reason, availability, currency,
        evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
      ) VALUES (
        'issuer-a', 'legacy-report-downloads', 'app-orbit', 'DAILY', '2026-08-18',
        'downloads', '{"territory":"USA"}', '{"territory":"USA"}', 120, 'COUNT',
        NULL, 'AVAILABLE', NULL, 'legacy-evidence', 'legacy-snapshot', 'legacy-request',
        '2026-08-20', 'ONE_TIME_SNAPSHOT', 'legacy-instance'
      );
    `);
    legacy.close();

    const store = new SqliteAnalyticsStore(path);
    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toMatchObject([{
      reportId: "legacy-report-downloads",
      value: 120,
      evidenceId: "legacy-evidence",
    }]);

    const ongoing = instance({
      id: "instance-ongoing",
      source: "ONGOING",
      segmentIds: ["segment-ongoing"],
    });
    ongoing.request.requestId = "request-ongoing";
    ongoing.request.accessType = "ONGOING";
    store.beginInstance(ongoing);
    store.stageSegment({
      issuerId: "issuer-a",
      instanceId: "instance-ongoing",
      segmentId: "segment-ongoing",
      checksum: null,
      observations: [observation({ value: 140 })],
      fetchedAt: "2026-08-20T10:07:00.000Z",
    });
    expect(store.promoteInstance("issuer-a", "instance-ongoing", "2026-08-20T10:08:00.000Z"))
      .toEqual({ promotedPartitions: 1, ignoredPartitions: 0, observationCount: 1 });
    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toMatchObject([{ reportId: "report-downloads", value: 140 }]);
    store.close();

    const upgraded = new DatabaseSync(path);
    const primaryKey = (table: string) => upgraded.prepare(`PRAGMA table_info(${table})`).all()
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => column.name);
    expect(primaryKey("analytics_partitions"))
      .toEqual(["issuer_id", "logical_report_key", "app_id", "granularity", "date"]);
    expect(primaryKey("analytics_facts"))
      .toEqual(["issuer_id", "logical_report_key", "app_id", "granularity", "date", "metric", "dimensions_key"]);
    expect(upgraded.prepare("SELECT COUNT(*) AS count FROM analytics_partitions").get())
      .toMatchObject({ count: 1 });
    expect(upgraded.prepare("SELECT COUNT(*) AS count FROM analytics_facts").get())
      .toMatchObject({ count: 1 });
    upgraded.close();
  });

  it("finishes upgrading tables left in the prior additive-migration shape", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asc-analytics-store-partial-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "analytics.sqlite");
    const partial = new DatabaseSync(path);
    partial.exec(legacyAnalyticsSchema);
    partial.exec(`
      INSERT INTO analytics_reports (
        issuer_id, report_id, request_id, app_id, name, category
      ) VALUES (
        'issuer-a', 'legacy-report-downloads', 'legacy-request', 'app-orbit',
        'App Store Downloads', 'COMMERCE'
      );
      INSERT INTO analytics_partitions (
        issuer_id, report_id, app_id, granularity, date, processing_date,
        source, instance_id, promoted_at
      ) VALUES (
        'issuer-a', 'legacy-report-downloads', 'app-orbit', 'DAILY', '2026-08-18',
        '2026-08-20', 'ONE_TIME_SNAPSHOT', 'legacy-instance', '2026-08-20T10:06:00.000Z'
      );
      INSERT INTO analytics_facts (
        issuer_id, report_id, app_id, granularity, date, metric, dimensions_key,
        dimensions_json, value, unit, unavailable_reason, availability, currency,
        evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
      ) VALUES (
        'issuer-a', 'legacy-report-downloads', 'app-orbit', 'DAILY', '2026-08-18',
        'downloads', '{"territory":"USA"}', '{"territory":"USA"}', 120, 'COUNT',
        NULL, 'AVAILABLE', NULL, 'legacy-evidence', 'legacy-snapshot', 'legacy-request',
        '2026-08-20', 'ONE_TIME_SNAPSHOT', 'legacy-instance'
      );
      ALTER TABLE analytics_partitions ADD COLUMN logical_report_key TEXT;
      ALTER TABLE analytics_facts ADD COLUMN logical_report_key TEXT;
      UPDATE analytics_partitions SET logical_report_key = 'prior-additive-key';
      UPDATE analytics_facts SET logical_report_key = 'prior-additive-key';
      CREATE UNIQUE INDEX analytics_partitions_logical_identity
        ON analytics_partitions (issuer_id, logical_report_key, app_id, granularity, date);
      CREATE UNIQUE INDEX analytics_facts_logical_identity
        ON analytics_facts (
          issuer_id, logical_report_key, app_id, granularity, date, metric, dimensions_key
        );
    `);
    partial.close();

    const store = new SqliteAnalyticsStore(path);
    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toMatchObject([{ value: 120, evidenceId: "legacy-evidence" }]);
    store.close();

    const upgraded = new DatabaseSync(path);
    for (const table of ["analytics_partitions", "analytics_facts"]) {
      const logicalKey = upgraded.prepare(`PRAGMA table_info(${table})`).all()
        .find((column) => column.name === "logical_report_key");
      expect(logicalKey).toMatchObject({ notnull: 1 });
    }
    expect(upgraded.prepare("SELECT logical_report_key FROM analytics_facts").get())
      .not.toMatchObject({ logical_report_key: "prior-additive-key" });
    upgraded.close();

    const reopened = new SqliteAnalyticsStore(path);
    expect(reopened.listPartitionCoverage("issuer-a", ["app-orbit"]))
      .toMatchObject([{ partitionCount: 1 }]);
    reopened.close();
  });

  it("collapses overlapping legacy partitions and keeps only each deterministic winner's facts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asc-analytics-store-overlap-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "analytics.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(legacyAnalyticsSchema);
    const insertReport = legacy.prepare(`
      INSERT INTO analytics_reports (issuer_id, report_id, request_id, app_id, name, category)
      VALUES ('issuer-a', ?, ?, 'app-orbit', 'App Store Downloads', 'COMMERCE')
    `);
    const insertPartition = legacy.prepare(`
      INSERT INTO analytics_partitions (
        issuer_id, report_id, app_id, granularity, date, processing_date,
        source, instance_id, promoted_at
      ) VALUES ('issuer-a', ?, 'app-orbit', 'DAILY', ?, ?, ?, ?, ?)
    `);
    const insertFact = legacy.prepare(`
      INSERT INTO analytics_facts (
        issuer_id, report_id, app_id, granularity, date, metric, dimensions_key,
        dimensions_json, value, unit, unavailable_reason, availability, currency,
        evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
      ) VALUES (
        'issuer-a', ?, 'app-orbit', 'DAILY', ?, 'downloads', '{"territory":"USA"}',
        '{"territory":"USA"}', ?, 'COUNT', NULL, 'AVAILABLE', NULL,
        ?, NULL, ?, ?, ?, ?
      )
    `);
    const candidate = (input: {
      reportId: string;
      date: string;
      processingDate: string;
      source: "ONGOING" | "ONE_TIME_SNAPSHOT";
      promotedAt: string;
      instanceId: string;
      value: number;
    }) => {
      insertReport.run(input.reportId, `request-${input.reportId}`);
      insertPartition.run(
        input.reportId,
        input.date,
        input.processingDate,
        input.source,
        input.instanceId,
        input.promotedAt,
      );
      insertFact.run(
        input.reportId,
        input.date,
        input.value,
        `evidence-${input.reportId}`,
        `request-${input.reportId}`,
        input.processingDate,
        input.source,
        input.instanceId,
      );
    };
    [
      { reportId: "newer-snapshot", date: "2026-08-15", processingDate: "2026-08-22", source: "ONE_TIME_SNAPSHOT", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "snapshot", value: 1 },
      { reportId: "older-ongoing", date: "2026-08-15", processingDate: "2026-08-21", source: "ONGOING", promotedAt: "2026-08-22T11:00:00.000Z", instanceId: "ongoing", value: 2 },
      { reportId: "tie-snapshot", date: "2026-08-16", processingDate: "2026-08-22", source: "ONE_TIME_SNAPSHOT", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "snapshot", value: 3 },
      { reportId: "tie-ongoing", date: "2026-08-16", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T09:00:00.000Z", instanceId: "ongoing", value: 4 },
      { reportId: "promoted-early", date: "2026-08-17", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T09:00:00.000Z", instanceId: "z-instance", value: 5 },
      { reportId: "promoted-late", date: "2026-08-17", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "a-instance", value: 6 },
      { reportId: "instance-a", date: "2026-08-18", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "a-instance", value: 7 },
      { reportId: "instance-z", date: "2026-08-18", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "z-instance", value: 8 },
      { reportId: "report-a", date: "2026-08-19", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "same-instance", value: 9 },
      { reportId: "report-z", date: "2026-08-19", processingDate: "2026-08-22", source: "ONGOING", promotedAt: "2026-08-22T10:00:00.000Z", instanceId: "same-instance", value: 10 },
    ].forEach((input) => candidate(input as Parameters<typeof candidate>[0]));
    legacy.close();

    const store = new SqliteAnalyticsStore(path);
    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-15",
      endDate: "2026-08-19",
    }).map((fact) => [fact.date, fact.value, fact.evidenceId])).toEqual([
      ["2026-08-15", 1, "evidence-newer-snapshot"],
      ["2026-08-16", 4, "evidence-tie-ongoing"],
      ["2026-08-17", 6, "evidence-promoted-late"],
      ["2026-08-18", 8, "evidence-instance-z"],
      ["2026-08-19", 10, "evidence-report-z"],
    ]);
    expect(store.listPartitionCoverage("issuer-a", ["app-orbit"]))
      .toMatchObject([{ partitionCount: 5 }]);
    store.close();
  });

  it("rebuilds a legacy demo cache before current startup reseeding changes report identities", async () => {
    const directory = await mkdtemp(join(tmpdir(), "asc-analytics-store-reseed-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "analytics.sqlite");
    const batches = demoAnalyticsFactBatches(["demo-app-orbit-notes"]);
    const commerce = batches.find((batch) => batch.reportId.endsWith("-commerce"))!;
    const legacyObservation = commerce.observations[0]!;
    const dimensionsJson = JSON.stringify(Object.fromEntries(
      Object.entries(legacyObservation.dimensions).sort(([left], [right]) => left.localeCompare(right)),
    ));
    const legacy = new DatabaseSync(path);
    legacy.exec(legacyAnalyticsSchema);
    legacy.prepare(`
      INSERT INTO analytics_reports (issuer_id, report_id, request_id, app_id, name, category)
      VALUES (?, ?, ?, ?, 'App Store Commerce', 'COMMERCE')
    `).run(commerce.issuerId, commerce.reportId, commerce.reportRequestId, commerce.appId);
    legacy.prepare(`
      INSERT INTO analytics_partitions (
        issuer_id, report_id, app_id, granularity, date, processing_date,
        source, instance_id, promoted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      commerce.issuerId,
      commerce.reportId,
      commerce.appId,
      commerce.granularity,
      legacyObservation.date,
      "2026-08-21",
      "ONGOING",
      "legacy-demo-instance",
      "2026-08-21T10:00:00.000Z",
    );
    legacy.prepare(`
      INSERT INTO analytics_facts (
        issuer_id, report_id, app_id, granularity, date, metric, dimensions_key,
        dimensions_json, value, unit, unavailable_reason, availability, currency,
        evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'AVAILABLE', ?, ?, ?, ?, ?, 'ONGOING', ?)
    `).run(
      commerce.issuerId,
      commerce.reportId,
      commerce.appId,
      commerce.granularity,
      legacyObservation.date,
      legacyObservation.metric,
      dimensionsJson,
      dimensionsJson,
      legacyObservation.value,
      legacyObservation.metric === "PROCEEDS" ? "CURRENCY_USD" : "COUNT",
      legacyObservation.currency,
      "legacy-demo-evidence",
      "legacy-demo-snapshot",
      commerce.reportRequestId,
      "2026-08-21",
      "legacy-demo-instance",
    );
    legacy.close();

    const store = new SqliteAnalyticsStore(path);
    for (const batch of batches) await expect(store.replaceAnalyticsFactBatch(batch)).resolves.toBeDefined();
    for (const batch of batches) {
      await expect(store.replaceAnalyticsFactBatch(batch))
        .resolves.toEqual({ observationCount: 0, replaced: false });
    }
    expect(store.listFacts({
      issuerId: commerce.issuerId,
      appIds: [commerce.appId],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    }).some((fact) => fact.evidenceId === "legacy-demo-evidence")).toBe(true);
    store.close();
  });

  it("requires every declared segment before atomically promoting an instance", async () => {
    const store = await createStore();
    store.beginInstance(instance());
    store.stageSegment({
      issuerId: "issuer-a",
      instanceId: "instance-snapshot",
      segmentId: "segment-1",
      checksum: "sha256:first",
      observations: [observation()],
      fetchedAt: "2026-08-20T10:05:00.000Z",
    });

    expect(() => store.promoteInstance("issuer-a", "instance-snapshot", "2026-08-20T10:06:00.000Z"))
      .toThrow("every segment must finish before promotion");
    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toEqual([]);

    store.stageSegment({
      issuerId: "issuer-a",
      instanceId: "instance-snapshot",
      segmentId: "segment-2",
      checksum: "sha256:second",
      observations: [observation({ dimensions: { territory: "MEX" }, value: 34 })],
      fetchedAt: "2026-08-20T10:05:30.000Z",
    });
    expect(store.promoteInstance("issuer-a", "instance-snapshot", "2026-08-20T10:06:00.000Z"))
      .toEqual({ promotedPartitions: 1, ignoredPartitions: 0, observationCount: 2 });
    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toMatchObject([
      { value: 34, dimensions: { territory: "MEX" } },
      { value: 120, dimensions: { territory: "USA" } },
    ]);
    store.close();
  });

  it("replaces a date partition only with fresher processing, preferring ongoing data on a tie", async () => {
    const store = await createStore();
    const ingest = (
      id: string,
      processingDate: string,
      source: "ONGOING" | "ONE_TIME_SNAPSHOT",
      value: number,
    ) => {
      const next = instance({
        id,
        processingDate,
        source,
        segmentIds: [`segment-${id}`],
      });
      next.request.requestId = `request-${id}`;
      next.request.accessType = source;
      store.beginInstance(next);
      store.stageSegment({
        issuerId: "issuer-a",
        instanceId: id,
        segmentId: `segment-${id}`,
        checksum: null,
        observations: [observation({ value })],
        fetchedAt: "2026-08-22T10:00:00.000Z",
      });
      return store.promoteInstance("issuer-a", id, "2026-08-22T10:01:00.000Z");
    };

    expect(ingest("snapshot", "2026-08-20", "ONE_TIME_SNAPSHOT", 100).promotedPartitions).toBe(1);
    expect(ingest("older", "2026-08-19", "ONGOING", 70).ignoredPartitions).toBe(1);
    expect(ingest("ongoing-tie", "2026-08-20", "ONGOING", 130).promotedPartitions).toBe(1);
    expect(ingest("snapshot-tie", "2026-08-20", "ONE_TIME_SNAPSHOT", 90).ignoredPartitions).toBe(1);
    expect(ingest("newer", "2026-08-21", "ONE_TIME_SNAPSHOT", 145).promotedPartitions).toBe(1);

    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toMatchObject([{ value: 145, processingDate: "2026-08-21", source: "ONE_TIME_SNAPSHOT" }]);
    store.close();
  });

  it("keeps privacy-limited values explicit and never leaks facts across issuers", async () => {
    const store = await createStore();
    const ingestForIssuer = (issuerId: string, id: string, value: number | null) => {
      const next = instance({ id, segmentIds: [`segment-${id}`] });
      next.issuerId = issuerId;
      next.request.requestId = `request-${id}`;
      store.beginInstance(next);
      store.stageSegment({
        issuerId,
        instanceId: id,
        segmentId: `segment-${id}`,
        checksum: null,
        observations: [observation({
          value,
          unavailableReason: value === null ? "PRIVACY_THRESHOLD" : null,
        })],
        fetchedAt: "2026-08-20T10:05:00.000Z",
      });
      store.promoteInstance(issuerId, id, "2026-08-20T10:06:00.000Z");
    };
    ingestForIssuer("issuer-a", "privacy-a", null);
    ingestForIssuer("issuer-b", "private-b", 999);

    expect(store.listFacts({
      issuerId: "issuer-a",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toMatchObject([{ value: null, unavailableReason: "PRIVACY_THRESHOLD" }]);
    expect(store.listFacts({
      issuerId: "issuer-c",
      appIds: ["app-orbit"],
      startDate: "2026-08-18",
      endDate: "2026-08-18",
    })).toEqual([]);
    store.close();
  });

  it("rehydrates withheld values as null and preserves a real reported zero", async () => {
    const store = await createStore();
    const original = demoAnalyticsFactBatches(["demo-app-field-log"])
      .find((batch) => batch.reportName === "App Sessions Standard")!;
    const withheld = original.observations.find((item) => item.availability === "PRIVACY_WITHHELD")!;
    const reported = original.observations.find((item) => (
      item.date === withheld.date && item.availability === "AVAILABLE"
    ))!;
    const observations = [withheld, { ...reported, value: 0 }];
    await store.replaceAnalyticsFactBatch({
      ...original,
      partitionDates: [...new Set(observations.map((item) => item.date))].sort(),
      observations,
      segments: original.segments.map((segment) => ({ ...segment, rowCount: observations.length })),
    });

    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-field-log"],
      startDate: withheld.date,
      endDate: withheld.date,
    });
    expect(snapshot?.observations.find((item) => item.availability === "PRIVACY_WITHHELD")?.value).toBeNull();
    expect(snapshot?.observations.find((item) => item.availability === "AVAILABLE")?.value).toBe(0);
    store.close();
  });

  it("persists issuer-scoped sync state without confusing queued, running, and completed jobs", async () => {
    const store = await createStore();
    expect(store.createSyncRun({
      id: "sync-1",
      issuerId: "issuer-a",
      appIds: ["app-field", "app-orbit", "app-field"],
      startedAt: "2026-08-22T10:00:00.000Z",
    })).toMatchObject({ state: "QUEUED", appIds: ["app-field", "app-orbit"] });
    expect(store.markSyncRunning("issuer-a", "sync-1")).toMatchObject({ state: "RUNNING" });
    expect(store.getSyncRun("issuer-b", "sync-1")).toBeNull();
    expect(store.completeSyncRun({
      issuerId: "issuer-a",
      id: "sync-1",
      completedAt: "2026-08-22T10:01:00.000Z",
      stats: { reports: 4, partitions: 60 },
    })).toMatchObject({ state: "SUCCEEDED", stats: { reports: 4, partitions: 60 } });
    store.close();
  });

  it("uses the slowest required metric family as the portfolio freshness watermark", async () => {
    const store = await createStore();
    for (const original of demoAnalyticsFactBatches()) {
      const cutoff = original.observations.some((observation) => observation.metric === "SESSIONS")
        ? "2026-08-15"
        : "2026-08-20";
      const observations = original.observations.filter((observation) => (
        observation.date >= "2026-08-01" && observation.date <= cutoff
      ));
      const batch = {
        ...original,
        partitionDates: [...new Set(observations.map((observation) => observation.date))].sort(),
        observations,
        segments: original.segments.map((segment) => ({
          ...segment,
          rowCount: observations.length,
        })),
      };
      await store.replaceAnalyticsFactBatch(batch);
    }

    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes", "demo-app-field-log"],
      startDate: "2026-08-01",
      endDate: "2026-08-20",
    });
    expect(snapshot?.freshness).toMatchObject({
      dataThrough: "2026-08-15",
      expectedDelayDays: 5,
      partial: true,
    });
    expect(snapshot?.freshness.detail).toContain("conservative portfolio watermark");
    store.close();
  });

  it("applies the documented per-report correction windows at exact date boundaries", async () => {
    const store = await createStore();
    for (const original of demoAnalyticsFactBatches(["demo-app-orbit-notes"])) {
      const observations = original.observations.filter((item) => item.date >= "2026-08-17" && item.date <= "2026-08-20");
      await store.replaceAnalyticsFactBatch({
        ...original,
        partitionDates: [...new Set(observations.map((item) => item.date))].sort(),
        observations,
        segments: original.segments.map((segment) => ({ ...segment, rowCount: observations.length })),
      });
    }
    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes"],
      startDate: "2026-08-17",
      endDate: "2026-08-20",
    });
    const coverage = new Map(snapshot?.metricCoverage?.map((item) => [item.metric, item]));
    expect(coverage.get("IMPRESSIONS")).toMatchObject({ completeThrough: "2026-08-19", expectedDelayDays: 3, availability: "PARTIAL" });
    expect(coverage.get("PRODUCT_PAGE_VIEWS")).toMatchObject({ completeThrough: "2026-08-19", expectedDelayDays: 3, availability: "PARTIAL" });
    expect(coverage.get("DOWNLOADS")).toMatchObject({ completeThrough: "2026-08-20", expectedDelayDays: 2, availability: "AVAILABLE" });
    expect(coverage.get("FIRST_TIME_DOWNLOADS")).toMatchObject({ completeThrough: "2026-08-20", expectedDelayDays: 2, availability: "AVAILABLE" });
    expect(coverage.get("PROCEEDS")).toMatchObject({ completeThrough: "2026-08-20", expectedDelayDays: 2, availability: "AVAILABLE" });
    expect(coverage.get("SESSIONS")).toMatchObject({ completeThrough: "2026-08-17", expectedDelayDays: 5, availability: "PARTIAL" });
    expect(snapshot?.freshness).toMatchObject({ dataThrough: "2026-08-17", expectedDelayDays: 5, partial: true });
    store.close();
  });

  it("does not call a trailing five-day slice complete for a thirty-day selection", async () => {
    const store = await createStore();
    for (const original of demoAnalyticsFactBatches(["demo-app-orbit-notes"])) {
      const observations = original.observations.filter((item) => item.date >= "2026-08-16");
      await store.replaceAnalyticsFactBatch({
        ...original,
        partitionDates: [...new Set(observations.map((item) => item.date))].sort(),
        observations,
        segments: original.segments.map((segment) => ({ ...segment, rowCount: observations.length })),
      });
    }

    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes"],
      startDate: "2026-07-22",
      endDate: "2026-08-20",
    });
    const downloads = snapshot?.observations.filter((item) => item.metric === "DOWNLOADS") ?? [];
    expect(downloads.length).toBeGreaterThan(0);
    expect(downloads.reduce((sum, item) => sum + (item.value ?? 0), 0)).toBeGreaterThan(0);
    expect(snapshot?.metricCoverage?.find((item) => item.metric === "DOWNLOADS")).toMatchObject({
      completeThrough: null,
      availability: "PARTIAL",
    });
    expect(snapshot?.freshness).toMatchObject({ dataThrough: null, partial: true });
    expect(snapshot?.freshness.detail).toContain("not continuous from the selected period start");
    store.close();
  });

  it("stores same-version session rows with distinct dimensions without a fact-key collision", async () => {
    const store = await createStore();
    const original = demoAnalyticsFactBatches(["demo-app-orbit-notes"])
      .find((batch) => batch.reportName === "App Sessions Standard")!;
    const base = original.observations.find((item) => item.availability === "AVAILABLE")!;
    const observations = [
      {
        ...base,
        value: 7,
        dimensions: {
          ...base.dimensions,
          version: "2.5.0",
          device: "iPhone",
          platformVersion: "iOS 19.0",
          source: "App Store Search",
          campaign: "launch-us",
          productPage: "Product Page",
          appDownloadDate: "2026-08-12",
          territory: "USA",
        },
      },
      {
        ...base,
        value: 5,
        evidenceId: `${base.evidenceId}:gb`,
        dimensions: {
          ...base.dimensions,
          version: "2.5.0",
          device: "iPad",
          platformVersion: "iOS 19.0",
          source: "App Store Search",
          campaign: "launch-gb",
          productPage: "Product Page",
          appDownloadDate: "2026-08-12",
          territory: "GBR",
        },
      },
    ];
    await expect(store.replaceAnalyticsFactBatch({
      ...original,
      partitionDates: [...new Set(observations.map((item) => item.date))].sort(),
      observations,
      segments: original.segments.map((segment) => ({ ...segment, rowCount: observations.length })),
    })).resolves.toMatchObject({ observationCount: 2 });

    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes"],
      startDate: base.date,
      endDate: base.date,
    });
    expect(snapshot?.observations).toHaveLength(2);
    expect(snapshot?.observations.reduce((sum, item) => sum + (item.value ?? 0), 0)).toBe(12);
    store.close();
  });

  it("applies dimension filters conjunctively while keeping unfiltered sorted facets", async () => {
    const store = await createStore();
    for (const batch of demoAnalyticsFactBatches(["demo-app-orbit-notes"])) {
      const observations = batch.observations.filter((observation) => (
        observation.date >= "2026-08-18" && observation.date <= "2026-08-20"
      ));
      await store.replaceAnalyticsFactBatch({
        ...batch,
        partitionDates: [...new Set(observations.map((observation) => observation.date))].sort(),
        observations,
      });
    }

    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes"],
      startDate: "2026-08-18",
      endDate: "2026-08-20",
      filters: {
        territories: ["USA"],
        sources: ["App Store Search"],
        productPages: ["Product Page"],
        versions: ["2.5.0"],
      },
    });
    expect(snapshot?.observations.length).toBeGreaterThan(0);
    expect(snapshot?.observations.every((item) => (
      item.dimensions.territory === "USA"
      && item.dimensions.source === "App Store Search"
      && item.dimensions.productPage === "Product Page"
      && item.dimensions.version === "2.5.0"
    ))).toBe(true);
    expect(snapshot?.facets).toMatchObject({
      territories: ["GBR", "JPN", "MEX", "USA"],
      sources: ["App Referral", "App Store Browse", "App Store Search", "Web Referral"],
      productPages: ["In-App Event", "No Page", "Product Page", "Store Sheet"],
    });

    const noMatch = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes"],
      startDate: "2026-08-18",
      endDate: "2026-08-20",
      filters: { territories: ["CAN"], sources: [], productPages: [], versions: [] },
    });
    expect(noMatch?.observations).toEqual([]);
    expect(noMatch?.facets?.territories).toContain("USA");
    expect(noMatch?.metricCoverage?.find((coverage) => coverage.metric === "DOWNLOADS")?.availability).toBe("UNAVAILABLE");
    store.close();
  });

  it("rebuilds deterministic demo analytics without deleting another issuer", async () => {
    const store = await createStore();
    const demoBatch = demoAnalyticsFactBatches(["demo-app-orbit-notes"])[0]!;
    await store.replaceAnalyticsFactBatch(demoBatch);
    await store.replaceAnalyticsFactBatch({
      ...demoBatch,
      issuerId: "another-issuer",
      reportRequestId: `other-${demoBatch.reportRequestId}`,
      reportId: `other-${demoBatch.reportId}`,
      instanceId: `other-${demoBatch.instanceId}`,
      snapshotId: `other-${demoBatch.snapshotId}`,
      evidenceId: `other-${demoBatch.evidenceId}`,
    });
    expect(store.getDemoAnalyticsFixtureVersion("demo-issuer")).toBeNull();
    store.setDemoAnalyticsFixtureVersion("demo-issuer", "fixture-v1");
    expect(store.getDemoAnalyticsFixtureVersion("demo-issuer")).toBe("fixture-v1");

    store.clearAnalyticsIssuer("demo-issuer");

    expect(store.getDemoAnalyticsFixtureVersion("demo-issuer")).toBeNull();
    const query = {
      appIds: ["demo-app-orbit-notes"],
      startDate: "2026-05-23",
      endDate: "2026-08-20",
    };
    await expect(store.readAnalyticsSnapshot({ issuerId: "demo-issuer", ...query })).resolves.toBeNull();
    await expect(store.readAnalyticsSnapshot({ issuerId: "another-issuer", ...query }))
      .resolves.toMatchObject({ observations: expect.any(Array) });
    store.close();
  });

  it("promotes an empty newer raw partition and removes stale supported facts", async () => {
    const store = await createStore();
    const original = demoAnalyticsFactBatches(["demo-app-orbit-notes"])
      .find((batch) => batch.reportName === "App Store Downloads Standard")!;
    const date = "2026-05-23";
    await store.replaceAnalyticsFactBatch(original);
    expect(store.listFacts({
      issuerId: original.issuerId,
      appIds: [original.appId],
      startDate: date,
      endDate: date,
    }).some((fact) => fact.metric === "DOWNLOADS")).toBe(true);

    const replacementSegmentId = "ignored-download-row-segment";
    await expect(store.replaceAnalyticsFactBatch({
      ...original,
      reportId: `corrected-${original.reportId}`,
      instanceId: `corrected-${original.instanceId}`,
      processingDate: "2026-08-23",
      partitionDates: [date],
      segmentIds: [replacementSegmentId],
      segments: [{
        segmentId: replacementSegmentId,
        checksumSha256: "b".repeat(64),
        byteCount: 64,
        rowCount: 1,
      }],
      expectedSegmentCount: 1,
      verifiedSegmentCount: 1,
      observations: [],
      snapshotId: "corrected-empty-download-snapshot",
      evidenceId: "corrected-empty-download-evidence",
    })).resolves.toEqual({ observationCount: 0, replaced: true });

    expect(store.listFacts({
      issuerId: original.issuerId,
      appIds: [original.appId],
      startDate: date,
      endDate: date,
    }).filter((fact) => fact.reportName === original.reportName)).toEqual([]);
    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: original.issuerId,
      appIds: [original.appId],
      startDate: date,
      endDate: date,
    });
    expect(snapshot?.observations).toEqual([]);
    expect(snapshot?.metricCoverage?.find((coverage) => coverage.metric === "DOWNLOADS")).toMatchObject({
      availability: "UNAVAILABLE",
      completeThrough: date,
    });
    expect(snapshot?.metricCoverage?.find((coverage) => coverage.metric === "DOWNLOADS")?.detail)
      .toContain("source coverage exists");
    store.close();
  });

  it("deduplicates snapshot and ongoing requests by logical report identity", async () => {
    const store = await createStore();
    const original = demoAnalyticsFactBatches(["demo-app-orbit-notes"])
      .find((batch) => batch.reportName === "App Store Downloads Standard")!;
    const originalObservation = original.observations.find((observation) => (
      observation.date === "2026-08-20"
      && observation.metric === "DOWNLOADS"
      && observation.dimensions.territory === "USA"
    ))!;
    const makeBatch = (
      suffix: string,
      accessType: "ONE_TIME_SNAPSHOT" | "ONGOING",
      value: number,
    ) => ({
      ...original,
      accessType,
      reportRequestId: `request-${suffix}`,
      reportId: `request-specific-report-${suffix}`,
      instanceId: `instance-${suffix}`,
      segmentIds: [`segment-${suffix}`],
      segments: [{
        segmentId: `segment-${suffix}`,
        checksumSha256: suffix.repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, "a"),
        byteCount: 100,
        rowCount: 1,
      }],
      expectedSegmentCount: 1,
      verifiedSegmentCount: 1,
      partitionDates: [originalObservation.date],
      observations: [{ ...originalObservation, value }],
      snapshotId: `snapshot-${suffix}`,
      evidenceId: `evidence-${suffix}`,
    });

    await store.replaceAnalyticsFactBatch(makeBatch("a", "ONE_TIME_SNAPSHOT", 100));
    await store.replaceAnalyticsFactBatch(makeBatch("b", "ONGOING", 140));
    await expect(store.replaceAnalyticsFactBatch(makeBatch("c", "ONE_TIME_SNAPSHOT", 80)))
      .resolves.toEqual({ observationCount: 0, replaced: false });

    const snapshot = await store.readAnalyticsSnapshot({
      issuerId: "demo-issuer",
      appIds: ["demo-app-orbit-notes"],
      startDate: "2026-08-20",
      endDate: "2026-08-20",
    });
    const downloads = snapshot?.observations.filter((observation) => observation.metric === "DOWNLOADS") ?? [];
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.value).toBe(140);
    store.close();
  });
});
