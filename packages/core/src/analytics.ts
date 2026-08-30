import {
  ANALYTICS_METRIC_COMPLETENESS_DAYS,
  AnalyticsOverviewResponseSchema,
  AnalyticsOverviewResponseV2Schema,
  type AnalyticsAdditiveMetricId,
  type AnalyticsAppContribution,
  type AnalyticsAvailability,
  type AnalyticsBreakdown,
  type AnalyticsBreakdownDimension,
  type AnalyticsFactBatch,
  type AnalyticsFacets,
  type AnalyticsFreshness,
  type AnalyticsKpi,
  type AnalyticsMetricChange,
  type AnalyticsMetricCoverage,
  type AnalyticsMetricId,
  type AnalyticsMetricUnit,
  type AnalyticsMetricValue,
  type AnalyticsObservation,
  type AnalyticsObservationQuery,
  type AnalyticsOverviewQuery,
  type AnalyticsOverviewQueryV2,
  type AnalyticsOverviewResponse,
  type AnalyticsOverviewResponseV2,
  type AnalyticsPortfolioApp,
  type AnalyticsPortfolioSourceCoverage,
  type AnalyticsPortfolioSourceState,
  type AnalyticsPrivacy,
  type AnalyticsProvenance,
  type AnalyticsReportRequest,
  type AnalyticsReportRequestCreateInput,
  type AnalyticsSeries,
  type AnalyticsStatusResponse,
  type AnalyticsSyncInput,
  type AnalyticsSyncResponse,
  type AnalyticsSyncResult,
  type AppSummary,
} from "@asc-studio/contracts";

export interface AnalyticsProvider {
  getAnalyticsStatus(): Promise<AnalyticsStatusResponse>;
  listAnalyticsReportRequests(appId?: string): Promise<AnalyticsReportRequest[]>;
  createAnalyticsReportRequest(input: AnalyticsReportRequestCreateInput): Promise<AnalyticsReportRequest>;
  syncAnalytics(input: AnalyticsSyncInput): Promise<AnalyticsSyncResult>;
}

export interface AnalyticsStoredSnapshot {
  observations: AnalyticsObservation[];
  freshness: AnalyticsFreshness;
  privacy: AnalyticsPrivacy;
  provenance: AnalyticsProvenance;
  metricCoverage?: AnalyticsMetricCoverage[];
  facets?: AnalyticsFacets;
}

export interface AnalyticsFactBatchWriteResult {
  observationCount: number;
  replaced: boolean;
}

export interface AnalyticsStore {
  replaceAnalyticsFactBatch(batch: AnalyticsFactBatch): Promise<AnalyticsFactBatchWriteResult>;
  readAnalyticsSnapshot(query: AnalyticsObservationQuery): Promise<AnalyticsStoredSnapshot | null>;
  saveAnalyticsSyncRun(run: AnalyticsSyncResponse): Promise<void>;
  getAnalyticsSyncRun(runId: string): Promise<AnalyticsSyncResponse | null>;
}

export interface AnalyticsServiceDependencies {
  provider: AnalyticsProvider;
  store: AnalyticsStore;
  now: () => Date;
  digest: (value: string) => string;
}

export interface AnalyticsOverviewContext {
  issuerId: string | null;
  apps: AppSummary[];
}

export interface AnalyticsPortfolioOverviewApp extends AnalyticsPortfolioApp {
  rawAppId: string;
}

export interface AnalyticsPortfolioOverviewSource {
  id: string;
  issuerId: string;
  state: AnalyticsPortfolioSourceState;
  detail: string;
  apps: AnalyticsPortfolioOverviewApp[];
}

export interface AnalyticsPortfolioOverviewContext {
  catalogRevision: string;
  sources: AnalyticsPortfolioOverviewSource[];
}

type MetricDefinition = {
  label: string;
  unit: AnalyticsMetricUnit;
  formula: string | null;
  additive: AnalyticsAdditiveMetricId | null;
};

export const ANALYTICS_METRIC_DEFINITIONS: Record<AnalyticsMetricId, MetricDefinition> = {
  IMPRESSIONS: { label: "Impressions", unit: "COUNT", formula: null, additive: "IMPRESSIONS" },
  DOWNLOADS: { label: "Total downloads", unit: "COUNT", formula: "First-time downloads + redownloads", additive: "DOWNLOADS" },
  FIRST_TIME_DOWNLOADS: { label: "First-time downloads", unit: "COUNT", formula: null, additive: "FIRST_TIME_DOWNLOADS" },
  PRODUCT_PAGE_VIEWS: { label: "Product page views", unit: "COUNT", formula: null, additive: "PRODUCT_PAGE_VIEWS" },
  DOWNLOAD_RATE: {
    label: "Download rate",
    unit: "RATIO",
    formula: "Total downloads ÷ product page views",
    additive: null,
  },
  SESSIONS: { label: "Sessions", unit: "COUNT", formula: null, additive: "SESSIONS" },
  PROCEEDS: { label: "Estimated proceeds", unit: "CURRENCY_USD", formula: "Sum of USD-normalized proceeds", additive: "PROCEEDS" },
};

const METRICS = Object.keys(ANALYTICS_METRIC_DEFINITIONS) as AnalyticsMetricId[];
const ADDITIVE_METRICS: AnalyticsAdditiveMetricId[] = [
  "IMPRESSIONS",
  "DOWNLOADS",
  "FIRST_TIME_DOWNLOADS",
  "PRODUCT_PAGE_VIEWS",
  "SESSIONS",
  "PROCEEDS",
];

const unavailable = (): AnalyticsMetricValue => ({ value: null, availability: "UNAVAILABLE" });

const metricComponents = (metric: AnalyticsMetricId): AnalyticsAdditiveMetricId[] => (
  metric === "DOWNLOAD_RATE" ? ["DOWNLOADS", "PRODUCT_PAGE_VIEWS"] : [metric]
);

const hasMetricCoverageGap = (
  observations: AnalyticsObservation[],
  metric: AnalyticsMetricId,
  expectedAppIds: string[],
) => metricComponents(metric).some((component) => expectedAppIds.some((appId) => (
  !observations.some((observation) => observation.appId === appId && observation.metric === component)
)));

