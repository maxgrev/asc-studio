import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  ANALYTICS_METRIC_COMPLETENESS_DAYS,
  AnalyticsFactBatchSchema,
  AnalyticsSyncResponseSchema,
  type AnalyticsAdditiveMetricId,
  type AnalyticsFilters,
  type AnalyticsMetricCoverage,
  type AnalyticsFactBatch,
  type AnalyticsObservation,
  type AnalyticsObservationQuery,
  type AnalyticsSyncResponse,
} from "@asc-studio/contracts";
import type { AnalyticsStore, AnalyticsStoredSnapshot } from "@asc-studio/core";

export type AnalyticsReportAccessType = "ONGOING" | "ONE_TIME_SNAPSHOT";
export type AnalyticsSyncRunState = "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface AnalyticsReportRequestRecord {
  issuerId: string;
  appId: string;
  requestId: string;
  accessType: AnalyticsReportAccessType;
  createdAt: string;
}

export interface AnalyticsObservationInput {
  appId: string;
  date: string;
  metric: string;
  value: number | null;
  unit: string;
  dimensions: Record<string, string>;
  unavailableReason: string | null;
  availability?: AnalyticsObservation["availability"] | undefined;
  currency?: AnalyticsObservation["currency"] | undefined;
  evidenceId?: string | undefined;
  snapshotId?: string | undefined;
  reportRequestId?: string | undefined;
}

export interface AnalyticsInstanceInput {
  issuerId: string;
  request: Omit<AnalyticsReportRequestRecord, "issuerId">;
  report: {
    id: string;
    name: string;
    category: string;
  };
  instance: {
    id: string;
    granularity: string;
    processingDate: string;
    source: AnalyticsReportAccessType;
    partitionDates: string[];
    segmentIds: string[];
  };
}

export interface AnalyticsSegmentInput {
  issuerId: string;
  instanceId: string;
  segmentId: string;
  checksum: string | null;
  observations: AnalyticsObservationInput[];
  fetchedAt: string;
}

export interface AnalyticsPromotionResult {
  promotedPartitions: number;
  ignoredPartitions: number;
  observationCount: number;
}

export interface AnalyticsFactRecord extends AnalyticsObservationInput {
  issuerId: string;
  reportId: string;
  reportName: string;
  category: string;
  granularity: string;
  processingDate: string;
  source: AnalyticsReportAccessType;
}

export interface AnalyticsSyncRunRecord {
  id: string;
  issuerId: string;
  appIds: string[];
  state: AnalyticsSyncRunState;
  startedAt: string;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  stats: Record<string, number>;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const isTimestamp = (value: string) => !Number.isNaN(Date.parse(value));

const stableObject = (value: Record<string, string>) => Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
);

const matchesAnalyticsFilters = (dimensions: Record<string, string>, filters: AnalyticsFilters) => (
  (filters.territories.length === 0 || filters.territories.includes(dimensions.territory ?? ""))
  && (filters.sources.length === 0 || filters.sources.includes(dimensions.source ?? ""))
  && (filters.productPages.length === 0 || filters.productPages.includes(dimensions.productPage ?? ""))
  && (filters.versions.length === 0 || filters.versions.includes(dimensions.version ?? ""))
);

const analyticsMetricReports: Record<AnalyticsAdditiveMetricId, string[]> = {
  IMPRESSIONS: ["App Store Discovery and Engagement Standard"],
  DOWNLOADS: ["App Store Downloads Standard"],
  FIRST_TIME_DOWNLOADS: ["App Store Downloads Standard"],
  PRODUCT_PAGE_VIEWS: ["App Store Discovery and Engagement Standard"],
  SESSIONS: ["App Sessions Standard"],
  PROCEEDS: ["App Store Purchases Standard"],
};

const additiveAnalyticsMetrics = Object.keys(analyticsMetricReports) as AnalyticsAdditiveMetricId[];

interface AnalyticsPartitionCoverageRecord {
  appId: string;
  reportName: string;
  reportRequestId: string;
  date: string;
  processingDate: string;
}

const addAnalyticsDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const completeThroughForPartitions = (
  partitions: AnalyticsPartitionCoverageRecord[],
  metric: AnalyticsAdditiveMetricId,
  startDate: string,
  endDate: string,
) => {
  const eligible = new Set(partitions
    .filter((partition) => (
      partition.date >= startDate
      && partition.date <= endDate
      && partition.date <= addAnalyticsDays(partition.processingDate, -ANALYTICS_METRIC_COMPLETENESS_DAYS[metric])
    ))
    .map((partition) => partition.date));
  let cursor = startDate;
  let completeThrough: string | null = null;
  while (cursor <= endDate && eligible.has(cursor)) {
    completeThrough = cursor;
    cursor = addAnalyticsDays(cursor, 1);
  }
  return completeThrough;
};

const stableJson = (value: Record<string, string>) => JSON.stringify(stableObject(value));
const logicalReportKey = (name: string, category: string) => createHash("sha256")
  .update(JSON.stringify({ category, name }))
  .digest("hex");

const requireNonEmpty = (label: string, value: string) => {
  if (!value.trim()) throw new TypeError(`${label} must not be empty.`);
};

const parseJsonObject = (value: unknown, label: string): Record<string, string> => {
  if (typeof value !== "string") throw new TypeError(`${label} is not JSON text.`);
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError(`${label} is not a JSON object.`);
  }
  return Object.fromEntries(Object.entries(parsed).map(([key, entry]) => {
    if (typeof entry !== "string") throw new TypeError(`${label} contains a non-string value.`);
    return [key, entry];
  }));
};

