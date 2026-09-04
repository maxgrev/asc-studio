import { z } from "zod";

const id = z.string().min(1);
const links = z.object({ self: z.string().optional(), next: z.string().optional() }).passthrough();
const linkage = z.object({ type: z.string().min(1), id }).strict();
const relationship = z.object({
  data: z.union([linkage, z.array(linkage), z.null()]).optional(),
}).passthrough();
const relationships = z.record(relationship).optional();
const resourceBase = {
  id,
  type: z.string().min(1),
  relationships,
  links: z.record(z.unknown()).optional(),
};
const page = <T extends z.ZodTypeAny>(resource: T) => z.object({
  data: z.array(resource),
  included: z.array(z.unknown()).optional(),
  links,
  meta: z.record(z.unknown()).optional(),
}).passthrough();
const single = <T extends z.ZodTypeAny>(resource: T) => z.object({
  data: resource,
  included: z.array(z.unknown()).optional(),
  links: z.record(z.unknown()).optional(),
}).passthrough();

export const AppResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("apps"),
  attributes: z.object({ name: z.string().min(1), bundleId: z.string().min(1) }).passthrough(),
}).passthrough();
export const AppsPageSchema = page(AppResourceSchema);

export const PlatformSchema = z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]);
export const AppStoreVersionResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("appStoreVersions"),
  attributes: z.object({
    platform: PlatformSchema,
    versionString: z.string().min(1),
    appVersionState: z.string().optional(),
    appStoreState: z.string().optional(),
    copyright: z.string().nullable().optional(),
    releaseType: z.string().nullable().optional(),
    createdDate: z.string().optional(),
  }).passthrough(),
}).passthrough();
export const AppStoreVersionsPageSchema = page(AppStoreVersionResourceSchema);
export const AppStoreVersionResponseSchema = single(AppStoreVersionResourceSchema);

export const LocalizationResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("appStoreVersionLocalizations"),
  attributes: z.object({
    locale: z.string().min(1),
    description: z.string().nullable().optional(),
    keywords: z.string().nullable().optional(),
    marketingUrl: z.string().nullable().optional(),
    promotionalText: z.string().nullable().optional(),
    supportUrl: z.string().nullable().optional(),
    whatsNew: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();
export const LocalizationsPageSchema = page(LocalizationResourceSchema);
export const LocalizationResponseSchema = single(LocalizationResourceSchema);

export const ScreenshotSetResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("appScreenshotSets"),
  // Screenshot read responses have drifted from Apple's published OpenAPI
  // types. Validate the JSON:API boundary here and interpret attributes in the
  // provider according to the operation that consumes them.
  attributes: z.record(z.unknown()).optional(),
}).passthrough();
export const ScreenshotSetsPageSchema = page(ScreenshotSetResourceSchema);
export const ScreenshotSetResponseSchema = single(ScreenshotSetResourceSchema);

const uploadOperation = z.object({
  method: z.string().min(1),
  url: z.string().url(),
  length: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  requestHeaders: z.array(z.object({ name: z.string().min(1), value: z.string() }).passthrough()),
}).passthrough();
export const ScreenshotUploadOperationsSchema = z.array(uploadOperation).min(1);
export const ScreenshotResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("appScreenshots"),
  attributes: z.record(z.unknown()).optional(),
}).passthrough();
export const ScreenshotsPageSchema = page(ScreenshotResourceSchema);
export const ScreenshotResponseSchema = single(ScreenshotResourceSchema);

export const PreReleaseVersionResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("preReleaseVersions"),
  attributes: z.record(z.unknown()).optional(),
}).passthrough();
export const BuildResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("builds"),
  attributes: z.record(z.unknown()).optional(),
}).passthrough();
export const BuildsPageSchema = page(BuildResourceSchema);
export const BuildResponseSchema = single(BuildResourceSchema);

export const BetaGroupResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("betaGroups"),
  attributes: z.record(z.unknown()).optional(),
}).passthrough();
export const BetaGroupsPageSchema = page(BetaGroupResourceSchema);

