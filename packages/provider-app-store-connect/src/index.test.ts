import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStoreConnectProvider, type AppStoreConnectCredentials } from "./index.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials: AppStoreConnectCredentials = {
  profileName: "Release key",
  issuerId: "11111111-2222-3333-4444-555555555555",
  keyId: "ABC123DEFG",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  authBackend: "Test memory",
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
});
const page = (data: unknown[], options: { included?: unknown[]; next?: string } = {}) => ({
  data,
  ...(options.included ? { included: options.included } : {}),
  links: { self: "https://api.appstoreconnect.apple.com/v1/test", ...(options.next ? { next: options.next } : {}) },
});
const app = (id: string, name: string) => ({ type: "apps", id, attributes: { name, bundleId: `com.example.${id}` } });

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AppStoreConnectProvider direct transport", () => {
  it("signs short-lived Apple JWTs and follows first-party pagination", async () => {
    const authorizations: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization) authorizations.push(authorization);
      if (url.searchParams.get("limit") === "1") return json(page([app("one", "One")]));
      if (url.searchParams.get("cursor") === "second") return json(page([app("two", "Two")]));
      return json(page(
        [app("one", "One")],
        { next: "https://api.appstoreconnect.apple.com/v1/apps?cursor=second" },
      ));
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.getStatus()).resolves.toMatchObject({
      connected: true,
      provider: "app-store-connect-api",
      profile: "Release key",
    });
    await expect(provider.listApps({ limit: 2 })).resolves.toEqual([
      { id: "one", name: "One", bundleId: "com.example.one", platforms: [] },
      { id: "two", name: "Two", bundleId: "com.example.two", platforms: [] },
    ]);

    const token = authorizations[0]?.replace(/^Bearer /, "");
    expect(token).toBeTruthy();
    const [encodedHeader, encodedPayload, encodedSignature] = token!.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toEqual({ alg: "ES256", kid: credentials.keyId, typ: "JWT" });
    const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString()) as Record<string, number | string>;
    expect(payload).toMatchObject({ iss: credentials.issuerId, aud: "appstoreconnect-v1" });
    expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(605);
    expect(Buffer.from(encodedSignature!, "base64url")).toHaveLength(64);
    expect(new Set(authorizations).size).toBe(1);
  });

  it("maps builds and groups from Apple's JSON:API relationships and writes group access directly", async () => {
    let assignmentBody: unknown;
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname === "/v1/builds" && init?.method === "GET") {
        return json(page([{
          type: "builds",
          id: "build-44",
          attributes: {
            version: "44",
            uploadedDate: "2026-08-16T10:00:00Z",
            processingState: "VALID",
            expired: false,
            computedMinMacOsVersion: "15.0",
          },
          relationships: {
            preReleaseVersion: { data: { type: "preReleaseVersions", id: "pre-310" } },
            betaGroups: { data: [{ type: "betaGroups", id: "group-team" }] },
          },
        }], { included: [
          { type: "preReleaseVersions", id: "pre-310", attributes: { version: "3.1.0", platform: "MAC_OS" } },
          { type: "betaGroups", id: "group-team", attributes: { name: "Team", isInternalGroup: true } },
        ] }));
      }
      if (url.pathname === "/v1/builds/build-44/relationships/betaGroups" && init?.method === "POST") {
        assignmentBody = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.listBuilds("app-1")).resolves.toEqual([expect.objectContaining({
      id: "build-44",
      version: "3.1.0",
      buildNumber: "44",
      platform: "MAC_OS",
      minimumOs: "15.0",
      testingStatus: "Internal",
      groups: [{ id: "group-team", name: "Team", testerCount: null, internal: true }],
    })]);
    await provider.addBuildToGroup({ appId: "app-1", buildId: "build-44", groupId: "group-qa" });
    expect(assignmentBody).toEqual({ data: [{ type: "betaGroups", id: "group-qa" }] });
  });

  it("clears metadata through Apple's nullable fields and verifies the saved value", async () => {
    let promotionalText: string | null = "Old promotion";
    let patchBody: unknown;
    const localizationPage = () => page([{
      type: "appStoreVersionLocalizations",
      id: "loc-en",
      attributes: {
        locale: "en-US",
        description: "Description",
        keywords: "notes,writing",
        promotionalText,
        whatsNew: "Faster sync.",
      },
    }]);
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/appStoreVersionLocalizations") && init?.method === "GET") return json(localizationPage());
      if (url.pathname === "/v1/appStoreVersionLocalizations/loc-en" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        promotionalText = null;
        return json({ data: localizationPage().data[0] });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await provider.applyVersionLocalizationPatches(
      "version-1",
      [{ locale: "en-US", promotionalText: "" }],
      [{ id: "loc-en", locale: "en-US", whatsNew: "Faster sync.", promotionalText: "Old promotion", keywords: "notes,writing" }],
    );
    expect(patchBody).toEqual({
      data: {
        type: "appStoreVersionLocalizations",
        id: "loc-en",
        attributes: { promotionalText: null },
      },
    });
  });

  it("uses Apple's reserve-upload-commit protocol for screenshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-provider-"));
    temporaryDirectories.push(root);
    const uploadId = "11111111-2222-4333-8444-555555555555";
    const fileName = "screen.png";
    const directory = join(root, uploadId);
    const body = Buffer.from("fixture image bytes");
    await mkdir(directory);
    await writeFile(join(directory, fileName), body);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const md5 = createHash("md5").update(body).digest("hex");
    let uploadedChunk: Uint8Array | null = null;
    let committed = false;
    let relatedIds: unknown;
    const screenshotResource = () => ({
      type: "appScreenshots",
      id: "screenshot-new",
      attributes: {
        fileName,
        fileSize: body.length,
        sourceFileChecksum: committed ? md5 : undefined,
        uploadOperations: committed ? [] : [{
          method: "PUT",
          url: "https://uploads.example.com/part",
          offset: 0,
          length: body.length,
          requestHeaders: [{ name: "content-type", value: "application/octet-stream" }],
        }],
        assetDeliveryState: committed ? { state: "COMPLETE" } : { state: "AWAITING_UPLOAD" },
        ...(committed ? { imageAsset: { templateUrl: "https://images.example.com/{w}x{h}{c}.{f}", width: 1290, height: 2796 } } : {}),
      },
    });
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "uploads.example.com") {
        uploadedChunk = new Uint8Array(init?.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      if (url.pathname.endsWith("/appScreenshotSets") && init?.method === "GET") {
        return json(page([{ type: "appScreenshotSets", id: "set-1", attributes: { screenshotDisplayType: "APP_IPHONE_69" } }]));
      }
      if (url.pathname === "/v1/appScreenshotSets/set-1/appScreenshots" && init?.method === "GET") {
        return json(page(committed ? [screenshotResource()] : []));
      }
      if (url.pathname === "/v1/appScreenshots" && init?.method === "POST") return json({ data: screenshotResource() }, 201);
      if (url.pathname === "/v1/appScreenshots/screenshot-new" && init?.method === "PATCH") {
        committed = true;
        return json({ data: screenshotResource() });
      }
      if (url.pathname === "/v1/appScreenshots/screenshot-new" && init?.method === "GET") return json({ data: screenshotResource() });
      if (url.pathname === "/v1/appScreenshotSets/set-1/relationships/appScreenshots" && init?.method === "PATCH") {
        relatedIds = JSON.parse(String(init.body));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch, uploadDirectory: root });

    await provider.applyScreenshotChanges({
      localizationId: "loc-en",
      locale: "en-US",
      displayType: "APP_IPHONE_69",
      uploads: [{
        uploadId,
        displayType: "APP_IPHONE_69",
        fileName,
        mediaType: "image/png",
        fileSize: body.length,
        width: 1290,
        height: 2796,
        checksum: sha256,
        hasAlpha: false,
      }],
      deleteIds: [],
      expected: [],
    });

    expect(Buffer.from(uploadedChunk!)).toEqual(body);
    expect(relatedIds).toEqual({ data: [{ type: "appScreenshots", id: "screenshot-new" }] });
  });

  it("loads older screenshots when Apple omits optional asset attributes", async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/appScreenshotSets") && init?.method === "GET") {
        return json(page([{
          type: "appScreenshotSets",
          id: "legacy-set",
          attributes: { screenshotDisplayType: "APP_IPHONE_69" },
        }]));
      }
      if (url.pathname === "/v1/appScreenshotSets/legacy-set/appScreenshots" && init?.method === "GET") {
        return json(page([{
          type: "appScreenshots",
          id: "legacy-screenshot",
          attributes: {
            fileName: "legacy.png",
            fileSize: null,
            uploadOperations: null,
            imageAsset: {
              templateUrl: "https://images.apple.test/{w}x{h}{c}.{f}",
              width: 1290,
              height: 2796,
            },
            assetDeliveryState: { state: "COMPLETE" },
          },
        }, {
          type: "appScreenshots",
          id: "legacy-screenshot-without-attributes",
        }]));
      }
      throw new Error(`Unexpected request: ${init?.method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.listScreenshots("loc-en", "en-US", "APP_IPHONE_69")).resolves.toEqual([
      expect.objectContaining({
        id: "legacy-screenshot",
        fileName: "legacy.png",
        fileSize: 0,
        width: 1290,
        height: 2796,
        state: "COMPLETE",
        imageUrl: "https://images.apple.test/332x720bb.jpg",
        fullImageUrl: "https://images.apple.test/1290x2796bb.jpg",
      }),
      expect.objectContaining({
        id: "legacy-screenshot-without-attributes",
        fileName: "screenshot-2",
        fileSize: 0,
        state: "COMPLETE",
      }),
    ]);
  });

  it("attaches a build and creates Apple's review submission resources in order", async () => {
    const writes: Array<{ method: string; path: string; body: unknown }> = [];
    const version = {
      type: "appStoreVersions",
      id: "version-1",
      attributes: {
        platform: "IOS",
        versionString: "2.6.0",
        appVersionState: "PREPARE_FOR_SUBMISSION",
      },
      relationships: { app: { data: { type: "apps", id: "app-1" } } },
    };
    const submission = (state: string, submittedDate?: string) => ({
      type: "reviewSubmissions",
      id: "submission-1",
      attributes: { platform: "IOS", state, ...(submittedDate ? { submittedDate } : {}) },
      relationships: { appStoreVersionForReview: { data: { type: "appStoreVersions", id: "version-1" } } },
    });
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const method = init?.method ?? "GET";
      if (method !== "GET") writes.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.pathname === "/v1/appStoreVersions/version-1" && method === "GET") return json({ data: version });
      if (url.pathname.endsWith("/relationships/build") && method === "GET") return json({ data: null, links: {} });
      if (url.pathname.endsWith("/relationships/build") && method === "PATCH") return new Response(null, { status: 204 });
      if (url.pathname === "/v1/reviewSubmissions" && method === "GET") return json(page([]));
      if (url.pathname === "/v1/reviewSubmissions" && method === "POST") return json({ data: submission("READY_FOR_REVIEW") }, 201);
      if (url.pathname === "/v1/reviewSubmissionItems" && method === "POST") {
        return json({ data: { type: "reviewSubmissionItems", id: "item-1", attributes: { state: "READY_FOR_REVIEW" } } }, 201);
      }
      if (url.pathname === "/v1/reviewSubmissions/submission-1" && method === "PATCH") {
        return json({ data: submission("WAITING_FOR_REVIEW", "2026-08-16T12:00:00Z") });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppStoreConnectProvider({ credentials, fetch: mockFetch });

    await expect(provider.submitVersion({ appId: "app-1", versionId: "version-1", buildId: "build-1" })).resolves.toEqual({
      appId: "app-1",
      versionId: "version-1",
      versionString: "2.6.0",
      platform: "IOS",
      buildId: "build-1",
      submissionId: "submission-1",
      submittedAt: "2026-08-16T12:00:00Z",
      alreadySubmitted: false,
      attached: true,
      alreadyAttached: false,
    });
    expect(writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      "PATCH /v1/appStoreVersions/version-1/relationships/build",
      "POST /v1/reviewSubmissions",
      "POST /v1/reviewSubmissionItems",
      "PATCH /v1/reviewSubmissions/submission-1",
    ]);
  });
});
