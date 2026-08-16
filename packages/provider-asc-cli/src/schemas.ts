import { z } from "zod";

export const allowedIdentifier = /^[A-Za-z0-9._:-]+$/;

const identifierSchema = z.string().min(1).regex(allowedIdentifier);
const nonEmptyStringSchema = z.string().min(1);
const jsonObjectSchema = z.record(z.unknown());
const collectionDataSchema = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.union([z.array(schema), z.null()]).transform(
    (data): Array<z.output<Schema>> => data ?? [],
  );

const paginationLinksSchema = z.object({
  self: z.string().optional(),
  next: z.string().optional(),
  prev: z.string().optional(),
}).strict();

const resourceLinkageSchema = z.object({
  type: nonEmptyStringSchema,
  id: identifierSchema,
}).strict();

const genericRelationshipSchema = z.object({
  data: z.union([resourceLinkageSchema, z.array(resourceLinkageSchema), z.null()]).optional(),
  links: jsonObjectSchema.optional(),
  meta: jsonObjectSchema.optional(),
}).strict();

const appAttributesSchema = z.object({
  name: nonEmptyStringSchema,
  bundleId: nonEmptyStringSchema,
  sku: nonEmptyStringSchema,
  primaryLocale: nonEmptyStringSchema.optional(),
  contentRightsDeclaration: z.enum([
    "DOES_NOT_USE_THIRD_PARTY_CONTENT",
    "USES_THIRD_PARTY_CONTENT",
  ]).optional(),
}).strict();

const appResourceSchema = z.object({
  type: z.literal("apps"),
  id: identifierSchema,
  attributes: appAttributesSchema,
  relationships: z.record(genericRelationshipSchema).optional(),
  links: jsonObjectSchema.optional(),
}).strict();

export const AppsEnvelopeSchema = z.object({
  data: collectionDataSchema(appResourceSchema),
  links: paginationLinksSchema,
  included: z.array(z.unknown()).optional(),
  meta: jsonObjectSchema.optional(),
}).strict();

const platformSchema = z.enum(["IOS", "MAC_OS", "TV_OS", "VISION_OS"]);

const appStoreVersionAttributesSchema = z.object({
  platform: platformSchema,
  versionString: nonEmptyStringSchema,
  appStoreState: nonEmptyStringSchema.optional(),
  appVersionState: nonEmptyStringSchema.optional(),
  copyright: z.string().optional(),
  createdDate: nonEmptyStringSchema.optional(),
  releaseType: nonEmptyStringSchema.optional(),
  earliestReleaseDate: nonEmptyStringSchema.optional(),
}).strict().superRefine((attributes, context) => {
  if (!attributes.appVersionState && !attributes.appStoreState) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "App Store version state is missing." });
  }
});

const appStoreVersionResourceSchema = z.object({
  type: z.literal("appStoreVersions"),
  id: identifierSchema,
  attributes: appStoreVersionAttributesSchema,
  relationships: z.record(genericRelationshipSchema).optional(),
  links: jsonObjectSchema.optional(),
}).strict();

export const AppStoreVersionsEnvelopeSchema = z.object({
  data: collectionDataSchema(appStoreVersionResourceSchema),
  links: paginationLinksSchema,
  included: z.array(z.unknown()).optional(),
  meta: jsonObjectSchema.optional(),
}).strict();

const appStoreVersionLocalizationAttributesSchema = z.object({
  locale: nonEmptyStringSchema,
  description: z.string().optional(),
  keywords: z.string().optional(),
  marketingUrl: z.string().optional(),
  promotionalText: z.string().optional(),
  supportUrl: z.string().optional(),
  whatsNew: z.string().optional(),
}).strict();

const appStoreVersionLocalizationResourceSchema = z.object({
  type: z.literal("appStoreVersionLocalizations"),
  id: identifierSchema,
  attributes: appStoreVersionLocalizationAttributesSchema,
  relationships: z.record(genericRelationshipSchema).optional(),
  links: jsonObjectSchema.optional(),
}).strict();

export const AppStoreVersionLocalizationsEnvelopeSchema = z.object({
  data: collectionDataSchema(appStoreVersionLocalizationResourceSchema),
  links: paginationLinksSchema,
  included: z.array(z.unknown()).optional(),
  meta: jsonObjectSchema.optional(),
}).strict();

