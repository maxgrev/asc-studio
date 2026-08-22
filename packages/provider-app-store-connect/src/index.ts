import { createHash } from "node:crypto";
import { readFile, rmdir, stat, unlink } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  AppStoreLocaleSchema,
  AppStorePlatformSchema,
  type AddBuildToGroupInput,
  type AgentStatus,
  type AppStorePlatform,
  type AppStoreVersion,
  type AppSummary,
  type BuildSummary,
  type CreateVersionInput,
  type CustomerReview,
  type CustomerReviewResponse,
  type CustomerReviewsPage,
  type LocalizationSnapshot,
  type ScreenshotAsset,
  type ScreenshotAssetSnapshot,
  type ScreenshotDisplayType,
  type StatusTone,
  type SubmitVersionInput,
  type TesterGroup,
  type ValidationCheck,
  type ValidationReport,
  type VersionLocalization,
  type VersionLocalizationPatch,
  type VersionSubmissionPreview,
  type VersionSubmissionResult,
  type VersionSubmissionStatus,
} from "@asc-studio/contracts";
import type {
  ApplyScreenshotChangesInput,
  AppListOptions,
  AscProvider,
  BuildListOptions,
  CustomerReviewListOptions,
  VersionListOptions,
} from "@asc-studio/core";
import type { output, ZodTypeAny } from "zod";
import {
  AppStoreConnectApiError,
  AppStoreConnectClient,
  CredentialUnavailableError,
  type AppStoreConnectClientOptions,
  type AppStoreConnectCredentials,
  type CredentialsResolver,
} from "./client.js";
import {
  AppsPageSchema,
  AppStoreVersionResponseSchema,
  AppStoreVersionsPageSchema,
  BetaGroupResourceSchema,
  BetaGroupsPageSchema,
  BuildResponseSchema,
  BuildsPageSchema,
  CustomerReviewResponseResourceResponseSchema,
  CustomerReviewResponseSchema as CustomerReviewDocumentSchema,
  CustomerReviewResponseResourceSchema,
  CustomerReviewsPageSchema,
  LinkageResponseSchema,
  LocalizationResponseSchema,
  LocalizationsPageSchema,
  PreReleaseVersionResourceSchema,
  ReviewSubmissionItemResponseSchema,
  ReviewSubmissionResponseSchema,
  ReviewSubmissionsPageSchema,
  ScreenshotResponseSchema,
  ScreenshotSetResponseSchema,
  ScreenshotSetsPageSchema,
  ScreenshotsPageSchema,
  ScreenshotUploadOperationsSchema,
  type AppStoreVersionResource,
  type BetaGroupResource,
  type BuildResource,
  type CustomerReviewResource,
  type CustomerReviewResponseResource,
  type LocalizationResource,
  type PreReleaseVersionResource,
  type ReviewSubmissionResource,
  type ScreenshotResource,
} from "./schemas.js";

export type { AppStoreConnectCredentials } from "./client.js";
export { AppStoreConnectApiError, CredentialUnavailableError } from "./client.js";

export interface AppStoreConnectProviderOptions extends Omit<AppStoreConnectClientOptions, "credentials"> {
  credentials: AppStoreConnectCredentials | null | CredentialsResolver;
  uploadDirectory?: string;
  mediaProcessingTimeoutMs?: number;
}

const editableVersionStates = new Set([
  "DEVELOPER_REJECTED",
  "INVALID_BINARY",
  "METADATA_REJECTED",
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "REJECTED",
]);

const submittedStates = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "UNRESOLVED_ISSUES",
  "CANCELING",
  "COMPLETING",
  "COMPLETE",
]);

const processingFor = (state: string, expired: boolean): { status: string; tone: StatusTone } => {
  if (expired) return { status: "Expired", tone: "neutral" };
  switch (state) {
    case "VALID": return { status: "Ready", tone: "success" };
    case "PROCESSING": return { status: "Processing", tone: "progress" };
    case "FAILED": return { status: "Failed", tone: "danger" };
    case "INVALID": return { status: "Invalid", tone: "danger" };
    default: return { status: state, tone: "neutral" };
  }
};

type RelatedResource = {
  relationships?: Record<string, { data?: unknown } | undefined> | undefined;
};

const relationshipIds = (resource: RelatedResource, name: string) => {
  const data = resource.relationships?.[name]?.data;
  if (!data) return [];
  const values = Array.isArray(data) ? data : [data];
  return values.flatMap((value) => (
    value && typeof value === "object" && "id" in value && typeof value.id === "string" ? [value.id] : []
  ));
};

const relationshipId = (resource: RelatedResource, name: string) =>
  relationshipIds(resource, name)[0] ?? null;

const screenshotSnapshot = (asset: ScreenshotAsset): ScreenshotAssetSnapshot => ({
  id: asset.id,
  fileName: asset.fileName,
  fileSize: asset.fileSize,
  width: asset.width,
  height: asset.height,
  checksum: asset.checksum,
  state: asset.state,
  sortOrder: asset.sortOrder,
});

const releaseSnapshot = (
  locale: LocalizationSnapshot["locale"],
  localization: VersionLocalization | undefined,
): LocalizationSnapshot => ({
  id: localization?.id ?? null,
  locale,
  whatsNew: localization?.whatsNew ?? "",
  promotionalText: localization?.promotionalText ?? "",
  keywords: localization?.keywords ?? "",
});

const screenshotImageUrl = (
  templateUrl: string | undefined,
  width: number | undefined,
  height: number | undefined,
  maximumDimension?: number,
) => {
  if (!templateUrl || !width || !height) return null;
  const scale = maximumDimension ? Math.min(1, maximumDimension / Math.max(width, height)) : 1;
  return templateUrl
    .replaceAll("{w}", String(Math.max(1, Math.round(width * scale))))
    .replaceAll("{h}", String(Math.max(1, Math.round(height * scale))))
    .replaceAll("{f}", "jpg")
    .replaceAll("{c}", "bb");
};

