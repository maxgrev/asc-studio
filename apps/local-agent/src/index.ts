import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AddBuildToGroupInputSchema,
  AppStoreConnectCredentialsInputSchema,
  AppStorePlatformSchema,
  CreateVersionInputSchema,
  GenerateReleaseCopyTranslationsInputSchema,
  ScreenshotDisplayTypeSchema,
  SubmitVersionInputSchema,
  UpdateScreenshotSetInputSchema,
  UpdateVersionLocalizationsInputSchema,
} from "@asc-studio/contracts";
import type { ScreenshotDisplayType, ScreenshotUploadReceipt } from "@asc-studio/contracts";
import { AscStudioService, DomainError } from "@asc-studio/core";
import { AppStoreConnectApiError, AppStoreConnectProvider } from "@asc-studio/provider-app-store-connect";
import { MockAscProvider } from "@asc-studio/provider-demo";
import { z } from "zod";
import { AppStoreConnectCredentialStore } from "./credentials.js";
import { handleMcpRequest } from "./mcp.js";
import { SqlitePlanStore } from "./store.js";
import { createReleaseCopyTranslator, TranslationProviderError } from "./translation.js";

const port = Number(process.env.ASC_STUDIO_PORT ?? 0);
const host = "127.0.0.1";
const dataDirectory = process.env.ASC_STUDIO_DATA_DIR ?? join(process.cwd(), ".asc-studio");
const webDirectory = process.env.ASC_STUDIO_WEB_DIR ? resolve(process.env.ASC_STUDIO_WEB_DIR) : null;
const maximumBodyBytes = 64 * 1024;
const maximumScreenshotBytes = 20 * 1024 * 1024;
const screenshotUploadsDirectory = join(dataDirectory, "uploads", "screenshots");

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

const domainStatus = (code: string) => {
  if (["group_not_found", "localization_not_found", "plan_not_found", "screenshot_not_found", "version_not_found", "source_version_not_found"].includes(code)) return 404;
  if ([
    "already_assigned",
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

const credentialStore = new AppStoreConnectCredentialStore(dataDirectory);

const resolveProvider = () => {
  if (mode === "demo") return new MockAscProvider();
  return new AppStoreConnectProvider({
    credentials: () => credentialStore.load(),
    uploadDirectory: screenshotUploadsDirectory,
  });
};

const main = async () => {
  await mkdir(screenshotUploadsDirectory, { recursive: true, mode: 0o700 });
  if (webDirectory) {
    const webStats = await stat(webDirectory).catch(() => null);
    if (!webStats?.isDirectory()) throw new Error(`ASC_STUDIO_WEB_DIR is not a readable directory: ${webDirectory}`);
  }
  const provider = resolveProvider();
  const status = await provider.getStatus();
  const databaseName = status.mode === "demo" ? "demo.sqlite" : "live.sqlite";
  const store = new SqlitePlanStore(join(dataDirectory, databaseName));
  const service = new AscStudioService({
    provider,
    store,
    now: () => new Date(),
    id: () => randomUUID(),
    digest: (value) => createHash("sha256").update(value).digest("hex"),
  });
  const translator = createReleaseCopyTranslator(mode);

  const server = createServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("cache-control", "no-store");

    if (!isTrustedHost(request.headers.host) || !isTrustedOrigin(request.headers.origin)) {
      json(response, 403, { error: { code: "untrusted_origin", message: "ASC Studio only accepts local requests." } });
      return;
    }

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
        json(response, 200, { name: "ASC Studio local agent", version: "0.6.0", mode: status.mode, connected: status.connected });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        json(response, 200, await service.getStatus());
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/connection/app-store-connect") {
        if (mode !== "live") throw new RequestError("demo_connection", "Demo mode cannot save a live connection.", 409);
        const input = AppStoreConnectCredentialsInputSchema.parse(await readBody(request));
        const candidate = new AppStoreConnectProvider({
          credentials: { ...input, authBackend: "Pending local credential file" },
          uploadDirectory: screenshotUploadsDirectory,
        });
        const candidateStatus = await candidate.getStatus();
        if (!candidateStatus.connected) throw new RequestError("connection_failed", candidateStatus.detail, 422);
        await credentialStore.save(input);
        json(response, 200, { status: await service.getStatus() });
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
        json(response, 200, {
          apps: await service.listApps({
            ...(limit === undefined ? {} : { limit }),
            ...(paginate === undefined ? {} : { paginate }),
          }),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/translations/status") {
        json(response, 200, translator.getStatus());
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
      const confirmMatch = url.pathname.match(/^\/api\/plans\/([^/]+)\/confirm$/);
      if (request.method === "POST" && confirmMatch?.[1]) {
        const input = z.object({ digest: z.string().length(64) }).parse(await readBody(request));
        const plan = await service.confirmPlan(decodeURIComponent(confirmMatch[1]), input.digest, "gui");
        if (plan.operation === "version.update_screenshots" && plan.state === "succeeded") {
          await Promise.all(plan.after.uploads.map(discardScreenshotUpload));
        }
        json(response, 200, { plan });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/activity") {
        const limit = Number(url.searchParams.get("limit") ?? 50);
        json(response, 200, { events: await service.listAudit(Number.isFinite(limit) ? limit : 50) });
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
      if (error instanceof DomainError) {
        json(response, domainStatus(error.code), { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof TranslationProviderError) {
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
      if (error instanceof z.ZodError) {
        json(response, 400, { error: { code: "invalid_input", message: "The request contains invalid fields.", details: error.flatten() } });
        return;
      }
      console.error(error);
      json(response, 500, { error: { code: "internal_error", message: "ASC Studio failed to complete the request." } });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      console.log(`ASC Studio local agent (${status.mode}) listening on http://${host}:${resolvedPort}`);
      console.log(`MCP endpoint: http://${host}:${resolvedPort}/mcp`);
      if (guiToken.generated) console.log(`GUI bearer token: ${guiToken.value}`);
      if (mcpToken.generated) console.log(`MCP bearer token: ${mcpToken.value}`);
      resolve();
    });
  });
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