const screenshotDisplayTypeSchema = z.enum([
  "APP_APPLE_TV",
  "APP_APPLE_VISION_PRO",
  "APP_DESKTOP",
  "APP_IPAD_105",
  "APP_IPAD_97",
  "APP_IPAD_PRO_129",
  "APP_IPAD_PRO_3GEN_11",
  "APP_IPAD_PRO_3GEN_129",
  "APP_IPHONE_35",
  "APP_IPHONE_40",
  "APP_IPHONE_47",
  "APP_IPHONE_55",
  "APP_IPHONE_58",
  "APP_IPHONE_61",
  "APP_IPHONE_65",
  "APP_IPHONE_67",
  "APP_IPHONE_69",
  "APP_WATCH_SERIES_10",
  "APP_WATCH_SERIES_3",
  "APP_WATCH_SERIES_4",
  "APP_WATCH_SERIES_7",
  "APP_WATCH_ULTRA",
  "IMESSAGE_APP_IPAD_105",
  "IMESSAGE_APP_IPAD_97",
  "IMESSAGE_APP_IPAD_PRO_129",
  "IMESSAGE_APP_IPAD_PRO_3GEN_11",
  "IMESSAGE_APP_IPAD_PRO_3GEN_129",
  "IMESSAGE_APP_IPHONE_40",
  "IMESSAGE_APP_IPHONE_47",
  "IMESSAGE_APP_IPHONE_55",
  "IMESSAGE_APP_IPHONE_58",
  "IMESSAGE_APP_IPHONE_61",
  "IMESSAGE_APP_IPHONE_65",
  "IMESSAGE_APP_IPHONE_67",
  "IMESSAGE_APP_IPHONE_69",
]);

const screenshotSetResourceSchema = z.object({
  type: z.literal("appScreenshotSets"),
  id: identifierSchema,
  attributes: z.object({ screenshotDisplayType: screenshotDisplayTypeSchema }).strict(),
  relationships: z.object({
    appScreenshots: z.object({
      links: jsonObjectSchema,
      meta: jsonObjectSchema.optional(),
    }).strict(),
  }).catchall(genericRelationshipSchema),
  links: jsonObjectSchema.optional(),
}).strict();

const screenshotResourceSchema = z.object({
  type: z.literal("appScreenshots"),
  id: identifierSchema,
  attributes: z.object({
    fileSize: z.number().int().nonnegative(),
    fileName: nonEmptyStringSchema,
    sourceFileChecksum: z.string().optional(),
    imageAsset: z.object({
      templateUrl: z.string().url(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }).strict().nullable().optional(),
    assetDeliveryState: z.object({
      state: nonEmptyStringSchema,
      errors: z.array(z.unknown()).optional(),
      warnings: z.array(z.unknown()).optional(),
    }).passthrough().nullable().optional(),
  }).passthrough(),
  relationships: z.record(genericRelationshipSchema).optional(),
  links: jsonObjectSchema.optional(),
}).strict();

export const ScreenshotListEnvelopeSchema = z.object({
  versionLocalizationId: identifierSchema,
  sets: z.array(z.object({
    set: screenshotSetResourceSchema,
    screenshots: z.array(screenshotResourceSchema),
  }).strict()),
}).strict().superRefine((payload, context) => {
  const displayTypes = new Set<string>();
  const screenshotIds = new Set<string>();
  for (const [setIndex, item] of payload.sets.entries()) {
    const displayType = item.set.attributes.screenshotDisplayType;
    if (displayTypes.has(displayType)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Screenshot display type appears more than once.",
        path: ["sets", setIndex, "set", "attributes", "screenshotDisplayType"],
      });
    }
    displayTypes.add(displayType);
    for (const [assetIndex, asset] of item.screenshots.entries()) {
      if (screenshotIds.has(asset.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Screenshot ID appears more than once.",
          path: ["sets", setIndex, "screenshots", assetIndex, "id"],
        });
      }
      screenshotIds.add(asset.id);
    }
  }
});

const validationSeveritySchema = z.enum(["error", "warning", "info"]);
const validationCheckFields = {
  id: z.string(),
  severity: validationSeveritySchema,
  message: z.string(),
  remediation: z.string().optional(),
  locale: z.string().optional(),
  field: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
};

export const ValidationReportEnvelopeSchema = z.object({
  appId: z.string(),
  versionId: z.string(),
  versionString: z.string().optional(),
  platform: z.string().optional(),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    infos: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
  }).strict(),
  remediation: z.object({
    totalActionable: z.number().int().nonnegative(),
    steps: z.array(z.object({
      order: z.number().int().positive(),
      blocking: z.boolean(),
      checkId: z.string(),
      ...validationCheckFields,
    }).omit({ id: true }).strict()),
  }).strict(),
  checks: z.array(z.object(validationCheckFields).strict()),
  strict: z.boolean().optional(),
}).strict();

