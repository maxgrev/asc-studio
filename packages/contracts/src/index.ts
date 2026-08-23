import { z } from "zod";

export const AppSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  bundleId: z.string(),
  platforms: z.array(z.string()).default([]),
});
export type AppSummary = z.infer<typeof AppSummarySchema>;

export const CustomerReviewResponseStateSchema = z.enum(["PENDING_PUBLISH", "PUBLISHED"]);
export type CustomerReviewResponseState = z.infer<typeof CustomerReviewResponseStateSchema>;

export const CustomerReviewResponseSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  responseBody: z.string(),
  lastModifiedAt: z.string().nullable(),
  state: CustomerReviewResponseStateSchema,
}).strict();
export type CustomerReviewResponse = z.infer<typeof CustomerReviewResponseSchema>;

export const CustomerReviewSchema = z.object({
  id: z.string(),
  appId: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string(),
  body: z.string(),
  reviewerNickname: z.string(),
  createdAt: z.string(),
  territory: z.string().regex(/^[A-Z]{3}$/, "Use an ISO 3166-1 alpha-3 territory code."),
  response: CustomerReviewResponseSchema.nullable(),
}).strict();
export type CustomerReview = z.infer<typeof CustomerReviewSchema>;

export const CustomerReviewSortSchema = z.enum(["rating", "-rating", "createdDate", "-createdDate"]);
export type CustomerReviewSort = z.infer<typeof CustomerReviewSortSchema>;

export const CustomerReviewsPageSchema = z.object({
  reviews: z.array(CustomerReviewSchema),
  total: z.number().nullable(),
  nextCursor: z.string().nullable(),
}).strict();
export type CustomerReviewsPage = z.infer<typeof CustomerReviewsPageSchema>;

export const CustomerReviewsResponseSchema = CustomerReviewsPageSchema;
export type CustomerReviewsResponse = CustomerReviewsPage;

export const UpsertCustomerReviewResponseInputSchema = z.object({
  appId: z.string(),
  reviewId: z.string(),
  responseBody: z.string().refine((value) => value.trim().length > 0, "Enter a non-empty response."),
}).strict();
export type UpsertCustomerReviewResponseInput = z.infer<typeof UpsertCustomerReviewResponseInputSchema>;

export const GenerateCustomerReviewReplyInputSchema = z.object({
  appId: z.string().min(1),
  reviewId: z.string().min(1),
}).strict();
export type GenerateCustomerReviewReplyInput = z.infer<typeof GenerateCustomerReviewReplyInputSchema>;

export const GeneratedCustomerReviewReplyResponseSchema = z.object({
  responseBody: z.string().trim().min(1),
}).strict();
export type GeneratedCustomerReviewReplyResponse = z.infer<typeof GeneratedCustomerReviewReplyResponseSchema>;

export const StatusToneSchema = z.enum(["success", "warning", "danger", "neutral", "progress"]);
export type StatusTone = z.infer<typeof StatusToneSchema>;

export const TesterGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  testerCount: z.number().int().nonnegative().nullable(),
  internal: z.boolean(),
});
export type TesterGroup = z.infer<typeof TesterGroupSchema>;

export const BuildSummarySchema = z.object({
  id: z.string(),
  appId: z.string(),
  buildNumber: z.string(),
  version: z.string(),
  uploadedAt: z.string(),
  processingStatus: z.string(),
  processingTone: StatusToneSchema,
  testingStatus: z.string(),
  expiresAt: z.string().nullable(),
  expired: z.boolean(),
  platform: z.string(),
  sdk: z.string().nullable(),
  minimumOs: z.string().nullable(),
  encryption: z.string().nullable(),
  groups: z.array(TesterGroupSchema),
});
export type BuildSummary = z.infer<typeof BuildSummarySchema>;

export const AgentModeSchema = z.enum(["live", "demo"]);
export const AgentStatusSchema = z.object({
  mode: AgentModeSchema,
  connected: z.boolean(),
  provider: z.enum(["app-store-connect-api", "demo"]),
  connectionId: z.string().nullable(),
  profile: z.string().nullable(),
  authBackend: z.string().nullable(),
  detail: z.string(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AnalyticsSchemaVersionSchema = z.literal(1);
export type AnalyticsSchemaVersion = z.infer<typeof AnalyticsSchemaVersionSchema>;

export const AnalyticsIsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format.");
export const AnalyticsIsoDateTimeSchema = z.string().datetime();

export const AnalyticsMetricIdSchema = z.enum([
  "IMPRESSIONS",
  "DOWNLOADS",
  "FIRST_TIME_DOWNLOADS",
  "PRODUCT_PAGE_VIEWS",
  "DOWNLOAD_RATE",
  "SESSIONS",
  "PROCEEDS",
]);
export type AnalyticsMetricId = z.infer<typeof AnalyticsMetricIdSchema>;

export const AnalyticsAdditiveMetricIdSchema = z.enum([
  "IMPRESSIONS",
  "DOWNLOADS",
  "FIRST_TIME_DOWNLOADS",
  "PRODUCT_PAGE_VIEWS",
  "SESSIONS",
  "PROCEEDS",
]);
export type AnalyticsAdditiveMetricId = z.infer<typeof AnalyticsAdditiveMetricIdSchema>;

export const ANALYTICS_METRIC_COMPLETENESS_DAYS: Record<AnalyticsAdditiveMetricId, number> = {
  IMPRESSIONS: 3,
  DOWNLOADS: 2,
  FIRST_TIME_DOWNLOADS: 2,
  PRODUCT_PAGE_VIEWS: 3,
  SESSIONS: 5,
  PROCEEDS: 2,
};

export const AnalyticsMetricUnitSchema = z.enum(["COUNT", "RATIO", "CURRENCY_USD"]);
export type AnalyticsMetricUnit = z.infer<typeof AnalyticsMetricUnitSchema>;

export const AnalyticsAvailabilitySchema = z.enum([
  "AVAILABLE",
  "PARTIAL",
  "UNAVAILABLE",
  "PRIVACY_WITHHELD",
]);
export type AnalyticsAvailability = z.infer<typeof AnalyticsAvailabilitySchema>;

export const AnalyticsScopeSchema = z.enum(["APP", "PORTFOLIO"]);
export type AnalyticsScope = z.infer<typeof AnalyticsScopeSchema>;

export const AnalyticsComparisonModeSchema = z.enum(["NONE", "PREVIOUS_PERIOD"]);
export type AnalyticsComparisonMode = z.infer<typeof AnalyticsComparisonModeSchema>;

export const AnalyticsGranularitySchema = z.enum(["DAY", "WEEK", "MONTH"]);
export type AnalyticsGranularity = z.infer<typeof AnalyticsGranularitySchema>;

export const AnalyticsBreakdownDimensionSchema = z.enum([
  "APP",
  "TERRITORY",
  "SOURCE",
  "PRODUCT_PAGE",
  "VERSION",
]);
export type AnalyticsBreakdownDimension = z.infer<typeof AnalyticsBreakdownDimensionSchema>;

const AnalyticsFilterValueSchema = z.string().min(1).max(200)
  .refine((value) => value.trim().length > 0, "Analytics filter values must contain visible text.")
  .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value), "Analytics filter values cannot contain control characters.");
const uniqueAnalyticsFilterValues = (values: string[]) => new Set(values).size === values.length;
const AnalyticsFilterValuesSchema = z.array(AnalyticsFilterValueSchema).max(100)
  .refine(uniqueAnalyticsFilterValues, "Choose each analytics filter value only once.");
export const AnalyticsFiltersSchema = z.object({
  territories: AnalyticsFilterValuesSchema.default([]),
  sources: AnalyticsFilterValuesSchema.default([]),
  productPages: AnalyticsFilterValuesSchema.default([]),
  versions: AnalyticsFilterValuesSchema.default([]),
}).strict();
export type AnalyticsFilters = z.infer<typeof AnalyticsFiltersSchema>;

export const AnalyticsFacetsSchema = z.object({
  territories: z.array(AnalyticsFilterValueSchema).max(500),
  sources: z.array(AnalyticsFilterValueSchema).max(500),
  productPages: z.array(AnalyticsFilterValueSchema).max(500),
  versions: z.array(AnalyticsFilterValueSchema).max(500),
}).strict();
export type AnalyticsFacets = z.infer<typeof AnalyticsFacetsSchema>;

const AnalyticsOverviewQueryBaseSchema = z.object({
  schemaVersion: AnalyticsSchemaVersionSchema.default(1),
  appIds: z.array(z.string().min(1)).min(1).max(2_000),
  startDate: AnalyticsIsoDateSchema,
  endDate: AnalyticsIsoDateSchema,
  compare: AnalyticsComparisonModeSchema.default("PREVIOUS_PERIOD"),
  granularity: AnalyticsGranularitySchema.default("DAY"),
  breakdowns: z.array(AnalyticsBreakdownDimensionSchema).max(5).default(["APP", "TERRITORY", "SOURCE"]),
  filters: AnalyticsFiltersSchema.optional(),
}).strict();

export const AnalyticsAppOverviewQuerySchema = AnalyticsOverviewQueryBaseSchema.extend({
  scope: z.literal("APP"),
  appIds: z.array(z.string().min(1)).length(1),
}).strict().refine((query) => query.startDate <= query.endDate, {
  message: "The start date must not be after the end date.",
  path: ["startDate"],
});
export type AnalyticsAppOverviewQuery = z.infer<typeof AnalyticsAppOverviewQuerySchema>;

export const AnalyticsPortfolioOverviewQuerySchema = AnalyticsOverviewQueryBaseSchema.extend({
  scope: z.literal("PORTFOLIO"),
}).strict().refine((query) => query.startDate <= query.endDate, {
  message: "The start date must not be after the end date.",
  path: ["startDate"],
});
export type AnalyticsPortfolioOverviewQuery = z.infer<typeof AnalyticsPortfolioOverviewQuerySchema>;

export const AnalyticsOverviewQuerySchema = z.union([
  AnalyticsAppOverviewQuerySchema,
  AnalyticsPortfolioOverviewQuerySchema,
]);
export type AnalyticsOverviewQuery = z.infer<typeof AnalyticsOverviewQuerySchema>;

export const AnalyticsDateRangeSchema = z.object({
  startDate: AnalyticsIsoDateSchema,
  endDate: AnalyticsIsoDateSchema,
}).strict().refine((range) => range.startDate <= range.endDate, {
  message: "The start date must not be after the end date.",
  path: ["startDate"],
});
export type AnalyticsDateRange = z.infer<typeof AnalyticsDateRangeSchema>;

export const AnalyticsEvidenceIdSchema = z.string().min(1);
export type AnalyticsEvidenceId = z.infer<typeof AnalyticsEvidenceIdSchema>;
export const AnalyticsSnapshotIdSchema = z.string().min(1);
export type AnalyticsSnapshotId = z.infer<typeof AnalyticsSnapshotIdSchema>;

export const AnalyticsMetricValueSchema = z.object({
  value: z.number().finite().nullable(),
  availability: AnalyticsAvailabilitySchema,
}).strict().superRefine((measure, context) => {
  if ((measure.availability === "AVAILABLE" || measure.availability === "PARTIAL") && measure.value === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Available and partial analytics values must contain a number.",
      path: ["value"],
    });
  }
  if ((measure.availability === "UNAVAILABLE" || measure.availability === "PRIVACY_WITHHELD") && measure.value !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unavailable and privacy-withheld analytics values must be null.",
      path: ["value"],
    });
  }
});
export type AnalyticsMetricValue = z.infer<typeof AnalyticsMetricValueSchema>;