const markPartial = (value: AnalyticsMetricValue, partial: boolean): AnalyticsMetricValue => (
  partial && value.value !== null && value.availability === "AVAILABLE"
    ? { value: value.value, availability: "PARTIAL" }
    : value
);

const metricValue = (
  observations: AnalyticsObservation[],
  metric: AnalyticsMetricId,
  expectedAppIds: string[] = [],
  forcePartial = false,
): AnalyticsMetricValue => {
  if (metric === "DOWNLOAD_RATE") {
    const downloads = metricValue(observations, "DOWNLOADS", expectedAppIds, forcePartial);
    const views = metricValue(observations, "PRODUCT_PAGE_VIEWS", expectedAppIds, forcePartial);
    if (downloads.value === null || views.value === null || views.value === 0) return unavailable();
    return {
      value: downloads.value / views.value,
      availability: downloads.availability === "PARTIAL" || views.availability === "PARTIAL" ? "PARTIAL" : "AVAILABLE",
    };
  }

  const candidates = observations.filter((observation) => observation.metric === metric);
  if (candidates.length === 0) return unavailable();
  const numeric = candidates.filter((observation): observation is AnalyticsObservation & { value: number } => (
    (observation.availability === "AVAILABLE" || observation.availability === "PARTIAL")
    && observation.value !== null
  ));
  if (numeric.length === 0) {
    return candidates.some((observation) => observation.availability === "PRIVACY_WITHHELD")
      ? { value: null, availability: "PRIVACY_WITHHELD" }
      : unavailable();
  }
  return markPartial({
    value: numeric.reduce((sum, observation) => sum + observation.value, 0),
    availability: numeric.length !== candidates.length || numeric.some((observation) => observation.availability === "PARTIAL")
      ? "PARTIAL"
      : "AVAILABLE",
  }, forcePartial || expectedAppIds.length > 0 && hasMetricCoverageGap(observations, metric, expectedAppIds));
};

const changeFor = (current: AnalyticsMetricValue, previous: AnalyticsMetricValue | null): AnalyticsMetricChange | null => {
  if (!previous || current.value === null || previous.value === null) return null;
  const absolute = current.value - previous.value;
  return {
    absolute,
    relative: previous.value === 0 ? null : absolute / previous.value,
  };
};

const parseDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const formatDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDate(value);
};

const expectedDelayDaysFor = (metric: AnalyticsMetricId) => Math.max(
  ...metricComponents(metric).map((component) => ANALYTICS_METRIC_COMPLETENESS_DAYS[component]),
);

const coverageIsIncomplete = (
  coverage: ReadonlyMap<AnalyticsMetricId, AnalyticsMetricCoverage>,
  metric: AnalyticsMetricId,
  periodEnd: string,
) => {
  const item = coverage.get(metric);
  return !item
    || item.completeThrough === null
    || item.completeThrough < periodEnd;
};

const inclusiveDays = (startDate: string, endDate: string) =>
  Math.floor((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86_400_000) + 1;

export const previousAnalyticsPeriod = (startDate: string, endDate: string) => {
  const days = inclusiveDays(startDate, endDate);
  return {
    startDate: addDays(startDate, -days),
    endDate: addDays(startDate, -1),
  };
};

const inRange = (observation: AnalyticsObservation, startDate: string, endDate: string) =>
  observation.date >= startDate && observation.date <= endDate;

const bucketFor = (date: string, granularity: AnalyticsOverviewQuery["granularity"]) => {
  if (granularity === "DAY") return date;
  const value = parseDate(date);
  if (granularity === "WEEK") {
    value.setUTCDate(value.getUTCDate() - value.getUTCDay());
    return formatDate(value);
  }
  value.setUTCDate(1);
  return formatDate(value);
};

const datesInPeriod = (startDate: string, endDate: string, granularity: AnalyticsOverviewQuery["granularity"]) => {
  const dates: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    const bucket = bucketFor(cursor, granularity);
    if (dates.at(-1) !== bucket) dates.push(bucket);
    cursor = addDays(cursor, 1);
  }
  return dates;
};

const evidenceFor = (base: string, suffix: string) => `${base}:${suffix}`;

const buildKpis = (
  current: AnalyticsObservation[],
  previous: AnalyticsObservation[] | null,
  evidenceId: string,
  appIds: string[],
  coverage: ReadonlyMap<AnalyticsMetricId, AnalyticsMetricCoverage>,
  currentEnd: string,
  previousEnd: string | null,
): AnalyticsKpi[] => METRICS.map((metric) => {
  const definition = ANALYTICS_METRIC_DEFINITIONS[metric];
  const currentValue = metricValue(current, metric, appIds, coverageIsIncomplete(coverage, metric, currentEnd));
  const previousValue = previous
    ? metricValue(previous, metric, appIds, previousEnd === null || coverageIsIncomplete(coverage, metric, previousEnd))
    : null;
  return {
    metric,
    label: definition.label,
    unit: definition.unit,
    formula: definition.formula,
    current: currentValue,
    previous: previousValue,
    change: changeFor(currentValue, previousValue),
    evidenceId: evidenceFor(evidenceId, `kpi:${metric}`),
  };
});

const buildSeries = (
  query: AnalyticsOverviewQuery,
  current: AnalyticsObservation[],
  previous: AnalyticsObservation[] | null,
  comparisonPeriod: { startDate: string; endDate: string } | null,
  evidenceId: string,
  appIds: string[],
  coverage: ReadonlyMap<AnalyticsMetricId, AnalyticsMetricCoverage>,
): AnalyticsSeries[] => {
  const currentBuckets = datesInPeriod(query.startDate, query.endDate, query.granularity);
  const previousBuckets = comparisonPeriod
    ? datesInPeriod(comparisonPeriod.startDate, comparisonPeriod.endDate, query.granularity)
    : [];

  return METRICS.map((metric) => {
    const definition = ANALYTICS_METRIC_DEFINITIONS[metric];
    const currentCoverageGap = hasMetricCoverageGap(current, metric, appIds);
    const previousCoverageGap = previous ? hasMetricCoverageGap(previous, metric, appIds) : false;
    return {
      metric,
      label: definition.label,
      unit: definition.unit,
      formula: definition.formula,
      evidenceId: evidenceFor(evidenceId, `series:${metric}`),
      points: currentBuckets.map((date, index) => {
        const currentForBucket = current.filter((observation) => bucketFor(observation.date, query.granularity) === date);
        const previousDate = previousBuckets[index];
        const previousForBucket = previous && previousDate
          ? previous.filter((observation) => bucketFor(observation.date, query.granularity) === previousDate)
          : null;
        const currentBucketEnd = currentForBucket.map((observation) => observation.date).sort().at(-1) ?? date;
        const previousBucketEnd = previousForBucket?.map((observation) => observation.date).sort().at(-1) ?? previousDate ?? null;
        return {
          date,
          current: metricValue(
            currentForBucket,
            metric,
            [],
            currentCoverageGap || coverageIsIncomplete(coverage, metric, currentBucketEnd),
          ),
          previous: previousForBucket ? metricValue(
            previousForBucket,
            metric,
            [],
            previousCoverageGap || previousBucketEnd === null || coverageIsIncomplete(coverage, metric, previousBucketEnd),
          ) : null,
        };
      }),
    };
  });
};

