import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AddBuildToGroupInputSchema,
  AppleAdsCampaignReportInputSchema,
  AppleAdsCredentialsInputSchema,
  AppleAdsKeywordResearchInputSchema,
  AnalyticsOverviewQuerySchema,
  AnalyticsOverviewQueryV2Schema,
  AnalyticsPortfolioPendingPlansResponseSchema,
  AnalyticsPortfolioReportRequestCreateInputSchema,
  AnalyticsPortfolioReportRequestPlanResponseSchema,
  AnalyticsPortfolioSyncInputSchema,
  AnalyticsReportRequestCreateInputSchema,
  AnalyticsSyncInputSchema,
  CreateAppleAdsAdGroupInputSchema,
  CreateAppleAdsCampaignInputSchema,
  CreateAppleAdsKeywordInputSchema,
  AppStoreConnectCredentialsInputSchema,
  AppStorePlatformSchema,
  AppStoreLocaleSchema,
  UpdateSearchMetadataInputSchema,
  CustomerReviewSortSchema,
  CreateVersionInputSchema,
  GenerateCustomerReviewReplyInputSchema,
  GenerateReleaseCopyTranslationsInputSchema,
  ScreenshotDisplayTypeSchema,
  SubscriptionParityPricingInputSchema,
  SubscriptionPlanTypeSchema,
  SubmitVersionInputSchema,
  UpdateAppleAdsCampaignInputSchema,
  UpdateAppleAdsKeywordInputSchema,
  UpdateScreenshotSetInputSchema,
  UpsertCustomerReviewResponseInputSchema,
  UpdateVersionLocalizationsInputSchema,
} from "@asc-studio/contracts";
import type {
  AppSummary,
  MutationPlan,
  ScreenshotDisplayType,
  ScreenshotUploadReceipt,
} from "@asc-studio/contracts";
import { AscStudioService, DomainError, type AnalyticsProvider } from "@asc-studio/core";
import {
  AppleAdsApiError,
  AppleAdsCredentialUnavailableError,
  AppleAdsPlatformProvider,
} from "@asc-studio/provider-apple-ads";
import { AnalyticsPermissionError, AppStoreConnectApiError, AppStoreConnectProvider } from "@asc-studio/provider-app-store-connect";
import {
  demoAnalyticsFixtureVersion,
  demoAnalyticsIssuerId,
  MockAscProvider,
} from "@asc-studio/provider-demo";
import { z } from "zod";
import {
  AppleAdsCredentialStore,
  AppStoreConnectCredentialStore,
  CredentialStoreError,
  defaultCredentialRecoveryDirectory,
  OpenAiCredentialStore,
} from "./credentials.js";
import { InMemoryCredentialVault, systemCredentialVault } from "./keychain.js";
import { acquireInstanceLock } from "./instance-lock.js";
import { handleMcpRequest } from "./mcp.js";
import { SqlitePlanStore } from "./store.js";
import { SqliteAnalyticsStore } from "./analytics-store.js";
import { AnalyticsSyncBusyError, AnalyticsSyncCoordinator } from "./analytics-sync.js";
import {
  AnalyticsPortfolioCoordinator,
  AnalyticsPortfolioError,
  type AnalyticsPortfolioConnection,
} from "./analytics-portfolio.js";
import {
  createCustomerReviewReplyGenerator,
  createReleaseCopyTranslator,
  resolveOpenAiModel,
  TranslationProviderError,
  validateOpenAiCredential,
} from "./translation.js";

const port = Number(process.env.ASC_STUDIO_PORT ?? 0);
const host = "127.0.0.1";
const dataDirectory = process.env.ASC_STUDIO_DATA_DIR ?? join(process.cwd(), ".asc-studio");
const webDirectory = process.env.ASC_STUDIO_WEB_DIR ? resolve(process.env.ASC_STUDIO_WEB_DIR) : null;
const maximumBodyBytes = 64 * 1024;
const maximumScreenshotBytes = 20 * 1024 * 1024;
const screenshotUploadsDirectory = join(dataDirectory, "uploads", "screenshots");

const customerReviewRatingsQuerySchema = z.string()
  .regex(/^[1-5](?:,[1-5])*$/)
  .transform((value) => value.split(",").map(Number))
  .refine((values) => new Set(values).size === values.length, "Ratings must be unique.");

const customerReviewTerritoriesQuerySchema = z.string()
  .regex(/^[A-Z]{3}(?:,[A-Z]{3})*$/)
  .transform((value) => value.split(","))
  .refine((values) => new Set(values).size === values.length, "Territories must be unique.");

const customerReviewsQuerySchema = z.object({
  limit: z.string()
    .regex(/^(?:[1-9]|[1-9]\d|1\d{2}|200)$/)
    .transform(Number)
    .optional()
    .default("50"),
  cursor: z.string().min(1).max(2_048).optional(),
  ratings: customerReviewRatingsQuerySchema.optional(),
  territories: customerReviewTerritoriesQuerySchema.optional(),
  sort: CustomerReviewSortSchema.optional().default("-createdDate"),
  publishedResponse: z.enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
}).strict();

const resetOpenAiVaultInputSchema = z.object({
  confirmation: z.literal("RESET OPENAI CONNECTION"),
}).strict();
const resetAppleAdsVaultInputSchema = z.object({
  confirmation: z.literal("RESET APPLE ADS CONNECTIONS"),
}).strict();
const resetAppleConnectionsVaultInputSchema = z.object({
  confirmation: z.literal("RESET APPLE CONNECTIONS"),
}).strict();

const uniqueSearchParams = (searchParams: URLSearchParams) => {
  const values = Object.create(null) as Record<string, string>;
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(values, key)) {
      throw new RequestError("invalid_input", "Query parameters may only be supplied once.", 400);
    }
    values[key] = value;
  }
  return values;
};

const screenshotDimensions: Record<ScreenshotDisplayType, Set<string>> = {
  APP_IPHONE_55: new Set(["1242x2208", "2208x1242"]),
  APP_IPHONE_65: new Set(["1242x2688", "1284x2778", "2688x1242", "2778x1284"]),
  APP_IPHONE_67: new Set(["1260x2736", "1290x2796", "1320x2868", "2736x1260", "2796x1290", "2868x1320"]),
  APP_IPHONE_69: new Set(["1260x2736", "1290x2796", "1320x2868", "2736x1260", "2796x1290", "2868x1320"]),
  APP_IPAD_PRO_129: new Set(["2048x2732", "2064x2752", "2732x2048", "2752x2064"]),
  APP_IPAD_PRO_3GEN_129: new Set(["2048x2732", "2064x2752", "2732x2048", "2752x2064"]),
  APP_WATCH_SERIES_7: new Set(["396x484"]),
  APP_WATCH_SERIES_10: new Set(["416x496"]),
  APP_WATCH_ULTRA: new Set(["410x502", "422x514"]),
  APP_DESKTOP: new Set(["1280x800", "1440x900", "2560x1600", "2880x1800"]),
  APP_APPLE_TV: new Set(["1920x1080", "3840x2160"]),
  APP_APPLE_VISION_PRO: new Set(["3840x2160"]),
};

class RequestError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "RequestError";
  }
}

class AsyncReadWriteLock {
  private readers = 0;
  private writer = false;
  private readonly queue: Array<{ mode: "read" | "write"; resolve: (release: () => void) => void }> = [];

  acquireRead() {
    return this.acquire("read");
  }

  acquireWrite() {
    return this.acquire("write");
  }

  private acquire(mode: "read" | "write"): Promise<() => void> {
    return new Promise((resolve) => {
      this.queue.push({ mode, resolve });
      this.dispatch();
    });
  }

  private dispatch() {
    if (this.writer || this.readers > 0 && this.queue[0]?.mode === "write") return;
    if (this.queue[0]?.mode === "write") {
      const entry = this.queue.shift()!;
      this.writer = true;
      entry.resolve(this.releaseOnce(() => {
        this.writer = false;
        this.dispatch();
      }));
      return;
    }
    while (this.queue[0]?.mode === "read" && !this.writer) {
      const entry = this.queue.shift()!;
      this.readers += 1;
      entry.resolve(this.releaseOnce(() => {
        this.readers -= 1;
        this.dispatch();
      }));
    }
  }