export const AnalyticsMetricChangeSchema = z.object({
  absolute: z.number().finite().nullable(),
  relative: z.number().finite().nullable(),
}).strict();
export type AnalyticsMetricChange = z.infer<typeof AnalyticsMetricChangeSchema>;

export const AnalyticsKpiSchema = z.object({
  metric: AnalyticsMetricIdSchema,
  label: z.string().min(1),
  unit: AnalyticsMetricUnitSchema,
  formula: z.string().min(1).nullable(),
  current: AnalyticsMetricValueSchema,
  previous: AnalyticsMetricValueSchema.nullable(),
  change: AnalyticsMetricChangeSchema.nullable(),
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict();
export type AnalyticsKpi = z.infer<typeof AnalyticsKpiSchema>;

export const AnalyticsSeriesPointSchema = z.object({
  date: AnalyticsIsoDateSchema,
  current: AnalyticsMetricValueSchema,
  previous: AnalyticsMetricValueSchema.nullable(),
}).strict();
export type AnalyticsSeriesPoint = z.infer<typeof AnalyticsSeriesPointSchema>;

export const AnalyticsSeriesSchema = z.object({
  metric: AnalyticsMetricIdSchema,
  label: z.string().min(1),
  unit: AnalyticsMetricUnitSchema,
  formula: z.string().min(1).nullable(),
  points: z.array(AnalyticsSeriesPointSchema),
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict();
export type AnalyticsSeries = z.infer<typeof AnalyticsSeriesSchema>;

export const AnalyticsBreakdownRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  appId: z.string().min(1).nullable(),
  current: AnalyticsMetricValueSchema,
  previous: AnalyticsMetricValueSchema.nullable(),
  change: AnalyticsMetricChangeSchema.nullable(),
  share: z.number().finite().nullable(),
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict();
export type AnalyticsBreakdownRow = z.infer<typeof AnalyticsBreakdownRowSchema>;

export const AnalyticsBreakdownSchema = z.object({
  dimension: AnalyticsBreakdownDimensionSchema,
  metric: AnalyticsMetricIdSchema,
  label: z.string().min(1),
  rows: z.array(AnalyticsBreakdownRowSchema),
}).strict();
export type AnalyticsBreakdown = z.infer<typeof AnalyticsBreakdownSchema>;

export const AnalyticsAppContributionSchema = z.object({
  appId: z.string().min(1),
  appName: z.string().min(1),
  metric: AnalyticsAdditiveMetricIdSchema,
  currentValue: z.number().finite().nullable(),
  currentAvailability: AnalyticsAvailabilitySchema,
  previousValue: z.number().finite().nullable(),
  previousAvailability: AnalyticsAvailabilitySchema.nullable(),
  absoluteChange: z.number().finite().nullable(),
  shareOfPortfolioChange: z.number().finite().nullable(),
  direction: z.enum(["UP", "DOWN", "FLAT", "UNAVAILABLE"]),
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict();
export type AnalyticsAppContribution = z.infer<typeof AnalyticsAppContributionSchema>;

export const AnalyticsFreshnessSchema = z.object({
  syncedAt: AnalyticsIsoDateTimeSchema.nullable(),
  dataThrough: AnalyticsIsoDateSchema.nullable(),
  expectedDelayDays: z.number().int().nonnegative().nullable(),
  partial: z.boolean(),
  detail: z.string().min(1),
}).strict();
export type AnalyticsFreshness = z.infer<typeof AnalyticsFreshnessSchema>;

export const AnalyticsPrivacySchema = z.object({
  aggregatedOnly: z.literal(true),
  includesOptInUsageData: z.boolean(),
  mayIncludePrivacyAdjustments: z.boolean(),
  detail: z.string().min(1),
}).strict();
export type AnalyticsPrivacy = z.infer<typeof AnalyticsPrivacySchema>;

export const AnalyticsProvenanceSchema = z.object({
  source: z.literal("APP_STORE_CONNECT_ANALYTICS_REPORTS"),
  reportNames: z.array(z.string().min(1)),
  reportRequestIds: z.array(z.string().min(1)),
  snapshotId: AnalyticsSnapshotIdSchema,
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict();
export type AnalyticsProvenance = z.infer<typeof AnalyticsProvenanceSchema>;

export const AnalyticsMetricCoverageFamilySchema = z.object({
  reportName: z.string().min(1),
  expectedDelayDays: z.number().int().nonnegative(),
  completeThrough: AnalyticsIsoDateSchema.nullable(),
  availability: AnalyticsAvailabilitySchema,
  detail: z.string().min(1),
}).strict();
export type AnalyticsMetricCoverageFamily = z.infer<typeof AnalyticsMetricCoverageFamilySchema>;

export const AnalyticsMetricCoverageSchema = z.object({
  metric: AnalyticsMetricIdSchema,
  source: z.literal("APP_STORE_CONNECT_ANALYTICS_REPORTS"),
  formula: z.string().min(1).nullable(),
  expectedDelayDays: z.number().int().nonnegative(),
  completeThrough: AnalyticsIsoDateSchema.nullable(),
  availability: AnalyticsAvailabilitySchema,
  detail: z.string().min(1),
  reportFamilies: z.array(AnalyticsMetricCoverageFamilySchema),
}).strict();
export type AnalyticsMetricCoverage = z.infer<typeof AnalyticsMetricCoverageSchema>;

const AnalyticsOverviewResponseBaseSchema = z.object({
  schemaVersion: AnalyticsSchemaVersionSchema,
  period: AnalyticsDateRangeSchema,
  comparisonPeriod: AnalyticsDateRangeSchema.nullable(),
  kpis: z.array(AnalyticsKpiSchema),
  series: z.array(AnalyticsSeriesSchema),
  breakdowns: z.array(AnalyticsBreakdownSchema),
  appContributions: z.array(AnalyticsAppContributionSchema),
  freshness: AnalyticsFreshnessSchema,
  privacy: AnalyticsPrivacySchema,
  provenance: AnalyticsProvenanceSchema,
  metricCoverage: z.array(AnalyticsMetricCoverageSchema),
  appliedFilters: AnalyticsFiltersSchema,
  facets: AnalyticsFacetsSchema,
  snapshotId: AnalyticsSnapshotIdSchema,
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict();

export const AnalyticsAppOverviewResponseSchema = AnalyticsOverviewResponseBaseSchema.extend({
  scope: z.literal("APP"),
  appId: z.string().min(1),
}).strict();
export type AnalyticsAppOverviewResponse = z.infer<typeof AnalyticsAppOverviewResponseSchema>;

export const AnalyticsPortfolioOverviewResponseSchema = AnalyticsOverviewResponseBaseSchema.extend({
  scope: z.literal("PORTFOLIO"),
  appIds: z.array(z.string().min(1)).min(1),
}).strict();
export type AnalyticsPortfolioOverviewResponse = z.infer<typeof AnalyticsPortfolioOverviewResponseSchema>;

export const AnalyticsOverviewResponseSchema = z.union([
  AnalyticsAppOverviewResponseSchema,
  AnalyticsPortfolioOverviewResponseSchema,
]);
export type AnalyticsOverviewResponse = z.infer<typeof AnalyticsOverviewResponseSchema>;

export const AnalyticsReportAccessTypeSchema = z.enum(["ONE_TIME_SNAPSHOT", "ONGOING"]);
export type AnalyticsReportAccessType = z.infer<typeof AnalyticsReportAccessTypeSchema>;

export const AnalyticsReportRequestSchema = z.object({
  id: z.string().min(1),
  appId: z.string().min(1),
  accessType: AnalyticsReportAccessTypeSchema,
  createdAt: AnalyticsIsoDateTimeSchema.nullable(),
  stoppedDueToInactivity: z.boolean(),
}).strict();
export type AnalyticsReportRequest = z.infer<typeof AnalyticsReportRequestSchema>;

export const AnalyticsReportRequestCreateInputSchema = z.object({
  appId: z.string().min(1),
  accessType: AnalyticsReportAccessTypeSchema,
}).strict();
export type AnalyticsReportRequestCreateInput = z.infer<typeof AnalyticsReportRequestCreateInputSchema>;

export const AnalyticsStatusStateSchema = z.enum([
  "NOT_CONFIGURED",
  "WAITING_FOR_DATA",
  "READY",
  "SYNCING",
  "PARTIAL",
  "ERROR",
]);
export type AnalyticsStatusState = z.infer<typeof AnalyticsStatusStateSchema>;

export const AnalyticsStatusResponseSchema = z.object({
  schemaVersion: AnalyticsSchemaVersionSchema,
  issuerId: z.string().min(1).nullable(),
  state: AnalyticsStatusStateSchema,
  reportRequests: z.array(AnalyticsReportRequestSchema),
  freshness: AnalyticsFreshnessSchema,
  detail: z.string().min(1),
}).strict();
export type AnalyticsStatusResponse = z.infer<typeof AnalyticsStatusResponseSchema>;

export const AnalyticsObservationSchema = z.object({
  date: AnalyticsIsoDateSchema,
  appId: z.string().min(1),
  metric: AnalyticsAdditiveMetricIdSchema,
  value: z.number().finite().nullable(),
  currency: z.literal("USD").nullable(),
  dimensions: z.record(z.string(), z.string()),
  reportName: z.string().min(1),
  availability: AnalyticsAvailabilitySchema,
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict().superRefine((observation, context) => {
  const numericAvailability = observation.availability === "AVAILABLE" || observation.availability === "PARTIAL";
  if (numericAvailability && observation.value === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Available and partial analytics observations must contain a number.",
      path: ["value"],
    });
  }
  if (!numericAvailability && observation.value !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Unavailable and privacy-withheld analytics observations must contain null, not a numeric sentinel.",
      path: ["value"],
    });
  }
  if (observation.metric !== "PROCEEDS" && observation.value !== null && observation.value < 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Count observations cannot be negative; only proceeds may be negative after refunds.",
      path: ["value"],
    });
  }
});
export type AnalyticsObservation = z.infer<typeof AnalyticsObservationSchema>;

export const AnalyticsSegmentEvidenceSchema = z.object({
  segmentId: z.string().min(1),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteCount: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
}).strict();
export type AnalyticsSegmentEvidence = z.infer<typeof AnalyticsSegmentEvidenceSchema>;

export const AnalyticsFactBatchSchema = z.object({
  schemaVersion: AnalyticsSchemaVersionSchema,
  issuerId: z.string().min(1),
  appId: z.string().min(1),
  accessType: AnalyticsReportAccessTypeSchema,
  reportRequestId: z.string().min(1),
  reportId: z.string().min(1),
  reportName: z.string().min(1),
  category: z.string().min(1),
  granularity: z.literal("DAILY"),
  instanceId: z.string().min(1),
  processingDate: AnalyticsIsoDateSchema,
  partitionDates: z.array(AnalyticsIsoDateSchema),
  segmentIds: z.array(z.string().min(1)).min(1),
  segments: z.array(AnalyticsSegmentEvidenceSchema).min(1),
  expectedSegmentCount: z.number().int().positive(),
  verifiedSegmentCount: z.number().int().positive(),
  observations: z.array(AnalyticsObservationSchema),
  snapshotId: AnalyticsSnapshotIdSchema,
  evidenceId: AnalyticsEvidenceIdSchema,
}).strict().superRefine((batch, context) => {
  if (batch.expectedSegmentCount !== batch.verifiedSegmentCount || batch.segments.length !== batch.verifiedSegmentCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Only complete, verified report instances may be stored." });
  }
  const segmentIds = [...batch.segmentIds].sort();
  const evidenceIds = batch.segments.map((segment) => segment.segmentId).sort();
  if (JSON.stringify(segmentIds) !== JSON.stringify(evidenceIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Segment evidence must cover every reported segment ID." });
  }
  if (new Set(batch.partitionDates).size !== batch.partitionDates.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Analytics partition dates must be unique.",
      path: ["partitionDates"],
    });
  }
  const partitionDates = new Set(batch.partitionDates);
  batch.partitionDates.forEach((date, index) => {
    if (date > batch.processingDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Analytics partition dates cannot be later than the report processing date.",
        path: ["partitionDates", index],
      });
    }
  });
  batch.observations.forEach((observation, index) => {
    if (!partitionDates.has(observation.date)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Every analytics observation must belong to a declared raw partition date.",
        path: ["observations", index, "date"],
      });
    }
  });
});
export type AnalyticsFactBatch = z.infer<typeof AnalyticsFactBatchSchema>;

export const AnalyticsObservationQuerySchema = z.object({
  issuerId: z.string().min(1),
  appIds: z.array(z.string().min(1)).min(1).max(2_000),
  startDate: AnalyticsIsoDateSchema,
  endDate: AnalyticsIsoDateSchema,
  filters: AnalyticsFiltersSchema.optional(),
  facetStartDate: AnalyticsIsoDateSchema.optional(),
}).strict().refine((query) => query.startDate <= query.endDate, {
  message: "The start date must not be after the end date.",
  path: ["startDate"],
}).refine((query) => query.facetStartDate === undefined || query.facetStartDate <= query.endDate, {
  message: "The facet start date must not be after the end date.",
  path: ["facetStartDate"],
});
export type AnalyticsObservationQuery = z.infer<typeof AnalyticsObservationQuerySchema>;

export const AnalyticsSyncInputSchema = z.object({
  schemaVersion: AnalyticsSchemaVersionSchema.default(1),
  appIds: z.array(z.string().min(1)).min(1).max(2_000),
  force: z.boolean().default(false),
}).strict();
export type AnalyticsSyncInput = z.infer<typeof AnalyticsSyncInputSchema>;

export const AnalyticsSyncStateSchema = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "PARTIAL", "FAILED"]);
export type AnalyticsSyncState = z.infer<typeof AnalyticsSyncStateSchema>;