export const LinkagesPageSchema = z.object({ data: z.array(linkage), links }).passthrough();
export const LinkageResponseSchema = z.object({ data: z.union([linkage, z.null()]), links: z.record(z.unknown()).optional() }).passthrough();

export const ReviewSubmissionResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("reviewSubmissions"),
  attributes: z.object({
    platform: PlatformSchema.optional(),
    submittedDate: z.string().optional(),
    state: z.string().min(1).optional(),
  }).passthrough(),
}).passthrough();
export const ReviewSubmissionsPageSchema = page(ReviewSubmissionResourceSchema);
export const ReviewSubmissionResponseSchema = single(ReviewSubmissionResourceSchema);

export const ReviewSubmissionItemResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("reviewSubmissionItems"),
  attributes: z.object({ state: z.string().min(1).optional() }).passthrough(),
}).passthrough();
export const ReviewSubmissionItemResponseSchema = single(ReviewSubmissionItemResourceSchema);

export const CustomerReviewResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("customerReviews"),
  attributes: z.object({
    rating: z.number().int().min(1).max(5),
    title: z.string(),
    body: z.string(),
    reviewerNickname: z.string(),
    createdDate: z.string().min(1),
    territory: z.string().regex(/^[A-Z]{3}$/),
  }).passthrough(),
}).passthrough();

export const CustomerReviewResponseResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("customerReviewResponses"),
  attributes: z.object({
    responseBody: z.string(),
    lastModifiedDate: z.string().min(1).nullable(),
    state: z.enum(["PENDING_PUBLISH", "PUBLISHED"]),
  }).passthrough(),
}).passthrough();

export const CustomerReviewsPageSchema = z.object({
  data: z.array(CustomerReviewResourceSchema),
  included: z.array(z.unknown()).optional(),
  links,
  meta: z.object({
    paging: z.object({
      total: z.number().int().nonnegative().optional(),
    }).passthrough(),
  }).passthrough().optional(),
}).passthrough();
export const CustomerReviewResponseSchema = single(CustomerReviewResourceSchema);
export const CustomerReviewResponseResourceResponseSchema = single(CustomerReviewResponseResourceSchema);

export const SubscriptionGroupResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("subscriptionGroups"),
  attributes: z.object({
    referenceName: z.string().min(1),
  }).passthrough(),
}).passthrough();
export const SubscriptionGroupsPageSchema = page(SubscriptionGroupResourceSchema);

export const SubscriptionResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("subscriptions"),
  attributes: z.object({
    name: z.string().min(1),
    productId: z.string().min(1),
    familySharable: z.boolean().optional(),
    state: z.string().min(1),
    subscriptionPeriod: z.enum([
      "ONE_WEEK",
      "ONE_MONTH",
      "TWO_MONTHS",
      "THREE_MONTHS",
      "SIX_MONTHS",
      "ONE_YEAR",
    ]),
    groupLevel: z.number().int().positive().nullable().optional(),
  }).passthrough(),
}).passthrough();
export const SubscriptionsPageSchema = page(SubscriptionResourceSchema);

export const TerritoryResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("territories"),
  attributes: z.object({ currency: z.string().regex(/^[A-Z]{3}$/) }).passthrough(),
}).passthrough();

export const SubscriptionPricePointResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("subscriptionPricePoints"),
  attributes: z.object({
    customerPrice: z.string().regex(/^\d+(?:\.\d+)?$/),
    proceeds: z.string().regex(/^\d+(?:\.\d+)?$/),
    proceedsYear2: z.string().regex(/^\d+(?:\.\d+)?$/),
  }).passthrough(),
}).passthrough();
export const SubscriptionPricePointsPageSchema = page(SubscriptionPricePointResourceSchema);

export const SubscriptionPriceResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("subscriptionPrices"),
  attributes: z.object({
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    preserved: z.boolean().optional(),
    planType: z.enum(["UPFRONT", "MONTHLY"]).optional(),
  }).passthrough(),
}).passthrough();
export const SubscriptionPricesPageSchema = page(SubscriptionPriceResourceSchema);
export const SubscriptionPriceResponseSchema = single(SubscriptionPriceResourceSchema);

