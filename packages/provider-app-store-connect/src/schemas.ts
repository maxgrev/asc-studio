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
  attributes: z.object({ version: z.string().min(1), platform: PlatformSchema }).passthrough(),
}).passthrough();
export const BuildResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("builds"),
  attributes: z.object({
    version: z.string().min(1),
    uploadedDate: z.string().min(1),
    expirationDate: z.string().optional(),
    expired: z.boolean().optional(),
    minOsVersion: z.string().optional(),
    computedMinMacOsVersion: z.string().optional(),
    computedMinVisionOsVersion: z.string().optional(),
    processingState: z.string().min(1),
    usesNonExemptEncryption: z.boolean().optional(),
  }).passthrough(),
}).passthrough();
export const BuildsPageSchema = page(BuildResourceSchema);
export const BuildResponseSchema = single(BuildResourceSchema);

export const BetaGroupResourceSchema = z.object({
  ...resourceBase,
  type: z.literal("betaGroups"),
  attributes: z.object({
    name: z.string().min(1),
    isInternalGroup: z.boolean().optional(),
  }).passthrough(),
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

export const EmptySchema = z.null();

export type AppResource = z.infer<typeof AppResourceSchema>;
export type AppStoreVersionResource = z.infer<typeof AppStoreVersionResourceSchema>;
export type LocalizationResource = z.infer<typeof LocalizationResourceSchema>;
export type ScreenshotResource = z.infer<typeof ScreenshotResourceSchema>;
export type BuildResource = z.infer<typeof BuildResourceSchema>;
export type PreReleaseVersionResource = z.infer<typeof PreReleaseVersionResourceSchema>;
export type BetaGroupResource = z.infer<typeof BetaGroupResourceSchema>;
export type ReviewSubmissionResource = z.infer<typeof ReviewSubmissionResourceSchema>;