export const AnalyticsSyncResultSchema = z.object({
  schemaVersion: AnalyticsSchemaVersionSchema,
  issuerId: z.string().min(1),
  runId: z.string().min(1),
  state: AnalyticsSyncStateSchema,
  appIds: z.array(z.string().min(1)).min(1),
  batches: z.array(AnalyticsFactBatchSchema),
  reportRequests: z.array(AnalyticsReportRequestSchema),
  startedAt: AnalyticsIsoDateTimeSchema,
  completedAt: AnalyticsIsoDateTimeSchema.nullable(),
  snapshotId: AnalyticsSnapshotIdSchema.nullable(),
  evidenceId: AnalyticsEvidenceIdSchema,
  freshness: AnalyticsFreshnessSchema,
  error: z.string().min(1).nullable(),
}).strict();
export type AnalyticsSyncResult = z.infer<typeof AnalyticsSyncResultSchema>;

export const AnalyticsSyncResponseSchema = AnalyticsSyncResultSchema.omit({ batches: true }).extend({
  batchCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
}).strict();
export type AnalyticsSyncResponse = z.infer<typeof AnalyticsSyncResponseSchema>;

export const AppleAdsStatusSchema = z.object({
  mode: AgentModeSchema,
  configured: z.boolean(),
  connected: z.boolean(),
  provider: z.enum(["apple-ads-platform-api", "demo"]),
  adAccountId: z.string().min(1).nullable(),
  detail: z.string().min(1),
}).strict();
export type AppleAdsStatus = z.infer<typeof AppleAdsStatusSchema>;