const recordValue = (value: unknown): Record<string, unknown> | null => (
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const stringValue = (value: unknown) => typeof value === "string" && value.length > 0 ? value : null;

const nonnegativeIntegerValue = (value: unknown) => (
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
);

const positiveIntegerValue = (value: unknown) => {
  const parsed = nonnegativeIntegerValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const booleanValue = (value: unknown) => typeof value === "boolean" ? value : null;

const requiredStringValue = (value: unknown, field: string) => {
  const parsed = stringValue(value);
  if (parsed === null) throw new Error(`App Store Connect returned a resource without a valid ${field}.`);
  return parsed;
};

const normalizeGroup = (resource: BetaGroupResource): TesterGroup => {
  const attributes = resource.attributes ?? {};
  return {
    id: resource.id,
    name: requiredStringValue(attributes.name, "beta group name"),
    testerCount: null,
    internal: booleanValue(attributes.isInternalGroup) ?? false,
  };
};

const normalizeCustomerReviewResponse = (
  resource: CustomerReviewResponseResource,
  expectedReviewId: string,
  requireReviewRelationship = false,
): CustomerReviewResponse => {
  const linkedReviewId = relationshipId(resource, "review");
  if (requireReviewRelationship && linkedReviewId !== expectedReviewId) {
    throw new Error("App Store Connect returned a customer review response without the expected review relationship.");
  }
  if (linkedReviewId && linkedReviewId !== expectedReviewId) {
    throw new Error("App Store Connect returned a customer review response for another review.");
  }
  return {
    id: resource.id,
    reviewId: expectedReviewId,
    responseBody: resource.attributes.responseBody,
    lastModifiedAt: resource.attributes.lastModifiedDate,
    state: resource.attributes.state,
  };
};

const normalizeCustomerReview = (
  resource: CustomerReviewResource,
  appId: string,
  responses: Map<string, CustomerReviewResponseResource>,
): CustomerReview => {
  const responseId = relationshipId(resource, "response");
  const responseResource = responseId ? responses.get(responseId) : null;
  if (responseId && !responseResource) {
    throw new Error(`App Store Connect omitted included response data for customer review ${resource.id}.`);
  }
  return {
    id: resource.id,
    appId,
    rating: resource.attributes.rating,
    title: resource.attributes.title,
    body: resource.attributes.body,
    reviewerNickname: resource.attributes.reviewerNickname,
    createdAt: resource.attributes.createdDate,
    territory: resource.attributes.territory,
    response: responseResource
      ? normalizeCustomerReviewResponse(responseResource, resource.id)
      : null,
  };
};

const normalizeLocalization = (resource: LocalizationResource, versionId: string): VersionLocalization => {
  const locale = AppStoreLocaleSchema.safeParse(resource.attributes.locale);
  if (!locale.success) throw new Error(`App Store Connect returned unsupported locale ${resource.attributes.locale}.`);
  return {
    id: resource.id,
    versionId,
    locale: locale.data,
    description: resource.attributes.description ?? "",
    keywords: resource.attributes.keywords ?? "",
    marketingUrl: resource.attributes.marketingUrl ?? "",
    promotionalText: resource.attributes.promotionalText ?? "",
    supportUrl: resource.attributes.supportUrl ?? "",
    whatsNew: resource.attributes.whatsNew ?? "",
  };
};

const normalizeVersion = (resource: AppStoreVersionResource, appId: string): AppStoreVersion => {
  const state = resource.attributes.appVersionState ?? resource.attributes.appStoreState;
  if (!state) throw new Error("App Store Connect returned an App Store version without a state.");
  return {
    id: resource.id,
    appId,
    versionString: resource.attributes.versionString,
    platform: resource.attributes.platform,
    state,
    releaseType: resource.attributes.releaseType ?? null,
    copyright: resource.attributes.copyright ?? null,
    createdAt: resource.attributes.createdDate ?? null,
    copiedFrom: null,
    editable: editableVersionStates.has(state),
  };
};

const normalizeScreenshot = (
  resource: ScreenshotResource,
  localizationId: string,
  locale: VersionLocalization["locale"],
  displayType: ScreenshotDisplayType,
  sortOrder: number,
): ScreenshotAsset => {
  const attributes = resource.attributes ?? {};
  const imageAsset = recordValue(attributes.imageAsset);
  const width = positiveIntegerValue(imageAsset?.width);
  const height = positiveIntegerValue(imageAsset?.height);
  const templateUrl = stringValue(imageAsset?.templateUrl) ?? undefined;
  const deliveryState = recordValue(attributes.assetDeliveryState);
  return {
    id: resource.id,
    localizationId,
    locale,
    displayType,
    fileName: stringValue(attributes.fileName) ?? `screenshot-${sortOrder + 1}`,
    fileSize: nonnegativeIntegerValue(attributes.fileSize) ?? 0,
    width,
    height,
    checksum: stringValue(attributes.sourceFileChecksum),
    state: stringValue(deliveryState?.state) ?? "COMPLETE",
    imageUrl: screenshotImageUrl(templateUrl, width ?? undefined, height ?? undefined, 720),
    fullImageUrl: screenshotImageUrl(templateUrl, width ?? undefined, height ?? undefined),
    sortOrder,
  };
};

const validationReport = (
  appId: string,
  version: AppStoreVersion,
  checks: ValidationCheck[],
): ValidationReport => {
  const errors = checks.filter((check) => check.severity === "error").length;
  const warnings = checks.filter((check) => check.severity === "warning").length;
  const infos = checks.filter((check) => check.severity === "info").length;
  return {
    appId,
    versionId: version.id,
    versionString: version.versionString,
    platform: version.platform,
    summary: { errors, warnings, infos, blocking: errors },
    remediation: {
      totalActionable: errors + warnings,
      steps: checks
        .filter((check) => check.severity !== "info")
        .map((check, index) => ({
          order: index + 1,
          blocking: check.severity === "error",
          severity: check.severity,
          checkId: check.id,
          message: check.message,
          remediation: check.remediation,
          locale: check.locale,
          field: check.field,
          resourceType: check.resourceType,
          resourceId: check.resourceId,
        })),
    },
    checks,
    strict: false,
  };
};

const toAppleValue = (value: string) => value === "" ? null : value;
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class AppStoreConnectProvider implements AscProvider {
  private readonly client: AppStoreConnectClient;
  private readonly uploadDirectory: string | null;
  private readonly mediaProcessingTimeoutMs: number;

  constructor(options: AppStoreConnectProviderOptions) {
    const configuredCredentials = options.credentials;
    const credentials: CredentialsResolver = typeof configuredCredentials === "function"
      ? configuredCredentials
      : async () => configuredCredentials;
    this.client = new AppStoreConnectClient({
      credentials,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
    this.uploadDirectory = options.uploadDirectory ? resolve(options.uploadDirectory) : null;
    this.mediaProcessingTimeoutMs = options.mediaProcessingTimeoutMs ?? 120_000;
  }

  async getStatus(): Promise<AgentStatus> {
    let credentials: AppStoreConnectCredentials;
    try {
      credentials = await this.client.credentials();
    } catch (error) {
      return {
        mode: "live",
        connected: false,
        provider: "app-store-connect-api",
        connectionId: null,
        profile: null,
        authBackend: null,
        detail: error instanceof Error ? error.message : "App Store Connect credentials are not available.",
      };
    }
    try {
      await this.client.request("GET", "/v1/apps?limit=1&fields%5Bapps%5D=name%2CbundleId", AppsPageSchema);
      return {
        mode: "live",
        connected: true,
        provider: "app-store-connect-api",
        connectionId: credentials.connectionId ?? null,
        profile: credentials.profileName,
        authBackend: credentials.authBackend,
        detail: "Connected directly to the App Store Connect API.",
      };
    } catch (error) {
      const detail = error instanceof AppStoreConnectApiError
        ? `App Store Connect rejected the API key: ${error.message}`
        : error instanceof Error ? error.message : "App Store Connect authentication failed.";
      return {
        mode: "live",
        connected: false,
        provider: "app-store-connect-api",
        connectionId: credentials.connectionId ?? null,
        profile: credentials.profileName,
        authBackend: credentials.authBackend,
        detail,
      };
    }
  }

  async listApps(options: AppListOptions = {}): Promise<AppSummary[]> {
    const limit = this.limit(options.limit, "App");
    const query = new URLSearchParams({ limit: String(limit), "fields[apps]": "name,bundleId" });
    const pages = await this.collect(`/v1/apps?${query}`, AppsPageSchema, options.paginate !== false);
    return pages.flatMap((page) => page.data).map((resource) => ({
      id: resource.id,
      name: resource.attributes.name,
      bundleId: resource.attributes.bundleId,
      platforms: [],
    }));
  }

  async listCustomerReviews(
    appId: string,
    options: CustomerReviewListOptions = {},
  ): Promise<CustomerReviewsPage> {
    const limit = this.limit(options.limit ?? 50, "Customer review");
    const sort = options.sort ?? "-createdDate";
    const ratings = options.ratings ?? [];
    const territories = options.territories ?? [];
    if (ratings.some((rating) => !Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new Error("Customer review ratings must be integers between 1 and 5.");
    }
    if (territories.some((territory) => !/^[A-Z]{3}$/.test(territory))) {
      throw new Error("Customer review territories must use three-letter uppercase codes.");
    }
    if (!["rating", "-rating", "createdDate", "-createdDate"].includes(sort)) {
      throw new Error("Customer review sort is unsupported.");
    }

    const query = new URLSearchParams({
      limit: String(limit),
      include: "response",
      sort,
      "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory,response",
      "fields[customerReviewResponses]": "responseBody,lastModifiedDate,state,review",
    });
    if (ratings.length > 0) query.set("filter[rating]", ratings.join(","));
    if (territories.length > 0) query.set("filter[territory]", territories.join(","));
    if (options.publishedResponse !== undefined) {
      query.set("exists[publishedResponse]", String(options.publishedResponse));
    }
    if (options.cursor !== undefined) query.set("cursor", options.cursor);

    const page = await this.client.request(
      "GET",
      `/v1/apps/${encodeURIComponent(appId)}/customerReviews?${query}`,
      CustomerReviewsPageSchema,
    );
    const responses = new Map((page.included ?? []).flatMap((candidate) => {
      const parsed = CustomerReviewResponseResourceSchema.safeParse(candidate);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }));
    const nextCursor = page.links.next
      ? this.client.resolveNext(page.links.next).searchParams.get("cursor")
      : null;
    return {
      reviews: page.data.map((resource) => normalizeCustomerReview(resource, appId, responses)),
      total: page.meta?.paging.total ?? null,
      nextCursor,
    };
  }

  async getCustomerReview(appId: string, reviewId: string): Promise<CustomerReview> {
    const query = new URLSearchParams({
      include: "response",
      "fields[customerReviews]": "rating,title,body,reviewerNickname,createdDate,territory,response",
      "fields[customerReviewResponses]": "responseBody,lastModifiedDate,state,review",
    });
    const page = await this.client.request(
      "GET",
      `/v1/customerReviews/${encodeURIComponent(reviewId)}?${query}`,
      CustomerReviewDocumentSchema,
    );
    const responses = new Map((page.included ?? []).flatMap((candidate) => {
      const parsed = CustomerReviewResponseResourceSchema.safeParse(candidate);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }));
    return normalizeCustomerReview(page.data, appId, responses);
  }

  async upsertCustomerReviewResponse(
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponse> {
    const response = await this.client.request(
      "POST",
      "/v1/customerReviewResponses",
      CustomerReviewResponseResourceResponseSchema,
      {
        expectedStatus: 201,
        retry: false,
        body: {
          data: {
            type: "customerReviewResponses",
            attributes: { responseBody },
            relationships: {
              review: { data: { type: "customerReviews", id: reviewId } },
            },
          },
        },
      },
    );
    return normalizeCustomerReviewResponse(response.data, reviewId, true);
  }

  async listBuilds(appId: string, options: BuildListOptions = {}): Promise<BuildSummary[]> {
    const query = new URLSearchParams({
      "filter[app]": appId,
      include: options.includeGroups === false ? "preReleaseVersion" : "preReleaseVersion,betaGroups",
      limit: "200",
      sort: "-uploadedDate",
    });
    const pages = await this.collect(`/v1/builds?${query}`, BuildsPageSchema, true);
    const included = pages.flatMap((page) => page.included ?? []);
    const prereleases = new Map(included.flatMap((candidate) => {
      const parsed = PreReleaseVersionResourceSchema.safeParse(candidate);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }));
    const groups = new Map(included.flatMap((candidate) => {
      const parsed = BetaGroupResourceSchema.safeParse(candidate);
      return parsed.success ? [[parsed.data.id, normalizeGroup(parsed.data)] as const] : [];
    }));
    return pages.flatMap((page) => page.data)
      .map((resource) => this.normalizeBuild(resource, appId, prereleases, groups))
      .filter((build) => (
        (!options.version || build.version === options.version)
        && (!options.platform || build.platform === options.platform)
      ));
  }

  async getBuild(appId: string, buildId: string): Promise<BuildSummary> {
    const query = new URLSearchParams({ include: "preReleaseVersion,betaGroups,app" });
    const page = await this.client.request("GET", `/v1/builds/${encodeURIComponent(buildId)}?${query}`, BuildResponseSchema);
    const linkedAppId = relationshipId(page.data, "app");
    if (linkedAppId && linkedAppId !== appId) throw new Error("The selected build belongs to another app.");
    const prereleases = new Map((page.included ?? []).flatMap((candidate) => {
      const parsed = PreReleaseVersionResourceSchema.safeParse(candidate);
      return parsed.success ? [[parsed.data.id, parsed.data] as const] : [];
    }));
    const groups = new Map((page.included ?? []).flatMap((candidate) => {
      const parsed = BetaGroupResourceSchema.safeParse(candidate);
      return parsed.success ? [[parsed.data.id, normalizeGroup(parsed.data)] as const] : [];
    }));
    return this.normalizeBuild(page.data, appId, prereleases, groups);
  }

  async listGroups(appId: string): Promise<TesterGroup[]> {
    const query = new URLSearchParams({ "filter[app]": appId, limit: "200", sort: "name" });
    const pages = await this.collect(`/v1/betaGroups?${query}`, BetaGroupsPageSchema, true);
    return pages.flatMap((page) => page.data).map(normalizeGroup);
  }

  async addBuildToGroup(input: AddBuildToGroupInput): Promise<void> {
    await this.client.requestNoContent(
      "POST",
      `/v1/builds/${encodeURIComponent(input.buildId)}/relationships/betaGroups`,
      {
        expectedStatus: 204,
        body: { data: [{ type: "betaGroups", id: input.groupId }] },
      },
    );
  }

  async listVersions(
    appId: string,
    platform?: AppStorePlatform,
    options: VersionListOptions = {},
  ): Promise<AppStoreVersion[]> {
    const limit = this.limit(options.limit, "Version");
    const query = new URLSearchParams({ limit: String(limit) });
    if (platform) query.set("filter[platform]", platform);
    const pages = await this.collect(
      `/v1/apps/${encodeURIComponent(appId)}/appStoreVersions?${query}`,
      AppStoreVersionsPageSchema,
      options.paginate !== false,
    );
    return pages.flatMap((page) => page.data)
      .map((resource) => normalizeVersion(resource, appId))
      .filter((version) => !platform || version.platform === platform);
  }

  async listVersionLocalizations(versionId: string): Promise<VersionLocalization[]> {
    const pages = await this.collect(
      `/v1/appStoreVersions/${encodeURIComponent(versionId)}/appStoreVersionLocalizations?limit=200`,
      LocalizationsPageSchema,
      true,
    );
    return pages.flatMap((page) => page.data).map((resource) => normalizeLocalization(resource, versionId));
  }

  async listScreenshots(
    localizationId: string,
    locale: VersionLocalization["locale"],
    displayType: ScreenshotDisplayType,
  ): Promise<ScreenshotAsset[]> {
    const set = await this.findScreenshotSet(localizationId, displayType);
    if (!set) return [];
    const pages = await this.collect(
      `/v1/appScreenshotSets/${encodeURIComponent(set.id)}/appScreenshots?limit=200`,
      ScreenshotsPageSchema,
      true,
    );
    return pages.flatMap((page) => page.data)
      .map((resource, index) => normalizeScreenshot(resource, localizationId, locale, displayType, index));
  }

  async createVersion(input: CreateVersionInput): Promise<AppStoreVersion> {
    const existing = await this.listVersions(input.appId, input.platform);
    const source = input.copyMetadataFrom
      ? existing.find((version) => version.versionString === input.copyMetadataFrom) ?? null
      : null;
    if (input.copyMetadataFrom && !source) throw new Error(`Source version ${input.copyMetadataFrom} no longer exists.`);
    const response = await this.client.request("POST", "/v1/appStoreVersions", AppStoreVersionResponseSchema, {
      expectedStatus: 201,
      body: {
        data: {
          type: "appStoreVersions",
          attributes: {
            platform: input.platform,
            versionString: input.versionString,
            releaseType: input.releaseType,
            ...(source?.copyright ? { copyright: source.copyright } : {}),
          },
          relationships: { app: { data: { type: "apps", id: input.appId } } },
        },
      },
    });
    const created = normalizeVersion(response.data, input.appId);
    if (source) {
      const sourceLocalizations = await this.listVersionLocalizations(source.id);
      for (const localization of sourceLocalizations) {
        await this.createLocalization(created.id, {
          ...localization,
          id: "",
          versionId: created.id,
          whatsNew: input.excludeWhatsNew ? "" : localization.whatsNew,
        });
      }
    }
    return { ...created, copiedFrom: input.copyMetadataFrom };
  }

  async applyVersionLocalizationPatches(
    versionId: string,
    patches: VersionLocalizationPatch[],
    expected: LocalizationSnapshot[],
  ): Promise<void> {
    const current = await this.listVersionLocalizations(versionId);
    const currentByLocale = new Map(current.map((localization) => [localization.locale, localization] as const));
    const currentSnapshots = expected.map((snapshot) => releaseSnapshot(snapshot.locale, currentByLocale.get(snapshot.locale)));
    if (JSON.stringify(currentSnapshots) !== JSON.stringify(expected)) {
      throw new Error("App Store Connect localization metadata changed before the update started.");
    }
    for (const patch of patches) {
      const attributes = {
        ...(patch.whatsNew !== undefined ? { whatsNew: toAppleValue(patch.whatsNew) } : {}),
        ...(patch.promotionalText !== undefined ? { promotionalText: toAppleValue(patch.promotionalText) } : {}),
        ...(patch.keywords !== undefined ? { keywords: toAppleValue(patch.keywords) } : {}),
      };
      const existing = currentByLocale.get(patch.locale);
      if (existing) {
        await this.client.request(
          "PATCH",
          `/v1/appStoreVersionLocalizations/${encodeURIComponent(existing.id)}`,
          LocalizationResponseSchema,
          { body: { data: { type: "appStoreVersionLocalizations", id: existing.id, attributes } } },
        );
      } else {
        await this.client.request("POST", "/v1/appStoreVersionLocalizations", LocalizationResponseSchema, {
          expectedStatus: 201,
          body: {
            data: {
              type: "appStoreVersionLocalizations",
              attributes: { locale: patch.locale, ...attributes },
              relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
            },
          },
        });
      }
    }
    const verified = new Map((await this.listVersionLocalizations(versionId)).map((item) => [item.locale, item] as const));
    for (const patch of patches) {
      const item = verified.get(patch.locale);
      if (!item) throw new Error(`App Store Connect did not save ${patch.locale}.`);
      for (const field of ["whatsNew", "promotionalText", "keywords"] as const) {
        if (patch[field] !== undefined && item[field] !== patch[field]) {
          throw new Error(`App Store Connect did not save ${field} for ${patch.locale}.`);
        }
      }
    }
  }

  async applyScreenshotChanges(input: ApplyScreenshotChangesInput): Promise<void> {
    const current = await this.listScreenshots(input.localizationId, input.locale, input.displayType);
    if (JSON.stringify(current.map(screenshotSnapshot)) !== JSON.stringify(input.expected)) {
      throw new Error("App Store Connect screenshots changed before the update started.");
    }
    const currentIds = new Set(current.map((asset) => asset.id));
    if (input.deleteIds.some((id) => !currentIds.has(id))) throw new Error("A screenshot selected for removal no longer exists.");

    const staged = await Promise.all(input.uploads.map(async (upload) => {
      const path = this.screenshotUploadPath(upload.uploadId, upload.fileName);
      const [body, details] = await Promise.all([readFile(path), stat(path)]);
      if (!details.isFile() || details.size !== upload.fileSize) throw new Error(`Staged screenshot ${upload.fileName} changed before upload.`);
      const checksum = createHash("sha256").update(body).digest("hex");
      if (checksum !== upload.checksum) throw new Error(`Staged screenshot ${upload.fileName} changed before upload.`);
      return { upload, path, body, sourceChecksum: createHash("md5").update(body).digest("hex") };
    }));

    let set = await this.findScreenshotSet(input.localizationId, input.displayType);
    if (!set && staged.length > 0) set = await this.createScreenshotSet(input.localizationId, input.displayType);
    if (!set && input.deleteIds.length > 0) throw new Error("The screenshot set no longer exists.");

    for (const id of input.deleteIds) {
      await this.client.requestNoContent("DELETE", `/v1/appScreenshots/${encodeURIComponent(id)}`, { expectedStatus: 204 });
    }
    const uploadedIds: string[] = [];
    if (set) {
      for (const item of staged) uploadedIds.push(await this.uploadScreenshot(set.id, item.upload.fileName, item.body, item.sourceChecksum));
      const keptIds = current.filter((asset) => !input.deleteIds.includes(asset.id)).map((asset) => asset.id);
      if (uploadedIds.length > 0 || input.deleteIds.length > 0) {
        await this.client.requestNoContent(
          "PATCH",
          `/v1/appScreenshotSets/${encodeURIComponent(set.id)}/relationships/appScreenshots`,
          {
            expectedStatus: 204,
            body: { data: [...keptIds, ...uploadedIds].map((id) => ({ type: "appScreenshots", id })) },
          },
        );
      }
    }

    const verified = await this.listScreenshots(input.localizationId, input.locale, input.displayType);
    for (const item of staged) {
      if (!verified.some((asset) => (
        asset.fileName === item.upload.fileName
        && (asset.checksum ? asset.checksum.toLowerCase() === item.sourceChecksum : asset.fileSize === item.upload.fileSize)
      ))) throw new Error(`App Store Connect could not verify ${item.upload.fileName}.`);
    }
    for (const id of input.deleteIds) {
      if (verified.some((asset) => asset.id === id)) throw new Error(`App Store Connect could not remove screenshot ${id}.`);
    }
    await Promise.all(staged.map(async ({ upload, path }) => {
      await unlink(path).catch(() => undefined);
      await rmdir(join(this.requireUploadDirectory(), upload.uploadId)).catch(() => undefined);
    }));
  }

  async validateVersion(appId: string, versionId: string, platform: AppStorePlatform): Promise<ValidationReport> {
    const version = await this.getVersion(appId, versionId);
    if (version.platform !== platform) throw new Error("The selected version platform changed.");
    const [localizations, buildLinkage, versions] = await Promise.all([
      this.listVersionLocalizations(versionId),
      this.client.request("GET", `/v1/appStoreVersions/${encodeURIComponent(versionId)}/relationships/build`, LinkageResponseSchema),
      this.listVersions(appId, platform),
    ]);
    const checks: ValidationCheck[] = [];
    if (localizations.length === 0) {
      checks.push({
        id: "metadata.localizations_missing",
        severity: "error",
        message: "The version has no App Store localization.",
        remediation: "Add at least one localization before submission.",
        locale: "",
        field: "localizations",
        resourceType: "appStoreVersions",
        resourceId: versionId,
      });
    }
    const isUpdate = versions.some((candidate) => candidate.id !== versionId);
    for (const localization of localizations) {
      const metadataChecks: Array<{
        applies: boolean;
        id: string;
        field: string;
        message: string;
        remediation: string;
      }> = [
        {
          applies: !localization.description.trim(),
          id: "metadata.description_missing",
          field: "description",
          message: `Description is missing for ${localization.locale}.`,
          remediation: "Add the localized App Store description.",
        },
        {
          applies: !localization.supportUrl.trim(),
          id: "metadata.support_url_missing",
          field: "supportUrl",
          message: `Support URL is missing for ${localization.locale}.`,
          remediation: "Add a support URL for this locale.",
        },
        {
          applies: isUpdate && !localization.whatsNew.trim(),
          id: "metadata.whats_new_missing",
          field: "whatsNew",
          message: `What's New is missing for ${localization.locale}.`,
          remediation: "Add localized release notes for this update.",
        },
        {
          applies: localization.whatsNew.length > 4_000,
          id: "metadata.whats_new_too_long",
          field: "whatsNew",
          message: `What's New exceeds 4,000 characters for ${localization.locale}.`,
          remediation: "Shorten the localized release notes.",
        },
        {
          applies: localization.promotionalText.length > 170,
          id: "metadata.promotional_text_too_long",
          field: "promotionalText",
          message: `Promotional text exceeds 170 characters for ${localization.locale}.`,
          remediation: "Shorten the localized promotional text.",
        },
        {
          applies: localization.keywords.length > 100,
          id: "metadata.keywords_too_long",
          field: "keywords",
          message: `Keywords exceed 100 characters for ${localization.locale}.`,
          remediation: "Shorten this locale's keyword list.",
        },
      ];
      for (const check of metadataChecks) {
        if (!check.applies) continue;
        checks.push({
          id: check.id,
          severity: "error",
          message: check.message,
          remediation: check.remediation,
          locale: localization.locale,
          field: check.field,
          resourceType: "appStoreVersionLocalizations",
          resourceId: localization.id,
        });
      }
    }
    if (!version.copyright?.trim()) {
      checks.push({
        id: "metadata.copyright_missing",
        severity: "error",
        message: "Copyright is missing for this App Store version.",
        remediation: "Add the copyright value before submission.",
        locale: "",
        field: "copyright",
        resourceType: "appStoreVersions",
        resourceId: versionId,
      });
    }
    if (!buildLinkage.data) {
      checks.push({
        id: "build.not_attached",
        severity: "warning",
        message: "No build is attached yet.",
        remediation: "ASC Studio will attach the selected processed build when you submit.",
        locale: "",
        field: "build",
        resourceType: "appStoreVersions",
        resourceId: versionId,
      });
    }
    checks.push({
      id: "apple.final_validation",
      severity: "info",
      message: "Apple performs the final contract, privacy, export, and review checks when the submission is sent.",
      remediation: "Any Apple validation error will be shown without hiding its code.",
      locale: "",
      field: "",
      resourceType: "appStoreVersions",
      resourceId: versionId,
    });
    return validationReport(appId, version, checks);
  }

  async previewVersionSubmission(input: SubmitVersionInput): Promise<VersionSubmissionPreview> {
    const [version, buildLinkage, submission] = await Promise.all([
      this.getVersion(input.appId, input.versionId),
      this.client.request("GET", `/v1/appStoreVersions/${encodeURIComponent(input.versionId)}/relationships/build`, LinkageResponseSchema),
      this.findSubmission(input.appId, input.versionId),
    ]);
    const currentBuildId = buildLinkage.data?.id ?? null;
    const alreadySubmitted = submission ? submittedStates.has(submission.attributes.state ?? "") : false;
    return {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      buildId: input.buildId,
      currentBuildId,
      wouldAttach: currentBuildId !== input.buildId,
      alreadyAttached: currentBuildId === input.buildId,
      wouldSubmit: !alreadySubmitted,
      alreadySubmitted,
      submissionId: submission?.id ?? null,
    };
  }

  async submitVersion(input: SubmitVersionInput): Promise<VersionSubmissionResult> {
    const preview = await this.previewVersionSubmission(input);
    if (preview.alreadySubmitted && preview.submissionId) {
      const current = await this.getSubmission(preview.submissionId);
      return {
        appId: input.appId,
        versionId: input.versionId,
        versionString: preview.versionString,
        platform: preview.platform,
        buildId: input.buildId,
        submissionId: current.id,
        submittedAt: current.attributes.submittedDate ?? null,
        alreadySubmitted: true,
        attached: false,
        alreadyAttached: preview.alreadyAttached,
      };
    }
    if (preview.wouldAttach) {
      await this.client.requestNoContent(
        "PATCH",
        `/v1/appStoreVersions/${encodeURIComponent(input.versionId)}/relationships/build`,
        { expectedStatus: 204, body: { data: { type: "builds", id: input.buildId } } },
      );
    }

    let submission = preview.submissionId ? await this.getSubmission(preview.submissionId) : null;
    if (!submission) {
      const created = await this.client.request("POST", "/v1/reviewSubmissions", ReviewSubmissionResponseSchema, {
        expectedStatus: 201,
        body: {
          data: {
            type: "reviewSubmissions",
            attributes: { platform: preview.platform },
            relationships: { app: { data: { type: "apps", id: input.appId } } },
          },
        },
      });
      submission = created.data;
      await this.client.request("POST", "/v1/reviewSubmissionItems", ReviewSubmissionItemResponseSchema, {
        expectedStatus: 201,
        body: {
          data: {
            type: "reviewSubmissionItems",
            relationships: {
              reviewSubmission: { data: { type: "reviewSubmissions", id: submission.id } },
              appStoreVersion: { data: { type: "appStoreVersions", id: input.versionId } },
            },
          },
        },
      });
    }
    const submitted = await this.client.request(
      "PATCH",
      `/v1/reviewSubmissions/${encodeURIComponent(submission.id)}`,
      ReviewSubmissionResponseSchema,
      {
        body: { data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } } },
      },
    );
    return {
      appId: input.appId,
      versionId: input.versionId,
      versionString: preview.versionString,
      platform: preview.platform,
      buildId: input.buildId,
      submissionId: submitted.data.id,
      submittedAt: submitted.data.attributes.submittedDate ?? null,
      alreadySubmitted: false,
      attached: preview.wouldAttach,
      alreadyAttached: preview.alreadyAttached,
    };
  }

  async getVersionSubmissionStatus(versionId: string): Promise<VersionSubmissionStatus> {
    const response = await this.client.request(
      "GET",
      `/v1/appStoreVersions/${encodeURIComponent(versionId)}?include=app`,
      AppStoreVersionResponseSchema,
    );
    const appId = relationshipId(response.data, "app");
    if (!appId) throw new Error("App Store Connect did not return the version's app relationship.");
    const version = normalizeVersion(response.data, appId);
    const submission = await this.findSubmission(appId, versionId);
    return {
      id: submission?.id ?? null,
      versionId,
      versionString: version.versionString,
      platform: version.platform,
      state: submission?.attributes.state ?? "NOT_SUBMITTED",
      submittedAt: submission?.attributes.submittedDate ?? null,
    };
  }

  private async collect<Schema extends ZodTypeAny>(
    path: string,
    schema: Schema,
    paginate: boolean,
  ): Promise<Array<output<Schema>>> {
    const pages: Array<output<Schema>> = [];
    let next: string | URL | null = path;
    do {
      const page: output<Schema> = await this.client.request("GET", next, schema);
      pages.push(page);
      const pageLinks = (page as { links: { next?: string | undefined } }).links;
      next = paginate && pageLinks.next ? this.client.resolveNext(pageLinks.next) : null;
    } while (next);
    return pages;
  }

  private limit(value: number | undefined, label: string) {
    const limit = value ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error(`${label} limit must be between 1 and 200.`);
    return limit;
  }

  private normalizeBuild(
    resource: BuildResource,
    appId: string,
    prereleases: Map<string, PreReleaseVersionResource>,
    groups: Map<string, TesterGroup>,
  ): BuildSummary {
    const attributes = resource.attributes ?? {};
    const prereleaseId = relationshipId(resource, "preReleaseVersion");
    const prerelease = prereleaseId ? prereleases.get(prereleaseId) : null;
    if (!prerelease) throw new Error(`App Store Connect omitted pre-release version data for build ${resource.id}.`);
    const prereleaseAttributes = prerelease.attributes ?? {};
    const platform = AppStorePlatformSchema.safeParse(prereleaseAttributes.platform);
    if (!platform.success) throw new Error(`App Store Connect returned an unsupported platform for build ${resource.id}.`);
    const expired = booleanValue(attributes.expired) ?? false;
    const processing = processingFor(requiredStringValue(attributes.processingState, "build processing state"), expired);
    const assignedGroups = relationshipIds(resource, "betaGroups").flatMap((id) => groups.get(id) ?? []);
    const encryption = booleanValue(attributes.usesNonExemptEncryption);
    return {
      id: resource.id,
      appId,
      buildNumber: requiredStringValue(attributes.version, "build number"),
      version: requiredStringValue(prereleaseAttributes.version, "pre-release version"),
      uploadedAt: requiredStringValue(attributes.uploadedDate, "build upload date"),
      processingStatus: processing.status,
      processingTone: processing.tone,
      testingStatus: assignedGroups.some((group) => !group.internal) ? "External" : assignedGroups.length ? "Internal" : "Not assigned",
      expiresAt: stringValue(attributes.expirationDate),
      expired,
      platform: platform.data,
      sdk: null,
      minimumOs: stringValue(attributes.minOsVersion)
        ?? stringValue(attributes.lsMinimumSystemVersion)
        ?? stringValue(attributes.computedMinMacOsVersion)
        ?? stringValue(attributes.computedMinVisionOsVersion),
      encryption: encryption === null ? null : encryption ? "Yes" : "No",
      groups: assignedGroups,
    };
  }

  private async getVersion(appId: string, versionId: string) {
    const response = await this.client.request("GET", `/v1/appStoreVersions/${encodeURIComponent(versionId)}`, AppStoreVersionResponseSchema);
    const version = normalizeVersion(response.data, appId);
    const linkedAppId = relationshipId(response.data, "app");
    if (linkedAppId && linkedAppId !== appId) throw new Error("The selected App Store version belongs to another app.");
    return version;
  }

  private async createLocalization(versionId: string, localization: VersionLocalization) {
    await this.client.request("POST", "/v1/appStoreVersionLocalizations", LocalizationResponseSchema, {
      expectedStatus: 201,
      body: {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: {
            locale: localization.locale,
            description: toAppleValue(localization.description),
            keywords: toAppleValue(localization.keywords),
            marketingUrl: toAppleValue(localization.marketingUrl),
            promotionalText: toAppleValue(localization.promotionalText),
            supportUrl: toAppleValue(localization.supportUrl),
            whatsNew: toAppleValue(localization.whatsNew),
          },
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
        },
      },
    });
  }

  private async findScreenshotSet(localizationId: string, displayType: ScreenshotDisplayType) {
    const pages = await this.collect(
      `/v1/appStoreVersionLocalizations/${encodeURIComponent(localizationId)}/appScreenshotSets?limit=50`,
      ScreenshotSetsPageSchema,
      true,
    );
    return pages.flatMap((page) => page.data)
      .find((set) => stringValue(set.attributes?.screenshotDisplayType) === displayType) ?? null;
  }

  private async createScreenshotSet(localizationId: string, displayType: ScreenshotDisplayType) {
    const response = await this.client.request("POST", "/v1/appScreenshotSets", ScreenshotSetResponseSchema, {
      expectedStatus: 201,
      body: {
        data: {
          type: "appScreenshotSets",
          attributes: { screenshotDisplayType: displayType },
          relationships: {
            appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } },
          },
        },
      },
    });
    return response.data;
  }

  private async uploadScreenshot(setId: string, fileName: string, body: Buffer, sourceChecksum: string) {
    const reserved = await this.client.request("POST", "/v1/appScreenshots", ScreenshotResponseSchema, {
      expectedStatus: 201,
      body: {
        data: {
          type: "appScreenshots",
          attributes: { fileName, fileSize: body.length },
          relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
        },
      },
    });
    const operations = ScreenshotUploadOperationsSchema.safeParse(reserved.data.attributes?.uploadOperations);
    if (!operations.success) throw new Error("App Store Connect did not provide valid screenshot upload operations.");
    await Promise.all(operations.data.map((operation) => this.client.upload(operation, body)));
    await this.client.request("PATCH", `/v1/appScreenshots/${encodeURIComponent(reserved.data.id)}`, ScreenshotResponseSchema, {
      body: {
        data: {
          type: "appScreenshots",
          id: reserved.data.id,
          attributes: { sourceFileChecksum: sourceChecksum, uploaded: true },
        },
      },
    });
    const deadline = Date.now() + this.mediaProcessingTimeoutMs;
    while (Date.now() < deadline) {
      const response = await this.client.request("GET", `/v1/appScreenshots/${encodeURIComponent(reserved.data.id)}`, ScreenshotResponseSchema);
      const state = stringValue(recordValue(response.data.attributes?.assetDeliveryState)?.state);
      if (state === "COMPLETE") return response.data.id;
      if (state === "FAILED") throw new Error(`App Store Connect could not process ${fileName}.`);
      await wait(2_000);
    }
    throw new Error(`Timed out while App Store Connect processed ${fileName}.`);
  }

  private async findSubmission(appId: string, versionId: string): Promise<ReviewSubmissionResource | null> {
    const query = new URLSearchParams({
      "filter[app]": appId,
      include: "appStoreVersionForReview",
      limit: "200",
    });
    const pages = await this.collect(`/v1/reviewSubmissions?${query}`, ReviewSubmissionsPageSchema, true);
    return pages.flatMap((page) => page.data)
      .find((submission) => relationshipId(submission, "appStoreVersionForReview") === versionId) ?? null;
  }

  private async getSubmission(submissionId: string) {
    const response = await this.client.request(
      "GET",
      `/v1/reviewSubmissions/${encodeURIComponent(submissionId)}`,
      ReviewSubmissionResponseSchema,
    );
    return response.data;
  }

  private requireUploadDirectory() {
    if (!this.uploadDirectory) throw new Error("Screenshot uploads are not configured for this provider.");
    return this.uploadDirectory;
  }

  private screenshotUploadPath(uploadId: string, fileName: string) {
    if (!/^[0-9a-f-]{36}$/.test(uploadId) || basename(fileName) !== fileName) {
      throw new Error("The staged screenshot reference is invalid.");
    }
    const root = this.requireUploadDirectory();
    const path = resolve(root, uploadId, fileName);
    const pathFromRoot = relative(root, path);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
      throw new Error("The staged screenshot reference is invalid.");
    }
    return path;
  }
}
