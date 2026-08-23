import { createHash, randomUUID } from "node:crypto";
import { lookup as lookupHost } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { gunzipSync } from "node:zlib";
import { ANALYTICS_METRIC_COMPLETENESS_DAYS } from "@asc-studio/contracts";
import type {
  AnalyticsAdditiveMetricId,
  AnalyticsFactBatch,
  AnalyticsObservation,
  AnalyticsReportRequest,
  AnalyticsReportRequestCreateInput,
  AnalyticsSegmentEvidence,
  AnalyticsStatusResponse,
  AnalyticsSyncInput,
  AnalyticsSyncResult,
} from "@asc-studio/contracts";
import type { output, ZodTypeAny } from "zod";
import { AppStoreConnectApiError, AppStoreConnectClient } from "./client.js";
import {
  AnalyticsReportInstancesPageSchema,
  AnalyticsReportRequestResponseSchema,
  AnalyticsReportRequestsPageSchema,
  AnalyticsReportsPageSchema,
  AnalyticsReportSegmentsPageSchema,
  AppsPageSchema,
  type AnalyticsReportInstanceResource,
  type AnalyticsReportResource,
  type AnalyticsReportSegmentResource,
} from "./schemas.js";

export type LiveAnalyticsCategory = "APP_STORE_ENGAGEMENT" | "COMMERCE" | "APP_USAGE";

export interface AnalyticsDownloadOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxCompressedBytes?: number;
  maxUncompressedBytes?: number;
  maxExpansionRatio?: number;
  maxRedirects?: number;
  resolveHost?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

interface DownloadedAnalyticsSegment {
  text: string;
  compressedBytes: number;
  checksumSha256: string;
}

interface ReportMetric {
  metric: AnalyticsAdditiveMetricId;
  header: string;
  currency?: "USD";
}

interface ReportDefinition {
  category: LiveAnalyticsCategory;
  dimensions: Record<string, string>;
  optionalDimensions?: Record<string, string>;
  requiredMetricHeaders: string[];
  metrics: (row: ReadonlyMap<string, string>) => ReportMetric[];
}

export const supportedAnalyticsReportNames = [
  "App Store Discovery and Engagement Standard",
  "App Store Downloads Standard",
  "App Store Pre-Orders Standard",
  "App Store Purchases Standard",
  "App Sessions Standard",
] as const;
export type SupportedAnalyticsReportName = typeof supportedAnalyticsReportNames[number];

export class AnalyticsPermissionError extends Error {
  readonly status = 403;

  constructor(
    readonly code: "analytics_admin_required" | "analytics_reports_role_required",
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsPermissionError";
  }
}

const mapAnalyticsPermission = (error: unknown, operation: "CREATE" | "READ"): never => {
  if (error instanceof AppStoreConnectApiError && error.status === 403) {
    throw operation === "CREATE"
      ? new AnalyticsPermissionError(
        "analytics_admin_required",
        "An App Store Connect Admin must create an Analytics Reports request for this app.",
      )
      : new AnalyticsPermissionError(
        "analytics_reports_role_required",
        "Analytics Reports require an App Store Connect API key with the Admin, Sales and Reports, or Finance role.",
      );
  }
  throw error;
};

const rethrowAnalyticsReadPermission = (error: unknown) => {
  if (error instanceof AnalyticsPermissionError) throw error;
  if (error instanceof AppStoreConnectApiError && error.status === 403) mapAnalyticsPermission(error, "READ");
};

const discoveryDimensions = {
  "App Name": "appName",
  Event: "event",
  "Page Type": "productPage",
  "Source Type": "source",
  "Engagement Type": "engagementType",
  Device: "device",
  "Platform Version": "platformVersion",
  Territory: "territory",
};

const downloadDimensions = {
  "App Name": "appName",
  "Download Type": "downloadType",
  "App Version": "version",
  Device: "device",
  "Platform Version": "platformVersion",
  "Source Type": "source",
  "Page Type": "productPage",
  "Pre-Order": "preOrder",
  Territory: "territory",
};

const preorderDimensions = {
  "App Name": "appName",
  Device: "device",
  "Platform Version": "platformVersion",
  "Source Type": "source",
  "Page Type": "productPage",
  Territory: "territory",
  "Pre-Order Start Date": "preOrderStartDate",
  "Pre-Order End Date": "preOrderEndDate",
};