  private releaseOnce(release: () => void) {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }
}

const domainStatus = (code: string) => {
  if (["app_not_found", "group_not_found", "localization_not_found", "plan_not_found", "review_not_found", "screenshot_not_found", "subscription_not_found", "version_not_found", "source_version_not_found"].includes(code)) return 404;
  if ([
    "already_assigned",
    "analytics_report_request_exists",
    "apple_ads_ad_group_changed",
    "apple_ads_ad_group_exists",
    "apple_ads_bid_strategy_unsupported",
    "apple_ads_campaign_deleted",
    "apple_ads_campaign_exists",
    "apple_ads_keyword_deleted",
    "apple_ads_keyword_exists",
    "build_app_mismatch",
    "build_not_ready",
    "build_version_mismatch",
    "no_changes",
    "plan_not_confirmable",
    "plan_changed",
    "plan_expired",
    "stale_plan",
    "submission_blocked",
    "submission_unavailable",
    "screenshot_limit",
    "screenshot_type_mismatch",
    "version_exists",
    "version_already_submitted",
    "version_not_editable",
    "workspace_changed",
  ].includes(code)) return 409;
  return 400;
};

const resolveMode = () => {
  const value = process.env.ASC_STUDIO_MODE;
  if (value === undefined) return "demo" as const;
  if (value === "demo" || value === "live") return value;
  throw new Error(`ASC_STUDIO_MODE must be exactly "demo" or "live"; received ${JSON.stringify(value)}.`);
};

const mode = resolveMode();

const bearerTokenPattern = /^[A-Za-z0-9\-._~+/]+=*$/;

const loadBearerToken = (name: "ASC_STUDIO_GUI_TOKEN" | "ASC_STUDIO_MCP_TOKEN") => {
  const configured = process.env[name];
  if (configured === undefined) return { value: randomBytes(32).toString("base64url"), generated: true };
  if (configured.length < 43 || configured.length > 512 || !bearerTokenPattern.test(configured)) {
    throw new Error(`${name} must be a high-entropy bearer token of 43-512 valid token characters.`);
  }
  return { value: configured, generated: false };
};

const guiToken = loadBearerToken("ASC_STUDIO_GUI_TOKEN");
const mcpToken = loadBearerToken("ASC_STUDIO_MCP_TOKEN");
if (guiToken.value === mcpToken.value) {
  throw new Error("ASC_STUDIO_GUI_TOKEN and ASC_STUDIO_MCP_TOKEN must be different.");
}

const tokenDigest = (value: string) => createHash("sha256").update(value).digest();
const guiTokenDigest = tokenDigest(guiToken.value);
const mcpTokenDigest = tokenDigest(mcpToken.value);

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const staticContentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const safeStaticPath = (pathname: string, fallbackToIndex: boolean) => {
  if (!webDirectory) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new RequestError("invalid_path", "The request path is invalid.", 400);
  }
  if (decoded.includes("\0")) throw new RequestError("invalid_path", "The request path is invalid.", 400);
  const requested = decoded === "/" || fallbackToIndex ? "index.html" : decoded.replace(/^\/+/, "");
  const path = resolve(webDirectory, requested);
  const pathFromRoot = relative(webDirectory, path);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new RequestError("invalid_path", "The request path is invalid.", 400);
  }
  return path;
};

const serveStatic = async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
  if (!webDirectory || !request.method || !["GET", "HEAD"].includes(request.method)) return false;
  const hasExtension = extname(pathname) !== "";
  const candidates = [safeStaticPath(pathname, false), ...(!hasExtension && pathname !== "/" ? [safeStaticPath(pathname, true)] : [])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const body = await readFile(candidate);
      response.writeHead(200, {
        "content-type": staticContentTypes.get(extname(candidate).toLowerCase()) ?? "application/octet-stream",
        "content-length": body.byteLength,
        "content-security-policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data: https://*.mzstatic.com; object-src 'none'; script-src 'self'; style-src 'self'",
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT" && code !== "EISDIR") throw error;
    }
  }
  return false;
};

const readRawBuffer = async (request: IncomingMessage, maximumBytes = maximumBodyBytes) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maximumBytes) throw new RequestError("body_too_large", "The request body is too large.", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const readRawBody = async (request: IncomingMessage) => (await readRawBuffer(request)).toString("utf8");

const readBody = async (request: IncomingMessage) => {
  const body = await readRawBody(request);
  if (!body) return {};
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestError("invalid_json", "The request body is not valid JSON.", 400);
  }
};

const enforceDeclaredBodySize = (request: IncomingMessage, maximumBytes = maximumBodyBytes) => {
  const value = request.headers["content-length"];
  if (value === undefined) return;
  if (!/^\d+$/.test(value)) throw new RequestError("invalid_content_length", "Content-Length must be a non-negative integer.", 400);
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new RequestError("invalid_content_length", "Content-Length is not valid.", 400);
  if (size > maximumBytes) throw new RequestError("body_too_large", "The request body is too large.", 413);
};

interface ParsedScreenshot {
  mediaType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  hasAlpha: boolean;
}

const parsePng = (body: Buffer): ParsedScreenshot | null => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (body.length < 33 || !body.subarray(0, 8).equals(signature) || body.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = body.readUInt32BE(16);
  const height = body.readUInt32BE(20);
  const colorType = body[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  let offset = 8;
  while (!hasAlpha && offset + 12 <= body.length) {
    const length = body.readUInt32BE(offset);
    if (offset + 12 + length > body.length) break;
    const type = body.toString("ascii", offset + 4, offset + 8);
    if (type === "tRNS") hasAlpha = true;
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return width && height ? { mediaType: "image/png", width, height, hasAlpha } : null;
};

const jpegStartOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const parseJpeg = (body: Buffer): ParsedScreenshot | null => {
  if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= body.length) {
    while (offset < body.length && body[offset] === 0xff) offset += 1;
    const marker = body[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > body.length) break;
    const length = body.readUInt16BE(offset);
    if (length < 2 || offset + length > body.length) break;
    if (jpegStartOfFrameMarkers.has(marker) && length >= 7) {
      const height = body.readUInt16BE(offset + 3);
      const width = body.readUInt16BE(offset + 5);
      return width && height ? { mediaType: "image/jpeg", width, height, hasAlpha: false } : null;
    }
    offset += length;
  }
  return null;
};

const parseScreenshot = (body: Buffer) => parsePng(body) ?? parseJpeg(body);

const safeScreenshotFileName = (value: string | null) => z.string()
  .min(1)
  .max(255)
  .refine((name) => basename(name) === name && !/[\u0000-\u001f\u007f]/.test(name), "Use a plain file name.")
  .parse(value);

const stagedScreenshotPath = (uploadId: string, fileName: string) => {
  const id = z.string().uuid().parse(uploadId);
  const safeName = safeScreenshotFileName(fileName);
  const path = resolve(screenshotUploadsDirectory, id, safeName);
  const pathFromRoot = relative(screenshotUploadsDirectory, path);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
    throw new RequestError("invalid_upload", "The staged screenshot reference is invalid.", 400);
  }
  return path;
};

const discardScreenshotUpload = async (upload: Pick<ScreenshotUploadReceipt, "uploadId" | "fileName">) => {
  const path = stagedScreenshotPath(upload.uploadId, upload.fileName);
  await unlink(path).catch(() => undefined);
  await rmdir(join(screenshotUploadsDirectory, upload.uploadId)).catch(() => undefined);
};

const presentedBearerToken = (authorization: string | undefined) => {
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization ?? "");
  return { validSyntax: match !== null, value: match?.[1] ?? "" };
};

const requestAuthorization = (request: IncomingMessage) => {
  const presented = presentedBearerToken(request.headers.authorization);
  const presentedDigest = tokenDigest(presented.value);
  const guiMatches = timingSafeEqual(presentedDigest, guiTokenDigest);
  const mcpMatches = timingSafeEqual(presentedDigest, mcpTokenDigest);
  return {
    gui: presented.validSyntax && guiMatches,
    mcp: presented.validSyntax && mcpMatches,
  };
};