export const AppleAdsCredentialsInputSchema = z.object({
  clientId: z.string().trim().regex(/^SEARCHADS\.[A-Za-z0-9-]+$/, "Use the SEARCHADS client ID shown in Apple Ads."),
  teamId: z.string().trim().regex(/^SEARCHADS\.[A-Za-z0-9-]+$/, "Use the SEARCHADS team ID shown in Apple Ads."),
  keyId: z.string().trim().regex(/^[A-Za-z0-9-]{1,128}$/, "Use the key ID shown in Apple Ads."),
  adAccountId: z.string().trim().regex(/^\d+$/, "Use the numeric ad account ID."),
  setupId: z.string().uuid().optional(),
  privateKey: z.string().min(1).max(16_384).optional(),
}).strict().superRefine((input, context) => {
  if ((input.setupId ? 1 : 0) + (input.privateKey ? 1 : 0) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Use a generated key or provide one private key." });
  }
});
export type AppleAdsCredentialsInput = z.infer<typeof AppleAdsCredentialsInputSchema>;

export const AppleAdsGeneratedKeyResponseSchema = z.object({
  setupId: z.string().uuid(),
  publicKey: z.string().min(1),
  expiresAt: z.string().datetime(),
}).strict();
export type AppleAdsGeneratedKeyResponse = z.infer<typeof AppleAdsGeneratedKeyResponseSchema>;

export const AppleAdsConnectionSchema = z.object({
  configured: z.boolean(),
  profileName: z.string().min(1).nullable(),
  appStoreConnectConnectionId: z.string().min(1).nullable(),
  adAccountId: z.string().min(1).nullable(),
  keyId: z.string().min(1).nullable(),
  source: z.enum(["local", "environment", "demo"]).nullable(),
}).strict();
export type AppleAdsConnection = z.infer<typeof AppleAdsConnectionSchema>;

export const AppleAdsConnectionResponseSchema = z.object({
  status: AppleAdsStatusSchema,
  connection: AppleAdsConnectionSchema,
}).strict();
export type AppleAdsConnectionResponse = z.infer<typeof AppleAdsConnectionResponseSchema>;

export const AppleAdsMoneySchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d+)?$/, "Use a non-negative decimal amount."),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use an ISO 4217 currency code."),
}).strict();
export type AppleAdsMoney = z.infer<typeof AppleAdsMoneySchema>;

export const AppleAdsCampaignSchema = z.object({
  id: z.string().min(1),
  adAccountId: z.string().min(1),
  name: z.string().min(1),
  promotedObjectId: z.string().min(1),
  status: z.string().min(1),
  systemStatus: z.string().min(1),
  displayStatus: z.string().min(1),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  dailyBudget: AppleAdsMoneySchema,
  countriesOrRegions: z.array(z.string().regex(/^[A-Z]{2}$/)),
  supplyPlacements: z.array(z.string().min(1)),
  bidStrategyType: z.string().min(1),
  deleted: z.boolean(),
  modificationTime: z.string().nullable(),
}).strict();
export type AppleAdsCampaign = z.infer<typeof AppleAdsCampaignSchema>;

export const AppleAdsAdGroupSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  systemStatus: z.string().min(1),
  displayStatus: z.string().min(1),
  automatedKeywordsOptIn: z.boolean(),
  bid: AppleAdsMoneySchema.nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  deleted: z.boolean(),
  modificationTime: z.string().nullable(),
}).strict();
export type AppleAdsAdGroup = z.infer<typeof AppleAdsAdGroupSchema>;

export const AppleAdsKeywordSchema = z.object({
  id: z.string().min(1),
  campaignId: z.string().min(1),
  adGroupId: z.string().min(1),
  text: z.string().min(1),
  matchType: z.string().min(1),
  bid: AppleAdsMoneySchema.nullable(),
  status: z.string().min(1),
  displayStatus: z.string().min(1),
  deleted: z.boolean(),
  modificationTime: z.string().nullable(),
}).strict();
export type AppleAdsKeyword = z.infer<typeof AppleAdsKeywordSchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in YYYY-MM-DD format.");
export const AppleAdsKeywordResearchInputSchema = z.object({
  appId: z.string().min(1),
  countryOrRegion: z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 country code."),
  genre: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/, "Use an Apple Ads genre identifier."),
  start: IsoDateSchema,
  end: IsoDateSchema,
  granularity: z.enum(["WEEKLY_SUN_SAT", "MONTHLY"]),
  seedTerms: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  limit: z.number().int().min(1).max(200).default(50),
}).strict().superRefine((input, context) => {
  if (input.start > input.end) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The start date must not be after the end date.", path: ["start"] });
  }
  if (input.granularity === "WEEKLY_SUN_SAT" && new Date(`${input.start}T00:00:00Z`).getUTCDay() !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Weekly research must start on a Sunday.", path: ["start"] });
  }
});
export type AppleAdsKeywordResearchInput = z.infer<typeof AppleAdsKeywordResearchInputSchema>;

export const AppleAdsKeywordResearchItemSchema = z.object({
  text: z.string().min(1),
  source: z.enum(["suggestion", "popularity", "both"]),
  suggestionPopularity: z.number().min(0).max(100).nullable(),
  searchPopularity: z.number().min(1).max(100).nullable(),
  searchPopularityInGenre: z.number().min(1).max(100).nullable(),
  rankInGenre: z.number().int().positive().nullable(),
  searchPopularityTier: z.number().int().min(1).max(5).nullable(),
  opportunityScore: z.number().min(0).max(100),
}).strict();
export type AppleAdsKeywordResearchItem = z.infer<typeof AppleAdsKeywordResearchItemSchema>;

export const AppleAdsKeywordResearchResultSchema = z.object({
  appId: z.string().min(1),
  countryOrRegion: z.string().regex(/^[A-Z]{2}$/),
  genre: z.string().min(1),
  start: IsoDateSchema,
  end: IsoDateSchema,
  granularity: z.enum(["WEEKLY_SUN_SAT", "MONTHLY"]),
  keywords: z.array(AppleAdsKeywordResearchItemSchema),
  note: z.string().min(1),
}).strict();
export type AppleAdsKeywordResearchResult = z.infer<typeof AppleAdsKeywordResearchResultSchema>;

export const AppleAdsCampaignReportInputSchema = z.object({
  campaignId: z.string().min(1),
  start: IsoDateSchema,
  end: IsoDateSchema,
  timeZone: z.enum(["ORTZ", "UTC"]).default("ORTZ"),
}).strict().refine((input) => input.start <= input.end, {
  message: "The start date must not be after the end date.",
  path: ["start"],
});
export type AppleAdsCampaignReportInput = z.infer<typeof AppleAdsCampaignReportInputSchema>;

export const AppleAdsCampaignMetricsSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().min(1),
  localSpend: AppleAdsMoneySchema.nullable(),
  impressions: z.number().int().nonnegative(),
  taps: z.number().int().nonnegative(),
  tapThroughRate: z.number().nonnegative(),
  tapInstalls: z.number().int().nonnegative(),
  totalInstalls: z.number().int().nonnegative(),
  averageCostPerTap: AppleAdsMoneySchema.nullable(),
  averageCostPerAcquisition: AppleAdsMoneySchema.nullable(),
}).strict();
export type AppleAdsCampaignMetrics = z.infer<typeof AppleAdsCampaignMetricsSchema>;

const AppleAdsTimestampSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/,
  "Use an Apple Ads UTC timestamp such as 2026-09-01T00:00:00.000.",
);
const AppleAdsRunStatusSchema = z.enum(["ENABLED", "PAUSED"]);
const AppleAdsCountrySchema = z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 country code.");

export const CreateAppleAdsCampaignInputSchema = z.object({
  promotedObjectId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  dailyBudget: AppleAdsMoneySchema,
  countriesOrRegions: z.array(AppleAdsCountrySchema).min(1).max(50),
  startTime: AppleAdsTimestampSchema.nullable().default(null),
  endTime: AppleAdsTimestampSchema.nullable().default(null),
  status: z.literal("PAUSED").default("PAUSED"),
  bidStrategyType: z.enum(["MANUAL_CPT", "MAX_CONVERSIONS"]).default("MANUAL_CPT"),
}).strict().superRefine((input, context) => {
  if (input.startTime && input.endTime && input.startTime >= input.endTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The end time must be after the start time.", path: ["endTime"] });
  }
  if (new Set(input.countriesOrRegions).size !== input.countriesOrRegions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Countries or regions must be unique.", path: ["countriesOrRegions"] });
  }
});
export type CreateAppleAdsCampaignInput = z.infer<typeof CreateAppleAdsCampaignInputSchema>;

export const UpdateAppleAdsCampaignInputSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  dailyBudget: AppleAdsMoneySchema.optional(),
  countriesOrRegions: z.array(AppleAdsCountrySchema).min(1).max(50).optional(),
  endTime: AppleAdsTimestampSchema.nullable().optional(),
  status: AppleAdsRunStatusSchema.optional(),
}).strict().superRefine((input, context) => {
  if (Object.keys(input).every((key) => key === "campaignId")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one campaign field to update." });
  }
  if (input.countriesOrRegions && new Set(input.countriesOrRegions).size !== input.countriesOrRegions.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Countries or regions must be unique.", path: ["countriesOrRegions"] });
  }
});
export type UpdateAppleAdsCampaignInput = z.infer<typeof UpdateAppleAdsCampaignInputSchema>;

export const CreateAppleAdsAdGroupInputSchema = z.object({
  campaignId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  bid: AppleAdsMoneySchema,
  automatedKeywordsOptIn: z.boolean().default(false),
  startTime: AppleAdsTimestampSchema.nullable().default(null),
  endTime: AppleAdsTimestampSchema.nullable().default(null),
  status: z.literal("PAUSED").default("PAUSED"),
}).strict().superRefine((input, context) => {
  if (input.startTime && input.endTime && input.startTime >= input.endTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "The end time must be after the start time.", path: ["endTime"] });
  }
});
export type CreateAppleAdsAdGroupInput = z.infer<typeof CreateAppleAdsAdGroupInputSchema>;

export const CreateAppleAdsKeywordInputSchema = z.object({
  campaignId: z.string().min(1),
  adGroupId: z.string().min(1),
  text: z.string().trim().min(1).max(80),
  matchType: z.enum(["EXACT", "BROAD"]),
  bid: AppleAdsMoneySchema.nullable().default(null),
  status: z.literal("PAUSED").default("PAUSED"),
}).strict();
export type CreateAppleAdsKeywordInput = z.infer<typeof CreateAppleAdsKeywordInputSchema>;

export const UpdateAppleAdsKeywordInputSchema = z.object({
  keywordId: z.string().min(1),
  bid: AppleAdsMoneySchema.optional(),
  status: AppleAdsRunStatusSchema.optional(),
}).strict().refine((input) => input.bid !== undefined || input.status !== undefined, {
  message: "Choose a bid or status to update.",
});
export type UpdateAppleAdsKeywordInput = z.infer<typeof UpdateAppleAdsKeywordInputSchema>;

export const AppStoreConnectCredentialsInputSchema = z.object({
  profileName: z.string().trim().min(1).max(80),
  issuerId: z.string().trim().min(1).max(128),
  keyId: z.string().trim().regex(/^[A-Z0-9]{8,32}$/, "Use the key ID shown in App Store Connect."),
  privateKey: z.string().min(1).max(16_384),
}).strict();
export type AppStoreConnectCredentialsInput = z.infer<typeof AppStoreConnectCredentialsInputSchema>;

export const AppStoreConnectAccountSchema = z.object({
  id: z.string().min(1),
  profileName: z.string().min(1).max(80),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  active: z.boolean(),
  source: z.enum(["local", "environment"]),
}).strict();
export type AppStoreConnectAccount = z.infer<typeof AppStoreConnectAccountSchema>;

export const AppStoreConnectAccountsResponseSchema = z.object({
  accounts: z.array(AppStoreConnectAccountSchema),
}).strict();
export type AppStoreConnectAccountsResponse = z.infer<typeof AppStoreConnectAccountsResponseSchema>;

export const AppStoreConnectConnectionResponseSchema = z.object({
  status: AgentStatusSchema,
  accounts: z.array(AppStoreConnectAccountSchema),
}).strict();
export type AppStoreConnectConnectionResponse = z.infer<typeof AppStoreConnectConnectionResponseSchema>;

export const AppStorePlatformSchema = z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]);
export type AppStorePlatform = z.infer<typeof AppStorePlatformSchema>;

export const AppStoreLocaleSchema = z.enum([
  "ar-SA", "ca", "cs", "da", "de-DE", "el", "en-AU", "en-CA", "en-GB", "en-US",
  "es-ES", "es-MX", "fi", "fr-CA", "fr-FR", "he", "hi", "hr", "hu", "id", "it",
  "ja", "ko", "ms", "nl-NL", "no", "pl", "pt-BR", "pt-PT", "ro", "ru", "sk",
  "sv", "th", "tr", "uk", "vi", "zh-Hans", "zh-Hant",
]);
export type AppStoreLocale = z.infer<typeof AppStoreLocaleSchema>;

export const AppStoreVersionSchema = z.object({
  id: z.string().min(1),
  appId: z.string().min(1),
  versionString: z.string().min(1),
  platform: AppStorePlatformSchema,
  state: z.string().min(1),
  releaseType: z.string().nullable(),
  copyright: z.string().nullable(),
  createdAt: z.string().nullable(),
  copiedFrom: z.string().nullable(),
  editable: z.boolean(),
});
export type AppStoreVersion = z.infer<typeof AppStoreVersionSchema>;

export const VersionLocalizationSchema = z.object({
  id: z.string().min(1),
  versionId: z.string().min(1),
  locale: AppStoreLocaleSchema,
  description: z.string().max(10_000),
  keywords: z.string().max(10_000),
  marketingUrl: z.string().max(4_000),
  promotionalText: z.string().max(10_000),
  supportUrl: z.string().max(4_000),
  whatsNew: z.string().max(10_000),
});
export type VersionLocalization = z.infer<typeof VersionLocalizationSchema>;

export const ScreenshotDisplayTypeSchema = z.enum([
  "APP_IPHONE_55",
  "APP_IPHONE_65",
  "APP_IPHONE_67",
  "APP_IPHONE_69",
  "APP_IPAD_PRO_129",
  "APP_IPAD_PRO_3GEN_129",
  "APP_WATCH_SERIES_7",
  "APP_WATCH_SERIES_10",
  "APP_WATCH_ULTRA",
  "APP_DESKTOP",
  "APP_APPLE_TV",
  "APP_APPLE_VISION_PRO",
]);
export type ScreenshotDisplayType = z.infer<typeof ScreenshotDisplayTypeSchema>;

export const ScreenshotAssetSchema = z.object({
  id: z.string().min(1),
  localizationId: z.string().min(1),
  locale: AppStoreLocaleSchema,
  displayType: ScreenshotDisplayTypeSchema,
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  checksum: z.string().min(1).nullable(),
  state: z.string().min(1),
  imageUrl: z.string().url().nullable(),
  fullImageUrl: z.string().url().nullable(),
  sortOrder: z.number().int().nonnegative(),
});
export type ScreenshotAsset = z.infer<typeof ScreenshotAssetSchema>;