export const AnalyticsReportAccessTypeSchema = z.enum(["ONGOING", "ONE_TIME_SNAPSHOT"]);
export const AnalyticsReportCategorySchema = z.enum([
  "APP_STORE_ENGAGEMENT",
  "COMMERCE",
  "APP_USAGE",
  "FRAMEWORK_USAGE",
  "PERFORMANCE",
]);
export const AnalyticsReportGranularitySchema = z.enum(["DAILY", "WEEKLY", "MONTHLY"]);

export const AnalyticsReportRequestResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("analyticsReportRequests"),
  attributes: z.object({
    accessType: AnalyticsReportAccessTypeSchema,
    stoppedDueToInactivity: z.boolean(),
  }).passthrough(),
}).passthrough();
export const AnalyticsReportRequestsPageSchema = page(AnalyticsReportRequestResourceSchema);
export const AnalyticsReportRequestResponseSchema = single(AnalyticsReportRequestResourceSchema);

export const AnalyticsReportResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("analyticsReports"),
  attributes: z.object({
    name: z.string().min(1),
    category: AnalyticsReportCategorySchema,
  }).passthrough(),
}).passthrough();
export const AnalyticsReportsPageSchema = page(AnalyticsReportResourceSchema);

export const AnalyticsReportInstanceResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("analyticsReportInstances"),
  attributes: z.object({
    granularity: AnalyticsReportGranularitySchema,
    processingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).passthrough(),
}).passthrough();
export const AnalyticsReportInstancesPageSchema = page(AnalyticsReportInstanceResourceSchema);

export const AnalyticsReportSegmentResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("analyticsReportSegments"),
  attributes: z.object({
    checksum: z.string().regex(/^[0-9a-f]{32}$/i),
    sizeInBytes: z.number().int().positive(),
    url: z.string().url(),
  }).passthrough(),
}).passthrough();
export const AnalyticsReportSegmentsPageSchema = page(AnalyticsReportSegmentResourceSchema);

export const EmptySchema = z.null();

export type AppResource = z.infer<typeof AppResourceSchema>;
export type AppStoreVersionResource = z.infer<typeof AppStoreVersionResourceSchema>;
export type LocalizationResource = z.infer<typeof LocalizationResourceSchema>;
export type ScreenshotResource = z.infer<typeof ScreenshotResourceSchema>;
export type BuildResource = z.infer<typeof BuildResourceSchema>;
export type PreReleaseVersionResource = z.infer<typeof PreReleaseVersionResourceSchema>;
export type BetaGroupResource = z.infer<typeof BetaGroupResourceSchema>;
export type ReviewSubmissionResource = z.infer<typeof ReviewSubmissionResourceSchema>;
export type CustomerReviewResource = z.infer<typeof CustomerReviewResourceSchema>;
export type CustomerReviewResponseResource = z.infer<typeof CustomerReviewResponseResourceSchema>;
export type SubscriptionGroupResource = z.infer<typeof SubscriptionGroupResourceSchema>;
export type SubscriptionResource = z.infer<typeof SubscriptionResourceSchema>;
export type SubscriptionPriceResource = z.infer<typeof SubscriptionPriceResourceSchema>;
export type SubscriptionPricePointResource = z.infer<typeof SubscriptionPricePointResourceSchema>;
export type TerritoryResource = z.infer<typeof TerritoryResourceSchema>;
export type AnalyticsReportRequestResource = z.infer<typeof AnalyticsReportRequestResourceSchema>;
export type AnalyticsReportResource = z.infer<typeof AnalyticsReportResourceSchema>;
export type AnalyticsReportInstanceResource = z.infer<typeof AnalyticsReportInstanceResourceSchema>;
export type AnalyticsReportSegmentResource = z.infer<typeof AnalyticsReportSegmentResourceSchema>;