const purchaseDimensions = {
  "App Name": "appName",
  "Purchase Type": "purchaseType",
  "Content Name": "contentName",
  "Content Apple Identifier": "contentAppleIdentifier",
  "Payment Method": "paymentMethod",
  Device: "device",
  "Platform Version": "platformVersion",
  "Source Type": "source",
  "Page Type": "productPage",
  "App Download Date": "appDownloadDate",
  "Pre-Order": "preOrder",
  Territory: "territory",
};

const sessionDimensions = {
  "App Name": "appName",
  "App Version": "version",
  Device: "device",
  "Platform Version": "platformVersion",
  "Source Type": "source",
  "Page Type": "productPage",
  "App Download Date": "appDownloadDate",
  Territory: "territory",
};

const reportDefinitions: Record<SupportedAnalyticsReportName, ReportDefinition> = {
  "App Store Discovery and Engagement Standard": {
    category: "APP_STORE_ENGAGEMENT",
    dimensions: discoveryDimensions,
    requiredMetricHeaders: ["Counts", "Unique Counts"],
    metrics: (row) => {
      const event = normalizedValue(row.get("Event") ?? "");
      const pageType = normalizedValue(row.get("Page Type") ?? "");
      if (event === "impression" && pageType === "no page") {
        return [{ metric: "IMPRESSIONS", header: "Counts" }];
      }
      if (event === "page view" && pageType === "product page") {
        // Apple's Impressions metric includes product-page views, while the raw
        // report's Impression event explicitly excludes page views.
        return [
          { metric: "IMPRESSIONS", header: "Counts" },
          { metric: "PRODUCT_PAGE_VIEWS", header: "Counts" },
        ];
      }
      return [];
    },
  },
  "App Store Downloads Standard": {
    category: "COMMERCE",
    dimensions: downloadDimensions,
    requiredMetricHeaders: ["Counts"],
    metrics: (row) => {
      const type = normalizedValue(row.get("Download Type") ?? "");
      if (type === "first-time download") {
        return [
          { metric: "DOWNLOADS", header: "Counts" },
          { metric: "FIRST_TIME_DOWNLOADS", header: "Counts" },
        ];
      }
      return type === "redownload" ? [{ metric: "DOWNLOADS", header: "Counts" }] : [];
    },
  },
  "App Store Pre-Orders Standard": {
    category: "COMMERCE",
    dimensions: preorderDimensions,
    requiredMetricHeaders: ["Pre-Orders Placed", "Pre-Orders Canceled"],
    metrics: () => [],
  },
  "App Store Purchases Standard": {
    category: "COMMERCE",
    dimensions: purchaseDimensions,
    requiredMetricHeaders: ["Purchases", "Proceeds in USD", "Sales in USD", "Paying Users"],
    metrics: () => [{ metric: "PROCEEDS", header: "Proceeds in USD", currency: "USD" }],
  },
  "App Sessions Standard": {
    category: "APP_USAGE",
    dimensions: sessionDimensions,
    optionalDimensions: { Campaign: "campaign" },
    requiredMetricHeaders: ["Sessions", "Total Session Duration", "Unique Devices"],
    metrics: () => [{ metric: "SESSIONS", header: "Sessions" }],
  },
};

const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 200;
const MIN_EXPANSION_ALLOWANCE = 4 * 1024 * 1024;
const MAX_REDIRECTS = 3;