export const ScreenshotUploadReceiptSchema = z.object({
  uploadId: z.string().uuid(),
  displayType: ScreenshotDisplayTypeSchema,
  fileName: z.string().min(1).max(255),
  mediaType: z.enum(["image/png", "image/jpeg"]),
  fileSize: z.number().int().positive().max(20 * 1024 * 1024),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  hasAlpha: z.literal(false),
});
export type ScreenshotUploadReceipt = z.infer<typeof ScreenshotUploadReceiptSchema>;

export const UpdateScreenshotSetInputSchema = z.object({
  appId: z.string().min(1),
  versionId: z.string().min(1),
  localizationId: z.string().min(1),
  locale: AppStoreLocaleSchema,
  displayType: ScreenshotDisplayTypeSchema,
  strategy: z.enum(["append", "replace"]),
  uploads: z.array(ScreenshotUploadReceiptSchema).max(10),
  deleteIds: z.array(z.string().min(1)).max(10),
}).strict().superRefine((input, context) => {
  if (input.strategy === "append" && input.uploads.length === 0 && input.deleteIds.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one screenshot must be uploaded or removed." });
  }
  const uploadIds = new Set<string>();
  for (const [index, upload] of input.uploads.entries()) {
    if (uploadIds.has(upload.uploadId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Each staged upload can appear only once.", path: ["uploads", index, "uploadId"] });
    }
    uploadIds.add(upload.uploadId);
  }
  const deleteIds = new Set<string>();
  for (const [index, id] of input.deleteIds.entries()) {
    if (deleteIds.has(id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Each screenshot can be removed only once.", path: ["deleteIds", index] });
    }
    deleteIds.add(id);
  }
});
export type UpdateScreenshotSetInput = z.infer<typeof UpdateScreenshotSetInputSchema>;

export const ReleaseMetadataSchema = z.object({
  whatsNew: z.string().max(4_000),
  promotionalText: z.string().max(170),
  keywords: z.string().max(100),
});
export type ReleaseMetadata = z.infer<typeof ReleaseMetadataSchema>;

export const VersionLocalizationDraftSchema = ReleaseMetadataSchema.extend({
  locale: AppStoreLocaleSchema,
});
export type VersionLocalizationDraft = z.infer<typeof VersionLocalizationDraftSchema>;

export const ReleaseCopyFieldSchema = z.enum(["whatsNew", "promotionalText"]);
export type ReleaseCopyField = z.infer<typeof ReleaseCopyFieldSchema>;

export const GenerateReleaseCopyTranslationsInputSchema = z.object({
  sourceLocale: AppStoreLocaleSchema,
  targetLocales: z.array(AppStoreLocaleSchema).min(1).max(39),
  fields: z.array(ReleaseCopyFieldSchema).min(1).max(2),
  source: z.object({
    whatsNew: z.string().max(4_000),
    promotionalText: z.string().max(170),
  }).strict(),
}).strict().superRefine((input, context) => {
  const targetLocales = new Set<string>();
  for (const [index, locale] of input.targetLocales.entries()) {
    if (locale === input.sourceLocale) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The source locale cannot also be a target locale.",
        path: ["targetLocales", index],
      });
    }
    if (targetLocales.has(locale)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each target locale can appear only once.",
        path: ["targetLocales", index],
      });
    }
    targetLocales.add(locale);
  }

  const fields = new Set<ReleaseCopyField>();
  for (const [index, field] of input.fields.entries()) {
    if (fields.has(field)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each release-copy field can appear only once.",
        path: ["fields", index],
      });
    }
    fields.add(field);
    if (!input.source[field].trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Selected source fields cannot be empty.",
        path: ["source", field],
      });
    }
  }
});
export type GenerateReleaseCopyTranslationsInput = z.infer<typeof GenerateReleaseCopyTranslationsInputSchema>;

export const GeneratedReleaseCopyTranslationSchema = z.object({
  locale: AppStoreLocaleSchema,
  whatsNew: z.string().min(1).max(4_000).optional(),
  promotionalText: z.string().min(1).max(170).optional(),
}).strict();
export type GeneratedReleaseCopyTranslation = z.infer<typeof GeneratedReleaseCopyTranslationSchema>;

export const OpenAiModelSchema = z.string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Use a valid OpenAI model ID.")
  .refine((value) => !/^sk-/i.test(value), "Use a model ID, not an API key.");
export type OpenAiModel = z.infer<typeof OpenAiModelSchema>;

export const OpenAiCredentialsInputSchema = z.object({
  apiKey: z.string()
    .trim()
    .min(1, "Enter an OpenAI API key.")
    .max(8_192, "The OpenAI API key is too long.")
    .refine((value) => !/\s/.test(value), "OpenAI API keys cannot contain whitespace."),
  model: z.string()
    .trim()
    .max(200)
    .refine(
      (value) => value === "" || (/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) && !/^sk-/i.test(value)),
      "Use a valid OpenAI model ID, not an API key.",
    )
    .optional(),
}).strict();
export type OpenAiCredentialsInput = z.infer<typeof OpenAiCredentialsInputSchema>;

export const OpenAiConnectionSchema = z.object({
  configured: z.boolean(),
  source: z.enum(["environment", "local", "demo"]).nullable(),
  model: OpenAiModelSchema.nullable(),
  modelSource: z.enum(["environment", "local", "default", "demo"]),
}).strict();
export type OpenAiConnection = z.infer<typeof OpenAiConnectionSchema>;

export const OpenAiConnectionResponseSchema = z.object({
  connection: OpenAiConnectionSchema,
}).strict();
export type OpenAiConnectionResponse = z.infer<typeof OpenAiConnectionResponseSchema>;

export const TranslationProviderStatusSchema = z.object({
  provider: z.enum(["openai", "demo"]),
  configured: z.boolean(),
  model: z.string().min(1).nullable(),
  detail: z.string().min(1),
}).strict();
export type TranslationProviderStatus = z.infer<typeof TranslationProviderStatusSchema>;

export const CreateVersionInputSchema = z.object({
  appId: z.string().min(1),
  versionString: z.string().regex(/^\d+(?:\.\d+){1,2}$/, "Use a version such as 2.5 or 2.5.0."),
  platform: AppStorePlatformSchema,
  copyMetadataFrom: z.string().regex(/^\d+(?:\.\d+){1,2}$/).nullable(),
  releaseType: z.enum(["MANUAL", "AFTER_APPROVAL", "SCHEDULED"]),
  excludeWhatsNew: z.boolean(),
});
export type CreateVersionInput = z.infer<typeof CreateVersionInputSchema>;

export const UpdateVersionLocalizationsInputSchema = z.object({
  appId: z.string().min(1),
  versionId: z.string().min(1),
  localizations: z.array(VersionLocalizationDraftSchema).min(1).max(40),
}).superRefine((input, context) => {
  const locales = new Set<string>();
  for (const [index, localization] of input.localizations.entries()) {
    if (locales.has(localization.locale)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each locale can appear only once.",
        path: ["localizations", index, "locale"],
      });
    }
    locales.add(localization.locale);
  }
});
export type UpdateVersionLocalizationsInput = z.infer<typeof UpdateVersionLocalizationsInputSchema>;

export const VersionLocalizationPatchSchema = z.object({
  locale: AppStoreLocaleSchema,
  whatsNew: z.string().max(4_000).optional(),
  promotionalText: z.string().max(170).optional(),
  keywords: z.string().max(100).optional(),
}).superRefine((patch, context) => {
  if (patch.whatsNew === undefined && patch.promotionalText === undefined && patch.keywords === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "At least one field must change." });
  }
});
export type VersionLocalizationPatch = z.infer<typeof VersionLocalizationPatchSchema>;

export const ValidationSeveritySchema = z.enum(["error", "warning", "info"]);
export const ValidationCheckSchema = z.object({
  id: z.string(),
  severity: ValidationSeveritySchema,
  message: z.string(),
  remediation: z.string().optional().default(""),
  locale: z.string().optional().default(""),
  field: z.string().optional().default(""),
  resourceType: z.string().optional().default(""),
  resourceId: z.string().optional().default(""),
});
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;

export const ValidationStepSchema = z.object({
  order: z.number().int().positive(),
  blocking: z.boolean(),
  severity: ValidationSeveritySchema,
  checkId: z.string(),
  message: z.string(),
  remediation: z.string(),
  locale: z.string().optional().default(""),
  field: z.string().optional().default(""),
  resourceType: z.string().optional().default(""),
  resourceId: z.string().optional().default(""),
});