const dimensionKey: Exclude<AnalyticsBreakdownDimension, "APP">[] = ["TERRITORY", "SOURCE", "PRODUCT_PAGE", "VERSION"];
const dimensionProperty: Record<(typeof dimensionKey)[number], string> = {
  TERRITORY: "territory",
  SOURCE: "source",
  PRODUCT_PAGE: "productPage",
  VERSION: "version",
};

const COMPATIBLE_BREAKDOWN_METRICS: Record<AnalyticsBreakdownDimension, ReadonlySet<AnalyticsMetricId>> = {
  APP: new Set(METRICS),
  TERRITORY: new Set(["IMPRESSIONS", "DOWNLOADS", "FIRST_TIME_DOWNLOADS", "PRODUCT_PAGE_VIEWS", "DOWNLOAD_RATE", "SESSIONS", "PROCEEDS"]),
  SOURCE: new Set(["IMPRESSIONS", "DOWNLOADS", "FIRST_TIME_DOWNLOADS", "PRODUCT_PAGE_VIEWS", "DOWNLOAD_RATE", "SESSIONS", "PROCEEDS"]),
  PRODUCT_PAGE: new Set(["IMPRESSIONS", "DOWNLOADS", "FIRST_TIME_DOWNLOADS", "PRODUCT_PAGE_VIEWS", "DOWNLOAD_RATE", "SESSIONS", "PROCEEDS"]),
  VERSION: new Set(["DOWNLOADS", "FIRST_TIME_DOWNLOADS", "SESSIONS"]),
};

const groupForDimension = (
  observations: AnalyticsObservation[],
  dimension: AnalyticsBreakdownDimension,
  appNames: Map<string, string>,
) => {
  const groups = new Map<string, { label: string; appId: string | null; observations: AnalyticsObservation[] }>();
  for (const observation of observations) {
    const id = dimension === "APP" ? observation.appId : observation.dimensions[dimensionProperty[dimension]];
    if (!id) continue;
    const existing = groups.get(id) ?? {
      label: dimension === "APP" ? appNames.get(observation.appId) ?? observation.appId : id,
      appId: dimension === "APP" ? observation.appId : null,
      observations: [],
    };
    existing.observations.push(observation);
    groups.set(id, existing);
  }
  return groups;
};

const buildBreakdowns = (
  query: AnalyticsOverviewQuery,
  current: AnalyticsObservation[],
  previous: AnalyticsObservation[] | null,
  appNames: Map<string, string>,
  evidenceId: string,
  coverage: ReadonlyMap<AnalyticsMetricId, AnalyticsMetricCoverage>,
  comparisonPeriod: { startDate: string; endDate: string } | null,
): AnalyticsBreakdown[] => query.breakdowns.flatMap((dimension) => {
  const currentGroups = groupForDimension(current, dimension, appNames);
  const previousGroups = previous ? groupForDimension(previous, dimension, appNames) : new Map();
  if (dimension === "APP") {
    for (const appId of query.appIds) {
      if (!currentGroups.has(appId)) currentGroups.set(appId, { label: appNames.get(appId) ?? appId, appId, observations: [] });
      if (previous && !previousGroups.has(appId)) previousGroups.set(appId, { label: appNames.get(appId) ?? appId, appId, observations: [] });
    }
  }
  return METRICS.filter((metric) => (
    COMPATIBLE_BREAKDOWN_METRICS[dimension].has(metric)
    && (
      metricValue(current, metric, query.appIds, coverageIsIncomplete(coverage, metric, query.endDate)).value !== null
      || previous !== null && metricValue(
        previous,
        metric,
        query.appIds,
        comparisonPeriod === null || coverageIsIncomplete(coverage, metric, comparisonPeriod.endDate),
      ).value !== null
    )
  )).map((metric): AnalyticsBreakdown => {
    const hasEvidence = (observations: AnalyticsObservation[]) => metric === "DOWNLOAD_RATE"
      ? observations.some((observation) => observation.metric === "DOWNLOADS")
        && observations.some((observation) => observation.metric === "PRODUCT_PAGE_VIEWS")
      : observations.some((observation) => observation.metric === metric);
    const ids = [...new Set([...currentGroups.keys(), ...previousGroups.keys()])].filter((id) => (
      dimension === "APP"
      || hasEvidence(currentGroups.get(id)?.observations ?? [])
      || hasEvidence(previousGroups.get(id)?.observations ?? [])
    ));
    const totalValue = metricValue(current, metric, query.appIds, coverageIsIncomplete(coverage, metric, query.endDate));
    const previousTotalValue = previous ? metricValue(
      previous,
      metric,
      query.appIds,
      comparisonPeriod === null || coverageIsIncomplete(coverage, metric, comparisonPeriod.endDate),
    ) : null;
    const currentContextIncomplete = hasMetricCoverageGap(current, metric, query.appIds)
      || coverageIsIncomplete(coverage, metric, query.endDate);
    const previousContextIncomplete = previous !== null && (
      hasMetricCoverageGap(previous, metric, query.appIds)
      || comparisonPeriod === null
      || coverageIsIncomplete(coverage, metric, comparisonPeriod.endDate)
    );
    const total = totalValue.value;
    const unsortedRows = ids.map((id) => {
      const currentValue = markPartial(
        metricValue(currentGroups.get(id)?.observations ?? [], metric),
        currentContextIncomplete,
      );
      const previousValue = previous ? markPartial(
        metricValue(previousGroups.get(id)?.observations ?? [], metric),
        previousContextIncomplete,
      ) : null;
      const group = currentGroups.get(id) ?? previousGroups.get(id);
      return {
        id,
        label: group?.label ?? id,
        appId: group?.appId ?? null,
        current: currentValue,
        previous: previousValue,
        change: changeFor(currentValue, previousValue),
        share: metric === "DOWNLOAD_RATE" || totalValue.availability === "PARTIAL"
          || currentValue.value === null || total === null || total === 0
          ? null
          : currentValue.value / total,
        evidenceId: evidenceFor(evidenceId, `breakdown:${dimension}:${metric}:${id}`),
      };
    });
    const proceedsMagnitude = metric === "PROCEEDS"
      ? unsortedRows.reduce((sum, row) => sum + Math.abs(row.current.value ?? 0), 0)
      : null;
    const rows = unsortedRows.map((row) => ({
      ...row,
      share: metric === "PROCEEDS"
        ? row.share === null || row.current.value === null || !proceedsMagnitude ? null : row.current.value / proceedsMagnitude
        : row.share,
    })).sort((a, b) => (
      (b.current.value ?? Number.NEGATIVE_INFINITY) - (a.current.value ?? Number.NEGATIVE_INFINITY)
      || a.label.localeCompare(b.label)
      || a.id.localeCompare(b.id)
    ));
    const definition = ANALYTICS_METRIC_DEFINITIONS[metric];
    return {
      dimension,
      metric,
      label: `${definition.label} by ${dimension.toLocaleLowerCase("en-US").replace("_", " ")}`,
      rows,
    };
  });
});