const unauthorized = (response: ServerResponse) => {
  response.setHeader("www-authenticate", 'Bearer realm="asc-studio"');
  response.setHeader("connection", "close");
  json(response, 401, { error: { code: "unauthorized", message: "A valid bearer token is required." } });
};

const isTrustedHost = (value: string | undefined) => {
  if (!value) return false;
  const hostname = value.replace(/^\[/, "").split(value.startsWith("[") ? "]" : ":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
};

const isTrustedOrigin = (value: string | undefined) => {
  if (!value) return true;
  try {
    const origin = new URL(value);
    return origin.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(origin.hostname);
  } catch {
    return false;
  }
};

const usesTestCredentialVault = process.env.NODE_ENV === "test"
  && process.env.ASC_STUDIO_TEST_IN_MEMORY_KEYCHAIN === "1";
const credentialVault = usesTestCredentialVault
  ? new InMemoryCredentialVault()
  : systemCredentialVault;
const credentialRecoveryDirectory = usesTestCredentialVault
  ? join(dataDirectory, "test-credential-recovery")
  : defaultCredentialRecoveryDirectory();
const credentialStore = new AppStoreConnectCredentialStore(
  dataDirectory,
  credentialVault,
  credentialRecoveryDirectory,
);
const appleAdsCredentialStore = new AppleAdsCredentialStore(
  dataDirectory,
  () => new Date(),
  credentialVault,
  credentialRecoveryDirectory,
);
const openAiCredentialStore = new OpenAiCredentialStore(
  dataDirectory,
  credentialVault,
  credentialRecoveryDirectory,
);
const accountLock = new AsyncReadWriteLock();
const openAiLock = new AsyncReadWriteLock();

const main = async () => {
  const releaseInstanceLock = await acquireInstanceLock(
    dataDirectory,
    usesTestCredentialVault ? { runtimeDirectory: join(dataDirectory, "test-instance-locks") } : {},
  );
  let serverStarted = false;
  try {
  await mkdir(screenshotUploadsDirectory, { recursive: true, mode: 0o700 });
  if (webDirectory) {
    const webStats = await stat(webDirectory).catch(() => null);
    if (!webStats?.isDirectory()) throw new Error(`ASC_STUDIO_WEB_DIR is not a readable directory: ${webDirectory}`);
  }
  const demoProvider = mode === "demo" ? new MockAscProvider() : null;
  const provider = demoProvider ?? new AppStoreConnectProvider({
    credentials: () => credentialStore.load(),
    uploadDirectory: screenshotUploadsDirectory,
  });
  const activeAppleAccount = async () => {
    const credentials = await credentialStore.load();
    return credentials?.connectionId
      ? { connectionId: credentials.connectionId, profileName: credentials.profileName }
      : null;
  };
  const adsProvider = demoProvider ?? new AppleAdsPlatformProvider({
    credentials: async () => appleAdsCredentialStore.load(await activeAppleAccount()),
  });
  const databaseName = mode === "demo" ? "demo.sqlite" : "live.sqlite";
  const databasePath = join(dataDirectory, databaseName);
  const store = new SqlitePlanStore(databasePath);
  const analyticsStore = new SqliteAnalyticsStore(databasePath);
  const interruptedAt = new Date().toISOString();
  await analyticsStore.failInterruptedAnalyticsSyncRuns(interruptedAt);
  analyticsStore.failInterruptedAnalyticsPortfolioSyncRuns(interruptedAt);
  const service = new AscStudioService({
    provider,
    adsProvider,
    analyticsProvider: provider,
    analyticsStore,
    store,
    now: () => new Date(),
    id: () => randomUUID(),
    digest: (value) => createHash("sha256").update(value).digest("hex"),
  });
  const activeAnalyticsIssuerId = async () => {
    if (mode === "demo") return demoAnalyticsIssuerId;
    return (await credentialStore.load())?.issuerId ?? null;
  };
  const portfolioAppsByIssuer = new Map<string, AppSummary[]>();
  const loadCompletePortfolioApps = async () => {
    const apps = await service.listApps({ paginate: true });
    const issuerId = await activeAnalyticsIssuerId();
    if (issuerId) portfolioAppsByIssuer.set(issuerId, apps);
    return apps;
  };
  const analyticsSync = new AnalyticsSyncCoordinator({
    provider,
    store: analyticsStore,
    acquireAccountRead: () => accountLock.acquireRead(),
    activeIssuerId: activeAnalyticsIssuerId,
    now: () => new Date(),
    id: () => randomUUID(),
  });
  const analyticsSyncReservations = new Set<string>();
  const providerForCredentials = (credentials: Awaited<ReturnType<typeof credentialStore.loadConnection>>) => (
    new AppStoreConnectProvider({ credentials, uploadDirectory: screenshotUploadsDirectory })
  );
  const listAnalyticsPortfolioConnections = async (): Promise<AnalyticsPortfolioConnection[]> => {
    if (demoProvider) {
      return [{
        connectionId: "demo",
        profileName: "Demo workspace",
        issuerId: demoAnalyticsIssuerId,
        active: true,
        provider: demoProvider,
      }];
    }
    const accounts = await credentialStore.list();
    return await Promise.all(accounts.map(async (account) => {
      const credentials = await credentialStore.loadConnection(account.id);
      return {
        connectionId: account.id,
        profileName: account.profileName,
        issuerId: credentials.issuerId,
        active: account.active,
        provider: providerForCredentials(credentials),
      };
    }));
  };
  const analyticsPortfolio = new AnalyticsPortfolioCoordinator({
    listConnections: listAnalyticsPortfolioConnections,
    store: analyticsStore,
    acquireAccountRead: () => accountLock.acquireRead(),
    now: () => new Date(),
    id: () => randomUUID(),
    digest: (value) => createHash("sha256").update(value).digest("hex"),
    isIssuerSyncActive: (issuerId) => (
      analyticsSync.isActive(issuerId) || analyticsSyncReservations.has(issuerId)
    ),
  });
  const scopedAnalyticsService = (
    connection: AnalyticsPortfolioConnection,
    mutationCandidates: AnalyticsPortfolioConnection[] = [connection],
  ) => {
    const uniqueCandidates = [...new Map(
      mutationCandidates.map((candidate) => [candidate.connectionId, candidate]),
    ).values()];
    let mutationConnection: AnalyticsPortfolioConnection | null = null;
    const analyticsProvider: AnalyticsProvider = {
      getAnalyticsStatus: () => connection.provider.getAnalyticsStatus(),
      listAnalyticsReportRequests: (appId) => connection.provider.listAnalyticsReportRequests(appId),
      syncAnalytics: (input) => connection.provider.syncAnalytics(input),
      createAnalyticsReportRequest: async (input) => {
        let lastAdminError: AnalyticsPermissionError | null = null;
        for (const candidate of uniqueCandidates) {
          try {
            const created = await candidate.provider.createAnalyticsReportRequest(input);
            mutationConnection = candidate;
            return created;
          } catch (error) {
            if (error instanceof AnalyticsPermissionError && error.code === "analytics_admin_required") {
              // This typed provider error is emitted only for an ASC 403 from
              // the non-retrying create request, so no mutation occurred and
              // trying the next same-issuer credential is safe.
              lastAdminError = error;
              continue;
            }
            throw error;
          }
        }
        throw lastAdminError ?? new AnalyticsPermissionError(
          "analytics_admin_required",
          "An App Store Connect Admin must create an Analytics Reports request for this app.",
        );
      },
    };
    return new AscStudioService({
      provider: connection.provider,
      analyticsProvider,
      analyticsStore,
      store: {
        savePlan: (plan) => store.savePortfolioAnalyticsPlan(plan, connection.issuerId),
        getPlan: (planId) => store.getPlan(planId),
        listPlans: (state, limit) => store.listPlans(state, limit),
        claimPlan: (planId, expectedState, next) => store.claimPlan(planId, expectedState, next),
        appendAudit: (event) => store.appendAudit({
          ...event,
          target: analyticsPortfolio.publicAppId(connection.issuerId, event.target),
          summary: event.operation === "analytics.report_request.create"
            && event.phase === "succeeded"
            && mutationConnection
            ? `${event.summary} via Apple account ${mutationConnection.profileName}.`
            : event.summary,
        }),
        listAudit: (limit) => store.listAudit(limit),
      },
      now: () => new Date(),
      id: () => randomUUID(),
      digest: (value) => createHash("sha256").update(value).digest("hex"),
    });
  };
  const loadAnalyticsPortfolioConnection = async (connectionId: string) => {
    if (demoProvider && connectionId === "demo") {
      return {
        connectionId: "demo",
        profileName: "Demo workspace",
        issuerId: demoAnalyticsIssuerId,
        active: true,
        provider: demoProvider,
      } satisfies AnalyticsPortfolioConnection;
    }
    if (demoProvider) {
      throw new RequestError(
        "connection_not_found",
        "The Apple account used to create this Analytics plan is no longer connected.",
        404,
      );
    }
    const credentials = await credentialStore.loadConnection(connectionId);
    const account = (await credentialStore.list()).find((candidate) => candidate.id === connectionId);
    if (!account) {
      throw new RequestError(
        "connection_not_found",
        "The Apple account used to create this Analytics plan is no longer connected.",
        404,
      );
    }
    return {
      connectionId,
      profileName: account.profileName,
      issuerId: credentials.issuerId,
      active: account.active,
      provider: providerForCredentials(credentials),
    } satisfies AnalyticsPortfolioConnection;
  };
  const sanitizeAnalyticsPlan = (plan: MutationPlan, issuerId: string) => {
    if (plan.operation !== "analytics.report_request.create") return plan;
    return analyticsPortfolio.sanitizeReportRequestPlan(plan, issuerId);
  };
  const requireAnalyticsApps = async (appIds: string[], allowProvider = false) => {
    if (new Set(appIds).size !== appIds.length) {
      throw new RequestError("analytics_duplicate_apps", "Choose each portfolio app only once.", 400);
    }
    const issuerId = await activeAnalyticsIssuerId();
    if (!issuerId) {
      throw new RequestError(
        "analytics_not_configured",
        "Connect App Store Connect before reading analytics.",
        409,
      );
    }
    const apps = portfolioAppsByIssuer.get(issuerId) ?? (allowProvider ? await loadCompletePortfolioApps() : null);
    if (!apps) {
      throw new RequestError(
        "analytics_portfolio_not_loaded",
        "Load the complete App Store Connect portfolio before reading analytics.",
        409,
      );
    }
    const known = new Set(apps.map((app) => app.id));
    const unknown = appIds.find((appId) => !known.has(appId));
    if (unknown) {
      throw new RequestError(
        "analytics_app_not_found",
        "One or more selected apps are not part of the active App Store Connect portfolio.",
        404,
      );
    }
    return { issuerId, apps };
  };
  const requireAnalyticsDateRange = (startDate: string, endDate: string) => {
    const parse = (value: string) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
    };
    const start = parse(startDate);
    const end = parse(endDate);
    if (!start || !end) throw new RequestError("analytics_date_invalid", "Choose valid analytics calendar dates.", 400);
    const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (days > 3_653) {
      throw new RequestError("analytics_range_too_large", "Choose an analytics range of ten years or less.", 400);
    }
  };
  if (mode === "demo") {
    const apps = await loadCompletePortfolioApps();
    if (analyticsStore.getDemoAnalyticsFixtureVersion(demoAnalyticsIssuerId) !== demoAnalyticsFixtureVersion) {
      // Demo analytics is deterministic sample data rather than user state.
      // Rebuild only its issuer-scoped cache when fixture semantics change so
      // upgrades are truthful without slowing every launch or touching live data.
      analyticsStore.clearAnalyticsIssuer(demoAnalyticsIssuerId);
      await service.syncAnalytics({
        schemaVersion: 1,
        appIds: apps.map((app) => app.id),
        force: false,
      });
      analyticsStore.setDemoAnalyticsFixtureVersion(demoAnalyticsIssuerId, demoAnalyticsFixtureVersion);
    }
  }
  const resolveOpenAiCredential = () => openAiCredentialStore.load();
  const translator = createReleaseCopyTranslator(mode, resolveOpenAiCredential);
  const customerReviewReplyGenerator = createCustomerReviewReplyGenerator(mode, resolveOpenAiCredential);
  const openAiConnectionResponse = async () => {
    if (mode === "demo") {
      return {
        connection: {
          configured: true,
          source: "demo" as const,
          model: null,
          modelSource: "demo" as const,
        },
      };
    }
    const summary = await openAiCredentialStore.summary();
    const effectiveModel = resolveOpenAiModel(summary.source === "local" ? summary.localModel : null);
    return {
      connection: {
        configured: summary.configured,
        source: summary.source,
        model: effectiveModel.model,
        modelSource: effectiveModel.source,
      },
    };
  };
  const appleAdsConnectionResponse = async () => ({
    status: await service.getAppleAdsStatus(),
    connection: mode === "demo"
      ? {
          configured: true,
          profileName: "Demo workspace",
          appStoreConnectConnectionId: "demo",
          adAccountId: "demo-ads-account",
          keyId: "DEMO",
          source: "demo" as const,
        }
      : await appleAdsCredentialStore.summary(await activeAppleAccount()),
  });

  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cache-control", "no-store");

    if (!isTrustedHost(request.headers.host) || !isTrustedOrigin(request.headers.origin)) {
      json(response, 403, { error: { code: "untrusted_origin", message: "ASC Studio only accepts local requests." } });
      return;
    }

    let releaseAccountLock: (() => void) | null = null;
    let releaseOpenAiLock: (() => void) | null = null;
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
      const authorization = requestAuthorization(request);
      const isApiRequest = url.pathname === "/api" || url.pathname.startsWith("/api/");
      const isMcpRequest = url.pathname === "/mcp" || url.pathname.startsWith("/mcp/");
      if (!isApiRequest && !isMcpRequest && url.pathname !== "/health" && await serveStatic(request, response, url.pathname)) {
        return;
      }
      const acceptsEitherToken = (!webDirectory && url.pathname === "/") || url.pathname === "/health";

      if ((isApiRequest && !authorization.gui) || (isMcpRequest && !authorization.mcp) || (acceptsEitherToken && !authorization.gui && !authorization.mcp)) {
        unauthorized(response);
        return;
      }

      const isOpenAiConnectionRequest = url.pathname === "/api/connections/openai"
        || url.pathname === "/api/connections/openai/reset-vault";
      const ownsPortfolioSyncLease = request.method === "POST"
        && url.pathname === "/api/analytics/portfolio/sync";
      if (
        mode === "live"
        && (isApiRequest || isMcpRequest)
        && !isOpenAiConnectionRequest
        && !ownsPortfolioSyncLease
      ) {
        const changesActiveAccount = (
          request.method === "POST"
          && (
            url.pathname === "/api/connection/app-store-connect"
            || url.pathname === "/api/connections/app-store-connect"
            || url.pathname === "/api/connections/apple-ads"
            || url.pathname === "/api/connections/apple-ads/key-pair"
            || url.pathname === "/api/connections/apple-ads/reset-vault"
            || url.pathname === "/api/connections/app-store-connect/reset-vault"
            || /^\/api\/connections\/app-store-connect\/[^/]+\/activate$/.test(url.pathname)
          )
        ) || (
          request.method === "DELETE"
          && (
            /^\/api\/connections\/app-store-connect\/[^/]+$/.test(url.pathname)
            || url.pathname === "/api/connections/apple-ads"
          )
        );
        releaseAccountLock = await (changesActiveAccount ? accountLock.acquireWrite() : accountLock.acquireRead());
      }

      const usesOpenAiCredential = isOpenAiConnectionRequest
        || url.pathname === "/api/translations/status"
        || url.pathname === "/api/translations/release-copy"
        || url.pathname === "/api/replies/customer-review";
      if (mode === "live" && usesOpenAiCredential) {
        const mutatesOpenAiCredential = isOpenAiConnectionRequest
          && (request.method === "POST" || request.method === "DELETE");
        releaseOpenAiLock = await (mutatesOpenAiCredential
          ? openAiLock.acquireWrite()
          : openAiLock.acquireRead());
      }

      if (isApiRequest || isMcpRequest) {
        enforceDeclaredBodySize(
          request,
          url.pathname === "/api/uploads/screenshots" ? maximumScreenshotBytes : maximumBodyBytes,
        );
      }

      let parsedMcpBody: unknown;
      if (isMcpRequest && request.method === "POST") {
        parsedMcpBody = await readBody(request);
      } else if (
        isMcpRequest &&
        (request.headers["transfer-encoding"] !== undefined || Number(request.headers["content-length"] ?? 0) > 0)
      ) {
        await readRawBody(request);
      }

      if (url.pathname === "/mcp" && request.method && ["POST", "GET", "DELETE"].includes(request.method)) {
        await handleMcpRequest(request, response, service, parsedMcpBody);
        return;
      }
      if (request.method === "GET" && url.pathname === "/") {
        json(response, 200, { name: "ASC Studio local agent", version: "0.6.0", mcp: "/mcp" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const currentStatus = await service.getStatus();
        json(response, 200, { name: "ASC Studio local agent", version: "0.6.0", mode: currentStatus.mode, connected: currentStatus.connected });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        json(response, 200, await service.getStatus());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/analytics/portfolio") {
        json(response, 200, await analyticsPortfolio.refresh());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/analytics/portfolio/status") {
        json(response, 200, await analyticsPortfolio.status());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/analytics/portfolio/plans") {
        store.expirePortfolioAnalyticsPlans(new Date().toISOString());
        const entries = await store.listPortfolioAnalyticsPlans("awaiting_confirmation", 50);
        const plans = entries.flatMap(({ plan, issuerId }) => (
          plan.operation === "analytics.report_request.create"
            ? [analyticsPortfolio.sanitizeReportRequestPlan(plan, issuerId)]
            : []
        ));
        json(response, 200, AnalyticsPortfolioPendingPlansResponseSchema.parse({ plans }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/analytics/status") {
        const analyticsStatus = await service.getAnalyticsStatus();
        const activeRun = analyticsStatus.issuerId
          ? analyticsStore.getActiveSyncRun(analyticsStatus.issuerId)
          : null;
        const persisted = analyticsStatus.issuerId && analyticsStatus.state === "WAITING_FOR_DATA"
          ? await analyticsStore.getLatestSuccessfulAnalyticsSyncRun(analyticsStatus.issuerId)
          : null;
        json(response, 200, activeRun ? {
          ...analyticsStatus,
          state: "SYNCING",
          detail: "Analytics reports are syncing in the background. Existing portfolio data remains available.",
        } : persisted ? {
          ...analyticsStatus,
          state: persisted.state === "PARTIAL" || persisted.freshness.partial ? "PARTIAL" : "READY",
          reportRequests: analyticsStatus.reportRequests.length > 0
            ? analyticsStatus.reportRequests
            : persisted.reportRequests,
          freshness: persisted.freshness,
          detail: persisted.freshness.detail,
        } : analyticsStatus);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/analytics/report-requests") {
        const { appId } = z.object({ appId: z.string().min(1).optional() })
          .strict()
          .parse(uniqueSearchParams(url.searchParams));
        if (appId) await requireAnalyticsApps([appId], true);
        json(response, 200, { reportRequests: await service.listAnalyticsReportRequests(appId) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/analytics/overview") {
        const body = await readBody(request);
        if (body && typeof body === "object" && "schemaVersion" in body && body.schemaVersion === 2) {
          const input = AnalyticsOverviewQueryV2Schema.parse(body);
          requireAnalyticsDateRange(input.startDate, input.endDate);
          json(response, 200, await service.getAnalyticsPortfolioOverview(
            input,
            analyticsPortfolio.requireOverviewContext(input),
          ));
        } else {
          const input = AnalyticsOverviewQuerySchema.parse(body);
          requireAnalyticsDateRange(input.startDate, input.endDate);
          const context = await requireAnalyticsApps(input.appIds);
          json(response, 200, await service.getAnalyticsOverview(input, context));
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/analytics/portfolio/sync") {
        const input = AnalyticsPortfolioSyncInputSchema.parse(await readBody(request));
        json(response, 202, await analyticsPortfolio.startSync(input));
        return;
      }
      const analyticsPortfolioSyncMatch = url.pathname.match(/^\/api\/analytics\/portfolio\/sync\/([^/]+)$/);
      if (request.method === "GET" && analyticsPortfolioSyncMatch?.[1]) {
        const run = analyticsPortfolio.getSync(decodeURIComponent(analyticsPortfolioSyncMatch[1]));
        if (!run) {
          throw new RequestError(
            "analytics_sync_not_found",
            "The portfolio Analytics sync run was not found in this workspace.",
            404,
          );
        }
        json(response, 200, run);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/analytics/sync") {
        const input = AnalyticsSyncInputSchema.parse(await readBody(request));
        await requireAnalyticsApps(input.appIds, true);
        const analyticsStatus = await service.getAnalyticsStatus();
        if (!analyticsStatus.issuerId) {
          throw new RequestError(
            "analytics_not_configured",
            "Connect App Store Connect before syncing analytics reports.",
            409,
          );
        }
        if (
          analyticsPortfolio.hasActiveIssuer(analyticsStatus.issuerId)
          || analyticsSyncReservations.has(analyticsStatus.issuerId)
        ) {
          throw new RequestError(
            "analytics_sync_scope_busy",
            "A portfolio Analytics sync is already using this Apple organization. Wait for it to finish before starting an app-scoped sync.",
            409,
          );
        }
        analyticsSyncReservations.add(analyticsStatus.issuerId);
        try {
          // Keep role failures synchronous and actionable instead of queuing a job
          // that can only fail later with an opaque upstream message.
          const reportRequests = (await Promise.all(
            input.appIds.map((appId) => service.listAnalyticsReportRequests(appId)),
          )).flat();
          json(response, 202, await analyticsSync.start(analyticsStatus.issuerId, input, {
            ...analyticsStatus,
            reportRequests,
          }));
        } finally {
          analyticsSyncReservations.delete(analyticsStatus.issuerId);
        }
        return;
      }
      const analyticsSyncMatch = url.pathname.match(/^\/api\/analytics\/sync\/([^/]+)$/);
      if (request.method === "GET" && analyticsSyncMatch?.[1]) {
        const run = await analyticsSync.get(decodeURIComponent(analyticsSyncMatch[1]));
        const activeIssuerId = await activeAnalyticsIssuerId();
        if (!run || run.issuerId !== activeIssuerId) {
          throw new RequestError("analytics_sync_not_found", "The analytics sync run was not found in this workspace.", 404);
        }
        json(response, 200, run);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/apple-ads/status") {
        json(response, 200, await service.getAppleAdsStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/apple-ads/keywords/research") {
        const input = AppleAdsKeywordResearchInputSchema.parse(await readBody(request));
        json(response, 200, { research: await service.researchAppleAdsKeywords(input) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/apple-ads/campaigns") {
        const appId = url.searchParams.get("appId")?.trim() || undefined;
        json(response, 200, { campaigns: await service.listAppleAdsCampaigns(appId) });
        return;
      }
      const adsAdGroupsMatch = url.pathname.match(/^\/api\/apple-ads\/campaigns\/([^/]+)\/adgroups$/);
      if (request.method === "GET" && adsAdGroupsMatch?.[1]) {
        json(response, 200, { adGroups: await service.listAppleAdsAdGroups(decodeURIComponent(adsAdGroupsMatch[1])) });
        return;
      }
      const adsCampaignKeywordsMatch = url.pathname.match(/^\/api\/apple-ads\/campaigns\/([^/]+)\/keywords$/);
      if (request.method === "GET" && adsCampaignKeywordsMatch?.[1]) {
        json(response, 200, { keywords: await service.listAppleAdsKeywords({ campaignId: decodeURIComponent(adsCampaignKeywordsMatch[1]) }) });
        return;
      }
      const adsAdGroupKeywordsMatch = url.pathname.match(/^\/api\/apple-ads\/adgroups\/([^/]+)\/keywords$/);
      if (request.method === "GET" && adsAdGroupKeywordsMatch?.[1]) {
        json(response, 200, { keywords: await service.listAppleAdsKeywords({ adGroupId: decodeURIComponent(adsAdGroupKeywordsMatch[1]) }) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/apple-ads/campaign-report") {
        const input = AppleAdsCampaignReportInputSchema.parse(await readBody(request));
        json(response, 200, { report: await service.getAppleAdsCampaignReport(input) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/connections/app-store-connect") {
        json(response, 200, { accounts: mode === "live" ? await credentialStore.list() : [] });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/connections/openai") {
        json(response, 200, await openAiConnectionResponse());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connections/openai") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot save a live OpenAI connection.", 409);
        const input = openAiCredentialStore.candidate(await readBody(request));
        const effectiveModel = resolveOpenAiModel(input.model?.trim() || null);
        await validateOpenAiCredential(input.apiKey, effectiveModel.model);
        await openAiCredentialStore.save(input);
        json(response, 200, await openAiConnectionResponse());
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/api/connections/openai") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot remove a live OpenAI connection.", 409);
        await openAiCredentialStore.remove();
        json(response, 200, await openAiConnectionResponse());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connections/openai/reset-vault") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode has no OpenAI credential vault to reset.", 409);
        resetOpenAiVaultInputSchema.parse(await readBody(request));
        await openAiCredentialStore.reset();
        json(response, 200, await openAiConnectionResponse());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/connections/apple-ads") {
        json(response, 200, await appleAdsConnectionResponse());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connections/apple-ads/key-pair") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot create live Apple Ads credentials.", 409);
        const activeAccount = await activeAppleAccount();
        if (!activeAccount) throw new RequestError("app_store_connect_required", "Connect App Store Connect before adding Apple Ads.", 409);
        json(response, 201, appleAdsCredentialStore.createSetup(activeAccount.connectionId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connections/apple-ads") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot save a live Apple Ads connection.", 409);
        const activeAccount = await activeAppleAccount();
        if (!activeAccount) throw new RequestError("app_store_connect_required", "Connect App Store Connect before adding Apple Ads.", 409);
        const input = AppleAdsCredentialsInputSchema.parse(await readBody(request));
        const credentials = await appleAdsCredentialStore.candidateCredentials(
          activeAccount.connectionId,
          activeAccount.profileName,
          input,
        );
        const candidate = new AppleAdsPlatformProvider({ credentials });
        const candidateStatus = await candidate.getAppleAdsStatus();
        if (!candidateStatus.connected) throw new RequestError("connection_failed", candidateStatus.detail, 422);
        await appleAdsCredentialStore.save(activeAccount.connectionId, input);
        json(response, 200, await appleAdsConnectionResponse());
        return;
      }
      if (request.method === "DELETE" && url.pathname === "/api/connections/apple-ads") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot remove a live Apple Ads connection.", 409);
        const activeAccount = await activeAppleAccount();
        if (!activeAccount) throw new RequestError("app_store_connect_required", "Connect App Store Connect before changing Apple Ads.", 409);
        await appleAdsCredentialStore.remove(activeAccount.connectionId);
        json(response, 200, await appleAdsConnectionResponse());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connections/apple-ads/reset-vault") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode has no Apple Ads credential vault to reset.", 409);
        resetAppleAdsVaultInputSchema.parse(await readBody(request));
        await appleAdsCredentialStore.reset();
        json(response, 200, await appleAdsConnectionResponse());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connections/app-store-connect/reset-vault") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode has no Apple credential vault to reset.", 409);
        resetAppleConnectionsVaultInputSchema.parse(await readBody(request));
        // Apple Ads bundles refer to App Store Connect connection IDs, so reset
        // those links first before removing the Apple account bundle itself.
        await appleAdsCredentialStore.reset();
        await credentialStore.reset();
        portfolioAppsByIssuer.clear();
        analyticsPortfolio.invalidate();
        json(response, 200, { status: await service.getStatus(), accounts: [] });
        return;
      }
      if (
        request.method === "POST"
        && ["/api/connection/app-store-connect", "/api/connections/app-store-connect"].includes(url.pathname)
      ) {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot save a live connection.", 409);
        const input = AppStoreConnectCredentialsInputSchema.parse(await readBody(request));
        const candidate = new AppStoreConnectProvider({
          credentials: { ...input, connectionId: "pending", authBackend: "Pending macOS Keychain credential" },
          uploadDirectory: screenshotUploadsDirectory,
        });
        const candidateStatus = await candidate.getStatus();
        if (!candidateStatus.connected) throw new RequestError("connection_failed", candidateStatus.detail, 422);
        await credentialStore.save(input);
        portfolioAppsByIssuer.clear();
        analyticsPortfolio.invalidate();
        json(response, 200, { status: await service.getStatus(), accounts: await credentialStore.list() });
        return;
      }
      const activateConnectionMatch = url.pathname.match(/^\/api\/connections\/app-store-connect\/([^/]+)\/activate$/);
      if (request.method === "POST" && activateConnectionMatch?.[1]) {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode has no Apple accounts to switch.", 409);
        const connectionId = decodeURIComponent(activateConnectionMatch[1]);
        const candidate = new AppStoreConnectProvider({
          credentials: await credentialStore.loadConnection(connectionId),
          uploadDirectory: screenshotUploadsDirectory,
        });
        const nextStatus = await candidate.getStatus();
        if (!nextStatus.connected) throw new RequestError("connection_failed", nextStatus.detail, 422);
        await credentialStore.activate(connectionId);
        portfolioAppsByIssuer.clear();
        analyticsPortfolio.invalidate();
        json(response, 200, { status: nextStatus, accounts: await credentialStore.list() });
        return;
      }
      const removeConnectionMatch = url.pathname.match(/^\/api\/connections\/app-store-connect\/([^/]+)$/);
      if (request.method === "DELETE" && removeConnectionMatch?.[1]) {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode has no Apple accounts to remove.", 409);
        const connectionId = decodeURIComponent(removeConnectionMatch[1]);
        await appleAdsCredentialStore.removeLinked(connectionId);
        await credentialStore.remove(connectionId);
        portfolioAppsByIssuer.clear();
        analyticsPortfolio.invalidate();
        json(response, 200, { status: await service.getStatus(), accounts: await credentialStore.list() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/uploads/screenshots") {
        const displayType = ScreenshotDisplayTypeSchema.parse(url.searchParams.get("displayType"));
        const fileName = safeScreenshotFileName(url.searchParams.get("fileName"));
        const body = await readRawBuffer(request, maximumScreenshotBytes);
        if (body.length === 0) throw new RequestError("empty_upload", "Choose a screenshot file to upload.", 400);
        const parsed = parseScreenshot(body);
        if (!parsed) throw new RequestError("invalid_screenshot", "Only valid PNG and JPEG screenshots are supported.", 400);
        const extension = extname(fileName).toLowerCase();
        const extensionMatches = parsed.mediaType === "image/png"
          ? extension === ".png"
          : extension === ".jpg" || extension === ".jpeg";
        if (!extensionMatches) throw new RequestError("invalid_screenshot", "The screenshot extension does not match its image data.", 400);
        if (parsed.hasAlpha) throw new RequestError("screenshot_has_alpha", "App Store screenshots cannot contain transparency.", 400);
        if (!screenshotDimensions[displayType].has(`${parsed.width}x${parsed.height}`)) {
          throw new RequestError(
            "invalid_screenshot_dimensions",
            `${parsed.width} × ${parsed.height} is not valid for ${displayType}.`,
            400,
          );
        }
        const uploadId = randomUUID();
        const directory = join(screenshotUploadsDirectory, uploadId);
        await mkdir(directory, { mode: 0o700 });
        await writeFile(join(directory, fileName), body, { flag: "wx", mode: 0o600 });
        const upload: ScreenshotUploadReceipt = {
          uploadId,
          displayType,
          fileName,
          mediaType: parsed.mediaType,
          fileSize: body.length,
          width: parsed.width,
          height: parsed.height,
          checksum: createHash("sha256").update(body).digest("hex"),
          hasAlpha: false,
        };
        json(response, 201, { upload });
        return;
      }
      const stagedScreenshotMatch = url.pathname.match(/^\/api\/uploads\/screenshots\/([^/]+)$/);
      if (request.method === "DELETE" && stagedScreenshotMatch?.[1]) {
        await discardScreenshotUpload({
          uploadId: decodeURIComponent(stagedScreenshotMatch[1]),
          fileName: safeScreenshotFileName(url.searchParams.get("fileName")),
        });
        json(response, 200, { discarded: true });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/apps") {
        const limitValue = url.searchParams.get("limit");
        const paginateValue = url.searchParams.get("paginate");
        const limit = limitValue === null
          ? undefined
          : z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(200)).parse(limitValue);
        const paginate = paginateValue === null
          ? undefined
          : z.enum(["true", "false"]).transform((value) => value === "true").parse(paginateValue);
        const apps = await service.listApps({
          ...(limit === undefined ? {} : { limit }),
          ...(paginate === undefined ? {} : { paginate }),
        });
        if (paginate === true) {
          const issuerId = await activeAnalyticsIssuerId();
          if (issuerId) portfolioAppsByIssuer.set(issuerId, apps);
        }
        json(response, 200, { apps });
        return;
      }
      const subscriptionsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/subscriptions$/);
      if (request.method === "GET" && subscriptionsMatch?.[1]) {
        json(response, 200, {
          subscriptions: await service.listSubscriptions(decodeURIComponent(subscriptionsMatch[1])),
        });
        return;
      }
      const subscriptionPricesMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/subscriptions\/([^/]+)\/prices$/);
      if (request.method === "GET" && subscriptionPricesMatch?.[1] && subscriptionPricesMatch[2]) {
        const planTypeValue = url.searchParams.get("planType");
        const planType = planTypeValue === null ? undefined : SubscriptionPlanTypeSchema.parse(planTypeValue);
        json(response, 200, {
          prices: await service.listSubscriptionPrices(
            decodeURIComponent(subscriptionPricesMatch[1]),
            decodeURIComponent(subscriptionPricesMatch[2]),
            planType,
          ),
        });
        return;
      }
      const customerReviewsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/customer-reviews$/);
      if (request.method === "GET" && customerReviewsMatch?.[1]) {
        const query = customerReviewsQuerySchema.parse(uniqueSearchParams(url.searchParams));
        const options = {
          limit: query.limit,
          sort: query.sort,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.ratings === undefined ? {} : { ratings: query.ratings }),
          ...(query.territories === undefined ? {} : { territories: query.territories }),
          ...(query.publishedResponse === undefined ? {} : { publishedResponse: query.publishedResponse }),
        };
        const page = await service.listCustomerReviews(decodeURIComponent(customerReviewsMatch[1]), options);
        json(response, 200, {
          reviews: page.reviews,
          total: page.total,
          nextCursor: page.nextCursor,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/replies/customer-review") {
        const input = GenerateCustomerReviewReplyInputSchema.parse(await readBody(request));
        const review = await service.getCustomerReview(input.appId, input.reviewId).catch((error: unknown) => {
          if (mode !== "demo" && (!(error instanceof AppStoreConnectApiError) || error.status !== 404)) throw error;
          throw new DomainError("review_not_found", "The selected customer review no longer exists.");
        });
        if (review.appId !== input.appId || review.id !== input.reviewId) {
          throw new DomainError("review_not_found", "The selected customer review no longer exists.");
        }
        json(response, 200, await customerReviewReplyGenerator.generate(review));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/translations/status") {
        json(response, 200, await translator.getStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/translations/release-copy") {
        const input = GenerateReleaseCopyTranslationsInputSchema.parse(await readBody(request));
        json(response, 200, { translations: await translator.generate(input) });
        return;
      }
      const buildsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/builds$/);
      if (request.method === "GET" && buildsMatch?.[1]) {
        const versionValue = url.searchParams.get("version");
        const platformValue = url.searchParams.get("platform");
        const includeGroupsValue = url.searchParams.get("includeGroups");
        const version = versionValue === null
          ? undefined
          : z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/).parse(versionValue);
        const platform = platformValue === null ? undefined : AppStorePlatformSchema.parse(platformValue);
        const includeGroups = includeGroupsValue === null
          ? undefined
          : z.enum(["true", "false"]).transform((value) => value === "true").parse(includeGroupsValue);
        json(response, 200, {
          builds: await service.listBuilds(decodeURIComponent(buildsMatch[1]), {
            ...(version === undefined ? {} : { version }),
            ...(platform === undefined ? {} : { platform }),
            ...(includeGroups === undefined ? {} : { includeGroups }),
          }),
        });
        return;
      }
      const groupsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/groups$/);
      if (request.method === "GET" && groupsMatch?.[1]) {
        json(response, 200, { groups: await service.listGroups(decodeURIComponent(groupsMatch[1])) });
        return;
      }
      const searchMetadataMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/versions\/([^/]+)\/search-metadata$/);
      if (request.method === "GET" && searchMetadataMatch?.[1] && searchMetadataMatch[2]) {
        json(response, 200, { metadata: await service.getSearchMetadata(
          decodeURIComponent(searchMetadataMatch[1]), decodeURIComponent(searchMetadataMatch[2]),
          AppStoreLocaleSchema.parse(url.searchParams.get("locale")),
        ) });
        return;
      }
      const localizationsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/versions\/([^/]+)\/localizations$/);
      if (request.method === "GET" && localizationsMatch?.[1] && localizationsMatch[2]) {
        json(response, 200, {
          localizations: await service.listVersionLocalizations(
            decodeURIComponent(localizationsMatch[1]),
            decodeURIComponent(localizationsMatch[2]),
          ),
        });
        return;
      }
      const screenshotsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/versions\/([^/]+)\/screenshots$/);
      if (request.method === "GET" && screenshotsMatch?.[1] && screenshotsMatch[2]) {
        const localizationId = z.string().min(1).parse(url.searchParams.get("localizationId"));
        const displayType = ScreenshotDisplayTypeSchema.parse(url.searchParams.get("displayType"));
        json(response, 200, {
          screenshots: await service.listScreenshots(
            decodeURIComponent(screenshotsMatch[1]),
            decodeURIComponent(screenshotsMatch[2]),
            localizationId,
            displayType,
          ),
        });
        return;
      }
      const validateMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/versions\/([^/]+)\/validate$/);
      if (request.method === "POST" && validateMatch?.[1] && validateMatch[2]) {
        json(response, 200, {
          report: await service.validateVersion(
            decodeURIComponent(validateMatch[1]),
            decodeURIComponent(validateMatch[2]),
          ),
        });
        return;
      }
      const submissionMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/versions\/([^/]+)\/submission$/);
      if (request.method === "GET" && submissionMatch?.[1] && submissionMatch[2]) {
        json(response, 200, {
          submission: await service.getVersionSubmissionStatus(
            decodeURIComponent(submissionMatch[1]),
            decodeURIComponent(submissionMatch[2]),
          ),
        });
        return;
      }
      const versionsMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/versions$/);
      if (request.method === "GET" && versionsMatch?.[1]) {
        const platformValue = url.searchParams.get("platform");
        const platform = platformValue === null ? undefined : AppStorePlatformSchema.parse(platformValue);
        const limitValue = url.searchParams.get("limit");
        const paginateValue = url.searchParams.get("paginate");
        const limit = limitValue === null
          ? undefined
          : z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(200)).parse(limitValue);
        const paginate = paginateValue === null
          ? undefined
          : z.enum(["true", "false"]).transform((value) => value === "true").parse(paginateValue);
        json(response, 200, {
          versions: await service.listVersions(decodeURIComponent(versionsMatch[1]), platform, {
            ...(limit === undefined ? {} : { limit }),
            ...(paginate === undefined ? {} : { paginate }),
          }),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/sync") {
        const input = z.object({ appId: z.string().min(1) }).parse(await readBody(request));
        const builds = await service.listBuilds(input.appId);
        await service.recordSync(builds.length, "gui");
        json(response, 200, { builds });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/build-group") {
        const input = AddBuildToGroupInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createAddBuildToGroupPlan(input, "gui") });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/plans") {
        // Filter marker-backed V2 plans in SQL before LIMIT so a burst of V2
        // plans cannot crowd older V1 plans out of this paginated feed.
        json(response, 200, { plans: await store.listNonPortfolioPlans("awaiting_confirmation", 50) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/subscription-prices") {
        const input = SubscriptionParityPricingInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createSubscriptionParityPricingPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/version") {
        const input = CreateVersionInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createVersionPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/localizations") {
        const input = UpdateVersionLocalizationsInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createUpdateVersionLocalizationsPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/search-metadata") {
        const input = UpdateSearchMetadataInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createSearchMetadataPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/screenshots") {
        const input = UpdateScreenshotSetInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createUpdateScreenshotsPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/submission") {
        const input = SubmitVersionInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createSubmitVersionPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/customer-review-response") {
        const input = UpsertCustomerReviewResponseInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createUpsertCustomerReviewResponsePlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/analytics-report-request") {
        const body = await readBody(request);
        if (body && typeof body === "object" && "schemaVersion" in body && body.schemaVersion === 2) {
          const input = AnalyticsPortfolioReportRequestCreateInputSchema.parse(body);
          const resolved = analyticsPortfolio.resolveApp(input.appId);
          const internalPlan = await scopedAnalyticsService(resolved.connection).createAnalyticsReportRequestPlan({
            appId: resolved.app.rawAppId,
            accessType: input.accessType,
          }, "gui");
          if (internalPlan.operation !== "analytics.report_request.create") {
            throw new Error("Analytics plan creation returned an unexpected operation.");
          }
          json(response, 201, AnalyticsPortfolioReportRequestPlanResponseSchema.parse({
            plan: analyticsPortfolio.sanitizeReportRequestPlan(internalPlan, resolved.source.issuerId),
          }));
        } else {
          const input = AnalyticsReportRequestCreateInputSchema.parse(body);
          json(response, 201, { plan: await service.createAnalyticsReportRequestPlan(input, "gui") });
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/apple-ads/campaign-create") {
        const input = CreateAppleAdsCampaignInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createAppleAdsCampaignPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/apple-ads/campaign-update") {
        const input = UpdateAppleAdsCampaignInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createUpdateAppleAdsCampaignPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/apple-ads/ad-group-create") {
        const input = CreateAppleAdsAdGroupInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createAppleAdsAdGroupPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/apple-ads/keyword-create") {
        const input = CreateAppleAdsKeywordInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createAppleAdsKeywordPlan(input, "gui") });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans/apple-ads/keyword-update") {
        const input = UpdateAppleAdsKeywordInputSchema.parse(await readBody(request));
        json(response, 201, { plan: await service.createUpdateAppleAdsKeywordPlan(input, "gui") });
        return;
      }
      const confirmMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/confirm$/);
      if (request.method === "POST" && confirmMatch?.[1]) {
        const input = z.object({ digest: z.string().length(64) }).parse(await readBody(request));
        const planId = decodeURIComponent(confirmMatch[1]);
        const savedPlan = await store.getPlan(planId);
        const portfolioPlanIssuer = savedPlan?.operation === "analytics.report_request.create"
          ? store.getPortfolioAnalyticsPlanIssuer(planId)
          : null;
        const plan = savedPlan?.operation === "analytics.report_request.create" && portfolioPlanIssuer
          ? await (async () => {
            if (!savedPlan.context.connectionId) {
              throw new RequestError(
                "workspace_disconnected",
                "The Apple account used for this Analytics plan is no longer connected.",
                409,
              );
            }
            const connection = await loadAnalyticsPortfolioConnection(savedPlan.context.connectionId);
            if (connection.issuerId !== portfolioPlanIssuer) {
              throw new RequestError(
                "workspace_changed",
                "The Apple organization for this Analytics plan changed. Review a fresh plan.",
                409,
              );
            }
            if (!analyticsPortfolio.catalog()) await analyticsPortfolio.refresh();
            const resolved = analyticsPortfolio.resolvePlanConnections(
              portfolioPlanIssuer,
              savedPlan.target.appId,
              connection.connectionId,
            );
            const candidates = resolved.connections.map((candidate) => (
              candidate.connectionId === connection.connectionId ? connection : candidate
            ));
            return scopedAnalyticsService(connection, candidates).confirmPlan(planId, input.digest, "gui");
          })()
          : await service.confirmPlan(planId, input.digest, "gui");
        if (plan.operation === "version.update_screenshots" && plan.state === "succeeded") {
          await Promise.all(plan.after.uploads.map(discardScreenshotUpload));
        }
        json(response, 200, plan.operation === "analytics.report_request.create" && portfolioPlanIssuer
          ? AnalyticsPortfolioReportRequestPlanResponseSchema.parse({
            plan: sanitizeAnalyticsPlan(plan, portfolioPlanIssuer),
          })
          : { plan });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/activity") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const events = await service.listAudit(Number.isFinite(limit) ? limit : 50);
        json(response, 200, { events: events.map((event) => (
          event.operation === "analytics.report_request.create" && !event.target.startsWith("app_")
            ? { ...event, target: "analytics-app" }
            : event
        )) });
        return;
      }
      json(response, 404, { error: { code: "not_found", message: "Route not found." } });
    } catch (error) {
      if (response.headersSent) return;
      if (error instanceof RequestError) {
        if (error.status === 413) response.setHeader("connection", "close");
        json(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof CredentialStoreError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof DomainError) {
        json(response, domainStatus(error.code), { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof TranslationProviderError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof AnalyticsSyncBusyError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof AnalyticsPortfolioError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof AnalyticsPermissionError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof AppStoreConnectApiError) {
        json(response, error.status === 429 ? 503 : 502, {
          error: {
            code: `app_store_connect_${error.code.toLowerCase()}`,
            message: error.message,
            ...(error.requestId ? { details: { requestId: error.requestId } } : {}),
          },
        });
        return;
      }
      if (error instanceof AppleAdsApiError) {
        json(response, error.status === 429 ? 503 : 502, {
          error: {
            code: `apple_ads_${error.code.toLowerCase()}`,
            message: error.message,
            ...(error.requestId ? { details: { requestId: error.requestId } } : {}),
          },
        });
        return;
      }
      if (error instanceof AppleAdsCredentialUnavailableError) {
        json(response, 409, { error: { code: "apple_ads_not_configured", message: error.message } });
        return;
      }
      if (error instanceof z.ZodError) {
        json(response, 400, { error: { code: "invalid_input", message: "The request contains invalid fields.", details: error.flatten() } });
        return;
      }
      console.error(error);
      json(response, 500, { error: { code: "internal_error", message: "ASC Studio failed to complete the request." } });
    } finally {
      releaseOpenAiLock?.();
      releaseAccountLock?.();
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      console.log(`ASC Studio local agent (${mode}) listening on http://${host}:${resolvedPort}`);
      console.log(`MCP endpoint: http://${host}:${resolvedPort}/mcp`);
      if (guiToken.generated) console.log(`GUI bearer token: ${guiToken.value}`);
      if (mcpToken.generated) console.log(`MCP bearer token: ${mcpToken.value}`);
      resolve();
    });
  });
  serverStarted = true;

  let shuttingDown = false;
  let releaseLockPromise: Promise<void> | null = null;
  const releaseLock = () => releaseLockPromise ??= releaseInstanceLock();
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceExit = setTimeout(() => {
      void releaseLock().finally(() => process.exit(1));
    }, 5_000);
    forceExit.unref();
    server.close(() => {
      void Promise.all([analyticsSync.waitForAll(), analyticsPortfolio.waitForAll()]).then(() => {
        clearTimeout(forceExit);
        analyticsStore.close();
        store.close();
      }).then(releaseLock).then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  } finally {
    if (!serverStarted) await releaseInstanceLock();
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
