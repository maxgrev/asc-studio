import { z } from "zod";

export const AppSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  bundleId: z.string(),
  platforms: z.array(z.string()).default([]),
});
export type AppSummary = z.infer<typeof AppSummarySchema>;

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

export const AppleAdsStatusSchema = z.object({
  mode: AgentModeSchema,
  configured: z.boolean(),
  connected: z.boolean(),
  provider: z.enum(["apple-ads-platform-api", "demo"]),
  adAccountId: z.string().min(1).nullable(),
  detail: z.string().min(1),
}).strict();
export type AppleAdsStatus = z.infer<typeof AppleAdsStatusSchema>;

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