const buildContributions = (
  query: AnalyticsOverviewQuery,
  current: AnalyticsObservation[],
  previous: AnalyticsObservation[] | null,
  appNames: Map<string, string>,
  evidenceId: string,
  coverage: ReadonlyMap<AnalyticsMetricId, AnalyticsMetricCoverage>,
  comparisonPeriod: { startDate: string; endDate: string } | null,
): AnalyticsAppContribution[] => {
  if (query.scope !== "PORTFOLIO") return [];
  const contributions = ADDITIVE_METRICS.flatMap((metric) => {
    const portfolioCurrentMetric = metricValue(
      current,
      metric,
      query.appIds,
      coverageIsIncomplete(coverage, metric, query.endDate),
    );
    const portfolioPreviousMetric = previous ? metricValue(
      previous,
      metric,
      query.appIds,
      comparisonPeriod === null || coverageIsIncomplete(coverage, metric, comparisonPeriod.endDate),
    ) : null;
    const portfolioCurrent = portfolioCurrentMetric.value;
    const portfolioPrevious = portfolioPreviousMetric?.value ?? null;
    const portfolioChange = portfolioCurrent === null || portfolioPrevious === null
      ? null
      : portfolioCurrent - portfolioPrevious;
    const currentContextIncomplete = hasMetricCoverageGap(current, metric, query.appIds)
      || coverageIsIncomplete(coverage, metric, query.endDate);
    const previousContextIncomplete = previous !== null && (
      hasMetricCoverageGap(previous, metric, query.appIds)
      || comparisonPeriod === null
      || coverageIsIncomplete(coverage, metric, comparisonPeriod.endDate)
    );
    const appChanges = query.appIds.map((appId) => {
      const appCurrent = markPartial(
        metricValue(current.filter((observation) => observation.appId === appId), metric),
        currentContextIncomplete,
      );
      const appPrevious = previous
        ? markPartial(
          metricValue(previous.filter((observation) => observation.appId === appId), metric),
          previousContextIncomplete,
        )
        : null;
      const absoluteChange = appCurrent.value === null || appPrevious?.value == null
        ? null
        : appCurrent.value - appPrevious.value;
      return { appId, appCurrent, appPrevious, absoluteChange };
    });
    const proceedsChangeMagnitude = metric === "PROCEEDS"
      ? appChanges.reduce((sum, item) => sum + Math.abs(item.absoluteChange ?? 0), 0)
      : null;
    return appChanges.map(({ appId, appCurrent, appPrevious, absoluteChange }): AnalyticsAppContribution => {
      return {
        appId,
        appName: appNames.get(appId) ?? appId,
        metric,
        currentValue: appCurrent.value,
        currentAvailability: appCurrent.availability,
        previousValue: appPrevious?.value ?? null,
        previousAvailability: appPrevious?.availability ?? null,
        absoluteChange,
        shareOfPortfolioChange: absoluteChange === null
          || portfolioCurrentMetric.availability === "PARTIAL"
          || portfolioPreviousMetric?.availability === "PARTIAL"
          ? null
          : metric === "PROCEEDS"
            ? !proceedsChangeMagnitude ? null : absoluteChange / proceedsChangeMagnitude
            : portfolioChange === null || portfolioChange === 0 ? null : absoluteChange / portfolioChange,
        direction: absoluteChange === null ? "UNAVAILABLE" : absoluteChange > 0 ? "UP" : absoluteChange < 0 ? "DOWN" : "FLAT",
        evidenceId: evidenceFor(evidenceId, `contribution:${metric}:${appId}`),
      };
    });
  });
  return contributions.sort((a, b) => (
    Math.abs(b.absoluteChange ?? 0) - Math.abs(a.absoluteChange ?? 0)
    || a.metric.localeCompare(b.metric)
    || a.appName.localeCompare(b.appName)
    || a.appId.localeCompare(b.appId)
  ));
};

const coverageAvailability = (
  values: AnalyticsMetricValue[],
  completeThrough: string | null,
  endDate: string,
): AnalyticsAvailability => {
  if (values.some((value) => value.availability === "PRIVACY_WITHHELD") && values.every((value) => value.value === null)) {
    return "PRIVACY_WITHHELD";
  }
  if (values.every((value) => value.value === null)) return "UNAVAILABLE";
  return values.some((value) => value.availability !== "AVAILABLE") || completeThrough === null || completeThrough < endDate
    ? "PARTIAL"
    : "AVAILABLE";
};