const buildAttributesSchema = z.object({
  version: nonEmptyStringSchema,
  uploadedDate: nonEmptyStringSchema,
  expirationDate: nonEmptyStringSchema.optional(),
  processingState: z.enum(["VALID", "PROCESSING", "FAILED", "INVALID"]),
  minOsVersion: nonEmptyStringSchema.optional(),
  usesNonExemptEncryption: z.boolean().optional(),
  expired: z.boolean().optional(),
}).strict();

const preReleaseVersionLinkageSchema = z.object({
  type: z.literal("preReleaseVersions"),
  id: identifierSchema,
}).strict();

const preReleaseVersionRelationshipSchema = z.object({
  data: preReleaseVersionLinkageSchema,
  links: jsonObjectSchema.optional(),
  meta: jsonObjectSchema.optional(),
}).strict();

const buildRelationshipsSchema = z.object({
  preReleaseVersion: preReleaseVersionRelationshipSchema,
}).catchall(genericRelationshipSchema);

const buildResourceSchema = z.object({
  type: z.literal("builds"),
  id: identifierSchema,
  attributes: buildAttributesSchema,
  relationships: buildRelationshipsSchema,
  links: jsonObjectSchema.optional(),
}).strict();

const preReleaseVersionResourceSchema = z.object({
  type: z.literal("preReleaseVersions"),
  id: identifierSchema,
  attributes: z.object({
    version: nonEmptyStringSchema,
    platform: platformSchema,
  }).strict(),
  relationships: z.record(genericRelationshipSchema).optional(),
  links: jsonObjectSchema.optional(),
}).strict();

const buildEnvelopeFields = {
  links: paginationLinksSchema,
  included: z.array(preReleaseVersionResourceSchema).optional(),
  meta: jsonObjectSchema.optional(),
};

const validateIncludedPreReleaseVersions = (
  builds: z.infer<typeof buildResourceSchema>[],
  included: z.infer<typeof preReleaseVersionResourceSchema>[] | undefined,
  ctx: z.RefinementCtx,
) => {
  const includedIds = new Set<string>();
  for (const [index, item] of (included ?? []).entries()) {
    if (includedIds.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate included pre-release version.",
        path: ["included", index, "id"],
      });
    }
    includedIds.add(item.id);
  }

  for (const [index, build] of builds.entries()) {
    const preReleaseVersionId = build.relationships.preReleaseVersion.data.id;
    if (!includedIds.has(preReleaseVersionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Build pre-release version is missing from included data.",
        path: ["data", index, "relationships", "preReleaseVersion", "data", "id"],
      });
    }
  }
};

export const BuildsEnvelopeSchema = z.object({
  data: collectionDataSchema(buildResourceSchema),
  ...buildEnvelopeFields,
}).strict().superRefine((payload, ctx) => {
  validateIncludedPreReleaseVersions(payload.data, payload.included, ctx);
});

export const BuildInfoEnvelopeSchema = z.object({
  data: buildResourceSchema,
  ...buildEnvelopeFields,
}).strict().superRefine((payload, ctx) => {
  validateIncludedPreReleaseVersions([payload.data], payload.included, ctx);
});

const betaGroupAttributesSchema = z.object({
  name: nonEmptyStringSchema,
  createdDate: nonEmptyStringSchema.optional(),
  isInternalGroup: z.boolean().optional(),
  hasAccessToAllBuilds: z.boolean().optional(),
  publicLinkEnabled: z.boolean().optional(),
  publicLinkLimitEnabled: z.boolean().optional(),
  publicLinkLimit: z.number().int().nonnegative().optional(),
  publicLink: z.string().optional(),
  feedbackEnabled: z.boolean().optional(),
}).strict();

const betaGroupResourceSchema = z.object({
  type: z.literal("betaGroups"),
  id: identifierSchema,
  attributes: betaGroupAttributesSchema,
  relationships: z.record(genericRelationshipSchema).optional(),
  links: jsonObjectSchema.optional(),
}).strict();

export const BetaGroupsEnvelopeSchema = z.object({
  data: collectionDataSchema(betaGroupResourceSchema),
  links: paginationLinksSchema,
  included: z.array(z.unknown()).optional(),
  meta: jsonObjectSchema.optional(),
}).strict();

