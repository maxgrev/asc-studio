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
  profile: z.string().nullable(),
  authBackend: z.string().nullable(),
  detail: z.string(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AppStoreConnectCredentialsInputSchema = z.object({
  profileName: z.string().trim().min(1).max(80),
  issuerId: z.string().trim().min(1).max(128),
  keyId: z.string().trim().regex(/^[A-Z0-9]{8,32}$/, "Use the key ID shown in App Store Connect."),
  privateKey: z.string().min(1).max(16_384),
}).strict();
export type AppStoreConnectCredentialsInput = z.infer<typeof AppStoreConnectCredentialsInputSchema>;

export const AppStoreConnectConnectionResponseSchema = z.object({
  status: AgentStatusSchema,
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

export const MutationPlanSchema = z.discriminatedUnion("operation", [
  BuildGroupMutationPlanSchema,
  CreateVersionMutationPlanSchema,
  UpdateLocalizationsMutationPlanSchema,
  UpdateScreenshotsMutationPlanSchema,
  SubmitVersionMutationPlanSchema,
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

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorSchema>;