const buildMetricCoverage = (
  query: AnalyticsOverviewQuery,
  current: AnalyticsObservation[],
  storedCoverage: AnalyticsMetricCoverage[] | undefined,
  referenceDate: string,
): AnalyticsMetricCoverage[] => {
  const stored = new Map(storedCoverage?.map((coverage) => [coverage.metric, coverage]));
  const additiveCoverage = new Map<AnalyticsAdditiveMetricId, AnalyticsMetricCoverage>();
  for (const metric of ADDITIVE_METRICS) {
    const existing = stored.get(metric);
    if (existing) {
      const computedAvailability = coverageAvailability(
        [metricValue(current, metric, query.appIds)],
        existing.completeThrough,
        query.endDate,
      );
      const availability = existing.availability === "PARTIAL" && computedAvailability === "AVAILABLE"
        ? "PARTIAL" as const
        : computedAvailability;
      additiveCoverage.set(metric, {
        ...existing,
        formula: ANALYTICS_METRIC_DEFINITIONS[metric].formula,
        availability,
        detail: availability === "UNAVAILABLE"
          ? existing.completeThrough
            ? `No reported ${ANALYTICS_METRIC_DEFINITIONS[metric].label.toLocaleLowerCase("en-US")} values match the selected period and filters; source coverage exists through ${existing.completeThrough}.`
            : `${ANALYTICS_METRIC_DEFINITIONS[metric].label} has no source coverage for every selected app; missing data is not zero.`
          : availability === "PRIVACY_WITHHELD"
            ? `${ANALYTICS_METRIC_DEFINITIONS[metric].label} is withheld for privacy for the selected period and filters.`
            : existing.detail,
      });
      continue;
    }
    const observations = current.filter((observation) => observation.metric === metric);
    const expectedDelayDays = ANALYTICS_METRIC_COMPLETENESS_DAYS[metric];
    const completenessCutoff = addDays(referenceDate, -expectedDelayDays);
    const reportNames = [...new Set(observations.map((observation) => observation.reportName))].sort();
    const reportFamilies = reportNames.map((reportName) => {
      const facts = observations.filter((observation) => observation.reportName === reportName);
      const everyAppPresent = query.appIds.every((appId) => facts.some((fact) => fact.appId === appId));
      const latestFact = facts.map((fact) => fact.date).sort().at(-1) ?? null;
      const completeThrough = everyAppPresent && latestFact
        ? [latestFact, completenessCutoff].sort()[0]!
        : null;
      const availability = coverageAvailability([metricValue(facts, metric, query.appIds)], completeThrough, query.endDate);
      return {
        reportName,
        expectedDelayDays,
        completeThrough,
        availability,
        detail: completeThrough
          ? `${reportName} is ${availability === "AVAILABLE" ? "complete" : "partially available"} through ${completeThrough}.`
          : `${reportName} has no stored facts for this selection.`,
      };
    });
    const completeThrough = reportFamilies.map((family) => family.completeThrough).filter((date): date is string => date !== null).sort()[0] ?? null;
    const availability = coverageAvailability([metricValue(observations, metric, query.appIds)], completeThrough, query.endDate);
    additiveCoverage.set(metric, {
      metric,
      source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
      formula: ANALYTICS_METRIC_DEFINITIONS[metric].formula,
      expectedDelayDays,
      completeThrough,
      availability,
      detail: completeThrough
        ? `${ANALYTICS_METRIC_DEFINITIONS[metric].label} is ${availability === "AVAILABLE" ? "complete" : "partially available"} through ${completeThrough}.`
        : `No ${ANALYTICS_METRIC_DEFINITIONS[metric].label.toLocaleLowerCase("en-US")} facts are stored for this selection.`,
      reportFamilies,
    });
  }

  return METRICS.map((metric) => {
    if (metric !== "DOWNLOAD_RATE") return additiveCoverage.get(metric as AnalyticsAdditiveMetricId)!;
    const downloads = additiveCoverage.get("DOWNLOADS")!;
    const views = additiveCoverage.get("PRODUCT_PAGE_VIEWS")!;
    const expectedDelayDays = expectedDelayDaysFor(metric);
    const completeThrough = downloads.completeThrough && views.completeThrough
      ? [downloads.completeThrough, views.completeThrough].sort()[0]!
      : null;
    const computedAvailability = coverageAvailability(
      [metricValue(current, "DOWNLOADS", query.appIds), metricValue(current, "PRODUCT_PAGE_VIEWS", query.appIds)],
      completeThrough,
      query.endDate,
    );
    const availability = computedAvailability === "AVAILABLE"
      && (downloads.availability === "PARTIAL" || views.availability === "PARTIAL")
      ? "PARTIAL" as const
      : computedAvailability;
    return {
      metric,
      source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
      formula: ANALYTICS_METRIC_DEFINITIONS[metric].formula,
      expectedDelayDays,
      completeThrough,
      availability,
      detail: completeThrough
        ? `Download rate is recomputed from total downloads and product page views complete through ${completeThrough}.`
        : "Download rate is unavailable until both total downloads and product page views are stored.",
      reportFamilies: [...downloads.reportFamilies, ...views.reportFamilies],
    };
  });
};

const emptyFreshness = (): AnalyticsFreshness => ({
  syncedAt: null,
  dataThrough: null,
  expectedDelayDays: null,
  partial: true,
  detail: "No App Store Connect analytics facts are stored for this period yet.",
});

const emptyPrivacy = (): AnalyticsPrivacy => ({
  aggregatedOnly: true,
  includesOptInUsageData: true,
  mayIncludePrivacyAdjustments: true,
  detail: "Usage metrics depend on customer analytics sharing and Apple privacy processing; missing data is not zero.",
});

export class AnalyticsService {
  constructor(private readonly dependencies: AnalyticsServiceDependencies) {}

  getStatus() {
    return this.dependencies.provider.getAnalyticsStatus();
  }

  listReportRequests(appId?: string) {
    return this.dependencies.provider.listAnalyticsReportRequests(appId);
  }

  getSyncRun(runId: string) {
    return this.dependencies.store.getAnalyticsSyncRun(runId);
  }