const blockedAddresses = new BlockList();
blockedAddresses.addSubnet("0.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("10.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("100.64.0.0", 10, "ipv4");
blockedAddresses.addSubnet("127.0.0.0", 8, "ipv4");
blockedAddresses.addSubnet("169.254.0.0", 16, "ipv4");
blockedAddresses.addSubnet("172.16.0.0", 12, "ipv4");
blockedAddresses.addSubnet("192.0.0.0", 24, "ipv4");
blockedAddresses.addSubnet("192.0.2.0", 24, "ipv4");
blockedAddresses.addSubnet("192.168.0.0", 16, "ipv4");
blockedAddresses.addSubnet("198.18.0.0", 15, "ipv4");
blockedAddresses.addSubnet("198.51.100.0", 24, "ipv4");
blockedAddresses.addSubnet("203.0.113.0", 24, "ipv4");
blockedAddresses.addSubnet("224.0.0.0", 4, "ipv4");
blockedAddresses.addSubnet("240.0.0.0", 4, "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("64:ff9b::", 96, "ipv6");
blockedAddresses.addSubnet("100::", 64, "ipv6");
blockedAddresses.addSubnet("2001::", 32, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");

const normalizedValue = (value: string) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
const canonicalHeader = (value: string) => value.replace(/^\uFEFF/u, "").trim().replace(/\s+/gu, " ");

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const addAnalyticsDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const completeAnalyticsDateSequence = (dates: string[]): string | null => {
  const ordered = [...new Set(dates)].sort();
  let completeThrough = ordered[0] ?? null;
  for (let index = 1; completeThrough && index < ordered.length; index += 1) {
    const candidate = ordered[index]!;
    if (candidate !== addAnalyticsDays(completeThrough, 1)) break;
    completeThrough = candidate;
  }
  return completeThrough;
};

const parseTsv = (input: string): string[][] => {
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const pushField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character !== '"') {
        field += character;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      quoted = false;
      closedQuote = true;
      continue;
    }

    if (closedQuote && character !== "\t" && character !== "\r" && character !== "\n") {
      throw new Error("An analytics report contains text after a closing quote.");
    }
    if (character === '"') {
      if (field.length > 0) throw new Error("An analytics report contains a quote inside an unquoted field.");
      quoted = true;
    } else if (character === "\t") {
      pushField();
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("An analytics report contains an unterminated quoted field.");
  if (field.length > 0 || row.length > 0 || closedQuote) pushRow();
  while (rows.length > 0 && rows.at(-1)?.every((value) => value === "")) rows.pop();
  return rows;
};

const numericValue = (value: string, integer: boolean, field: string): number | null => {
  if (value === "") return null;
  const pattern = integer ? /^-?\d+$/ : /^-?(?:\d+\.?\d*|\.\d+)$/;
  if (!pattern.test(value)) throw new Error(`An analytics report contains an invalid ${field} value.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isSafeInteger(parsed))) {
    throw new Error(`An analytics report contains an out-of-range ${field} value.`);
  }
  return parsed;
};

const evidenceIdFor = (kind: string, value: unknown) => `${kind}:${createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex")}`;

export const parseAnalyticsTsvDocument = (
  reportName: SupportedAnalyticsReportName,
  expectedAppId: string,
  input: string,
): { observations: AnalyticsObservation[]; partitionDates: string[]; rowCount: number } => {
  if (!/^\d+$/.test(expectedAppId)) throw new Error("The App Store app ID must contain only digits.");
  const definition = reportDefinitions[reportName];
  const rows = parseTsv(input);
  const rawHeaders = rows.shift();
  if (!rawHeaders || rawHeaders.length === 0) throw new Error("An analytics report is missing its header row.");
  const headers = rawHeaders.map(canonicalHeader);
  if (headers.some((header) => header.length === 0) || new Set(headers).size !== headers.length) {
    throw new Error("An analytics report contains empty or duplicate headers.");
  }
  const requiredHeaders = new Set([
    "Date",
    "App Apple Identifier",
    ...Object.keys(definition.dimensions),
    ...definition.requiredMetricHeaders,
  ]);
  for (const header of requiredHeaders) {
    if (!headers.includes(header)) throw new Error(`An analytics report is missing the ${header} column.`);
  }

  const partitionDates = new Set<string>();
  const observations = rows.flatMap((row, rowIndex) => {
    if (row.length !== headers.length) throw new Error("An analytics report row does not match its header row.");
    const values = new Map(headers.map((header, index) => [header, row[index] ?? ""]));
    const appId = values.get("App Apple Identifier") ?? "";
    if (appId !== expectedAppId) {
      throw new Error("An analytics report contains data for a different App Store app ID.");
    }
    const date = values.get("Date") ?? "";
    if (!isValidDate(date)) throw new Error("An analytics report contains an invalid Date value.");
    partitionDates.add(date);
    const dimensions = Object.fromEntries([
      ...Object.entries(definition.dimensions).map(([header, key]) => [key, values.get(header) ?? ""]),
      ...Object.entries(definition.optionalDimensions ?? {}).flatMap(([header, key]) => (
        headers.includes(header) ? [[key, values.get(header) ?? ""]] : []
      )),
    ]);
    return definition.metrics(values).flatMap((metric): AnalyticsObservation[] => {
      const value = numericValue(values.get(metric.header) ?? "", metric.metric !== "PROCEEDS", metric.header);
      if (value === null) return [];
      if (metric.metric !== "PROCEEDS" && value < 0) {
        throw new Error(`An analytics report contains a negative ${metric.header} count.`);
      }
      return [{
        appId,
        date,
        metric: metric.metric,
        value,
        currency: metric.currency ?? null,
        dimensions,
        reportName,
        availability: "AVAILABLE",
        evidenceId: evidenceIdFor("analytics-observation", {
          reportName,
          appId,
          date,
          rowIndex,
          metric: metric.metric,
          dimensions,
          value,
        }),
      }];
    });
  });
  return { observations, partitionDates: [...partitionDates].sort(), rowCount: rows.length };
};

export const parseAnalyticsTsv = (
  reportName: SupportedAnalyticsReportName,
  expectedAppId: string,
  input: string,
) => parseAnalyticsTsvDocument(reportName, expectedAppId, input).observations;

const isBlockedAddress = (address: string, family: number) => (
  family === 4
    ? blockedAddresses.check(address, "ipv4")
    : family === 6
      ? address.toLocaleLowerCase("en-US").startsWith("::ffff:") || blockedAddresses.check(address, "ipv6")
      : true
);

const defaultResolveHost = async (hostname: string) => lookupHost(hostname, { all: true, verbatim: true });

const validateDownloadUrl = async (
  value: string | URL,
  resolveHost: NonNullable<AnalyticsDownloadOptions["resolveHost"]>,
) => {
  let url: URL;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    throw new Error("App Store Connect returned an invalid analytics download URL.");
  }
  if (url.protocol !== "https:") throw new Error("App Store Connect returned an insecure analytics download URL.");
  if (url.username || url.password) throw new Error("App Store Connect returned an invalid analytics download URL.");
  const rawHostname = url.hostname.toLocaleLowerCase("en-US").replace(/\.$/, "");
  const hostname = rawHostname.startsWith("[") && rawHostname.endsWith("]")
    ? rawHostname.slice(1, -1)
    : rawHostname;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("App Store Connect returned a private analytics download host.");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveHost(hostname).catch(() => {
      throw new Error("The analytics download host could not be resolved safely.");
    });
  if (addresses.length === 0 || addresses.some(({ address, family }) => isBlockedAddress(address, family))) {
    throw new Error("App Store Connect returned a private or reserved analytics download host.");
  }
  return url;
};

const readLimitedBody = async (response: Response, maximumBytes: number) => {
  if (!response.body) throw new Error("The analytics segment download returned an empty body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) throw new Error("The analytics segment download exceeded its size limit.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = Buffer.allocUnsafe(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const downloadAnalyticsSegment = async (
  segment: Pick<AnalyticsReportSegmentResource, "id" | "attributes">,
  options: AnalyticsDownloadOptions = {},
): Promise<DownloadedAnalyticsSegment> => {
  const fetchImplementation = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxCompressedBytes = options.maxCompressedBytes ?? MAX_COMPRESSED_BYTES;
  const maxUncompressedBytes = options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  const maxExpansionRatio = options.maxExpansionRatio ?? MAX_EXPANSION_RATIO;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const expectedBytes = segment.attributes.sizeInBytes;
  if (expectedBytes > maxCompressedBytes) throw new Error("The analytics segment is larger than the download limit.");

  let url = await validateDownloadUrl(segment.attributes.url, resolveHost);
  let response: Response | null = null;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    try {
      response = await fetchImplementation(url, {
        method: "GET",
        headers: { accept: "application/gzip, application/octet-stream" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new Error(error instanceof Error && error.name === "TimeoutError"
        ? "The analytics segment download timed out."
        : "The analytics segment download could not be reached.");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirect === maxRedirects) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("The analytics segment download exceeded its redirect limit.");
    }
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error("The analytics segment download returned an invalid redirect.");
    let redirected: URL;
    try {
      redirected = new URL(location, url);
    } catch {
      throw new Error("The analytics segment download returned an invalid redirect.");
    }
    url = await validateDownloadUrl(redirected, resolveHost);
  }
  if (!response || !response.ok) {
    await response?.body?.cancel().catch(() => undefined);
    throw new Error(`The analytics segment download failed with HTTP ${response?.status ?? "unknown"}.`);
  }
  if (response.headers.get("content-encoding")) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The analytics segment download used an unsupported content encoding.");
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) !== expectedBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("The analytics segment download size did not match App Store Connect metadata.");
    }
  }
  const compressed = await readLimitedBody(response, Math.min(maxCompressedBytes, expectedBytes));
  if (compressed.byteLength !== expectedBytes) {
    throw new Error("The analytics segment download size did not match App Store Connect metadata.");
  }
  const checksum = createHash("md5").update(compressed).digest("hex");
  if (checksum !== segment.attributes.checksum.toLocaleLowerCase("en-US")) {
    throw new Error("The analytics segment checksum did not match App Store Connect metadata.");
  }
  const checksumSha256 = createHash("sha256").update(compressed).digest("hex");
  const ratioLimit = Math.max(MIN_EXPANSION_ALLOWANCE, Math.floor(compressed.byteLength * maxExpansionRatio));
  const outputLimit = Math.min(maxUncompressedBytes, ratioLimit);
  let decompressed: Buffer;
  try {
    decompressed = gunzipSync(compressed, { maxOutputLength: outputLimit });
  } catch {
    throw new Error("The analytics segment could not be decompressed within its safety limit.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(decompressed);
  } catch {
    throw new Error("The analytics segment is not valid UTF-8 text.");
  }
  return { text, compressedBytes: compressed.byteLength, checksumSha256 };
};

interface AppStoreConnectAnalyticsReportsOptions extends AnalyticsDownloadOptions {
  now?: () => Date;
  id?: () => string;
}

export class AppStoreConnectAnalyticsReports {
  private readonly downloadOptions: AnalyticsDownloadOptions;
  private readonly now: () => Date;
  private readonly id: () => string;
  private lastSync: AnalyticsSyncResult | null = null;

  constructor(
    private readonly client: AppStoreConnectClient,
    options: AppStoreConnectAnalyticsReportsOptions = {},
  ) {
    this.downloadOptions = {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxCompressedBytes ? { maxCompressedBytes: options.maxCompressedBytes } : {}),
      ...(options.maxUncompressedBytes ? { maxUncompressedBytes: options.maxUncompressedBytes } : {}),
      ...(options.maxExpansionRatio ? { maxExpansionRatio: options.maxExpansionRatio } : {}),
      ...(options.maxRedirects !== undefined ? { maxRedirects: options.maxRedirects } : {}),
      ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    };
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async getStatus(): Promise<AnalyticsStatusResponse> {
    let issuerId: string;
    try {
      issuerId = (await this.client.credentials()).issuerId;
    } catch (error) {
      return {
        schemaVersion: 1,
        issuerId: null,
        state: "NOT_CONFIGURED",
        reportRequests: [],
        freshness: emptyAnalyticsFreshness("Connect an App Store Connect API key to use Analytics."),
        detail: errorMessage(error),
      };
    }
    try {
      const reportRequests = await this.listReportRequests();
      const lastSync = this.lastSync?.issuerId === issuerId ? this.lastSync : null;
      const active = reportRequests.filter((request) => !request.stoppedDueToInactivity);
      if (reportRequests.length === 0) {
        return {
          schemaVersion: 1,
          issuerId,
          state: "NOT_CONFIGURED",
          reportRequests,
          freshness: emptyAnalyticsFreshness("No Analytics Reports request exists yet."),
          detail: "Create an ongoing Analytics Reports request to begin receiving Apple data.",
        };
      }
      const state = active.length === 0
        ? "PARTIAL"
        : lastSync?.state === "SUCCEEDED" && !lastSync.freshness.partial
          ? "READY"
          : lastSync?.state === "PARTIAL" || lastSync?.freshness.partial
            ? "PARTIAL"
            : lastSync?.state === "FAILED"
              ? "ERROR"
              : "WAITING_FOR_DATA";
      return {
        schemaVersion: 1,
        issuerId,
        state,
        reportRequests,
        freshness: lastSync?.freshness
          ?? emptyAnalyticsFreshness("Analytics Reports are configured; run a sync to populate the local cache."),
        detail: active.length === 0
          ? "Every Analytics Reports request is stopped due to inactivity; create a new ongoing request."
          : state === "READY"
            ? "Analytics Reports are configured and the latest sync completed."
            : state === "ERROR"
              ? lastSync?.error ?? "The latest Analytics sync failed."
              : "Analytics Reports are configured and may take 24–48 hours to produce their first data.",
      };
    } catch (error) {
      return {
        schemaVersion: 1,
        issuerId,
        state: "ERROR",
        reportRequests: [],
        freshness: emptyAnalyticsFreshness("ASC Studio could not inspect Analytics Reports."),
        detail: errorMessage(error),
      };
    }
  }

  async listReportRequests(appId?: string): Promise<AnalyticsReportRequest[]> {
    const appIds = appId === undefined ? await this.listAppIds() : [appId];
    const requests: AnalyticsReportRequest[] = [];
    for (const candidateAppId of appIds) requests.push(...await this.listReportRequestsForApp(candidateAppId));
    return requests;
  }

  private async listReportRequestsForApp(appId: string): Promise<AnalyticsReportRequest[]> {
    this.assertAppId(appId);
    const query = new URLSearchParams({
      limit: "200",
      "fields[analyticsReportRequests]": "accessType,stoppedDueToInactivity",
    });
    const pages = await this.collect(
      `/v1/apps/${encodeURIComponent(appId)}/analyticsReportRequests?${query}`,
      AnalyticsReportRequestsPageSchema,
    ).catch((error: unknown) => mapAnalyticsPermission(error, "READ"));
    return pages.flatMap((page) => page.data).map((request) => ({
      id: request.id,
      appId,
      accessType: request.attributes.accessType,
      createdAt: null,
      stoppedDueToInactivity: request.attributes.stoppedDueToInactivity,
    }));
  }

  async createReportRequest(input: AnalyticsReportRequestCreateInput): Promise<AnalyticsReportRequest> {
    this.assertAppId(input.appId);
    const response = await this.client.request(
      "POST",
      "/v1/analyticsReportRequests",
      AnalyticsReportRequestResponseSchema,
      {
        expectedStatus: 201,
        retry: false,
        body: {
          data: {
            type: "analyticsReportRequests",
            attributes: { accessType: input.accessType },
            relationships: { app: { data: { type: "apps", id: input.appId } } },
          },
        },
      },
    ).catch((error: unknown) => mapAnalyticsPermission(error, "CREATE"));
    const linkedApp = relationshipId(response.data, "app");
    if (linkedApp !== null && linkedApp !== input.appId) {
      throw new Error("App Store Connect created an analytics report request for another app.");
    }
    return {
      id: response.data.id,
      appId: input.appId,
      accessType: response.data.attributes.accessType,
      createdAt: null,
      stoppedDueToInactivity: response.data.attributes.stoppedDueToInactivity,
    };
  }

  async sync(input: AnalyticsSyncInput): Promise<AnalyticsSyncResult> {
    const uniqueAppIds = [...new Set(input.appIds)];
    if (uniqueAppIds.length !== input.appIds.length) throw new Error("Analytics sync app IDs must be unique.");
    for (const appId of uniqueAppIds) this.assertAppId(appId);
    const issuerId = (await this.client.credentials()).issuerId;
    const startedAt = this.now().toISOString();
    const runId = this.id();
    const snapshotId = evidenceIdFor("analytics-snapshot", { issuerId, runId, startedAt });
    const reportRequests: AnalyticsReportRequest[] = [];
    const batches: AnalyticsFactBatch[] = [];
    const issues: string[] = [];
    for (const appId of uniqueAppIds) {
      this.assertAppId(appId);
      let requests: AnalyticsReportRequest[];
      try {
        requests = await this.listReportRequestsForApp(appId);
        reportRequests.push(...requests);
      } catch (error) {
        rethrowAnalyticsReadPermission(error);
        issues.push(`App ${appId}: ${errorMessage(error)}`);
        continue;
      }
      if (requests.length === 0) {
        issues.push(`App ${appId} has no Analytics Reports request.`);
        continue;
      }
      for (const request of requests) {
        try {
          batches.push(...await this.syncRequest(request, issuerId, snapshotId, issues));
        } catch (error) {
          rethrowAnalyticsReadPermission(error);
          issues.push(`Report request ${request.id}: ${errorMessage(error)}`);
        }
      }
    }
    if (batches.length === 0 && issues.length === 0) issues.push("No complete daily Analytics Report segments are available yet.");
    const state = issues.length === 0 ? "SUCCEEDED" : batches.length > 0 ? "PARTIAL" : "FAILED";
    const completedAt = this.now().toISOString();
    const additiveMetrics = Object.keys(ANALYTICS_METRIC_COMPLETENESS_DAYS) as AnalyticsAdditiveMetricId[];
    const completeDates = uniqueAppIds.flatMap((appId) => additiveMetrics.map((metric) => {
      const eligibleDates = batches.flatMap((batch) => batch.appId === appId
        ? batch.observations
          .filter((observation) => (
            observation.metric === metric
            && observation.date <= addAnalyticsDays(batch.processingDate, -ANALYTICS_METRIC_COMPLETENESS_DAYS[metric])
          ))
          .map((observation) => observation.date)
        : []).sort();
      return completeAnalyticsDateSequence(eligibleDates);
    }));
    const dataThrough = completeDates.every((date): date is string => date !== null)
      ? [...completeDates].sort()[0]!
      : null;
    const latestObservedDate = batches.flatMap((batch) => batch.observations.map((observation) => observation.date)).sort().at(-1) ?? null;
    const freshnessPartial = state !== "SUCCEEDED" || dataThrough === null || latestObservedDate !== null && dataThrough < latestObservedDate;
    const result: AnalyticsSyncResult = {
      schemaVersion: 1,
      issuerId,
      runId,
      state,
      appIds: uniqueAppIds,
      batches,
      reportRequests,
      startedAt,
      completedAt,
      snapshotId: batches.length > 0 ? snapshotId : null,
      evidenceId: evidenceIdFor("analytics-sync", {
        issuerId,
        runId,
        appIds: uniqueAppIds,
        batches: batches.map((batch) => batch.evidenceId),
        issues,
      }),
      freshness: {
        syncedAt: completedAt,
        dataThrough,
        expectedDelayDays: 5,
        partial: freshnessPartial,
        detail: dataThrough
          ? `Apple Analytics Reports have continuous settled observations through ${dataThrough}; newer numeric facts remain partial during report-specific correction windows of two to five days.`
          : "Apple has not supplied a complete supported daily report segment yet.",
      },
      error: issues.length > 0 ? issues.join(" ") : null,
    };
    this.lastSync = result;
    return result;
  }

  private async syncRequest(
    request: AnalyticsReportRequest,
    issuerId: string,
    snapshotId: string,
    issues: string[],
  ): Promise<AnalyticsFactBatch[]> {
    const query = new URLSearchParams({
      limit: "200",
      "filter[category]": "APP_STORE_ENGAGEMENT,COMMERCE,APP_USAGE",
      "fields[analyticsReports]": "name,category",
    });
    const pages = await this.collect(
      `/v1/analyticsReportRequests/${encodeURIComponent(request.id)}/reports?${query}`,
      AnalyticsReportsPageSchema,
    );
    const reports = pages.flatMap((page) => page.data).flatMap((report) => (
      this.isSupportedReport(report) ? [report] : []
    ));
    if (new Set(reports.map((report) => report.attributes.name)).size !== reports.length) {
      throw new Error("App Store Connect returned duplicate supported Analytics Reports.");
    }
    const availableNames = new Set(reports.map((report) => report.attributes.name));
    for (const name of supportedAnalyticsReportNames) {
      if (!availableNames.has(name)) issues.push(`Report request ${request.id} does not include ${name}.`);
    }
    const batches: AnalyticsFactBatch[] = [];
    for (const report of reports) {
      try {
        batches.push(...await this.syncReport(request, report, issuerId, snapshotId, issues));
      } catch (error) {
        rethrowAnalyticsReadPermission(error);
        issues.push(`${report.attributes.name}: ${errorMessage(error)}`);
      }
    }
    return batches;
  }

  private async syncReport(
    request: AnalyticsReportRequest,
    report: AnalyticsReportResource & { attributes: { name: SupportedAnalyticsReportName } },
    issuerId: string,
    snapshotId: string,
    issues: string[],
  ): Promise<AnalyticsFactBatch[]> {
    const definition = reportDefinitions[report.attributes.name];
    if (report.attributes.category !== definition.category) {
      throw new Error(`App Store Connect returned ${report.attributes.name} in an unexpected report category.`);
    }
    const query = new URLSearchParams({
      limit: "200",
      "filter[granularity]": "DAILY",
      "fields[analyticsReportInstances]": "granularity,processingDate",
    });
    const pages = await this.collect(
      `/v1/analyticsReports/${encodeURIComponent(report.id)}/instances?${query}`,
      AnalyticsReportInstancesPageSchema,
    );
    const instances = pages.flatMap((page) => page.data);
    if (instances.length === 0) {
      issues.push(`${report.attributes.name} has no generated daily instances yet.`);
      return [];
    }
    const batches: AnalyticsFactBatch[] = [];
    for (const instance of instances) {
      if (instance.attributes.granularity !== "DAILY") {
        throw new Error("App Store Connect returned a non-daily analytics report instance.");
      }
      if (!isValidDate(instance.attributes.processingDate)) {
        throw new Error("App Store Connect returned an invalid analytics processing date.");
      }
      try {
        const batch = await this.syncInstance(request, report, instance, issuerId, snapshotId);
        if (batch) batches.push(batch);
        else issues.push(`${report.attributes.name} instance ${instance.id} has no downloadable segments.`);
      } catch (error) {
        rethrowAnalyticsReadPermission(error);
        issues.push(`${report.attributes.name} instance ${instance.id}: ${errorMessage(error)}`);
      }
    }
    return batches;
  }

  private async syncInstance(
    request: AnalyticsReportRequest,
    report: AnalyticsReportResource & { attributes: { name: SupportedAnalyticsReportName } },
    instance: AnalyticsReportInstanceResource,
    issuerId: string,
    snapshotId: string,
  ): Promise<AnalyticsFactBatch | null> {
    const query = new URLSearchParams({
      limit: "200",
      "fields[analyticsReportSegments]": "checksum,sizeInBytes,url",
    });
    const pages = await this.collect(
      `/v1/analyticsReportInstances/${encodeURIComponent(instance.id)}/segments?${query}`,
      AnalyticsReportSegmentsPageSchema,
    );
    const segments = pages.flatMap((page) => page.data);
    if (segments.length === 0) return null;
    const observations: AnalyticsObservation[] = [];
    const partitionDates = new Set<string>();
    const provenance: AnalyticsSegmentEvidence[] = [];
    for (const segment of segments) {
      const downloaded = await downloadAnalyticsSegment(segment, this.downloadOptions);
      const parsed = parseAnalyticsTsvDocument(report.attributes.name, request.appId, downloaded.text);
      parsed.partitionDates.forEach((date) => partitionDates.add(date));
      observations.push(...parsed.observations.map((observation) => ({
        ...observation,
        evidenceId: evidenceIdFor("analytics-observation", {
          segmentId: segment.id,
          observationEvidenceId: observation.evidenceId,
        }),
      })));
      provenance.push({
        segmentId: segment.id,
        checksumSha256: downloaded.checksumSha256,
        byteCount: downloaded.compressedBytes,
        rowCount: parsed.rowCount,
      });
    }
    const segmentIds = segments.map((segment) => segment.id);
    const evidenceId = evidenceIdFor("analytics-batch", {
      issuerId,
      appId: request.appId,
      reportRequestId: request.id,
      reportId: report.id,
      instanceId: instance.id,
      processingDate: instance.attributes.processingDate,
      segments: provenance,
    });
    return {
      schemaVersion: 1,
      issuerId,
      appId: request.appId,
      accessType: request.accessType,
      reportRequestId: request.id,
      reportId: report.id,
      reportName: report.attributes.name,
      category: report.attributes.category,
      granularity: "DAILY",
      instanceId: instance.id,
      processingDate: instance.attributes.processingDate,
      partitionDates: [...partitionDates].sort(),
      segmentIds,
      segments: provenance,
      expectedSegmentCount: segments.length,
      verifiedSegmentCount: provenance.length,
      observations,
      snapshotId,
      evidenceId,
    };
  }

  private async listAppIds() {
    const query = new URLSearchParams({ limit: "200", "fields[apps]": "name,bundleId" });
    const pages = await this.collect(`/v1/apps?${query}`, AppsPageSchema);
    return pages.flatMap((page) => page.data.map((app) => app.id));
  }

  private isSupportedReport(
    report: AnalyticsReportResource,
  ): report is AnalyticsReportResource & { attributes: { name: SupportedAnalyticsReportName } } {
    return (supportedAnalyticsReportNames as readonly string[]).includes(report.attributes.name);
  }

  private async collect<Schema extends ZodTypeAny>(
    path: string,
    schema: Schema,
  ): Promise<Array<output<Schema>>> {
    const pages: Array<output<Schema>> = [];
    let next: string | URL | null = path;
    do {
      const page: output<Schema> = await this.client.request("GET", next, schema);
      pages.push(page);
      const links = (page as { links: { next?: string } }).links;
      next = links.next ? this.client.resolveNext(links.next) : null;
    } while (next);
    return pages;
  }

  private assertAppId(appId: string) {
    if (!/^\d+$/.test(appId)) throw new Error("The App Store app ID must contain only digits.");
  }
}

const emptyAnalyticsFreshness = (detail: string) => ({
  syncedAt: null,
  dataThrough: null,
  expectedDelayDays: null,
  partial: true,
  detail,
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "An unknown analytics error occurred.";

type RelatedResource = {
  relationships?: Record<string, { data?: unknown } | undefined> | undefined;
};

const relationshipId = (resource: RelatedResource, name: string) => {
  const data = resource.relationships?.[name]?.data;
  if (!data || Array.isArray(data) || typeof data !== "object") return null;
  return "id" in data && typeof data.id === "string" ? data.id : null;
};