const parseStringArray = (value: unknown, label: string): string[] => {
  if (typeof value !== "string") throw new TypeError(`${label} is not JSON text.`);
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${label} is not a string array.`);
  }
  return parsed;
};

const sourcePriority = (source: AnalyticsReportAccessType) => source === "ONGOING" ? 1 : 0;

export class SqliteAnalyticsStore implements AnalyticsStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS analytics_report_requests (
        issuer_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        access_type TEXT NOT NULL CHECK (access_type IN ('ONGOING', 'ONE_TIME_SNAPSHOT')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (issuer_id, request_id)
      );

      CREATE TABLE IF NOT EXISTS analytics_reports (
        issuer_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        PRIMARY KEY (issuer_id, report_id)
      );

      CREATE TABLE IF NOT EXISTS analytics_instances (
        issuer_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        app_id TEXT NOT NULL,
        granularity TEXT NOT NULL,
        processing_date TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ONGOING', 'ONE_TIME_SNAPSHOT')),
        partition_dates_json TEXT NOT NULL,
        segment_ids_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('STAGING', 'PROMOTED')),
        PRIMARY KEY (issuer_id, instance_id)
      );

      CREATE TABLE IF NOT EXISTS analytics_segments (
        issuer_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        checksum TEXT,
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'COMPLETE')),
        byte_count INTEGER NOT NULL DEFAULT 0,
        row_count INTEGER NOT NULL DEFAULT 0,
        fetched_at TEXT,
        PRIMARY KEY (issuer_id, instance_id, segment_id)
      );

      CREATE TABLE IF NOT EXISTS analytics_staged_facts (
        issuer_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        row_index INTEGER NOT NULL,
        fact_json TEXT NOT NULL,
        PRIMARY KEY (issuer_id, instance_id, segment_id, row_index)
      );

      CREATE TABLE IF NOT EXISTS analytics_partitions (
        issuer_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        logical_report_key TEXT NOT NULL,
        app_id TEXT NOT NULL,
        granularity TEXT NOT NULL,
        date TEXT NOT NULL,
        processing_date TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ONGOING', 'ONE_TIME_SNAPSHOT')),
        instance_id TEXT NOT NULL,
        promoted_at TEXT NOT NULL,
        PRIMARY KEY (issuer_id, logical_report_key, app_id, granularity, date)
      );

      CREATE TABLE IF NOT EXISTS analytics_facts (
        issuer_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        logical_report_key TEXT NOT NULL,
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
        PRIMARY KEY (issuer_id, logical_report_key, app_id, granularity, date, metric, dimensions_key)
      );

      CREATE TABLE IF NOT EXISTS analytics_sync_runs (
        id TEXT PRIMARY KEY,
        issuer_id TEXT NOT NULL,
        app_ids_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        error_message TEXT,
        stats_json TEXT NOT NULL,
        response_json TEXT
      );

      CREATE TABLE IF NOT EXISTS analytics_demo_state (
        issuer_id TEXT PRIMARY KEY,
        fixture_version TEXT NOT NULL
      );

    `);
    this.migrateLogicalReportSchema();
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS analytics_facts_query
        ON analytics_facts (issuer_id, app_id, date, metric);
      CREATE INDEX IF NOT EXISTS analytics_partitions_freshness
        ON analytics_partitions (issuer_id, date, processing_date);
      CREATE INDEX IF NOT EXISTS analytics_sync_runs_latest
        ON analytics_sync_runs (issuer_id, started_at DESC);
    `);
  }

  async replaceAnalyticsFactBatch(unparsedBatch: AnalyticsFactBatch) {
    const batch = AnalyticsFactBatchSchema.parse(unparsedBatch);
    if (batch.observations.some((observation) => (
      observation.appId !== batch.appId
      || observation.reportName !== batch.reportName
      || observation.date > batch.processingDate
    ))) {
      throw new TypeError("Analytics observations must match their complete report batch.");
    }
    const partitionDates = [...batch.partitionDates].sort();
    const reportKey = logicalReportKey(batch.reportName, batch.category);
    const storedAt = new Date().toISOString();
    let replaced = false;
    let observationCount = 0;
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO analytics_report_requests (issuer_id, request_id, app_id, access_type, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (issuer_id, request_id) DO UPDATE SET
          app_id = excluded.app_id,
          access_type = excluded.access_type
      `).run(
        batch.issuerId,
        batch.reportRequestId,
        batch.appId,
        batch.accessType,
        `${batch.processingDate}T00:00:00.000Z`,
      );
      this.database.prepare(`
        INSERT INTO analytics_reports (issuer_id, report_id, request_id, app_id, name, category)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (issuer_id, report_id) DO UPDATE SET
          request_id = excluded.request_id,
          app_id = excluded.app_id,
          name = excluded.name,
          category = excluded.category
      `).run(
        batch.issuerId,
        batch.reportId,
        batch.reportRequestId,
        batch.appId,
        batch.reportName,
        batch.category,
      );
      this.database.prepare(`
        INSERT INTO analytics_instances (
          issuer_id, instance_id, report_id, app_id, granularity, processing_date,
          source, partition_dates_json, segment_ids_json, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROMOTED')
        ON CONFLICT (issuer_id, instance_id) DO UPDATE SET
          report_id = excluded.report_id,
          app_id = excluded.app_id,
          granularity = excluded.granularity,
          processing_date = excluded.processing_date,
          source = excluded.source,
          partition_dates_json = excluded.partition_dates_json,
          segment_ids_json = excluded.segment_ids_json,
          state = 'PROMOTED'
      `).run(
        batch.issuerId,
        batch.instanceId,
        batch.reportId,
        batch.appId,
        batch.granularity,
        batch.processingDate,
        batch.accessType,
        JSON.stringify(partitionDates),
        JSON.stringify([...batch.segmentIds].sort()),
      );
      const upsertSegment = this.database.prepare(`
        INSERT INTO analytics_segments (
          issuer_id, instance_id, segment_id, checksum, state, byte_count, row_count, fetched_at
        ) VALUES (?, ?, ?, ?, 'COMPLETE', ?, ?, ?)
        ON CONFLICT (issuer_id, instance_id, segment_id) DO UPDATE SET
          checksum = excluded.checksum,
          state = 'COMPLETE',
          byte_count = excluded.byte_count,
          row_count = excluded.row_count,
          fetched_at = excluded.fetched_at
      `);
      for (const segment of batch.segments) {
        upsertSegment.run(
          batch.issuerId,
          batch.instanceId,
          segment.segmentId,
          segment.checksumSha256,
          segment.byteCount,
          segment.rowCount,
          storedAt,
        );
      }

      const currentPartition = this.database.prepare(`
        SELECT processing_date, source
        FROM analytics_partitions
        WHERE issuer_id = ? AND logical_report_key = ? AND app_id = ? AND granularity = ? AND date = ?
      `);
      const deleteFacts = this.database.prepare(`
        DELETE FROM analytics_facts
        WHERE issuer_id = ? AND logical_report_key = ? AND app_id = ? AND granularity = ? AND date = ?
      `);
      const upsertPartition = this.database.prepare(`
        INSERT INTO analytics_partitions (
          issuer_id, report_id, logical_report_key, app_id, granularity, date,
          processing_date, source, instance_id, promoted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (issuer_id, logical_report_key, app_id, granularity, date) DO UPDATE SET
          report_id = excluded.report_id,
          processing_date = excluded.processing_date,
          source = excluded.source,
          instance_id = excluded.instance_id,
          promoted_at = excluded.promoted_at
      `);
      const insertFact = this.database.prepare(`
        INSERT INTO analytics_facts (
          issuer_id, report_id, logical_report_key, app_id, granularity, date, metric, dimensions_key,
          dimensions_json, value, unit, unavailable_reason, availability, currency,
          evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const date of partitionDates) {
        const current = currentPartition.get(
          batch.issuerId,
          reportKey,
          batch.appId,
          batch.granularity,
          date,
        ) as Record<string, unknown> | undefined;
        const shouldReplace = !current
          || batch.processingDate > String(current.processing_date)
          || batch.processingDate === String(current.processing_date)
            && sourcePriority(batch.accessType) > sourcePriority(String(current.source) as AnalyticsReportAccessType);
        if (!shouldReplace) continue;
        replaced = true;
        deleteFacts.run(batch.issuerId, reportKey, batch.appId, batch.granularity, date);
        upsertPartition.run(
          batch.issuerId,
          batch.reportId,
          reportKey,
          batch.appId,
          batch.granularity,
          date,
          batch.processingDate,
          batch.accessType,
          batch.instanceId,
          storedAt,
        );
        for (const observation of batch.observations.filter((candidate) => candidate.date === date)) {
          const dimensionsJson = stableJson(observation.dimensions);
          const available = observation.availability === "AVAILABLE" || observation.availability === "PARTIAL";
          insertFact.run(
            batch.issuerId,
            batch.reportId,
            reportKey,
            batch.appId,
            batch.granularity,
            observation.date,
            observation.metric,
            dimensionsJson,
            dimensionsJson,
            available ? observation.value : null,
            observation.metric === "PROCEEDS" ? "CURRENCY_USD" : "COUNT",
            observation.availability === "PRIVACY_WITHHELD" ? "PRIVACY_THRESHOLD"
              : observation.availability === "UNAVAILABLE" ? "NOT_REPORTED"
                : null,
            observation.availability,
            observation.currency,
            observation.evidenceId,
            batch.snapshotId,
            batch.reportRequestId,
            batch.processingDate,
            batch.accessType,
            batch.instanceId,
          );
          observationCount += 1;
        }
      }
    });
    return { observationCount, replaced };
  }

  async readAnalyticsSnapshot(query: AnalyticsObservationQuery): Promise<AnalyticsStoredSnapshot | null> {
    const allFacts = this.listFacts({
      issuerId: query.issuerId,
      appIds: query.appIds,
      startDate: query.startDate,
      endDate: query.endDate,
    });
    // The store read can span both the requested and comparison periods. Source
    // continuity must cover that entire read, while selected-value availability
    // and facets remain scoped to the requested (facet) period.
    const coverageStartDate = query.startDate;
    const selectionStartDate = query.facetStartDate ?? query.startDate;
    const partitionRows = this.database.prepare(`
      SELECT partitions.app_id, reports.name AS report_name, reports.request_id AS report_request_id,
             partitions.date, partitions.processing_date
      FROM analytics_partitions AS partitions
      JOIN analytics_reports AS reports
        ON reports.issuer_id = partitions.issuer_id
       AND reports.report_id = partitions.report_id
      WHERE partitions.issuer_id = ?
        AND partitions.app_id IN (${query.appIds.map(() => "?").join(", ")})
        AND partitions.date >= ? AND partitions.date <= ?
      ORDER BY partitions.app_id, reports.name, partitions.date
    `).all(query.issuerId, ...query.appIds, coverageStartDate, query.endDate)
      .map((row): AnalyticsPartitionCoverageRecord => ({
        appId: String(row.app_id),
        reportName: String(row.report_name),
        reportRequestId: String(row.report_request_id),
        date: String(row.date),
        processingDate: String(row.processing_date),
      }));
    if (!allFacts.length && !partitionRows.length) return null;
    const filters = query.filters ?? { territories: [], sources: [], productPages: [], versions: [] };
    const facts = allFacts.filter((fact) => matchesAnalyticsFilters(fact.dimensions, filters));
    const coverageFacts = allFacts.filter((fact) => fact.date >= coverageStartDate);
    const selectedCoverageFacts = facts.filter((fact) => fact.date >= selectionStartDate);
    const syncedAtRow = this.database.prepare(`
      SELECT MAX(promoted_at) AS synced_at
      FROM analytics_partitions
      WHERE issuer_id = ? AND app_id IN (${query.appIds.map(() => "?").join(", ")})
        AND date >= ? AND date <= ?
    `).get(query.issuerId, ...query.appIds, query.startDate, query.endDate) as Record<string, unknown>;
    const observations: AnalyticsObservation[] = facts.map((fact) => ({
      date: fact.date,
      appId: fact.appId,
      metric: fact.metric as AnalyticsObservation["metric"],
      value: fact.value,
      currency: fact.currency ?? null,
      dimensions: fact.dimensions,
      reportName: fact.reportName,
      availability: fact.availability ?? (fact.value === null ? "UNAVAILABLE" : "AVAILABLE"),
      evidenceId: fact.evidenceId ?? `cache:${fact.reportId}:${fact.date}:${stableJson(fact.dimensions)}`,
    }));
    const reportNames = [...new Set([
      ...allFacts.map((fact) => fact.reportName),
      ...partitionRows.map((partition) => partition.reportName),
    ])].sort();
    const reportRequestIds = [...new Set([
      ...allFacts.flatMap((fact) => fact.reportRequestId ? [fact.reportRequestId] : []),
      ...partitionRows.map((partition) => partition.reportRequestId),
    ])].sort();
    const sourceSnapshots = [...new Set(allFacts.flatMap((fact) => fact.snapshotId ? [fact.snapshotId] : []))].sort();
    const digest = createHash("sha256")
      .update(JSON.stringify({ issuerId: query.issuerId, reportNames, reportRequestIds, sourceSnapshots }))
      .digest("hex");
    const snapshotId = `cache:${digest}`;
    const evidenceId = `cache-evidence:${digest}`;
    const coverage = query.appIds.flatMap((appId) => additiveAnalyticsMetrics.map((metric) => {
      const metricFacts = coverageFacts.filter((fact) => fact.appId === appId && fact.metric === metric);
      const metricPartitions = partitionRows.filter((partition) => (
        partition.appId === appId
        && analyticsMetricReports[metric].includes(partition.reportName)
      ));
      const dates = metricFacts.map((fact) => fact.date).sort();
      return {
        appId,
        metric,
        latestDate: dates.at(-1) ?? null,
        completeThrough: completeThroughForPartitions(
          metricPartitions,
          metric,
          coverageStartDate,
          query.endDate,
        ),
      };
    }));
    const presentDataThrough = coverage.flatMap((item) => item.completeThrough ? [item.completeThrough] : []).sort();
    const dataThrough = presentDataThrough.length === coverage.length ? presentDataThrough[0] ?? null : null;
    const missingCoverage = coverage.filter(({ latestDate }) => latestDate === null);
    const missingMetrics = [...new Set(missingCoverage.map(({ metric }) => metric))];
    const incomplete = facts.some((fact) => (
      fact.availability !== undefined && fact.availability !== "AVAILABLE"
    ));
    const partial = incomplete || missingCoverage.length > 0 || dataThrough === null || dataThrough < query.endDate;
    const freshnessIssues = [
      ...(missingCoverage.length > 0
        ? [`${missingMetrics.join(", ")} is absent for ${missingCoverage.length} app/metric selection${missingCoverage.length === 1 ? "" : "s"} in this period`]
        : []),
      ...(dataThrough !== null && dataThrough < query.endDate
        ? [`the conservative portfolio watermark is ${dataThrough} because every required metric family must arrive before it advances`]
        : []),
      ...(coverage.some((item) => item.latestDate !== null && item.completeThrough === null)
        ? ["source partitions are not continuous from the selected period start or are still inside their documented correction window"]
        : []),
      ...(incomplete ? ["some rows are partial or privacy-limited"] : []),
    ];
    const metricCoverage: AnalyticsMetricCoverage[] = additiveAnalyticsMetrics.map((metric) => {
      const expectedDelayDays = ANALYTICS_METRIC_COMPLETENESS_DAYS[metric];
      const selectedFacts = selectedCoverageFacts.filter((fact) => fact.metric === metric);
      const selectedAvailable = selectedFacts.filter((fact) => fact.availability === "AVAILABLE" || fact.availability === "PARTIAL");
      const selectedAppFactGap = selectedAvailable.length > 0 && query.appIds.some((appId) => (
        !selectedFacts.some((fact) => fact.appId === appId)
      ));
      const appDates = query.appIds.map((appId) => completeThroughForPartitions(
        partitionRows.filter((partition) => (
          partition.appId === appId
          && analyticsMetricReports[metric].includes(partition.reportName)
        )),
        metric,
        coverageStartDate,
        query.endDate,
      ));
      const completeThrough = appDates.every((date): date is string => date !== null) ? [...appDates].sort()[0]! : null;
      const availability = selectedAvailable.length === 0
        ? selectedFacts.some((fact) => fact.availability === "PRIVACY_WITHHELD") ? "PRIVACY_WITHHELD" as const : "UNAVAILABLE" as const
        : selectedAvailable.length !== selectedFacts.length
          || selectedAvailable.some((fact) => fact.availability === "PARTIAL")
          || selectedAppFactGap
          || completeThrough === null
          || completeThrough < query.endDate
          ? "PARTIAL" as const
          : "AVAILABLE" as const;
      const reportFamilies = analyticsMetricReports[metric].map((reportName) => {
        const familyPartitions = partitionRows.filter((partition) => partition.reportName === reportName);
        const familyDates = query.appIds.map((appId) => completeThroughForPartitions(
          familyPartitions.filter((partition) => partition.appId === appId),
          metric,
          coverageStartDate,
          query.endDate,
        ));
        const familyCompleteThrough = familyDates.every((date): date is string => date !== null)
          ? [...familyDates].sort()[0]!
          : null;
        const familyAvailability = familyPartitions.length === 0
          ? "UNAVAILABLE" as const
          : familyCompleteThrough === query.endDate
            ? "AVAILABLE" as const
            : "PARTIAL" as const;
        return {
          reportName,
          expectedDelayDays,
          completeThrough: familyCompleteThrough,
          availability: familyAvailability,
          detail: familyCompleteThrough
            ? `${reportName} is ${familyAvailability === "AVAILABLE" ? "complete" : "partially available"} through ${familyCompleteThrough}.`
            : familyPartitions.length > 0
              ? `${reportName} does not have continuous settled partitions from ${coverageStartDate} for every selected app.`
              : `${reportName} is not stored for every selected app in this period.`,
        };
      });
      return {
        metric,
        source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
        formula: metric === "DOWNLOADS" ? "First-time downloads + redownloads"
          : metric === "PROCEEDS" ? "Sum of USD-normalized proceeds"
            : null,
        expectedDelayDays,
        completeThrough,
        availability,
        detail: availability === "UNAVAILABLE" && completeThrough
          ? `No reported ${metric.replaceAll("_", " ").toLocaleLowerCase("en-US")} values match these filters; source coverage exists through ${completeThrough}.`
          : availability === "PARTIAL" && selectedAppFactGap
            ? `${metric.replaceAll("_", " ").toLocaleLowerCase("en-US")} has a numeric subtotal, but at least one selected app has no matching reported facts; source coverage is complete through ${completeThrough ?? "no continuous settled date"}.`
          : completeThrough
          ? `${metric.replaceAll("_", " ").toLocaleLowerCase("en-US")} is ${availability === "AVAILABLE" ? "complete" : "partially available"} through ${completeThrough}.`
          : `No complete ${metric.replaceAll("_", " ").toLocaleLowerCase("en-US")} coverage exists for every selected app.`,
        reportFamilies,
      };
    });
    const facetFacts = query.facetStartDate
      ? allFacts.filter((fact) => fact.date >= query.facetStartDate!)
      : allFacts;
    const facetValues = (key: string) => [...new Set(facetFacts.flatMap((fact) => fact.dimensions[key] ? [fact.dimensions[key]!] : []))]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 500);
    return {
      observations,
      freshness: {
        syncedAt: syncedAtRow.synced_at === null ? null : String(syncedAtRow.synced_at),
        dataThrough,
        expectedDelayDays: 5,
        partial,
        detail: freshnessIssues.length > 0
          ? `Coverage is partial: ${freshnessIssues.join("; ")}. Missing data is not zero.`
          : "Every required metric family has stored App Store Connect analytics facts through the stated date.",
      },
      privacy: {
        aggregatedOnly: true,
        includesOptInUsageData: reportNames.includes("App Sessions Standard"),
        mayIncludePrivacyAdjustments: incomplete,
        detail: "Usage metrics depend on customer analytics sharing and Apple privacy processing; privacy-limited and missing values are not zero.",
      },
      provenance: {
        source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
        reportNames,
        reportRequestIds,
        snapshotId,
        evidenceId,
      },
      metricCoverage,
      facets: {
        territories: facetValues("territory"),
        sources: facetValues("source"),
        productPages: facetValues("productPage"),
        versions: facetValues("version"),
      },
    };
  }

  async saveAnalyticsSyncRun(run: AnalyticsSyncResponse) {
    const parsed = AnalyticsSyncResponseSchema.parse(run);
    const stats = { batches: parsed.batchCount, observations: parsed.observationCount };
    this.database.prepare(`
      INSERT INTO analytics_sync_runs (
        id, issuer_id, app_ids_json, state, started_at, completed_at,
        error_code, error_message, stats_json, response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        issuer_id = excluded.issuer_id,
        app_ids_json = excluded.app_ids_json,
        state = excluded.state,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        stats_json = excluded.stats_json,
        response_json = excluded.response_json
    `).run(
      parsed.runId,
      parsed.issuerId,
      JSON.stringify(parsed.appIds),
      parsed.state,
      parsed.startedAt,
      parsed.completedAt,
      parsed.state === "FAILED" ? "ANALYTICS_SYNC_FAILED" : null,
      parsed.error,
      JSON.stringify(stats),
      JSON.stringify(parsed),
    );
  }

  async getAnalyticsSyncRun(runId: string): Promise<AnalyticsSyncResponse | null> {
    const row = this.database.prepare(`
      SELECT response_json FROM analytics_sync_runs WHERE id = ?
    `).get(runId) as Record<string, unknown> | undefined;
    if (!row || typeof row.response_json !== "string") return null;
    return AnalyticsSyncResponseSchema.parse(JSON.parse(row.response_json));
  }

  async getLatestSuccessfulAnalyticsSyncRun(issuerId: string): Promise<AnalyticsSyncResponse | null> {
    const row = this.database.prepare(`
      SELECT response_json
      FROM analytics_sync_runs
      WHERE issuer_id = ? AND state IN ('SUCCEEDED', 'PARTIAL') AND response_json IS NOT NULL
      ORDER BY COALESCE(completed_at, started_at) DESC, id DESC
      LIMIT 1
    `).get(issuerId) as Record<string, unknown> | undefined;
    if (!row || typeof row.response_json !== "string") return null;
    return AnalyticsSyncResponseSchema.parse(JSON.parse(row.response_json));
  }

  async failInterruptedAnalyticsSyncRuns(completedAt: string) {
    if (!isTimestamp(completedAt)) throw new TypeError("completedAt must be an ISO-compatible timestamp.");
    const rows = this.database.prepare(`
      SELECT response_json
      FROM analytics_sync_runs
      WHERE state IN ('QUEUED', 'RUNNING') AND response_json IS NOT NULL
    `).all();
    for (const row of rows) {
      if (typeof row.response_json !== "string") continue;
      const run = AnalyticsSyncResponseSchema.parse(JSON.parse(row.response_json));
      await this.saveAnalyticsSyncRun({
        ...run,
        state: "FAILED",
        completedAt,
        error: "ASC Studio stopped before this analytics sync finished. Start a new sync to retry safely.",
      });
    }
    return rows.length;
  }

  upsertReportRequest(input: AnalyticsReportRequestRecord) {
    this.validateRequest(input);
    this.database.prepare(`
      INSERT INTO analytics_report_requests (issuer_id, request_id, app_id, access_type, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (issuer_id, request_id) DO UPDATE SET
        app_id = excluded.app_id,
        access_type = excluded.access_type,
        created_at = excluded.created_at
    `).run(input.issuerId, input.requestId, input.appId, input.accessType, input.createdAt);
  }

  beginInstance(input: AnalyticsInstanceInput) {
    this.validateInstance(input);
    const partitionDates = [...new Set(input.instance.partitionDates)].sort();
    const segmentIds = [...new Set(input.instance.segmentIds)].sort();
    this.transaction(() => {
      this.upsertReportRequest({ issuerId: input.issuerId, ...input.request });
      this.database.prepare(`
        INSERT INTO analytics_reports (issuer_id, report_id, request_id, app_id, name, category)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (issuer_id, report_id) DO UPDATE SET
          request_id = excluded.request_id,
          app_id = excluded.app_id,
          name = excluded.name,
          category = excluded.category
      `).run(
        input.issuerId,
        input.report.id,
        input.request.requestId,
        input.request.appId,
        input.report.name,
        input.report.category,
      );
      this.database.prepare(`
        INSERT INTO analytics_instances (
          issuer_id, instance_id, report_id, app_id, granularity, processing_date,
          source, partition_dates_json, segment_ids_json, state
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'STAGING')
        ON CONFLICT (issuer_id, instance_id) DO UPDATE SET
          report_id = excluded.report_id,
          app_id = excluded.app_id,
          granularity = excluded.granularity,
          processing_date = excluded.processing_date,
          source = excluded.source,
          partition_dates_json = excluded.partition_dates_json,
          segment_ids_json = excluded.segment_ids_json,
          state = CASE WHEN analytics_instances.state = 'PROMOTED' THEN 'PROMOTED' ELSE 'STAGING' END
      `).run(
        input.issuerId,
        input.instance.id,
        input.report.id,
        input.request.appId,
        input.instance.granularity,
        input.instance.processingDate,
        input.instance.source,
        JSON.stringify(partitionDates),
        JSON.stringify(segmentIds),
      );
      const insertSegment = this.database.prepare(`
        INSERT INTO analytics_segments (issuer_id, instance_id, segment_id, state)
        VALUES (?, ?, ?, 'PENDING')
        ON CONFLICT (issuer_id, instance_id, segment_id) DO NOTHING
      `);
      for (const segmentId of segmentIds) insertSegment.run(input.issuerId, input.instance.id, segmentId);
    });
  }

  stageSegment(input: AnalyticsSegmentInput) {
    requireNonEmpty("issuerId", input.issuerId);
    requireNonEmpty("instanceId", input.instanceId);
    requireNonEmpty("segmentId", input.segmentId);
    if (!isTimestamp(input.fetchedAt)) throw new TypeError("fetchedAt must be an ISO-compatible timestamp.");
    const instance = this.database.prepare(`
      SELECT app_id, partition_dates_json, segment_ids_json, state
      FROM analytics_instances
      WHERE issuer_id = ? AND instance_id = ?
    `).get(input.issuerId, input.instanceId) as Record<string, unknown> | undefined;
    if (!instance) throw new Error(`Analytics instance ${input.instanceId} was not staged for this issuer.`);
    if (instance.state === "PROMOTED") return;
    const expectedSegmentIds = parseStringArray(instance.segment_ids_json, "Stored analytics segment IDs");
    if (!expectedSegmentIds.includes(input.segmentId)) {
      throw new Error(`Analytics segment ${input.segmentId} does not belong to instance ${input.instanceId}.`);
    }
    const partitionDates = new Set(parseStringArray(instance.partition_dates_json, "Stored analytics partition dates"));
    const appId = String(instance.app_id);
    input.observations.forEach((observation) => this.validateObservation(observation, appId, partitionDates));

    this.transaction(() => {
      this.database.prepare(`
        DELETE FROM analytics_staged_facts
        WHERE issuer_id = ? AND instance_id = ? AND segment_id = ?
      `).run(input.issuerId, input.instanceId, input.segmentId);
      const insert = this.database.prepare(`
        INSERT INTO analytics_staged_facts (issuer_id, instance_id, segment_id, row_index, fact_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      input.observations.forEach((observation, index) => {
        insert.run(input.issuerId, input.instanceId, input.segmentId, index, JSON.stringify({
          ...observation,
          dimensions: stableObject(observation.dimensions),
        }));
      });
      this.database.prepare(`
        UPDATE analytics_segments
        SET checksum = ?, state = 'COMPLETE', row_count = ?, fetched_at = ?
        WHERE issuer_id = ? AND instance_id = ? AND segment_id = ?
      `).run(
        input.checksum,
        input.observations.length,
        input.fetchedAt,
        input.issuerId,
        input.instanceId,
        input.segmentId,
      );
    });
  }

  promoteInstance(issuerId: string, instanceId: string, promotedAt: string): AnalyticsPromotionResult {
    requireNonEmpty("issuerId", issuerId);
    requireNonEmpty("instanceId", instanceId);
    if (!isTimestamp(promotedAt)) throw new TypeError("promotedAt must be an ISO-compatible timestamp.");
    const instance = this.database.prepare(`
      SELECT report_id, app_id, granularity, processing_date, source,
             partition_dates_json, segment_ids_json, state
      FROM analytics_instances
      WHERE issuer_id = ? AND instance_id = ?
    `).get(issuerId, instanceId) as Record<string, unknown> | undefined;
    if (!instance) throw new Error(`Analytics instance ${instanceId} was not staged for this issuer.`);
    if (instance.state === "PROMOTED") {
      return { promotedPartitions: 0, ignoredPartitions: 0, observationCount: 0 };
    }
    const segmentIds = parseStringArray(instance.segment_ids_json, "Stored analytics segment IDs");
    const completed = this.database.prepare(`
      SELECT segment_id
      FROM analytics_segments
      WHERE issuer_id = ? AND instance_id = ? AND state = 'COMPLETE'
    `).all(issuerId, instanceId).map((row) => String(row.segment_id));
    if (completed.length !== segmentIds.length || segmentIds.some((id) => !completed.includes(id))) {
      throw new Error(`Analytics instance ${instanceId} is incomplete; every segment must finish before promotion.`);
    }

    const stagedRows = this.database.prepare(`
      SELECT fact_json
      FROM analytics_staged_facts
      WHERE issuer_id = ? AND instance_id = ?
      ORDER BY segment_id, row_index
    `).all(issuerId, instanceId);
    const observations = stagedRows.map((row) => {
      if (typeof row.fact_json !== "string") throw new TypeError("Stored analytics fact is not JSON text.");
      return JSON.parse(row.fact_json) as AnalyticsObservationInput;
    });
    const reportId = String(instance.report_id);
    const report = this.database.prepare(`
      SELECT name, category FROM analytics_reports WHERE issuer_id = ? AND report_id = ?
    `).get(issuerId, reportId) as Record<string, unknown> | undefined;
    if (!report) throw new Error(`Analytics report ${reportId} was not staged for this issuer.`);
    const reportKey = logicalReportKey(String(report.name), String(report.category));
    const appId = String(instance.app_id);
    const granularity = String(instance.granularity);
    const processingDate = String(instance.processing_date);
    const source = String(instance.source) as AnalyticsReportAccessType;
    const partitionDates = parseStringArray(instance.partition_dates_json, "Stored analytics partition dates");
    let promotedPartitions = 0;
    let ignoredPartitions = 0;
    let observationCount = 0;

    this.transaction(() => {
      const currentPartition = this.database.prepare(`
        SELECT processing_date, source, instance_id
        FROM analytics_partitions
        WHERE issuer_id = ? AND logical_report_key = ? AND app_id = ? AND granularity = ? AND date = ?
      `);
      const deleteFacts = this.database.prepare(`
        DELETE FROM analytics_facts
        WHERE issuer_id = ? AND logical_report_key = ? AND app_id = ? AND granularity = ? AND date = ?
      `);
      const upsertPartition = this.database.prepare(`
        INSERT INTO analytics_partitions (
          issuer_id, report_id, logical_report_key, app_id, granularity, date,
          processing_date, source, instance_id, promoted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (issuer_id, logical_report_key, app_id, granularity, date) DO UPDATE SET
          report_id = excluded.report_id,
          processing_date = excluded.processing_date,
          source = excluded.source,
          instance_id = excluded.instance_id,
          promoted_at = excluded.promoted_at
      `);
      const insertFact = this.database.prepare(`
        INSERT INTO analytics_facts (
          issuer_id, report_id, logical_report_key, app_id, granularity, date, metric, dimensions_key,
          dimensions_json, value, unit, unavailable_reason, availability, currency,
          evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const date of partitionDates) {
        const current = currentPartition.get(issuerId, reportKey, appId, granularity, date) as Record<string, unknown> | undefined;
        const shouldPromote = !current
          || processingDate > String(current.processing_date)
          || processingDate === String(current.processing_date)
            && sourcePriority(source) > sourcePriority(String(current.source) as AnalyticsReportAccessType);
        if (!shouldPromote) {
          ignoredPartitions += 1;
          continue;
        }
        deleteFacts.run(issuerId, reportKey, appId, granularity, date);
        upsertPartition.run(
          issuerId,
          reportId,
          reportKey,
          appId,
          granularity,
          date,
          processingDate,
          source,
          instanceId,
          promotedAt,
        );
        const factsForDate = observations.filter((observation) => observation.date === date);
        for (const observation of factsForDate) {
          const dimensionsJson = stableJson(observation.dimensions);
          insertFact.run(
            issuerId,
            reportId,
            reportKey,
            appId,
            granularity,
            date,
            observation.metric,
            dimensionsJson,
            dimensionsJson,
            observation.value,
            observation.unit,
            observation.unavailableReason,
            observation.availability ?? (observation.value === null ? "UNAVAILABLE" : "AVAILABLE"),
            observation.currency ?? null,
            observation.evidenceId ?? null,
            observation.snapshotId ?? null,
            observation.reportRequestId ?? null,
            processingDate,
            source,
            instanceId,
          );
        }
        promotedPartitions += 1;
        observationCount += factsForDate.length;
      }
      this.database.prepare(`
        UPDATE analytics_instances SET state = 'PROMOTED'
        WHERE issuer_id = ? AND instance_id = ?
      `).run(issuerId, instanceId);
      this.database.prepare(`
        DELETE FROM analytics_staged_facts WHERE issuer_id = ? AND instance_id = ?
      `).run(issuerId, instanceId);
    });
    return { promotedPartitions, ignoredPartitions, observationCount };
  }

  listFacts(input: {
    issuerId: string;
    appIds: string[];
    startDate: string;
    endDate: string;
    metrics?: string[];
  }): AnalyticsFactRecord[] {
    requireNonEmpty("issuerId", input.issuerId);
    if (!input.appIds.length) throw new TypeError("At least one app ID is required.");
    if (!isDate(input.startDate) || !isDate(input.endDate) || input.startDate > input.endDate) {
      throw new TypeError("Analytics date range is invalid.");
    }
    const appPlaceholders = input.appIds.map(() => "?").join(", ");
    const metricClause = input.metrics?.length
      ? ` AND facts.metric IN (${input.metrics.map(() => "?").join(", ")})`
      : "";
    const rows = this.database.prepare(`
      SELECT facts.issuer_id, facts.report_id, reports.name AS report_name, reports.category,
             facts.app_id, facts.granularity, facts.date, facts.metric, facts.dimensions_json,
             facts.value, facts.unit, facts.unavailable_reason, facts.availability, facts.currency,
             facts.evidence_id, facts.snapshot_id, facts.report_request_id,
             facts.processing_date, facts.source
      FROM analytics_facts AS facts
      JOIN analytics_reports AS reports
        ON reports.issuer_id = facts.issuer_id AND reports.report_id = facts.report_id
      WHERE facts.issuer_id = ?
        AND facts.app_id IN (${appPlaceholders})
        AND facts.date >= ? AND facts.date <= ?${metricClause}
      ORDER BY facts.date, facts.app_id, facts.metric, facts.dimensions_key, facts.report_id
    `).all(
      input.issuerId,
      ...input.appIds,
      input.startDate,
      input.endDate,
      ...(input.metrics ?? []),
    );
    return rows.map((row) => ({
      issuerId: String(row.issuer_id),
      reportId: String(row.report_id),
      reportName: String(row.report_name),
      category: String(row.category),
      appId: String(row.app_id),
      granularity: String(row.granularity),
      date: String(row.date),
      metric: String(row.metric),
      dimensions: parseJsonObject(row.dimensions_json, "Stored analytics dimensions"),
      value: row.value === null ? null : Number(row.value),
      unit: String(row.unit),
      unavailableReason: row.unavailable_reason === null ? null : String(row.unavailable_reason),
      availability: String(row.availability) as AnalyticsObservation["availability"],
      currency: row.currency === null ? null : String(row.currency) as AnalyticsObservation["currency"],
      evidenceId: row.evidence_id === null ? undefined : String(row.evidence_id),
      snapshotId: row.snapshot_id === null ? undefined : String(row.snapshot_id),
      reportRequestId: row.report_request_id === null ? undefined : String(row.report_request_id),
      processingDate: String(row.processing_date),
      source: String(row.source) as AnalyticsReportAccessType,
    }));
  }

  listPartitionCoverage(issuerId: string, appIds: string[]) {
    if (!appIds.length) return [];
    const placeholders = appIds.map(() => "?").join(", ");
    return this.database.prepare(`
      SELECT app_id, MIN(date) AS start_date, MAX(date) AS end_date,
             MAX(processing_date) AS processing_date, COUNT(*) AS partition_count
      FROM analytics_partitions
      WHERE issuer_id = ? AND app_id IN (${placeholders})
      GROUP BY app_id
      ORDER BY app_id
    `).all(issuerId, ...appIds).map((row) => ({
      appId: String(row.app_id),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      processingDate: String(row.processing_date),
      partitionCount: Number(row.partition_count),
    }));
  }

  createSyncRun(input: Pick<AnalyticsSyncRunRecord, "id" | "issuerId" | "appIds" | "startedAt">) {
    requireNonEmpty("id", input.id);
    requireNonEmpty("issuerId", input.issuerId);
    if (!input.appIds.length) throw new TypeError("At least one app ID is required for analytics sync.");
    if (!isTimestamp(input.startedAt)) throw new TypeError("startedAt must be an ISO-compatible timestamp.");
    this.database.prepare(`
      INSERT INTO analytics_sync_runs (
        id, issuer_id, app_ids_json, state, started_at, completed_at,
        error_code, error_message, stats_json
      ) VALUES (?, ?, ?, 'QUEUED', ?, NULL, NULL, NULL, '{}')
    `).run(input.id, input.issuerId, JSON.stringify([...new Set(input.appIds)].sort()), input.startedAt);
    return this.getSyncRun(input.issuerId, input.id)!;
  }

  markSyncRunning(issuerId: string, id: string) {
    this.database.prepare(`
      UPDATE analytics_sync_runs SET state = 'RUNNING'
      WHERE issuer_id = ? AND id = ? AND state = 'QUEUED'
    `).run(issuerId, id);
    return this.getSyncRun(issuerId, id);
  }

  completeSyncRun(input: {
    issuerId: string;
    id: string;
    completedAt: string;
    stats: Record<string, number>;
  }) {
    if (!isTimestamp(input.completedAt)) throw new TypeError("completedAt must be an ISO-compatible timestamp.");
    this.database.prepare(`
      UPDATE analytics_sync_runs
      SET state = 'SUCCEEDED', completed_at = ?, error_code = NULL,
          error_message = NULL, stats_json = ?
      WHERE issuer_id = ? AND id = ? AND state IN ('QUEUED', 'RUNNING')
    `).run(input.completedAt, JSON.stringify(input.stats), input.issuerId, input.id);
    return this.getSyncRun(input.issuerId, input.id);
  }

  failSyncRun(input: {
    issuerId: string;
    id: string;
    completedAt: string;
    errorCode: string;
    errorMessage: string;
  }) {
    if (!isTimestamp(input.completedAt)) throw new TypeError("completedAt must be an ISO-compatible timestamp.");
    this.database.prepare(`
      UPDATE analytics_sync_runs
      SET state = 'FAILED', completed_at = ?, error_code = ?, error_message = ?
      WHERE issuer_id = ? AND id = ? AND state IN ('QUEUED', 'RUNNING')
    `).run(input.completedAt, input.errorCode, input.errorMessage, input.issuerId, input.id);
    return this.getSyncRun(input.issuerId, input.id);
  }

  getSyncRun(issuerId: string, id: string): AnalyticsSyncRunRecord | null {
    const row = this.database.prepare(`
      SELECT id, issuer_id, app_ids_json, state, started_at, completed_at,
             error_code, error_message, stats_json
      FROM analytics_sync_runs
      WHERE issuer_id = ? AND id = ?
    `).get(issuerId, id) as Record<string, unknown> | undefined;
    return row ? this.syncRun(row) : null;
  }

  getActiveSyncRun(issuerId: string): AnalyticsSyncRunRecord | null {
    const row = this.database.prepare(`
      SELECT id, issuer_id, app_ids_json, state, started_at, completed_at,
             error_code, error_message, stats_json
      FROM analytics_sync_runs
      WHERE issuer_id = ? AND state IN ('QUEUED', 'RUNNING')
      ORDER BY started_at DESC LIMIT 1
    `).get(issuerId) as Record<string, unknown> | undefined;
    return row ? this.syncRun(row) : null;
  }

  getLatestSyncRun(issuerId: string): AnalyticsSyncRunRecord | null {
    const row = this.database.prepare(`
      SELECT id, issuer_id, app_ids_json, state, started_at, completed_at,
             error_code, error_message, stats_json
      FROM analytics_sync_runs
      WHERE issuer_id = ?
      ORDER BY started_at DESC LIMIT 1
    `).get(issuerId) as Record<string, unknown> | undefined;
    return row ? this.syncRun(row) : null;
  }

  clearAnalyticsIssuer(issuerId: string) {
    requireNonEmpty("Analytics issuer ID", issuerId);
    this.transaction(() => {
      for (const table of [
        "analytics_staged_facts",
        "analytics_segments",
        "analytics_instances",
        "analytics_facts",
        "analytics_partitions",
        "analytics_reports",
        "analytics_report_requests",
        "analytics_sync_runs",
        "analytics_demo_state",
      ]) {
        this.database.prepare(`DELETE FROM ${table} WHERE issuer_id = ?`).run(issuerId);
      }
    });
  }

  getDemoAnalyticsFixtureVersion(issuerId: string) {
    requireNonEmpty("Analytics issuer ID", issuerId);
    const row = this.database.prepare(`
      SELECT fixture_version
      FROM analytics_demo_state
      WHERE issuer_id = ?
    `).get(issuerId) as Record<string, unknown> | undefined;
    return row ? String(row.fixture_version) : null;
  }

  setDemoAnalyticsFixtureVersion(issuerId: string, fixtureVersion: string) {
    requireNonEmpty("Analytics issuer ID", issuerId);
    requireNonEmpty("Demo analytics fixture version", fixtureVersion);
    this.database.prepare(`
      INSERT INTO analytics_demo_state (issuer_id, fixture_version)
      VALUES (?, ?)
      ON CONFLICT (issuer_id) DO UPDATE SET fixture_version = excluded.fixture_version
    `).run(issuerId, fixtureVersion);
  }

  close() {
    this.database.close();
  }

  private migrateLogicalReportSchema() {
    const primaryKey = (table: string) => this.database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => String(column.name));
    const expectedPartitionKey = ["issuer_id", "logical_report_key", "app_id", "granularity", "date"];
    const expectedFactKey = [...expectedPartitionKey, "metric", "dimensions_key"];
    const partitionsNeedMigration = primaryKey("analytics_partitions").join("\0") !== expectedPartitionKey.join("\0");
    const factsNeedMigration = primaryKey("analytics_facts").join("\0") !== expectedFactKey.join("\0");
    if (!partitionsNeedMigration && !factsNeedMigration) return;

    this.transaction(() => {
      if (partitionsNeedMigration) this.rebuildAnalyticsPartitions();
      if (partitionsNeedMigration || factsNeedMigration) this.rebuildAnalyticsFacts();
    });
  }

  private rebuildAnalyticsPartitions() {
    this.database.exec(`
      CREATE TABLE analytics_partitions_migration (
        issuer_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        logical_report_key TEXT NOT NULL,
        app_id TEXT NOT NULL,
        granularity TEXT NOT NULL,
        date TEXT NOT NULL,
        processing_date TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ONGOING', 'ONE_TIME_SNAPSHOT')),
        instance_id TEXT NOT NULL,
        promoted_at TEXT NOT NULL,
        PRIMARY KEY (issuer_id, logical_report_key, app_id, granularity, date)
      )
    `);
    const rows = this.database.prepare(`
      SELECT stored.*, reports.name AS report_name, reports.category AS report_category
      FROM analytics_partitions AS stored
      LEFT JOIN analytics_reports AS reports
        ON reports.issuer_id = stored.issuer_id AND reports.report_id = stored.report_id
    `).all();
    const winners = new Map<string, { logicalKey: string; row: Record<string, unknown> }>();
    const compareText = (left: unknown, right: unknown) => String(left) < String(right)
      ? -1
      : String(left) > String(right) ? 1 : 0;
    const winsOver = (candidate: Record<string, unknown>, current: Record<string, unknown>) => {
      const order = [
        compareText(candidate.processing_date, current.processing_date),
        sourcePriority(String(candidate.source) as AnalyticsReportAccessType)
          - sourcePriority(String(current.source) as AnalyticsReportAccessType),
        compareText(candidate.promoted_at, current.promoted_at),
        compareText(candidate.instance_id, current.instance_id),
        compareText(candidate.report_id, current.report_id),
      ];
      return (order.find((comparison) => comparison !== 0) ?? 0) > 0;
    };
    for (const row of rows) {
      if (typeof row.report_name !== "string" || typeof row.report_category !== "string") {
        throw new Error("Cannot migrate analytics_partitions: a stored row references a missing analytics report.");
      }
      const reportKey = logicalReportKey(row.report_name, row.report_category);
      const identity = JSON.stringify([
        row.issuer_id,
        reportKey,
        row.app_id,
        row.granularity,
        row.date,
      ]);
      const current = winners.get(identity);
      if (!current || winsOver(row, current.row)) winners.set(identity, { logicalKey: reportKey, row });
    }
    const insert = this.database.prepare(`
      INSERT INTO analytics_partitions_migration (
        issuer_id, report_id, logical_report_key, app_id, granularity, date,
        processing_date, source, instance_id, promoted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const { logicalKey: reportKey, row } of [...winners.values()]) {
      insert.run(
        String(row.issuer_id),
        String(row.report_id),
        reportKey,
        String(row.app_id),
        String(row.granularity),
        String(row.date),
        String(row.processing_date),
        String(row.source),
        String(row.instance_id),
        String(row.promoted_at),
      );
    }
    this.database.exec(`
      DROP TABLE analytics_partitions;
      ALTER TABLE analytics_partitions_migration RENAME TO analytics_partitions;
    `);
  }

  private rebuildAnalyticsFacts() {
    this.database.exec(`
      CREATE TABLE analytics_facts_migration (
        issuer_id TEXT NOT NULL,
        report_id TEXT NOT NULL,
        logical_report_key TEXT NOT NULL,
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
        PRIMARY KEY (issuer_id, logical_report_key, app_id, granularity, date, metric, dimensions_key)
      )
    `);
    const rows = this.database.prepare(`
      SELECT stored.*, reports.name AS report_name, reports.category AS report_category
      FROM analytics_facts AS stored
      LEFT JOIN analytics_reports AS reports
        ON reports.issuer_id = stored.issuer_id AND reports.report_id = stored.report_id
    `).all();
    const winningPartitions = new Map(this.database.prepare(`
      SELECT issuer_id, report_id, logical_report_key, app_id, granularity, date, instance_id
      FROM analytics_partitions
    `).all().map((row) => [
      JSON.stringify([
        row.issuer_id,
        row.logical_report_key,
        row.app_id,
        row.granularity,
        row.date,
      ]),
      { reportId: String(row.report_id), instanceId: String(row.instance_id) },
    ]));
    const insert = this.database.prepare(`
      INSERT INTO analytics_facts_migration (
        issuer_id, report_id, logical_report_key, app_id, granularity, date, metric, dimensions_key,
        dimensions_json, value, unit, unavailable_reason, availability, currency,
        evidence_id, snapshot_id, report_request_id, processing_date, source, instance_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      if (typeof row.report_name !== "string" || typeof row.report_category !== "string") {
        throw new Error("Cannot migrate analytics_facts: a stored row references a missing analytics report.");
      }
      const reportKey = logicalReportKey(row.report_name, row.report_category);
      const winner = winningPartitions.get(JSON.stringify([
        row.issuer_id,
        reportKey,
        row.app_id,
        row.granularity,
        row.date,
      ]));
      if (!winner || winner.reportId !== String(row.report_id) || winner.instanceId !== String(row.instance_id)) {
        continue;
      }
      insert.run(
        String(row.issuer_id),
        String(row.report_id),
        reportKey,
        String(row.app_id),
        String(row.granularity),
        String(row.date),
        String(row.metric),
        String(row.dimensions_key),
        String(row.dimensions_json),
        row.value === null ? null : Number(row.value),
        String(row.unit),
        row.unavailable_reason === null ? null : String(row.unavailable_reason),
        String(row.availability),
        row.currency === null ? null : String(row.currency),
        row.evidence_id === null ? null : String(row.evidence_id),
        row.snapshot_id === null ? null : String(row.snapshot_id),
        row.report_request_id === null ? null : String(row.report_request_id),
        String(row.processing_date),
        String(row.source),
        String(row.instance_id),
      );
    }
    this.database.exec(`
      DROP TABLE analytics_facts;
      ALTER TABLE analytics_facts_migration RENAME TO analytics_facts;
    `);
  }

  private validateRequest(input: AnalyticsReportRequestRecord) {
    requireNonEmpty("issuerId", input.issuerId);
    requireNonEmpty("appId", input.appId);
    requireNonEmpty("requestId", input.requestId);
    if (!isTimestamp(input.createdAt)) throw new TypeError("createdAt must be an ISO-compatible timestamp.");
  }

  private validateInstance(input: AnalyticsInstanceInput) {
    this.validateRequest({ issuerId: input.issuerId, ...input.request });
    requireNonEmpty("report.id", input.report.id);
    requireNonEmpty("report.name", input.report.name);
    requireNonEmpty("report.category", input.report.category);
    requireNonEmpty("instance.id", input.instance.id);
    requireNonEmpty("instance.granularity", input.instance.granularity);
    if (!isDate(input.instance.processingDate)) throw new TypeError("processingDate must use YYYY-MM-DD.");
    if (!input.instance.partitionDates.length || input.instance.partitionDates.some((date) => !isDate(date))) {
      throw new TypeError("Every analytics instance needs valid partition dates.");
    }
    if (!input.instance.segmentIds.length || input.instance.segmentIds.some((id) => !id.trim())) {
      throw new TypeError("Every analytics instance needs at least one segment ID.");
    }
  }

  private validateObservation(observation: AnalyticsObservationInput, appId: string, partitionDates: Set<string>) {
    if (observation.appId !== appId) throw new TypeError("Analytics observation app ID does not match its report request.");
    if (!isDate(observation.date) || !partitionDates.has(observation.date)) {
      throw new TypeError("Analytics observation date is outside its instance partitions.");
    }
    requireNonEmpty("observation.metric", observation.metric);
    requireNonEmpty("observation.unit", observation.unit);
    for (const [key, value] of Object.entries(observation.dimensions)) {
      requireNonEmpty("dimension key", key);
      if (typeof value !== "string") throw new TypeError("Analytics dimensions must be strings.");
    }
    const availability = observation.availability ?? (observation.value === null ? "UNAVAILABLE" : "AVAILABLE");
    const numericAvailability = availability === "AVAILABLE" || availability === "PARTIAL";
    if (numericAvailability && observation.value === null) {
      throw new TypeError("Available and partial analytics observations need a finite numeric value.");
    }
    if (!numericAvailability && observation.value !== null) {
      throw new TypeError("Unavailable and privacy-withheld analytics observations must store null, not a numeric sentinel.");
    }
    if (observation.value === null) {
      if (!observation.unavailableReason?.trim()) {
        throw new TypeError("Unavailable analytics values need an explicit reason.");
      }
    } else {
      if (!Number.isFinite(observation.value)) throw new TypeError("Analytics values must be finite numbers.");
      if (observation.unavailableReason !== null) {
        throw new TypeError("Available analytics values cannot have an unavailable reason.");
      }
    }
  }

  private syncRun(row: Record<string, unknown>): AnalyticsSyncRunRecord {
    const stats = parseJsonObject(
      typeof row.stats_json === "string"
        ? JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(row.stats_json) as Record<string, unknown>)
          .map(([key, value]) => [key, String(value)])))
        : row.stats_json,
      "Stored analytics sync stats",
    );
    return {
      id: String(row.id),
      issuerId: String(row.issuer_id),
      appIds: parseStringArray(row.app_ids_json, "Stored analytics sync app IDs"),
      state: String(row.state) as AnalyticsSyncRunState,
      startedAt: String(row.started_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
      errorCode: row.error_code === null ? null : String(row.error_code),
      errorMessage: row.error_message === null ? null : String(row.error_message),
      stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number(value)])),
    };
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