  async sync(input: AnalyticsSyncInput): Promise<AnalyticsSyncResponse> {
    const result = await this.dependencies.provider.syncAnalytics(input);
    let observationCount = 0;
    for (const batch of result.batches) {
      const write = await this.dependencies.store.replaceAnalyticsFactBatch(batch);
      observationCount += write.observationCount;
    }
    const response: AnalyticsSyncResponse = {
      schemaVersion: 1,
      issuerId: result.issuerId,
      runId: result.runId,
      state: result.state,
      appIds: result.appIds,
      reportRequests: result.reportRequests,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      snapshotId: result.snapshotId,
      evidenceId: result.evidenceId,
      freshness: result.freshness,
      error: result.error,
      batchCount: result.batches.length,
      observationCount,
    };
    await this.dependencies.store.saveAnalyticsSyncRun(response);
    return response;
  }

  async overview(
    query: AnalyticsOverviewQuery,
    context: AnalyticsOverviewContext,
  ): Promise<AnalyticsOverviewResponse> {
    const filters = query.filters ?? { territories: [], sources: [], productPages: [], versions: [] };
    const comparisonPeriod = query.compare === "PREVIOUS_PERIOD"
      ? previousAnalyticsPeriod(query.startDate, query.endDate)
      : null;
    const readStart = comparisonPeriod?.startDate ?? query.startDate;
    const stored = context.issuerId
      ? await this.dependencies.store.readAnalyticsSnapshot({
        issuerId: context.issuerId,
        appIds: query.appIds,
        startDate: readStart,
        endDate: query.endDate,
        filters,
        facetStartDate: query.startDate,
      })
      : null;
    return this.buildOverview(query, context.apps, stored);
  }