export const ValidationReportSchema = z.object({
  appId: z.string(),
  versionId: z.string(),
  versionString: z.string().optional().default(""),
  platform: z.string().optional().default(""),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
  }),
  remediation: z.object({
    totalActionable: z.number().int().nonnegative(),
    steps: z.array(ValidationStepSchema),
  }),
  checks: z.array(ValidationCheckSchema),
  strict: z.boolean().optional().default(false),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const PlanStateSchema = z.enum([
  "awaiting_confirmation",
  "running",
  "succeeded",
  "failed",
  "expired",
  "stale",
]);

export const AddBuildToGroupInputSchema = z.object({
  appId: z.string().min(1),
  buildId: z.string().min(1),
  groupId: z.string().min(1),
});
export type AddBuildToGroupInput = z.infer<typeof AddBuildToGroupInputSchema>;

export const SubmitVersionInputSchema = z.object({
  appId: z.string().min(1),
  versionId: z.string().min(1),
  buildId: z.string().min(1),
});
export type SubmitVersionInput = z.infer<typeof SubmitVersionInputSchema>;

export const VersionSubmissionPreviewSchema = z.object({
  appId: z.string().min(1),
  versionId: z.string().min(1),
  versionString: z.string().min(1),
  platform: AppStorePlatformSchema,
  buildId: z.string().min(1),
  currentBuildId: z.string().nullable(),
  wouldAttach: z.boolean(),
  alreadyAttached: z.boolean(),
  wouldSubmit: z.boolean(),
  alreadySubmitted: z.boolean(),
  submissionId: z.string().min(1).nullable(),
});
export type VersionSubmissionPreview = z.infer<typeof VersionSubmissionPreviewSchema>;

export const VersionSubmissionResultSchema = z.object({
  appId: z.string().min(1),
  versionId: z.string().min(1),
  versionString: z.string().min(1),
  platform: AppStorePlatformSchema,
  buildId: z.string().min(1),
  submissionId: z.string().min(1),
  submittedAt: z.string().nullable(),
  alreadySubmitted: z.boolean(),
  attached: z.boolean(),
  alreadyAttached: z.boolean(),
});
export type VersionSubmissionResult = z.infer<typeof VersionSubmissionResultSchema>;

export const VersionSubmissionStatusSchema = z.object({
  id: z.string().min(1).nullable(),
  versionId: z.string().min(1),
  versionString: z.string().min(1),
  platform: AppStorePlatformSchema,
  state: z.string().min(1),
  submittedAt: z.string().nullable(),
});
export type VersionSubmissionStatus = z.infer<typeof VersionSubmissionStatusSchema>;

const PlanContextSchema = z.object({
  profile: z.string().nullable(),
  connectionId: z.string().nullable().default(null),
  appleAdsAdAccountId: z.string().nullable().default(null),
  appleAdsMode: AgentModeSchema.nullable().default(null),
});

const PlanBaseSchema = z.object({
  id: z.string(),
  risk: z.literal("mutation"),
  state: PlanStateSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  digest: z.string(),
  summary: z.string(),
  context: PlanContextSchema,
  error: z.string().nullable(),
});

export const BuildGroupMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("build.add_to_group"),
  target: z.object({
    appId: z.string(),
    buildId: z.string(),
    buildLabel: z.string(),
    groupId: z.string(),
    groupName: z.string(),
  }),
  before: z.object({ groupIds: z.array(z.string()) }),
  after: z.object({ groupIds: z.array(z.string()) }),
});
export type BuildGroupMutationPlan = z.infer<typeof BuildGroupMutationPlanSchema>;

export const CreateVersionMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("version.create"),
  target: z.object({
    appId: z.string(),
    versionString: z.string(),
    platform: AppStorePlatformSchema,
    sourceVersionId: z.string().nullable(),
  }),
  before: z.object({ versionId: z.null() }),
  after: z.object({
    versionString: z.string(),
    platform: AppStorePlatformSchema,
    copyMetadataFrom: z.string().nullable(),
    releaseType: z.enum(["MANUAL", "AFTER_APPROVAL", "SCHEDULED"]),
    excludeWhatsNew: z.boolean(),
  }),
});
export type CreateVersionMutationPlan = z.infer<typeof CreateVersionMutationPlanSchema>;

export const LocalizationSnapshotSchema = z.object({
  id: z.string().nullable(),
  locale: AppStoreLocaleSchema,
  whatsNew: z.string().max(10_000),
  promotionalText: z.string().max(10_000),
  keywords: z.string().max(10_000),
});
export type LocalizationSnapshot = z.infer<typeof LocalizationSnapshotSchema>;

export const DesiredLocalizationSnapshotSchema = ReleaseMetadataSchema.extend({
  id: z.string().nullable(),
  locale: AppStoreLocaleSchema,
});

export const UpdateLocalizationsMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("version.update_localizations"),
  target: z.object({
    appId: z.string(),
    versionId: z.string(),
    versionString: z.string(),
    platform: AppStorePlatformSchema,
    locales: z.array(AppStoreLocaleSchema),
  }),
  before: z.object({ localizations: z.array(LocalizationSnapshotSchema) }),
  after: z.object({ localizations: z.array(DesiredLocalizationSnapshotSchema) }),
});
export type UpdateLocalizationsMutationPlan = z.infer<typeof UpdateLocalizationsMutationPlanSchema>;

export const ScreenshotAssetSnapshotSchema = ScreenshotAssetSchema.omit({
  localizationId: true,
  locale: true,
  displayType: true,
  imageUrl: true,
  fullImageUrl: true,
});
export type ScreenshotAssetSnapshot = z.infer<typeof ScreenshotAssetSnapshotSchema>;

export const UpdateScreenshotsMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("version.update_screenshots"),
  target: z.object({
    appId: z.string().min(1),
    versionId: z.string().min(1),
    versionString: z.string().min(1),
    platform: AppStorePlatformSchema,
    localizationId: z.string().min(1),
    locale: AppStoreLocaleSchema,
    displayType: ScreenshotDisplayTypeSchema,
  }),
  before: z.object({ screenshots: z.array(ScreenshotAssetSnapshotSchema).max(10) }),
  after: z.object({
    strategy: z.enum(["append", "replace"]),
    uploads: z.array(ScreenshotUploadReceiptSchema).max(10),
    deleteIds: z.array(z.string().min(1)).max(10),
  }),
});
export type UpdateScreenshotsMutationPlan = z.infer<typeof UpdateScreenshotsMutationPlanSchema>;

export const SubmitVersionMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("version.submit"),
  target: z.object({
    appId: z.string(),
    versionId: z.string(),
    versionString: z.string(),
    platform: AppStorePlatformSchema,
    buildId: z.string(),
    buildNumber: z.string(),
  }),
  before: z.object({
    versionState: z.string(),
    attachedBuildId: z.string().nullable(),
    validation: z.object({
      errors: z.number().int().nonnegative(),
      warnings: z.number().int().nonnegative(),
      blocking: z.number().int().nonnegative(),
    }),
  }),
  after: z.object({
    buildId: z.string(),
    attachBuild: z.boolean(),
    submitForReview: z.literal(true),
  }),
});
export type SubmitVersionMutationPlan = z.infer<typeof SubmitVersionMutationPlanSchema>;

export const UpsertCustomerReviewResponseMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("customer_review.response.upsert"),
  target: z.object({
    appId: z.string(),
    reviewId: z.string(),
    reviewTitle: z.string(),
    reviewerNickname: z.string(),
  }).strict(),
  before: CustomerReviewSchema,
  after: z.object({
    responseBody: z.string(),
  }).strict(),
});
export type UpsertCustomerReviewResponseMutationPlan = z.infer<typeof UpsertCustomerReviewResponseMutationPlanSchema>;

export const CreateAnalyticsReportRequestMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("analytics.report_request.create"),
  target: z.object({
    appId: z.string().min(1),
    appName: z.string().min(1),
    accessType: AnalyticsReportAccessTypeSchema,
  }).strict(),
  before: z.object({
    matchingReportRequestIds: z.array(z.string().min(1)),
    activeOngoingReportRequestIds: z.array(z.string().min(1)),
  }).strict(),
  after: AnalyticsReportRequestCreateInputSchema,
});
export type CreateAnalyticsReportRequestMutationPlan = z.infer<typeof CreateAnalyticsReportRequestMutationPlanSchema>;

