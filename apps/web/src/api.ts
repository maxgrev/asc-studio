import {
  ActivityResponseSchema,
  AgentStatusSchema,
  AppStoreConnectConnectionResponseSchema,
  ApiErrorSchema,
  AppsResponseSchema,
  BuildsResponseSchema,
  GeneratedReleaseCopyTranslationsResponseSchema,
  GroupsResponseSchema,
  LocalizationsResponseSchema,
  PlanResponseSchema,
  ScreenshotDiscardResponseSchema,
  ScreenshotsResponseSchema,
  ScreenshotUploadResponseSchema,
  SubmissionStatusResponseSchema,
  TranslationProviderStatusSchema,
  ValidationResponseSchema,
  VersionsResponseSchema,
} from "@asc-studio/contracts";
import type {
  AddBuildToGroupInput,
  AppStoreConnectCredentialsInput,
  AppStorePlatform,
  ScreenshotDisplayType,
  ScreenshotUploadReceipt,
  BuildGroupMutationPlan,
  CreateVersionInput,
  CreateVersionMutationPlan,
  GenerateReleaseCopyTranslationsInput,
  MutationPlan,
  SubmitVersionInput,
  SubmitVersionMutationPlan,
  UpdateLocalizationsMutationPlan,
  UpdateScreenshotsMutationPlan,
  UpdateScreenshotSetInput,
  UpdateVersionLocalizationsInput,
} from "@asc-studio/contracts";

interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const sessionStorageKey = "asc-studio.gui-token";

