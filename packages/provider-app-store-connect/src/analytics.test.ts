import { createHash, generateKeyPairSync } from "node:crypto";
import { gzipSync } from "node:zlib";
import { AnalyticsFactBatchSchema } from "@asc-studio/contracts";
import { describe, expect, it, vi } from "vitest";
import { AppStoreConnectProvider, type AppStoreConnectCredentials } from "./index.js";
import {
  completeAnalyticsDateSequence,
  downloadAnalyticsSegment,
  parseAnalyticsTsv,
  parseAnalyticsTsvDocument,
} from "./analytics.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials: AppStoreConnectCredentials = {
  profileName: "Analytics key",
  issuerId: "11111111-2222-3333-4444-555555555555",
  keyId: "ABC123DEFG",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  authBackend: "Test memory",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

const page = (data: unknown[], next?: string) => ({
  data,
  links: {
    self: "https://api.appstoreconnect.apple.com/v1/test",
    ...(next ? { next } : {}),
  },
});

const segmentFor = (body: Buffer, url = "https://1.1.1.1/report.txt.gz", id = "segment-1") => ({
  id,
  attributes: {
    checksum: createHash("md5").update(body).digest("hex"),
    sizeInBytes: body.byteLength,
    url,
  },
});

const discoveryHeaders = [
  "Date",
  "App Name",
  "App Apple Identifier",
  "Event",
  "Page Type",
  "Source Type",
  "Engagement Type",
  "Device",
  "Platform Version",
  "Territory",
  "Counts",
  "Unique Counts",
];