export const AppleAdsCampaignSnapshotSchema = AppleAdsCampaignSchema.pick({
  id: true,
  adAccountId: true,
  name: true,
  promotedObjectId: true,
  status: true,
  startTime: true,
  endTime: true,
  dailyBudget: true,
  countriesOrRegions: true,
  supplyPlacements: true,
  bidStrategyType: true,
  deleted: true,
});
export type AppleAdsCampaignSnapshot = z.infer<typeof AppleAdsCampaignSnapshotSchema>;

export const AppleAdsAdGroupSnapshotSchema = AppleAdsAdGroupSchema.pick({
  id: true,
  campaignId: true,
  name: true,
  status: true,
  automatedKeywordsOptIn: true,
  bid: true,
  startTime: true,
  endTime: true,
  deleted: true,
});
export type AppleAdsAdGroupSnapshot = z.infer<typeof AppleAdsAdGroupSnapshotSchema>;

export const AppleAdsKeywordSnapshotSchema = AppleAdsKeywordSchema.pick({
  id: true,
  campaignId: true,
  adGroupId: true,
  text: true,
  matchType: true,
  bid: true,
  status: true,
  deleted: true,
});
export type AppleAdsKeywordSnapshot = z.infer<typeof AppleAdsKeywordSnapshotSchema>;

export const CreateAppleAdsCampaignMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("apple_ads.campaign.create"),
  target: z.object({
    promotedObjectId: z.string().min(1),
    name: z.string().min(1),
  }),
  before: z.object({ matchingCampaignIds: z.array(z.string()) }),
  after: CreateAppleAdsCampaignInputSchema,
});
export type CreateAppleAdsCampaignMutationPlan = z.infer<typeof CreateAppleAdsCampaignMutationPlanSchema>;

export const UpdateAppleAdsCampaignMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("apple_ads.campaign.update"),
  target: z.object({
    campaignId: z.string().min(1),
    campaignName: z.string().min(1),
  }),
  before: AppleAdsCampaignSnapshotSchema,
  after: AppleAdsCampaignSnapshotSchema,
});
export type UpdateAppleAdsCampaignMutationPlan = z.infer<typeof UpdateAppleAdsCampaignMutationPlanSchema>;

export const CreateAppleAdsAdGroupMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("apple_ads.ad_group.create"),
  target: z.object({
    campaignId: z.string().min(1),
    campaignName: z.string().min(1),
    name: z.string().min(1),
  }),
  before: z.object({
    campaign: AppleAdsCampaignSnapshotSchema,
    matchingAdGroupIds: z.array(z.string()),
  }),
  after: CreateAppleAdsAdGroupInputSchema,
});
export type CreateAppleAdsAdGroupMutationPlan = z.infer<typeof CreateAppleAdsAdGroupMutationPlanSchema>;

export const CreateAppleAdsKeywordMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("apple_ads.keyword.create"),
  target: z.object({
    campaignId: z.string().min(1),
    adGroupId: z.string().min(1),
    adGroupName: z.string().min(1),
    text: z.string().min(1),
  }),
  before: z.object({
    adGroup: AppleAdsAdGroupSnapshotSchema,
    matchingKeywordIds: z.array(z.string()),
  }),
  after: CreateAppleAdsKeywordInputSchema,
});
export type CreateAppleAdsKeywordMutationPlan = z.infer<typeof CreateAppleAdsKeywordMutationPlanSchema>;

export const UpdateAppleAdsKeywordMutationPlanSchema = PlanBaseSchema.extend({
  operation: z.literal("apple_ads.keyword.update"),
  target: z.object({
    keywordId: z.string().min(1),
    text: z.string().min(1),
  }),
  before: AppleAdsKeywordSnapshotSchema,
  after: AppleAdsKeywordSnapshotSchema,
});
export type UpdateAppleAdsKeywordMutationPlan = z.infer<typeof UpdateAppleAdsKeywordMutationPlanSchema>;

export const MutationPlanSchema = z.discriminatedUnion("operation", [
  BuildGroupMutationPlanSchema,
  CreateVersionMutationPlanSchema,
  UpdateLocalizationsMutationPlanSchema,
  UpdateScreenshotsMutationPlanSchema,
  SubmitVersionMutationPlanSchema,
  UpsertCustomerReviewResponseMutationPlanSchema,
  CreateAnalyticsReportRequestMutationPlanSchema,
  CreateAppleAdsCampaignMutationPlanSchema,
  UpdateAppleAdsCampaignMutationPlanSchema,
  CreateAppleAdsAdGroupMutationPlanSchema,
  CreateAppleAdsKeywordMutationPlanSchema,
  UpdateAppleAdsKeywordMutationPlanSchema,
]);
export type MutationPlan = z.infer<typeof MutationPlanSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  actor: z.enum(["gui", "mcp", "system"]),
  operation: z.string(),
  phase: z.string(),
  target: z.string(),
  summary: z.string(),
  status: z.enum(["info", "success", "warning", "error"]),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AppsResponseSchema = z.object({
  apps: z.array(AppSummarySchema),
});
export type AppsResponse = z.infer<typeof AppsResponseSchema>;

export const AppleAdsCampaignsResponseSchema = z.object({
  campaigns: z.array(AppleAdsCampaignSchema),
});
export type AppleAdsCampaignsResponse = z.infer<typeof AppleAdsCampaignsResponseSchema>;

export const AppleAdsAdGroupsResponseSchema = z.object({
  adGroups: z.array(AppleAdsAdGroupSchema),
});
export type AppleAdsAdGroupsResponse = z.infer<typeof AppleAdsAdGroupsResponseSchema>;

export const AppleAdsKeywordsResponseSchema = z.object({
  keywords: z.array(AppleAdsKeywordSchema),
});
export type AppleAdsKeywordsResponse = z.infer<typeof AppleAdsKeywordsResponseSchema>;

export const AppleAdsKeywordResearchResponseSchema = z.object({
  research: AppleAdsKeywordResearchResultSchema,
});
export type AppleAdsKeywordResearchResponse = z.infer<typeof AppleAdsKeywordResearchResponseSchema>;

export const AppleAdsCampaignReportResponseSchema = z.object({
  report: AppleAdsCampaignMetricsSchema,
});
export type AppleAdsCampaignReportResponse = z.infer<typeof AppleAdsCampaignReportResponseSchema>;

export const BuildsResponseSchema = z.object({
  builds: z.array(BuildSummarySchema),
});
export type BuildsResponse = z.infer<typeof BuildsResponseSchema>;

export const GroupsResponseSchema = z.object({
  groups: z.array(TesterGroupSchema),
});
export type GroupsResponse = z.infer<typeof GroupsResponseSchema>;

export const VersionsResponseSchema = z.object({
  versions: z.array(AppStoreVersionSchema),
});
export type VersionsResponse = z.infer<typeof VersionsResponseSchema>;

export const LocalizationsResponseSchema = z.object({
  localizations: z.array(VersionLocalizationSchema),
});
export type LocalizationsResponse = z.infer<typeof LocalizationsResponseSchema>;

export const ScreenshotsResponseSchema = z.object({
  screenshots: z.array(ScreenshotAssetSchema).max(10),
});
export type ScreenshotsResponse = z.infer<typeof ScreenshotsResponseSchema>;

export const ScreenshotUploadResponseSchema = z.object({
  upload: ScreenshotUploadReceiptSchema,
});
export type ScreenshotUploadResponse = z.infer<typeof ScreenshotUploadResponseSchema>;

export const ScreenshotDiscardResponseSchema = z.object({ discarded: z.literal(true) });

export const ValidationResponseSchema = z.object({
  report: ValidationReportSchema,
});
export type ValidationResponse = z.infer<typeof ValidationResponseSchema>;

export const SubmissionStatusResponseSchema = z.object({
  submission: VersionSubmissionStatusSchema,
});
export type SubmissionStatusResponse = z.infer<typeof SubmissionStatusResponseSchema>;

export const ActivityResponseSchema = z.object({
  events: z.array(AuditEventSchema),
});
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

export const GeneratedReleaseCopyTranslationsResponseSchema = z.object({
  translations: z.array(GeneratedReleaseCopyTranslationSchema).min(1).max(39),
}).strict();
export type GeneratedReleaseCopyTranslationsResponse = z.infer<typeof GeneratedReleaseCopyTranslationsResponseSchema>;

export const PlanResponseSchema = z.object({
  plan: MutationPlanSchema,
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

export const PlansResponseSchema = z.object({
  plans: z.array(MutationPlanSchema),
});
export type PlansResponse = z.infer<typeof PlansResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