export const GroupBuildLinksEnvelopeSchema = z.object({
  data: collectionDataSchema(z.object({
    type: z.literal("builds"),
    id: identifierSchema,
  }).strict()),
  links: paginationLinksSchema,
  meta: jsonObjectSchema.optional(),
}).strict().superRefine((payload, ctx) => {
  const ids = new Set<string>();
  for (const [index, linkage] of payload.data.entries()) {
    if (ids.has(linkage.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate build linkage.",
        path: ["data", index, "id"],
      });
    }
    ids.add(linkage.id);
  }
});

const authStatusCredentialSchema = z.object({
  name: nonEmptyStringSchema,
  keyId: nonEmptyStringSchema,
  isDefault: z.boolean(),
  storedIn: nonEmptyStringSchema,
  validation: z.enum(["works", "failed"]).optional(),
  validationDetail: nonEmptyStringSchema.optional(),
  validationError: nonEmptyStringSchema.optional(),
}).strict();

export const AuthStatusEnvelopeSchema = z.object({
  storageBackend: nonEmptyStringSchema,
  storageLocation: nonEmptyStringSchema,
  warnings: z.array(nonEmptyStringSchema).optional(),
  credentials: z.array(authStatusCredentialSchema),
  profile: nonEmptyStringSchema.optional(),
  environmentCredentialsProvided: z.boolean(),
  environmentCredentialsComplete: z.boolean(),
  environmentNote: nonEmptyStringSchema.optional(),
  validationFailures: z.number().int().nonnegative().optional(),
  keychainAvailable: z.boolean().optional(),
  keychainError: nonEmptyStringSchema.optional(),
  configPath: nonEmptyStringSchema.optional(),
}).strict();

export const AddGroupsEnvelopeSchema = z.object({
  buildId: identifierSchema,
  groupIds: z.array(identifierSchema),
  action: z.literal("added"),
}).strict();

const buildAttachmentResultSchema = z.object({
  versionId: identifierSchema,
  buildId: identifierSchema,
  currentBuildId: identifierSchema.optional(),
  attached: z.boolean().optional(),
  alreadyAttached: z.boolean().optional(),
  wouldAttach: z.boolean().optional(),
}).strict();

export const ReviewSubmitEnvelopeSchema = z.object({
  appId: identifierSchema,
  version: nonEmptyStringSchema.optional(),
  versionId: identifierSchema,
  buildId: identifierSchema,
  platform: platformSchema,
  dryRun: z.boolean().optional(),
  submissionId: identifierSchema.optional(),
  submittedDate: nonEmptyStringSchema.optional(),
  alreadySubmitted: z.boolean().optional(),
  wouldSubmit: z.boolean().optional(),
  buildAttachment: buildAttachmentResultSchema.optional(),
  messages: z.array(z.string()).optional(),
}).strict();

export const SubmissionStatusEnvelopeSchema = z.object({
  id: z.string(),
  versionId: identifierSchema.optional(),
  versionString: nonEmptyStringSchema.optional(),
  platform: platformSchema.optional(),
  state: nonEmptyStringSchema.optional(),
  createdDate: nonEmptyStringSchema.optional(),
}).strict();

export const CliVersionSchema = z.string().trim().regex(/^\d+\.\d+\.\d+(?:\s+\([^\r\n]+\))?$/);

export type AppsEnvelope = z.infer<typeof AppsEnvelopeSchema>;
export type BuildsEnvelope = z.infer<typeof BuildsEnvelopeSchema>;
export type BuildInfoEnvelope = z.infer<typeof BuildInfoEnvelopeSchema>;
export type BetaGroupsEnvelope = z.infer<typeof BetaGroupsEnvelopeSchema>;
export type GroupBuildLinksEnvelope = z.infer<typeof GroupBuildLinksEnvelopeSchema>;
export type AuthStatusEnvelope = z.infer<typeof AuthStatusEnvelopeSchema>;
export type AppStoreVersionsEnvelope = z.infer<typeof AppStoreVersionsEnvelopeSchema>;
export type AppStoreVersionLocalizationsEnvelope = z.infer<typeof AppStoreVersionLocalizationsEnvelopeSchema>;
export type ValidationReportEnvelope = z.infer<typeof ValidationReportEnvelopeSchema>;
export type ReviewSubmitEnvelope = z.infer<typeof ReviewSubmitEnvelopeSchema>;
export type SubmissionStatusEnvelope = z.infer<typeof SubmissionStatusEnvelopeSchema>;
export type BuildResource = BuildsEnvelope["data"][number];
export type PreReleaseVersionResource = NonNullable<BuildsEnvelope["included"]>[number];