describe("analytics report parsing", () => {
  it("does not call a later date complete when an internal report date is missing", () => {
    expect(completeAnalyticsDateSequence([
      "2026-08-15",
      "2026-08-16",
      "2026-08-18",
      "2026-08-19",
      "2026-08-18",
    ])).toBe("2026-08-16");
    expect(completeAnalyticsDateSequence([])).toBeNull();
  });

  it("parses BOM, CRLF, reordered and extra headers, and quoted TSV fields", () => {
    const headers = ["Extra", ...[...discoveryHeaders].reverse()];
    const values: Record<string, string> = {
      Extra: "ignored",
      Date: "2026-08-18",
      "App Name": '"Focus\tTracker"',
      "App Apple Identifier": "1234567890",
      Event: "Page view",
      "Page Type": "Product Page",
      "Source Type": "App Store search",
      "Engagement Type": "Get",
      Device: "iPhone",
      "Platform Version": "iOS 19.0",
      Territory: "USA",
      Counts: "42",
      "Unique Counts": "39",
    };
    const tsv = `\uFEFF${headers.join("\t")}\r\n${headers.map((header) => values[header]).join("\t")}\r\n`;

    expect(parseAnalyticsTsv(
      "App Store Discovery and Engagement Standard",
      "1234567890",
      tsv,
    )).toEqual([
      expect.objectContaining({ metric: "IMPRESSIONS", value: 42 }),
      expect.objectContaining({
      appId: "1234567890",
      date: "2026-08-18",
      metric: "PRODUCT_PAGE_VIEWS",
      value: 42,
      currency: null,
      availability: "AVAILABLE",
      reportName: "App Store Discovery and Engagement Standard",
      dimensions: expect.objectContaining({
        appName: "Focus\tTracker",
        source: "App Store search",
        productPage: "Product Page",
        territory: "USA",
      }),
      }),
    ]);
  });

  it("counts list impressions only for the raw Impression + No page event semantics", () => {
    const row = (event: string, pageType: string, count: string) => [
      "2026-08-18", "Focus", "1234567890", event, pageType, "App Store search",
      "", "iPhone", "iOS 19.0", "USA", count, count,
    ].join("\t");
    const observations = parseAnalyticsTsv(
      "App Store Discovery and Engagement Standard",
      "1234567890",
      `${discoveryHeaders.join("\t")}\n${row("Impression", "No Page", "100")}\n${row("Impression", "In-App Event", "20")}`,
    );

    expect(observations.map(({ metric, value }) => ({ metric, value }))).toEqual([
      { metric: "IMPRESSIONS", value: 100 },
    ]);
  });

  it("retains deduplicated raw dates when every row is outside the supported metric mapping", () => {
    const ignoredRow = (date: string) => [
      date, "Focus", "1234567890", "Impression", "In-App Event", "App Store search",
      "", "iPhone", "iOS 19.0", "USA", "20", "20",
    ].join("\t");
    const parsed = parseAnalyticsTsvDocument(
      "App Store Discovery and Engagement Standard",
      "1234567890",
      `${discoveryHeaders.join("\t")}\n${ignoredRow("2026-08-17")}\n${ignoredRow("2026-08-18")}\n${ignoredRow("2026-08-17")}`,
    );

    expect(parsed.observations).toEqual([]);
    expect(parsed.partitionDates).toEqual(["2026-08-17", "2026-08-18"]);
    expect(parsed.rowCount).toBe(3);
  });

  it("normalizes only first-time downloads and redownloads into total downloads", () => {
    const headers = [
      "Date", "App Name", "App Apple Identifier", "Download Type", "App Version", "Device",
      "Platform Version", "Source Type", "Page Type", "Pre-Order", "Territory", "Counts",
    ];
    const row = (type: string, count: string) => [
      "2026-08-18", "Focus", "1234567890", type, "1.4", "iPhone", "iOS 19.0",
      "App Store search", "Product Page", "No", "USA", count,
    ].join("\t");
    const observations = parseAnalyticsTsv(
      "App Store Downloads Standard",
      "1234567890",
      `${headers.join("\t")}\n${row("First-time Download", "7")}\n${row("Redownload", "3")}\n${row("Auto-update", "91")}`,
    );

    expect(observations.map(({ metric, value }) => ({ metric, value }))).toEqual([
      { metric: "DOWNLOADS", value: 7 },
      { metric: "FIRST_TIME_DOWNLOADS", value: 7 },
      { metric: "DOWNLOADS", value: 3 },
    ]);
    expect(observations[0]?.dimensions).toMatchObject({
      source: "App Store search",
      productPage: "Product Page",
      version: "1.4",
    });
    expect(() => parseAnalyticsTsv(
      "App Store Downloads Standard",
      "1234567890",
      `${headers.join("\t")}\n${row("First-time Download", "-1")}`,
    )).toThrow("negative Counts count");
  });

  it("preserves negative proceeds for refunds", () => {
    const headers = [
      "Date", "App Name", "App Apple Identifier", "Purchase Type", "Content Name",
      "Content Apple Identifier", "Payment Method", "Device", "Platform Version", "Source Type",
      "Page Type", "App Download Date", "Pre-Order", "Territory", "Purchases",
      "Proceeds in USD", "Sales in USD", "Paying Users",
    ];
    const values = [
      "2026-08-18", "Focus", "1234567890", "In-app purchases", "Annual", "9988", "Apple Pay",
      "iPhone", "iOS 19.0", "App Store search", "Product Page", "2026-08-17", "No", "USA",
      "-1", "-8.49", "-9.99", "1",
    ];
    expect(parseAnalyticsTsv(
      "App Store Purchases Standard",
      "1234567890",
      `${headers.join("\t")}\n${values.join("\t")}`,
    )).toEqual([expect.objectContaining({ metric: "PROCEEDS", value: -8.49, currency: "USD" })]);
  });

  it("preserves every standard session dimension so same-version rows remain distinct", () => {
    const headers = [
      "Date", "App Name", "App Apple Identifier", "App Version", "Device", "Platform Version",
      "Source Type", "Campaign", "Page Type", "App Download Date", "Territory",
      "Sessions", "Total Session Duration", "Unique Devices",
    ];
    const row = (device: string, territory: string, sessions: string, campaign: string) => [
      "2026-08-18", "Focus", "1234567890", "1.4", device, "iOS 19.0",
      "App Store search", campaign, "Product Page", "2026-08-12", territory,
      sessions, "120", "5",
    ].join("\t");
    const observations = parseAnalyticsTsv(
      "App Sessions Standard",
      "1234567890",
      `${headers.join("\t")}\n${row("iPhone", "USA", "7", "launch-us")}\n${row("iPad", "GBR", "5", "launch-gb")}`,
    );

    expect(observations).toHaveLength(2);
    expect(observations.reduce((sum, item) => sum + item.value!, 0)).toBe(12);
    expect(observations.map((item) => item.dimensions)).toEqual([
      expect.objectContaining({
        version: "1.4", device: "iPhone", platformVersion: "iOS 19.0", source: "App Store search",
        campaign: "launch-us", productPage: "Product Page", appDownloadDate: "2026-08-12", territory: "USA",
      }),
      expect.objectContaining({
        version: "1.4", device: "iPad", platformVersion: "iOS 19.0", source: "App Store search",
        campaign: "launch-gb", productPage: "Product Page", appDownloadDate: "2026-08-12", territory: "GBR",
      }),
    ]);
  });

  it("rejects another app ID exactly and malformed quoted input", () => {
    const row = [
      "2026-08-18", "Focus", "12345678900", "Page view", "Product Page", "App Store search",
      "Get", "iPhone", "iOS 19.0", "USA", "42", "39",
    ];
    expect(() => parseAnalyticsTsv(
      "App Store Discovery and Engagement Standard",
      "1234567890",
      `${discoveryHeaders.join("\t")}\n${row.join("\t")}`,
    )).toThrow("different App Store app ID");
    expect(() => parseAnalyticsTsv(
      "App Store Discovery and Engagement Standard",
      "1234567890",
      `${discoveryHeaders.join("\t")}\n"unterminated`,
    )).toThrow("unterminated quoted field");
  });
});