  async portfolioOverview(
    query: AnalyticsOverviewQueryV2,
    context: AnalyticsPortfolioOverviewContext,
  ): Promise<AnalyticsOverviewResponseV2> {
    const sourceIds = new Set<string>();
    const issuerIds = new Set<string>();
    const appIds = new Set<string>();
    for (const source of context.sources) {
      if (sourceIds.has(source.id) || issuerIds.has(source.issuerId)) {
        throw new TypeError("Analytics portfolio sources must be unique by source and issuer.");
      }
      sourceIds.add(source.id);
      issuerIds.add(source.issuerId);
      for (const app of source.apps) {
        if (app.sourceId !== source.id || appIds.has(app.id)) {
          throw new TypeError("Analytics portfolio apps must have one unique source-scoped identity.");
        }
        appIds.add(app.id);
      }
    }

    const requestedAppId = query.scope === "APP" ? query.selection.appId : null;
    const selectedSources = context.sources.flatMap((source) => {
      const apps = requestedAppId === null
        ? source.apps
        : source.apps.filter((app) => app.id === requestedAppId);
      return requestedAppId === null || apps.length > 0 ? [{ source, apps }] : [];
    });
    const selectedApps = selectedSources.flatMap(({ apps }) => apps);
    if (selectedApps.length === 0) throw new TypeError("The selected Analytics portfolio app is unavailable.");

    const filters = query.filters ?? { territories: [], sources: [], productPages: [], versions: [] };
    const comparisonPeriod = query.compare === "PREVIOUS_PERIOD"
      ? previousAnalyticsPeriod(query.startDate, query.endDate)
      : null;
    const readStart = comparisonPeriod?.startDate ?? query.startDate;
    const reads = await Promise.all(selectedSources.map(async ({ source, apps }) => {
      const stored = apps.length > 0
        ? await this.dependencies.store.readAnalyticsSnapshot({
          issuerId: source.issuerId,
          appIds: apps.map((app) => app.rawAppId),
          startDate: readStart,
          endDate: query.endDate,
          filters,
          facetStartDate: query.startDate,
        })
        : null;
      const publicIdByRaw = new Map(apps.map((app) => [app.rawAppId, app.id]));
      const mapped = stored ? {
        ...stored,
        observations: stored.observations.map((observation) => {
          const appId = publicIdByRaw.get(observation.appId);
          if (!appId) throw new TypeError("An issuer-scoped Analytics read returned an app outside its portfolio source.");
          return { ...observation, appId };
        }),
      } : null;
      return { source, apps, stored: mapped };
    }));

    const sourceCoverage: AnalyticsPortfolioSourceCoverage[] = reads.map(({ source, apps, stored }) => {
      const hasNoApps = source.state === "READY" && apps.length === 0;
      const state = source.state === "ERROR"
        ? "ERROR" as const
        : hasNoApps
          ? "READY" as const
        : stored === null
          ? "NO_DATA" as const
          : source.state === "PARTIAL" || stored.freshness.partial
            ? "PARTIAL" as const
            : "READY" as const;
      const freshness = hasNoApps ? {
        syncedAt: null,
        dataThrough: null,
        expectedDelayDays: null,
        partial: false,
        detail: "This connected source has no apps, so no analytics facts are expected.",
      } : stored?.freshness ?? emptyFreshness();
      return {
        sourceId: source.id,
        state,
        selectedAppCount: apps.length,
        freshness: hasNoApps ? freshness : { ...freshness, partial: state !== "READY" || freshness.partial },
        detail: hasNoApps
          ? "This connected App Store Connect source currently has no apps and is fully covered."
          : state === "READY"
          ? freshness.detail
          : `${source.detail} ${freshness.detail}`.trim(),
      };
    });

    const observations = reads.flatMap(({ stored }) => stored?.observations ?? []);
    // A successfully discovered organization with zero apps has nothing to
    // contribute and must not make otherwise complete portfolio facts partial.
    // Failed discovery remains in the denominator because zero apps is not
    // known to be true for that source.
    const coverageReads = reads.filter(({ source, apps }) => apps.length > 0 || source.state !== "READY");
    const populated = coverageReads.flatMap(({ stored }) => stored ? [stored] : []);
    const allSourcesDiscoverableAndStored = coverageReads.length > 0 && coverageReads.every(({ source, stored }) => (
      source.state === "READY" && stored !== null
    ));
    const allSourcesComplete = coverageReads.length > 0 && coverageReads.every(({ source, stored }) => (
      source.state === "READY" && stored !== null && !stored.freshness.partial
    ));
    const allSourcesPresent = coverageReads.length > 0 && coverageReads.every(({ stored }) => stored !== null);
    const presentSyncedAt = populated.flatMap((stored) => stored.freshness.syncedAt ? [stored.freshness.syncedAt] : []).sort();
    const presentDataThrough = populated.flatMap((stored) => stored.freshness.dataThrough ? [stored.freshness.dataThrough] : []).sort();
    const expectedDelayDays = populated.flatMap((stored) => (
      stored.freshness.expectedDelayDays === null ? [] : [stored.freshness.expectedDelayDays]
    ));
    const sourceEvidence = reads.map(({ source, stored }) => ({
      sourceId: source.id,
      snapshotId: stored?.provenance.snapshotId ?? null,
      evidenceId: stored?.provenance.evidenceId ?? null,
    })).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const selectedRoster = selectedSources.map(({ source, apps }) => ({
      sourceId: source.id,
      sourceState: source.state,
      apps: apps.map((app) => ({ id: app.id, rawAppId: app.rawAppId })).sort((left, right) => left.id.localeCompare(right.id)),
    })).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const coverageIdentity = sourceCoverage.map((coverage) => ({
      sourceId: coverage.sourceId,
      state: coverage.state,
      selectedAppCount: coverage.selectedAppCount,
    })).sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const mergedDigest = this.dependencies.digest(JSON.stringify({
      catalogRevision: context.catalogRevision,
      query,
      selectedRoster,
      coverageIdentity,
      sourceEvidence,
    }));
    const snapshotId = `portfolio:${mergedDigest}`;
    const evidenceId = `portfolio-evidence:${mergedDigest}`;
    const reportNames = [...new Set(populated.flatMap((stored) => stored.provenance.reportNames))].sort();
    const reportRequestIds = [...new Set(reads.flatMap(({ source, stored }) => (
      stored?.provenance.reportRequestIds.map((id) => (
        `report-request_${this.dependencies.digest(JSON.stringify({ sourceId: source.id, requestId: id })).slice(0, 48)}`
      )) ?? []
    )))].sort();

    const metricCoverage: AnalyticsMetricCoverage[] = METRICS.map((metric) => {
      const entries = coverageReads.map(({ stored }) => stored?.metricCoverage?.find((item) => item.metric === metric) ?? null);
      const everySourceCovered = entries.length > 0 && entries.every((entry) => entry !== null);
      const dates = entries.flatMap((entry) => entry?.completeThrough ? [entry.completeThrough] : []).sort();
      // Snapshot freshness is the oldest watermark across every report family.
      // It may be partial because a slower metric (for example Sessions or
      // Proceeds) is still arriving. A metric that is independently covered by
      // every source must retain its own truthful complete-through date.
      const completeThrough = allSourcesDiscoverableAndStored && everySourceCovered && dates.length === entries.length
        ? dates[0] ?? null
        : null;
      const availableEntries = entries.flatMap((entry) => entry ? [entry] : []);
      const availability: AnalyticsAvailability = availableEntries.length === 0
        ? "UNAVAILABLE"
        : allSourcesDiscoverableAndStored
          && everySourceCovered
          && availableEntries.every((entry) => entry.availability === "PRIVACY_WITHHELD")
          ? "PRIVACY_WITHHELD"
          : allSourcesDiscoverableAndStored
            && everySourceCovered
            && availableEntries.every((entry) => entry.availability === "AVAILABLE")
            && completeThrough !== null
            && completeThrough >= query.endDate
            ? "AVAILABLE"
            : "PARTIAL";
      const familyNames = [...new Set(availableEntries.flatMap((entry) => entry.reportFamilies.map((family) => family.reportName)))].sort();
      const reportFamilies = familyNames.map((reportName) => {
        const families = entries.map((entry) => entry?.reportFamilies.find((family) => family.reportName === reportName) ?? null);
        const everyFamilyCovered = families.length > 0 && families.every((family) => family !== null);
        const familyDates = families.flatMap((family) => family?.completeThrough ? [family.completeThrough] : []).sort();
        const familyCompleteThrough = allSourcesDiscoverableAndStored
          && everyFamilyCovered
          && familyDates.length === families.length
          ? familyDates[0] ?? null
          : null;
        const familyAvailability: AnalyticsAvailability = everyFamilyCovered
          && families.every((family) => family?.availability === "AVAILABLE")
          && familyCompleteThrough !== null
          && familyCompleteThrough >= query.endDate
          && allSourcesDiscoverableAndStored
          ? "AVAILABLE"
          : allSourcesDiscoverableAndStored
            && everyFamilyCovered
            && families.every((family) => family?.availability === "PRIVACY_WITHHELD")
            ? "PRIVACY_WITHHELD"
            : families.some((family) => family !== null)
              ? "PARTIAL"
              : "UNAVAILABLE";
        return {
          reportName,
          expectedDelayDays: Math.max(...families.flatMap((family) => family ? [family.expectedDelayDays] : [0])),
          completeThrough: familyCompleteThrough,
          availability: familyAvailability,
          detail: familyCompleteThrough
            ? `${reportName} is ${familyAvailability === "AVAILABLE" ? "complete" : "partially available"} across connected sources through ${familyCompleteThrough}.`
            : `${reportName} is not complete for every connected source.`,
        };
      });
      return {
        metric,
        source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
        formula: ANALYTICS_METRIC_DEFINITIONS[metric].formula,
        expectedDelayDays: Math.max(expectedDelayDaysFor(metric), ...availableEntries.map((entry) => entry.expectedDelayDays)),
        completeThrough,
        availability,
        detail: completeThrough
          ? `${ANALYTICS_METRIC_DEFINITIONS[metric].label} is ${availability === "AVAILABLE" ? "complete" : "partially available"} across connected sources through ${completeThrough}.`
          : `${ANALYTICS_METRIC_DEFINITIONS[metric].label} is not complete for every connected source; missing data is not zero.`,
        reportFamilies,
      };
    });

    const merged: AnalyticsStoredSnapshot = {
      observations,
      freshness: {
        syncedAt: allSourcesPresent && presentSyncedAt.length === coverageReads.length ? presentSyncedAt[0] ?? null : null,
        dataThrough: allSourcesPresent && presentDataThrough.length === coverageReads.length ? presentDataThrough[0] ?? null : null,
        expectedDelayDays: expectedDelayDays.length > 0 ? Math.max(...expectedDelayDays) : null,
        partial: !allSourcesComplete,
        detail: allSourcesComplete
          ? `Every connected Analytics source has cached coverage through ${presentDataThrough[0] ?? "the stated period"}.`
          : "Portfolio coverage is partial because one or more connected Analytics sources is unavailable, incomplete, or has no cached data. Missing data is not zero.",
      },
      privacy: {
        aggregatedOnly: true,
        includesOptInUsageData: populated.some((stored) => stored.privacy.includesOptInUsageData),
        mayIncludePrivacyAdjustments: !allSourcesComplete || populated.some((stored) => stored.privacy.mayIncludePrivacyAdjustments),
        detail: "Usage metrics depend on customer analytics sharing and Apple privacy processing across every connected source; privacy-limited and missing values are not zero.",
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
        territories: [...new Set(populated.flatMap((stored) => stored.facets?.territories ?? []))].sort().slice(0, 500),
        sources: [...new Set(populated.flatMap((stored) => stored.facets?.sources ?? []))].sort().slice(0, 500),
        productPages: [...new Set(populated.flatMap((stored) => stored.facets?.productPages ?? []))].sort().slice(0, 500),
        versions: [...new Set(populated.flatMap((stored) => stored.facets?.versions ?? []))].sort().slice(0, 500),
      },
    };
    const internalQuery: AnalyticsOverviewQuery = {
      schemaVersion: 1,
      scope: query.scope,
      appIds: selectedApps.map((app) => app.id),
      startDate: query.startDate,
      endDate: query.endDate,
      compare: query.compare,
      granularity: query.granularity,
      breakdowns: query.breakdowns,
      filters,
    };
    const legacy = this.buildOverview(
      internalQuery,
      selectedApps.map((app) => ({ id: app.id, name: app.name, bundleId: app.bundleId, platforms: app.platforms })),
      merged,
    );
    const { schemaVersion: _schemaVersion, ...legacyFields } = legacy;
    const publicApps = selectedApps.map(({ rawAppId: _rawAppId, ...app }) => app);
    const response: AnalyticsOverviewResponseV2 = legacy.scope === "APP"
      ? {
        ...legacyFields,
        schemaVersion: 2,
        catalogRevision: context.catalogRevision,
        scope: "APP",
        appId: legacy.appId,
        apps: publicApps,
        sourceCoverage,
      }
      : {
        ...legacyFields,
        schemaVersion: 2,
        catalogRevision: context.catalogRevision,
        scope: "PORTFOLIO",
        appIds: legacy.appIds,
        apps: publicApps,
        sourceCoverage,
      };
    return AnalyticsOverviewResponseV2Schema.parse(response);
  }

