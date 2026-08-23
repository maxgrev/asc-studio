import {
  ANALYTICS_METRIC_COMPLETENESS_DAYS,
  AnalyticsOverviewResponseSchema,
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
  type AnalyticsOverviewResponse,
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
    const appNames = new Map(context.apps.map((app) => [app.id, app.name]));
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