describe("analytics segment downloads", () => {
  it("downloads without ASC authorization, verifies MD5, and records SHA-256", async () => {
    const compressed = gzipSync(`${discoveryHeaders.join("\t")}\n`);
    const mockFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(init?.redirect).toBe("manual");
      return new Response(compressed, { headers: { "content-length": String(compressed.byteLength) } });
    }) as unknown as typeof fetch;

    await expect(downloadAnalyticsSegment(segmentFor(compressed), { fetch: mockFetch })).resolves.toEqual({
      text: `${discoveryHeaders.join("\t")}\n`,
      compressedBytes: compressed.byteLength,
      checksumSha256: createHash("sha256").update(compressed).digest("hex"),
    });
  });

  it("rejects private hosts before fetch and validates every redirect", async () => {
    const compressed = gzipSync("safe");
    const mockFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://127.0.0.1/internal" },
    })) as unknown as typeof fetch;

    await expect(downloadAnalyticsSegment(
      segmentFor(compressed, "https://10.0.0.8/report.txt.gz"),
      { fetch: mockFetch },
    )).rejects.toThrow("private or reserved");
    expect(mockFetch).not.toHaveBeenCalled();

    await expect(downloadAnalyticsSegment(segmentFor(compressed), { fetch: mockFetch }))
      .rejects.toThrow("private or reserved");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects checksum mismatches and gzip expansion bombs", async () => {
    const compressed = gzipSync(Buffer.alloc(5 * 1024 * 1024, 65));
    const response = () => new Response(compressed, {
      headers: { "content-length": String(compressed.byteLength) },
    });
    const mockFetch = vi.fn(async () => response()) as unknown as typeof fetch;
    const wrongChecksum = segmentFor(compressed);
    wrongChecksum.attributes.checksum = "0".repeat(32);
    await expect(downloadAnalyticsSegment(wrongChecksum, { fetch: mockFetch }))
      .rejects.toThrow("checksum did not match");

    await expect(downloadAnalyticsSegment(segmentFor(compressed), {
      fetch: mockFetch,
      maxUncompressedBytes: 10 * 1024 * 1024,
      maxExpansionRatio: 10,
    })).rejects.toThrow("decompressed within its safety limit");
  });

  it("does not expose signed download URLs when transport fails", async () => {
    const compressed = gzipSync("safe");
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      throw new Error(`Socket failed for ${input.toString()}`);
    }) as unknown as typeof fetch;
    const error = await downloadAnalyticsSegment(
      segmentFor(compressed, "https://1.1.1.1/report.txt.gz?X-Amz-Signature=do-not-log"),
      { fetch: mockFetch },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("The analytics segment download could not be reached.");
    expect((error as Error).message).not.toContain("do-not-log");
  });
});