  private buildOverview(
    query: AnalyticsOverviewQuery,
    apps: AppSummary[],
    stored: AnalyticsStoredSnapshot | null,
  ): AnalyticsOverviewResponse {
    const filters = query.filters ?? { territories: [], sources: [], productPages: [], versions: [] };
    const comparisonPeriod = query.compare === "PREVIOUS_PERIOD"
      ? previousAnalyticsPeriod(query.startDate, query.endDate)
      : null;
    const appNames = new Map(apps.map((app) => [app.id, app.name]));
    const observations = stored?.observations ?? [];
    const current = observations.filter((observation) => inRange(observation, query.startDate, query.endDate));
    const previous = comparisonPeriod
      ? observations.filter((observation) => inRange(observation, comparisonPeriod.startDate, comparisonPeriod.endDate))
      : null;
    const referenceDate = this.dependencies.now().toISOString().slice(0, 10);
    const emptyId = this.dependencies.digest(JSON.stringify({ query, at: referenceDate }));
    const snapshotId = stored?.provenance.snapshotId ?? `empty:${emptyId}`;
    const evidenceId = stored?.provenance.evidenceId ?? `empty:${emptyId}`;
    const provenance: AnalyticsProvenance = stored?.provenance ?? {
      source: "APP_STORE_CONNECT_ANALYTICS_REPORTS",
      reportNames: [],
      reportRequestIds: [],
      snapshotId,
      evidenceId,
    };
    const metricCoverage = buildMetricCoverage(query, current, stored?.metricCoverage, referenceDate);
    const coverageByMetric = new Map(metricCoverage.map((item) => [item.metric, item]));
    const common = {
      schemaVersion: 1 as const,
      period: { startDate: query.startDate, endDate: query.endDate },
      comparisonPeriod,
      kpis: buildKpis(
        current,
        previous,
        evidenceId,
        query.appIds,
        coverageByMetric,
        query.endDate,
        comparisonPeriod?.endDate ?? null,
      ),
      series: buildSeries(query, current, previous, comparisonPeriod, evidenceId, query.appIds, coverageByMetric),
      breakdowns: buildBreakdowns(query, current, previous, appNames, evidenceId, coverageByMetric, comparisonPeriod),
      appContributions: buildContributions(
        query,
        current,
        previous,
        appNames,
        evidenceId,
        coverageByMetric,
        comparisonPeriod,
      ),
      freshness: stored?.freshness ?? emptyFreshness(),
      privacy: stored?.privacy ?? emptyPrivacy(),
      provenance,
      metricCoverage,
      appliedFilters: filters,
      facets: stored?.facets ?? {
        territories: [...new Set(current.flatMap((observation) => observation.dimensions.territory ? [observation.dimensions.territory] : []))].sort(),
        sources: [...new Set(current.flatMap((observation) => observation.dimensions.source ? [observation.dimensions.source] : []))].sort(),
        productPages: [...new Set(current.flatMap((observation) => observation.dimensions.productPage ? [observation.dimensions.productPage] : []))].sort(),
        versions: [...new Set(current.flatMap((observation) => observation.dimensions.version ? [observation.dimensions.version] : []))].sort(),
      },
      snapshotId,
      evidenceId,
    };
    const response: AnalyticsOverviewResponse = query.scope === "APP"
      ? { ...common, scope: "APP", appId: query.appIds[0]! }
      : { ...common, scope: "PORTFOLIO", appIds: query.appIds };
    return AnalyticsOverviewResponseSchema.parse(response);
  }
}