const captureSessionToken = () => {
  const parameters = new URLSearchParams(window.location.hash.slice(1));
  const tokenFromFragment = parameters.get("session");
  if (tokenFromFragment) {
    window.sessionStorage.setItem(sessionStorageKey, tokenFromFragment);
  }
  if (parameters.has("session")) {
    parameters.delete("session");
    const remainingFragment = parameters.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${remainingFragment ? `#${remainingFragment}` : ""}`,
    );
  }
  return window.sessionStorage.getItem(sessionStorageKey);
};

const guiSessionToken = captureSessionToken();

const request = async <T>(path: string, schema: ResponseSchema<T>, options?: RequestInit): Promise<T> => {
  if (!guiSessionToken) {
    throw new ApiError("missing_session", "Open the GUI session URL printed by the local agent.", 401);
  }
  const headers = new Headers(options?.headers);
  headers.set("authorization", `Bearer ${guiSessionToken}`);
  if (options?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("invalid_response", "The local agent returned an invalid response.", response.status);
  }
  if (!response.ok) {
    const error = ApiErrorSchema.safeParse(body);
    throw new ApiError(
      error.success ? error.data.error.code : "request_failed",
      error.success ? error.data.error.message : "Request failed.",
      response.status,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError("invalid_response", "The local agent returned an invalid response.", 502);
  return parsed.data;
};

export const api = {
  status: () => request("/api/status", AgentStatusSchema),
  connectAppStoreConnect: (input: AppStoreConnectCredentialsInput) => request(
    "/api/connection/app-store-connect",
    AppStoreConnectConnectionResponseSchema,
    { method: "POST", body: JSON.stringify(input) },
  ),
  translationStatus: () => request("/api/translations/status", TranslationProviderStatusSchema),
  generateReleaseCopyTranslations: (input: GenerateReleaseCopyTranslationsInput) => request(
    "/api/translations/release-copy",
    GeneratedReleaseCopyTranslationsResponseSchema,
    { method: "POST", body: JSON.stringify(input) },
  ),
  apps: (options: { limit?: number; paginate?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.paginate !== undefined) query.set("paginate", String(options.paginate));
    return request(`/api/apps${query.size ? `?${query}` : ""}`, AppsResponseSchema);
  },
  builds: (appId: string) => request(`/api/apps/${encodeURIComponent(appId)}/builds`, BuildsResponseSchema),
  releaseBuilds: (appId: string, version: string, platform: AppStorePlatform) => {
    const query = new URLSearchParams({ version, platform, includeGroups: "false" });
    return request(`/api/apps/${encodeURIComponent(appId)}/builds?${query}`, BuildsResponseSchema);
  },
  groups: (appId: string) => request(`/api/apps/${encodeURIComponent(appId)}/groups`, GroupsResponseSchema),
  versions: (
    appId: string,
    platform: AppStorePlatform = "IOS",
    options: { limit?: number; paginate?: boolean } = {},
  ) => {
    const query = new URLSearchParams({ platform });
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.paginate !== undefined) query.set("paginate", String(options.paginate));
    return request(`/api/apps/${encodeURIComponent(appId)}/versions?${query}`, VersionsResponseSchema);
  },
  localizations: (appId: string, versionId: string) =>
    request(
      `/api/apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(versionId)}/localizations`,
      LocalizationsResponseSchema,
    ),
  screenshots: (
    appId: string,
    versionId: string,
    localizationId: string,
    displayType: ScreenshotDisplayType,
  ) => {
    const query = new URLSearchParams({ localizationId, displayType });
    return request(
      `/api/apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(versionId)}/screenshots?${query}`,
      ScreenshotsResponseSchema,
    );
  },
  stageScreenshot: (file: File, displayType: ScreenshotDisplayType) => {
    const query = new URLSearchParams({ fileName: file.name, displayType });
    return request(`/api/uploads/screenshots?${query}`, ScreenshotUploadResponseSchema, {
      method: "POST",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
  },
  discardScreenshotUpload: (upload: Pick<ScreenshotUploadReceipt, "uploadId" | "fileName">) => {
    const query = new URLSearchParams({ fileName: upload.fileName });
    return request(
      `/api/uploads/screenshots/${encodeURIComponent(upload.uploadId)}?${query}`,
      ScreenshotDiscardResponseSchema,
      { method: "DELETE" },
    );
  },
  validateVersion: (appId: string, versionId: string) =>
    request(
      `/api/apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(versionId)}/validate`,
      ValidationResponseSchema,
      { method: "POST" },
    ),
  submissionStatus: (appId: string, versionId: string) =>
    request(
      `/api/apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(versionId)}/submission`,
      SubmissionStatusResponseSchema,
    ),
  sync: (appId: string) => request("/api/sync", BuildsResponseSchema, { method: "POST", body: JSON.stringify({ appId }) }),
  activity: () => request("/api/activity?limit=50", ActivityResponseSchema),
  planBuildGroup: async (input: AddBuildToGroupInput): Promise<{ plan: BuildGroupMutationPlan }> => {
    const response = await request("/api/plans/build-group", PlanResponseSchema, { method: "POST", body: JSON.stringify(input) });
    if (response.plan.operation !== "build.add_to_group") throw new ApiError("invalid_response", "The local agent returned the wrong plan type.", 502);
    return { plan: response.plan };
  },
  planVersion: async (input: CreateVersionInput): Promise<{ plan: CreateVersionMutationPlan }> => {
    const response = await request("/api/plans/version", PlanResponseSchema, { method: "POST", body: JSON.stringify(input) });
    if (response.plan.operation !== "version.create") throw new ApiError("invalid_response", "The local agent returned the wrong plan type.", 502);
    return { plan: response.plan };
  },
  planLocalizations: async (input: UpdateVersionLocalizationsInput): Promise<{ plan: UpdateLocalizationsMutationPlan }> => {
    const response = await request("/api/plans/localizations", PlanResponseSchema, { method: "POST", body: JSON.stringify(input) });
    if (response.plan.operation !== "version.update_localizations") throw new ApiError("invalid_response", "The local agent returned the wrong plan type.", 502);
    return { plan: response.plan };
  },
  planScreenshots: async (input: UpdateScreenshotSetInput): Promise<{ plan: UpdateScreenshotsMutationPlan }> => {
    const response = await request("/api/plans/screenshots", PlanResponseSchema, { method: "POST", body: JSON.stringify(input) });
    if (response.plan.operation !== "version.update_screenshots") throw new ApiError("invalid_response", "The local agent returned the wrong plan type.", 502);
    return { plan: response.plan };
  },
  planSubmission: async (input: SubmitVersionInput): Promise<{ plan: SubmitVersionMutationPlan }> => {
    const response = await request("/api/plans/submission", PlanResponseSchema, { method: "POST", body: JSON.stringify(input) });
    if (response.plan.operation !== "version.submit") throw new ApiError("invalid_response", "The local agent returned the wrong plan type.", 502);
    return { plan: response.plan };
  },
  confirmPlan: (plan: MutationPlan) =>
    request(`/api/plans/${encodeURIComponent(plan.id)}/confirm`, PlanResponseSchema, {
      method: "POST",
      body: JSON.stringify({ digest: plan.digest }),
    }),
};