describe("AppStoreConnectProvider analytics transport", () => {
  it("discovers standard daily reports and emits only complete, verified batches", async () => {
    const row = [
      "2026-08-18", "Focus", "1234567890", "Page view", "Product Page", "App Store search",
      "Get", "iPhone", "iOS 19.0", "USA", "42", "39",
    ];
    const compressed = gzipSync(`${discoveryHeaders.join("\t")}\n${row.join("\t")}\n`);
    const emptyCompressed = gzipSync(`${discoveryHeaders.join("\t")}\n`);
    const segment = segmentFor(compressed);
    const emptySegment = segmentFor(emptyCompressed, "https://8.8.8.8/report-2.txt.gz", "segment-2");
    const requestMethods: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requestMethods.push(`${init?.method} ${url.pathname}`);
      if (url.hostname === "1.1.1.1" || url.hostname === "8.8.8.8") {
        expect(new Headers(init?.headers).has("authorization")).toBe(false);
        const body = url.hostname === "1.1.1.1" ? compressed : emptyCompressed;
        return new Response(body, { headers: { "content-length": String(body.byteLength) } });
      }
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Bearer /);
      if (url.pathname === "/v1/apps/1234567890/analyticsReportRequests") {
        return json(page([{
          type: "analyticsReportRequests",
          id: "request-1",
          attributes: { accessType: "ONGOING", stoppedDueToInactivity: false },
        }]));
      }
      if (url.pathname === "/v1/analyticsReportRequests/request-1/reports") {
        if (url.searchParams.get("cursor") !== "reports-2") {
          expect(url.searchParams.get("filter[category]")).toBe("APP_STORE_ENGAGEMENT,COMMERCE,APP_USAGE");
          return json(page([{
            type: "analyticsReports",
            id: "report-detailed",
            attributes: {
              name: "App Store Discovery and Engagement Detailed",
              category: "APP_STORE_ENGAGEMENT",
            },
          }], "https://api.appstoreconnect.apple.com/v1/analyticsReportRequests/request-1/reports?cursor=reports-2"));
        }
        return json(page([{
          type: "analyticsReports",
          id: "report-1",
          attributes: {
            name: "App Store Discovery and Engagement Standard",
            category: "APP_STORE_ENGAGEMENT",
          },
        }]));
      }
      if (url.pathname === "/v1/analyticsReports/report-1/instances") {
        if (url.searchParams.get("cursor") !== "instances-2") {
          expect(url.searchParams.get("filter[granularity]")).toBe("DAILY");
          return json(page([], "https://api.appstoreconnect.apple.com/v1/analyticsReports/report-1/instances?cursor=instances-2"));
        }
        return json(page([{
          type: "analyticsReportInstances",
          id: "instance-1",
          attributes: { granularity: "DAILY", processingDate: "2026-08-20" },
        }]));
      }
      if (url.pathname === "/v1/analyticsReportInstances/instance-1/segments") {
        if (url.searchParams.get("cursor") !== "segments-2") {
          return json(page([{
            type: "analyticsReportSegments",
            id: segment.id,
            attributes: segment.attributes,
          }], "https://api.appstoreconnect.apple.com/v1/analyticsReportInstances/instance-1/segments?cursor=segments-2"));
        }
        return json(page([{
          type: "analyticsReportSegments",
          id: emptySegment.id,
          attributes: emptySegment.attributes,
        }]));
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch, now: () => new Date("2026-08-22T12:00:00Z") });

    const result = await provider.syncAnalytics({ schemaVersion: 1, appIds: ["1234567890"], force: false });
    expect(result.state, result.error ?? "sync failed without detail").toBe("PARTIAL");
    expect(result.issuerId).toBe(credentials.issuerId);
    expect(result.batches).toHaveLength(1);
    expect(AnalyticsFactBatchSchema.safeParse(result.batches[0]).success).toBe(true);
    expect(result.batches[0]).toMatchObject({
      appId: "1234567890",
      accessType: "ONGOING",
      reportRequestId: "request-1",
      reportName: "App Store Discovery and Engagement Standard",
      processingDate: "2026-08-20",
      partitionDates: ["2026-08-18"],
      segmentIds: ["segment-1", "segment-2"],
      expectedSegmentCount: 2,
      verifiedSegmentCount: 2,
      observations: expect.arrayContaining([
        expect.objectContaining({ metric: "IMPRESSIONS", value: 42 }),
        expect.objectContaining({ metric: "PRODUCT_PAGE_VIEWS", value: 42 }),
      ]),
    });
    expect(requestMethods).toContain("GET /report.txt.gz");
    expect(requestMethods).toContain("GET /report-2.txt.gz");
    expect(result.batches.some((batch) => batch.reportName.includes("Detailed"))).toBe(false);
  });

  it("treats a configured report that Apple is still preparing as a successful check", async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/apps/1234567890/analyticsReportRequests") {
        return json(page([{
          type: "analyticsReportRequests",
          id: "request-waiting",
          attributes: { accessType: "ONGOING", stoppedDueToInactivity: false },
        }]));
      }
      if (url.pathname === "/v1/analyticsReportRequests/request-waiting/reports") {
        return json(page([{
          type: "analyticsReports",
          id: "report-sessions",
          attributes: { name: "App Sessions Standard", category: "APP_USAGE" },
        }]));
      }
      if (url.pathname === "/v1/analyticsReports/report-sessions/instances") return json(page([]));
      throw new Error(`Unexpected request: ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch, now: () => new Date("2026-08-22T12:00:00Z") });

    const result = await provider.syncAnalytics({ schemaVersion: 1, appIds: ["1234567890"], force: false });

    expect(result).toMatchObject({
      state: "SUCCEEDED",
      batches: [],
      error: null,
      freshness: {
        dataThrough: null,
        partial: true,
        detail: expect.stringContaining("has not supplied"),
      },
    });
  });

  it("creates the exact report request document once and never retries the write", async () => {
    let body: unknown;
    const mockFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return json({ errors: [{ status: "500", code: "UNAVAILABLE", detail: "Try later." }] }, 500);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.createAnalyticsReportRequest({ appId: "1234567890", accessType: "ONGOING" }))
      .rejects.toMatchObject({ status: 500, code: "UNAVAILABLE" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(body).toEqual({
      data: {
        type: "analyticsReportRequests",
        attributes: { accessType: "ONGOING" },
        relationships: { app: { data: { type: "apps", id: "1234567890" } } },
      },
    });
  });

  it("maps analytics role failures to actionable permission errors", async () => {
    const forbiddenFetch = vi.fn(async () => json({
      errors: [{ status: "403", code: "FORBIDDEN", detail: "Forbidden" }],
    }, 403)) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: forbiddenFetch });

    await expect(provider.createAnalyticsReportRequest({ appId: "1234567890", accessType: "ONGOING" }))
      .rejects.toMatchObject({
        status: 403,
        code: "analytics_admin_required",
        message: expect.stringContaining("Admin"),
      });
    await expect(provider.listAnalyticsReportRequests("1234567890"))
      .rejects.toMatchObject({
        status: 403,
        code: "analytics_reports_role_required",
        message: expect.stringContaining("Sales and Reports"),
      });
    await expect(provider.syncAnalytics({ schemaVersion: 1, appIds: ["1234567890"], force: false }))
      .rejects.toMatchObject({ status: 403, code: "analytics_reports_role_required" });
  });
});
