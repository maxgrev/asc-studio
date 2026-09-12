import { spawn, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  AnalyticsOverviewResponseV2Schema,
  AnalyticsPortfolioCatalogResponseSchema,
  AnalyticsPortfolioPendingPlansResponseSchema,
  AnalyticsPortfolioReportRequestPlanResponseSchema,
  AnalyticsPortfolioStatusResponseSchema,
  AnalyticsPortfolioSyncResponseSchema,
  AppStoreLocaleSchema,
  PlanResponseSchema,
  type MutationPlan,
  type SearchMetadata,
} from "@asc-studio/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqliteAnalyticsStore } from "./analytics-store.js";
import { SqlitePlanStore } from "./store.js";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const launchArguments = ["--import", "tsx", "src/index.ts"];
const guiToken = "g".repeat(43);
const mcpToken = "m".repeat(43);

interface RunningAgent {
  baseUrl: string;
  child: ChildProcess;
  dataDirectory: string;
  providerCallLog: string | null;
}

interface StartAgentOptions {
  serveWeb?: boolean;
  mode?: "demo" | "live";
  environment?: Record<string, string>;
  mockOpenAiValidation?: boolean;
  mockAnalyticsForbidden?: boolean;
  mockAnalyticsPortfolioLease?: boolean;
  mockAnalyticsWaiting?: boolean;
  mockAnalyticsAdminFallback?: boolean;
  prepareDataDirectory?: (dataDirectory: string) => Promise<void>;
}

const startAgent = async (options: StartAgentOptions = {}): Promise<RunningAgent> => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "asc-studio-agent-test-"));
  const webDirectory = join(dataDirectory, "web");
  if (options.serveWeb) {
    await mkdir(join(webDirectory, "assets"), { recursive: true });
    await writeFile(join(webDirectory, "index.html"), '<!doctype html><div id="root">ASC Studio built GUI</div>', "utf8");
    await writeFile(join(webDirectory, "assets", "app.js"), 'document.title = "ASC Studio";', "utf8");
  }
  await options.prepareDataDirectory?.(dataDirectory);
  const environment = { ...process.env };
  for (const name of [
    "ASC_STUDIO_PROFILE_NAME",
    "ASC_STUDIO_ISSUER_ID",
    "ASC_STUDIO_KEY_ID",
    "ASC_STUDIO_PRIVATE_KEY",
    "ASC_STUDIO_PRIVATE_KEY_PATH",
    "ASC_STUDIO_ADS_PROFILE_NAME",
    "ASC_STUDIO_ADS_CLIENT_ID",
    "ASC_STUDIO_ADS_TEAM_ID",
    "ASC_STUDIO_ADS_KEY_ID",
    "ASC_STUDIO_ADS_PRIVATE_KEY",
    "ASC_STUDIO_ADS_PRIVATE_KEY_PATH",
    "ASC_STUDIO_ADS_AD_ACCOUNT_ID",
    "OPENAI_API_KEY",
    "ASC_STUDIO_OPENAI_MODEL",
  ]) delete environment[name];
  const preloadPaths: string[] = [];
  if (options.mockOpenAiValidation) {
    const preloadPath = join(dataDirectory, "mock-openai-fetch.mjs");
    await writeFile(preloadPath, [
      "const originalFetch = globalThis.fetch;",
      "globalThis.fetch = async (input, init) => {",
      "  if (String(input) === 'https://api.openai.com/v1/responses') {",
      "    const authorization = new Headers(init?.headers).get('authorization') ?? '';",
      "    const status = authorization.includes('rejected') ? 401 : 200;",
      "    const body = status === 200 ? JSON.stringify({ output_text: JSON.stringify({ ok: true }) }) : 'rejected';",
      "    return new Response(body, { status, headers: { 'content-type': 'application/json' } });",
      "  }",
      "  return originalFetch(input, init);",
      "};",
    ].join("\n"), "utf8");
    preloadPaths.push(preloadPath);
  }
  if (options.mockAnalyticsForbidden) {
    const preloadPath = join(dataDirectory, "mock-analytics-forbidden-fetch.mjs");
    const providerCallLog = join(dataDirectory, "apple-provider-calls.log");
    await writeFile(providerCallLog, "", "utf8");
    await writeFile(preloadPath, [
      "import { appendFileSync } from 'node:fs';",
      "const originalFetch = globalThis.fetch;",
      `const providerCallLog = ${JSON.stringify(providerCallLog)};`,
      "globalThis.fetch = async (input, init) => {",
      "  const url = new URL(String(input));",
      "  if (url.hostname === 'api.appstoreconnect.apple.com') appendFileSync(providerCallLog, `${url.pathname}${url.search}\\n`);",
      "  if (url.hostname === 'api.appstoreconnect.apple.com' && url.pathname === '/v1/apps') {",
      "    return new Response(JSON.stringify({ data: [{ type: 'apps', id: '1234567890', attributes: { name: 'Denied App', bundleId: 'com.example.denied' } }], links: { self: url.toString() } }), { status: 200, headers: { 'content-type': 'application/json' } });",
      "  }",
      "  if (url.hostname === 'api.appstoreconnect.apple.com' && url.pathname.includes('analyticsReportRequests')) {",
      "    return new Response(JSON.stringify({ errors: [{ status: '403', code: 'FORBIDDEN', detail: 'Forbidden' }] }), { status: 403, headers: { 'content-type': 'application/json' } });",
      "  }",
      "  return originalFetch(input, init);",
      "};",
    ].join("\n"), "utf8");
    preloadPaths.push(preloadPath);
  }
  if (options.mockAnalyticsPortfolioLease) {
    const preloadPath = join(dataDirectory, "mock-analytics-portfolio-lease.mjs");
    const providerCallLog = join(dataDirectory, "apple-provider-calls.log");
    const discoveryGate = join(dataDirectory, "portfolio-discovery-release");
    await writeFile(providerCallLog, "", "utf8");
    await writeFile(preloadPath, [
      "import { appendFileSync, existsSync } from 'node:fs';",
      "const originalFetch = globalThis.fetch;",
      `const providerCallLog = ${JSON.stringify(providerCallLog)};`,
      `const discoveryGate = ${JSON.stringify(discoveryGate)};`,
      "const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });",
      "globalThis.fetch = async (input, init) => {",
      "  const url = new URL(String(input));",
      "  if (url.hostname !== 'api.appstoreconnect.apple.com') return originalFetch(input, init);",
      "  appendFileSync(providerCallLog, `${init?.method ?? 'GET'} ${url.pathname}${url.search}\\n`);",
      "  if (url.pathname === '/v1/apps') {",
      "    if (url.searchParams.get('limit') !== '1') {",
      "      const deadline = Date.now() + 10000;",
      "      while (!existsSync(discoveryGate) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));",
      "      if (!existsSync(discoveryGate)) return json({ errors: [{ status: '503', detail: 'Discovery gate timed out.' }] }, 503);",
      "    }",
      "    return json({ data: [{ type: 'apps', id: '1234567890', attributes: { name: 'Lease Test', bundleId: 'com.example.lease-test' } }], links: { self: url.toString() } });",
      "  }",
      "  if (url.pathname === '/v1/apps/1234567890/analyticsReportRequests') {",
      "    return json({ data: [{ type: 'analyticsReportRequests', id: 'raw-lease-request', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }], links: { self: url.toString() } });",
      "  }",
      "  if (url.pathname === '/v1/analyticsReportRequests/raw-lease-request/reports') {",
      "    return json({ data: [], links: { self: url.toString() } });",
      "  }",
      "  return json({ errors: [{ status: '404', detail: `Unexpected fixture request: ${url.pathname}` }] }, 404);",
      "};",
    ].join("\n"), "utf8");
    preloadPaths.push(preloadPath);
  }
  if (options.mockAnalyticsWaiting) {
    const preloadPath = join(dataDirectory, "mock-analytics-waiting.mjs");
    await writeFile(preloadPath, [
      "const originalFetch = globalThis.fetch;",
      "const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });",
      "globalThis.fetch = async (input, init) => {",
      "  const url = new URL(String(input));",
      "  if (url.hostname !== 'api.appstoreconnect.apple.com') return originalFetch(input, init);",
      "  if (url.pathname === '/v1/apps') {",
      "    return json({ data: [{ type: 'apps', id: '1234567890', attributes: { name: 'Active App', bundleId: 'com.example.active' } }], links: { self: url.toString() } });",
      "  }",
      "  if (url.pathname === '/v1/apps/1234567890/analyticsReportRequests') {",
      "    return json({ data: [{ type: 'analyticsReportRequests', id: 'raw-active-request', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } }], links: { self: url.toString() } });",
      "  }",
      "  return json({ errors: [{ status: '404', detail: `Unexpected fixture request: ${url.pathname}` }] }, 404);",
      "};",
    ].join("\n"), "utf8");
    preloadPaths.push(preloadPath);
  }
  if (options.mockAnalyticsAdminFallback) {
    const preloadPath = join(dataDirectory, "mock-analytics-admin-fallback.mjs");
    const providerCallLog = join(dataDirectory, "apple-provider-calls.log");
    await writeFile(providerCallLog, "", "utf8");
    await writeFile(preloadPath, [
      "import { appendFileSync } from 'node:fs';",
      "const originalFetch = globalThis.fetch;",
      `const providerCallLog = ${JSON.stringify(providerCallLog)};`,
      "const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });",
      "const keyId = (init) => {",
      "  const authorization = new Headers(init?.headers).get('authorization') ?? '';",
      "  try { return JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[0], 'base64url').toString('utf8')).kid ?? 'unknown'; } catch { return 'unknown'; }",
      "};",
      "globalThis.fetch = async (input, init) => {",
      "  const url = new URL(String(input));",
      "  if (url.hostname !== 'api.appstoreconnect.apple.com') return originalFetch(input, init);",
      "  const kid = keyId(init);",
      "  if (url.pathname === '/v1/apps') {",
      "    return json({ data: [{ type: 'apps', id: '1234567890', attributes: { name: 'Fallback App', bundleId: 'com.example.fallback' } }], links: { self: url.toString() } });",
      "  }",
      "  if (url.pathname === '/v1/apps/1234567890/analyticsReportRequests' && (init?.method ?? 'GET') === 'GET') {",
      "    return json({ data: [], links: { self: url.toString() } });",
      "  }",
      "  if (url.pathname === '/v1/analyticsReportRequests' && init?.method === 'POST') {",
      "    const body = JSON.parse(String(init.body));",
      "    const accessType = body.data.attributes.accessType;",
      "    appendFileSync(providerCallLog, `${kid} POST ${accessType}\n`);",
      "    if (kid === 'READ123456' && accessType === 'ONGOING') {",
      "      return json({ errors: [{ status: '500', code: 'UNEXPECTED_ERROR', detail: 'Transient upstream failure.' }] }, 500);",
      "    }",
      "    if (kid === 'READ123456') {",
      "      return json({ errors: [{ status: '403', code: 'FORBIDDEN', detail: 'Admin role required.' }] }, 403);",
      "    }",
      "    return json({ data: { type: 'analyticsReportRequests', id: 'raw-created-request', attributes: { accessType, stoppedDueToInactivity: false }, relationships: { app: { data: { type: 'apps', id: '1234567890' } } } } }, 201);",
      "  }",
      "  return json({ errors: [{ status: '404', detail: `Unexpected fixture request: ${url.pathname}` }] }, 404);",
      "};",
    ].join("\n"), "utf8");
    preloadPaths.push(preloadPath);
  }
  const childArguments = [...preloadPaths.flatMap((path) => ["--import", path]), ...launchArguments];
  const child = spawn(process.execPath, childArguments, {
    cwd: appRoot,
    env: {
      ...environment,
      ASC_STUDIO_MODE: options.mode ?? "demo",
      ASC_STUDIO_PORT: "0",
      ASC_STUDIO_DATA_DIR: dataDirectory,
      ASC_STUDIO_GUI_TOKEN: guiToken,
      ASC_STUDIO_MCP_TOKEN: mcpToken,
      NODE_ENV: "test",
      ASC_STUDIO_TEST_IN_MEMORY_KEYCHAIN: "1",
      ...(options.serveWeb ? { ASC_STUDIO_WEB_DIR: webDirectory } : {}),
      ...options.environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return await new Promise<RunningAgent>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Local agent did not start in time. ${stderr}`));
    }, 10_000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
      if (!match?.[1]) return;
      clearTimeout(timer);
      resolve({
        baseUrl: `http://127.0.0.1:${match[1]}`,
        child,
        dataDirectory,
        providerCallLog: options.mockAnalyticsForbidden
          || options.mockAnalyticsPortfolioLease
          || options.mockAnalyticsAdminFallback
          ? join(dataDirectory, "apple-provider-calls.log")
          : null,
      });
    });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Local agent exited before listening with code ${String(code)}. ${stderr}`));
    });
  });
};

const stopAgent = async (agent: RunningAgent | undefined) => {
  if (!agent) return;
  if (agent.child.exitCode === null) {
    const exited = new Promise<void>((resolve) => agent.child.once("exit", () => resolve()));
    agent.child.kill("SIGTERM");
    await exited;
  }
  await rm(agent.dataDirectory, { recursive: true, force: true });
};

const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
const mcpHeaders = (token: string) => ({
  ...authorization(token),
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
});

describe("local-agent live connection setup", () => {
  let agent: RunningAgent | undefined;

  beforeAll(async () => { agent = await startAgent({ mode: "live" }); });
  afterAll(async () => { await stopAgent(agent); });

  it("starts without a third-party CLI or saved credentials and reports setup state", async () => {
    const response = await fetch(`${agent!.baseUrl}/api/status`, { headers: authorization(guiToken) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      mode: "live",
      connected: false,
      provider: "app-store-connect-api",
      connectionId: null,
      profile: null,
      authBackend: null,
      detail: "Connect an App Store Connect API key before using live mode.",
    });
  });

  it("keeps Apple Ads optional and returns a clear error for unconfigured tools", async () => {
    const [status, connection, keyPair] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/apple-ads/status`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/connections/apple-ads`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/connections/apple-ads/key-pair`, { method: "POST", headers: authorization(guiToken) }),
    ]);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ configured: false, connected: false, adAccountId: null });
    expect(connection.status).toBe(200);
    expect(await connection.json()).toMatchObject({ connection: { configured: false, source: null } });
    expect(keyPair.status).toBe(409);
    expect(await keyPair.json()).toMatchObject({ error: { code: "app_store_connect_required" } });

    const research = await fetch(`${agent!.baseUrl}/api/apple-ads/keywords/research`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({
        appId: "123456789",
        countryOrRegion: "US",
        genre: "PRODUCTIVITY_UTILITIES",
        start: "2026-08-09",
        end: "2026-08-15",
        granularity: "WEEKLY_SUN_SAT",
      }),
    });
    expect(research.status).toBe(409);
    expect(await research.json()).toMatchObject({ error: { code: "apple_ads_not_configured" } });
  });

  it("reports unconfigured OpenAI metadata and rejects invalid connection input without a provider call", async () => {
    const status = await fetch(`${agent!.baseUrl}/api/connections/openai`, {
      headers: authorization(guiToken),
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      connection: {
        configured: false,
        source: null,
        model: "gpt-5.6-luna",
        modelSource: "default",
      },
    });

    const invalid = await fetch(`${agent!.baseUrl}/api/connections/openai`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "contains whitespace", extra: true }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_input" } });
    await expect(stat(join(agent!.dataDirectory, "credentials", "openai.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps explicit vault recovery inside the GUI boundary and requires exact scope confirmation", async () => {
    const jsonHeaders = { ...authorization(guiToken), "content-type": "application/json" };
    const wrongConfirmation = await fetch(`${agent!.baseUrl}/api/connections/openai/reset-vault`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ confirmation: "reset" }),
    });
    const wrongScope = await fetch(`${agent!.baseUrl}/api/connections/openai/reset-vault`, {
      method: "POST",
      headers: { ...authorization(mcpToken), "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESET OPENAI CONNECTION" }),
    });
    expect(wrongConfirmation.status).toBe(400);
    expect(wrongScope.status).toBe(401);

    const [openAi, appleAds, apple] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/connections/openai/reset-vault`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ confirmation: "RESET OPENAI CONNECTION" }),
      }),
      fetch(`${agent!.baseUrl}/api/connections/apple-ads/reset-vault`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ confirmation: "RESET APPLE ADS CONNECTIONS" }),
      }),
      fetch(`${agent!.baseUrl}/api/connections/app-store-connect/reset-vault`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ confirmation: "RESET APPLE CONNECTIONS" }),
      }),
    ]);
    expect([openAi.status, appleAds.status, apple.status]).toEqual([200, 200, 200]);
    expect(await openAi.json()).toMatchObject({ connection: { configured: false, source: null } });
    expect(await appleAds.json()).toMatchObject({ connection: { configured: false, source: null } });
    expect(await apple.json()).toMatchObject({ status: { connected: false }, accounts: [] });
  });
});

describe("local-agent analytics permissions", () => {
  let agent: RunningAgent | undefined;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

  beforeAll(async () => {
    agent = await startAgent({
      mode: "live",
      mockAnalyticsForbidden: true,
      environment: {
        ASC_STUDIO_PROFILE_NAME: "Restricted analytics key",
        ASC_STUDIO_ISSUER_ID: "11111111-2222-3333-4444-555555555555",
        ASC_STUDIO_KEY_ID: "ABC123DEFG",
        ASC_STUDIO_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
    });
  });
  afterAll(async () => { await stopAgent(agent); });

  it("keeps portfolio, app, refresh, and unknown-app overview reads off Apple after roster loading", async () => {
    const roster = await fetch(`${agent!.baseUrl}/api/apps?paginate=true`, {
      headers: authorization(guiToken),
    });
    expect(roster.status).toBe(200);
    expect(await roster.json()).toMatchObject({ apps: [expect.objectContaining({ id: "1234567890" })] });
    const callsBefore = await readFile(agent!.providerCallLog!, "utf8");
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const query = {
      schemaVersion: 1,
      scope: "PORTFOLIO",
      appIds: ["1234567890"],
      startDate: "2026-08-01",
      endDate: "2026-08-20",
      compare: "NONE",
      granularity: "DAY",
      breakdowns: ["APP"],
    };
    const responses = await Promise.all([
      fetch(`${agent!.baseUrl}/api/analytics/overview`, { method: "POST", headers, body: JSON.stringify(query) }),
      fetch(`${agent!.baseUrl}/api/analytics/overview`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...query, scope: "APP", breakdowns: ["TERRITORY"] }),
      }),
      fetch(`${agent!.baseUrl}/api/analytics/overview`, { method: "POST", headers, body: JSON.stringify(query) }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);

    const unknown = await fetch(`${agent!.baseUrl}/api/analytics/overview`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...query, appIds: ["another-account-app"] }),
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: { code: "analytics_app_not_found" } });
    expect(await readFile(agent!.providerCallLog!, "utf8")).toBe(callsBefore);
  });

  it("returns a typed reports-role error before queuing an analytics sync", async () => {
    const response = await fetch(`${agent!.baseUrl}/api/analytics/sync`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, appIds: ["1234567890"], force: false }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: {
        code: "analytics_reports_role_required",
        message: expect.stringContaining("Sales and Reports"),
      },
    });
  });
});

describe("local-agent legacy Analytics status isolation", () => {
  let agent: RunningAgent | undefined;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const activeIssuerId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const rawPortfolioChildRunId = "raw-inactive-portfolio-child";

  beforeAll(async () => {
    agent = await startAgent({
      mode: "live",
      mockAnalyticsWaiting: true,
      environment: {
        ASC_STUDIO_PROFILE_NAME: "Active reports key",
        ASC_STUDIO_ISSUER_ID: activeIssuerId,
        ASC_STUDIO_KEY_ID: "ACTIVE1234",
        ASC_STUDIO_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      },
      prepareDataDirectory: async (dataDirectory) => {
        const analyticsStore = new SqliteAnalyticsStore(join(dataDirectory, "live.sqlite"));
        await analyticsStore.savePortfolioChildAnalyticsSyncRun({
          schemaVersion: 1,
          issuerId: activeIssuerId,
          runId: rawPortfolioChildRunId,
          state: "SUCCEEDED",
          appIds: ["9876543210"],
          reportRequests: [{
            id: "raw-inactive-request",
            appId: "9876543210",
            accessType: "ONGOING",
            createdAt: "2026-08-29T18:00:00.000Z",
            stoppedDueToInactivity: false,
          }],
          startedAt: "2026-08-30T18:00:00.000Z",
          completedAt: "2026-08-30T18:01:00.000Z",
          snapshotId: "raw-inactive-snapshot",
          evidenceId: "raw-inactive-evidence",
          freshness: {
            syncedAt: "2026-08-30T18:01:00.000Z",
            dataThrough: "2026-08-29",
            expectedDelayDays: 5,
            partial: false,
            detail: "The inactive credential child is complete.",
          },
          error: null,
          batchCount: 1,
          observationCount: 25,
        }, "raw-parent-portfolio-run");
        analyticsStore.close();
      },
    });
  });
  afterAll(async () => { await stopAgent(agent); });

  it("does not promote V1 status or freshness from a scope-mismatched portfolio child", async () => {
    const response = await fetch(`${agent!.baseUrl}/api/analytics/status`, {
      headers: authorization(guiToken),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuerId: activeIssuerId,
      state: "WAITING_FOR_DATA",
      reportRequests: [{
        id: "raw-active-request",
        appId: "1234567890",
        accessType: "ONGOING",
      }],
      freshness: {
        syncedAt: null,
        dataThrough: null,
        partial: true,
      },
    });

    const legacyChildLookup = await fetch(`${agent!.baseUrl}/api/analytics/sync/${encodeURIComponent(rawPortfolioChildRunId)}`, {
      headers: authorization(guiToken),
    });
    expect(legacyChildLookup.status).toBe(404);
    expect(await legacyChildLookup.json()).toMatchObject({ error: { code: "analytics_sync_not_found" } });
  });
});

describe("local-agent portfolio Analytics Admin fallback", () => {
  let agent: RunningAgent | undefined;
  let publicAppId = "";
  let activeReadConnectionId = "";
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const issuerId = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

  beforeAll(async () => {
    agent = await startAgent({ mode: "live", mockAnalyticsAdminFallback: true });
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const connect = (profileName: string, keyId: string) => fetch(`${agent!.baseUrl}/api/connections/app-store-connect`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        profileName,
        issuerId,
        keyId,
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
    });
    const admin = await connect("Admin fallback", "ADMIN12345");
    expect(admin.status).toBe(200);
    const read = await connect("Read-capable active", "READ123456");
    expect(read.status).toBe(200);
    const readBody = await read.json() as { accounts: Array<{ id: string; profileName: string; active: boolean }> };
    activeReadConnectionId = readBody.accounts.find((account) => account.profileName === "Read-capable active")!.id;
    expect(readBody.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ profileName: "Read-capable active", active: true }),
      expect.objectContaining({ profileName: "Admin fallback", active: false }),
    ]));

    const catalogResponse = await fetch(`${agent!.baseUrl}/api/analytics/portfolio`, {
      headers: authorization(guiToken),
    });
    expect(catalogResponse.status).toBe(200);
    const catalog = AnalyticsPortfolioCatalogResponseSchema.parse(await catalogResponse.json());
    expect(catalog.apps).toHaveLength(1);
    publicAppId = catalog.apps[0]!.id;
  });
  afterAll(async () => { await stopAgent(agent); });

  const createPlan = async (accessType: "ONGOING" | "ONE_TIME_SNAPSHOT") => {
    const response = await fetch(`${agent!.baseUrl}/api/plans/analytics-report-request`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 2, appId: publicAppId, accessType }),
    });
    expect(response.status).toBe(201);
    return AnalyticsPortfolioReportRequestPlanResponseSchema.parse(await response.json());
  };

  it("falls back once from a read-capable key to an app-capable Admin key without switching accounts", async () => {
    const planned = await createPlan("ONE_TIME_SNAPSHOT");
    const confirmed = await fetch(`${agent!.baseUrl}/api/plans/${encodeURIComponent(planned.plan.id)}/confirm`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ digest: planned.plan.digest }),
    });
    expect(confirmed.status).toBe(200);
    expect(AnalyticsPortfolioReportRequestPlanResponseSchema.parse(await confirmed.json()).plan.state).toBe("succeeded");

    const callsAfterSuccess = (await readFile(agent!.providerCallLog!, "utf8")).trim().split("\n").filter(Boolean);
    expect(callsAfterSuccess.filter((call) => call.endsWith("POST ONE_TIME_SNAPSHOT"))).toEqual([
      "READ123456 POST ONE_TIME_SNAPSHOT",
      "ADMIN12345 POST ONE_TIME_SNAPSHOT",
    ]);
    const connections = await fetch(`${agent!.baseUrl}/api/connections/app-store-connect`, {
      headers: authorization(guiToken),
    });
    expect(connections.status).toBe(200);
    expect(await connections.json()).toMatchObject({
      accounts: expect.arrayContaining([
        expect.objectContaining({ id: activeReadConnectionId, profileName: "Read-capable active", active: true }),
        expect.objectContaining({ profileName: "Admin fallback", active: false }),
      ]),
    });
    const activity = await fetch(`${agent!.baseUrl}/api/activity`, {
      headers: authorization(guiToken),
    });
    expect(activity.status).toBe(200);
    const activityBody = await activity.json() as {
      events: Array<{ operation: string; phase: string; summary: string }>;
    };
    const succeeded = activityBody.events.find((event) => (
      event.operation === "analytics.report_request.create" && event.phase === "succeeded"
    ));
    expect(succeeded?.summary).toContain("Admin fallback");
    expect(succeeded?.summary).not.toContain("Read-capable active");

    const duplicateConfirm = await fetch(`${agent!.baseUrl}/api/plans/${encodeURIComponent(planned.plan.id)}/confirm`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ digest: planned.plan.digest }),
    });
    expect(duplicateConfirm.status).toBe(409);
    expect((await readFile(agent!.providerCallLog!, "utf8")).trim().split("\n").filter(Boolean)).toEqual(callsAfterSuccess);
  });

  it("does not try the Admin key after an untyped upstream write failure", async () => {
    const planned = await createPlan("ONGOING");
    const confirmed = await fetch(`${agent!.baseUrl}/api/plans/${encodeURIComponent(planned.plan.id)}/confirm`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ digest: planned.plan.digest }),
    });
    expect(confirmed.status).toBe(502);
    const calls = (await readFile(agent!.providerCallLog!, "utf8")).trim().split("\n").filter(Boolean);
    expect(calls.filter((call) => call.endsWith("POST ONGOING"))).toEqual([
      "READ123456 POST ONGOING",
    ]);
  });
});

describe("local-agent pending plan pagination", () => {
  let agent: RunningAgent | undefined;
  const legacyPlanId = "older-visible-v1-plan";
  const expiredPlanId = "expired-hidden-v2-plan";

  beforeAll(async () => {
    agent = await startAgent({
      mode: "demo",
      prepareDataDirectory: async (dataDirectory) => {
        const path = join(dataDirectory, "demo.sqlite");
        const store = new SqlitePlanStore(path);
        const legacyPlan: MutationPlan = {
          id: legacyPlanId,
          operation: "build.add_to_group",
          risk: "mutation",
          state: "awaiting_confirmation",
          createdAt: "2026-08-01T10:00:00.000Z",
          expiresAt: "2030-08-01T10:10:00.000Z",
          digest: "a".repeat(64),
          summary: "Add the older build to the QA group.",
          context: {
            profile: "Demo workspace",
            connectionId: "demo",
            appleAdsAdAccountId: null,
            appleAdsMode: null,
          },
          target: {
            appId: "demo-app-orbit-notes",
            buildId: "demo-build-older",
            buildLabel: "1.0 (1)",
            groupId: "demo-group-qa",
            groupName: "QA",
          },
          before: { groupIds: [] },
          after: { groupIds: ["demo-group-qa"] },
          error: null,
        };
        await store.savePlan(legacyPlan);
        for (let index = 0; index < 60; index += 1) {
          const portfolioPlan: MutationPlan = {
            id: `newer-hidden-v2-plan-${index}`,
            operation: "analytics.report_request.create",
            risk: "mutation",
            state: "awaiting_confirmation",
            createdAt: `2026-08-30T19:${String(index).padStart(2, "0")}:00.000Z`,
            expiresAt: "2030-08-30T20:00:00.000Z",
            digest: index.toString(16).padStart(64, "0"),
            summary: `Create portfolio Analytics request ${index}.`,
            context: {
              profile: "Demo workspace",
              connectionId: "demo",
              appleAdsAdAccountId: null,
              appleAdsMode: null,
            },
            target: {
              appId: "demo-app-orbit-notes",
              appName: "Orbit Notes",
              accessType: "ONE_TIME_SNAPSHOT",
            },
            before: {
              matchingReportRequestIds: [`raw-pending-request-${index}`],
              activeOngoingReportRequestIds: [],
            },
            after: { appId: "demo-app-orbit-notes", accessType: "ONE_TIME_SNAPSHOT" },
            error: null,
          };
          await store.savePortfolioAnalyticsPlan(portfolioPlan, "demo-issuer");
        }
        await store.savePortfolioAnalyticsPlan({
          id: expiredPlanId,
          operation: "analytics.report_request.create",
          risk: "mutation",
          state: "awaiting_confirmation",
          createdAt: "2026-08-01T20:01:00.000Z",
          expiresAt: "2026-08-01T20:02:00.000Z",
          digest: "f".repeat(64),
          summary: "This expired portfolio plan must never reopen.",
          context: {
            profile: "Demo workspace",
            connectionId: "demo",
            appleAdsAdAccountId: null,
            appleAdsMode: null,
          },
          target: {
            appId: "demo-app-orbit-notes",
            appName: "Orbit Notes",
            accessType: "ONE_TIME_SNAPSHOT",
          },
          before: {
            matchingReportRequestIds: ["raw-expired-request"],
            activeOngoingReportRequestIds: [],
          },
          after: { appId: "demo-app-orbit-notes", accessType: "ONE_TIME_SNAPSHOT" },
          error: null,
        }, "demo-issuer");
        store.close();
        const ordering = new DatabaseSync(path);
        ordering.prepare("UPDATE mutation_plans SET updated_at = ? WHERE id = ?")
          .run("2026-08-01T10:00:00.000Z", legacyPlanId);
        ordering.prepare("UPDATE mutation_plans SET updated_at = ? WHERE id LIKE 'newer-hidden-v2-plan-%'")
          .run("2026-08-30T20:00:00.000Z");
        ordering.prepare("UPDATE mutation_plans SET updated_at = ? WHERE id = ?")
          .run("2026-08-30T20:01:00.000Z", expiredPlanId);
        ordering.close();
      },
    });
  });
  afterAll(async () => { await stopAgent(agent); });

  it("does not let more than 50 hidden V2 plans consume the V1 pending-plan limit", async () => {
    const [response, portfolioResponse] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/plans`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/analytics/portfolio/plans`, { headers: authorization(guiToken) }),
    ]);
    expect(response.status).toBe(200);
    const body = await response.json() as { plans: Array<{ id: string; operation: string }> };
    expect(body.plans).toEqual([
      expect.objectContaining({ id: legacyPlanId, operation: "build.add_to_group" }),
    ]);
    expect(body.plans.some((plan) => plan.id.startsWith("newer-hidden-v2-plan-"))).toBe(false);

    expect(portfolioResponse.status).toBe(200);
    const portfolioText = await portfolioResponse.text();
    const portfolio = AnalyticsPortfolioPendingPlansResponseSchema.parse(JSON.parse(portfolioText));
    expect(portfolio.plans).toHaveLength(50);
    expect(portfolio.plans.some((plan) => plan.id === expiredPlanId)).toBe(false);
    expect(portfolio.plans.every((plan) => (
      plan.operation === "analytics.report_request.create"
      && plan.after.schemaVersion === 2
      && plan.after.appId.startsWith("app_")
      && plan.target.sourceId.startsWith("source_")
      && plan.context.connectionId?.startsWith("account_") === true
      && plan.before.matchingReportRequestIds.every((requestId) => requestId.startsWith("report-request_"))
    ))).toBe(true);
    for (const rawIdentity of [
      "demo-issuer",
      "demo-app-orbit-notes",
      "raw-pending-request",
      '"connectionId":"demo"',
    ]) {
      expect(portfolioText).not.toContain(rawIdentity);
    }

    const persisted = new SqlitePlanStore(join(agent!.dataDirectory, "demo.sqlite"));
    expect(await persisted.getPlan(expiredPlanId)).toMatchObject({
      state: "expired",
      error: "The confirmation window expired.",
    });
    expect(persisted.getPortfolioAnalyticsPlanIssuer(expiredPlanId)).toBe("demo-issuer");
    persisted.close();

    const repeated = await fetch(`${agent!.baseUrl}/api/analytics/portfolio/plans`, {
      headers: authorization(guiToken),
    });
    expect(repeated.status).toBe(200);
    const repeatedText = await repeated.text();
    const repeatedBody = AnalyticsPortfolioPendingPlansResponseSchema.parse(JSON.parse(repeatedText));
    expect(repeatedBody.plans).toHaveLength(50);
    expect(repeatedBody.plans.some((plan) => plan.id === expiredPlanId)).toBe(false);
    expect(repeatedBody.plans.some((plan) => plan.id.startsWith("newer-hidden-v2-plan-"))).toBe(true);
    expect(repeatedText).not.toContain("raw-expired-request");

    const reopened = new SqlitePlanStore(join(agent!.dataDirectory, "demo.sqlite"));
    expect(await reopened.getPlan(expiredPlanId)).toMatchObject({
      state: "expired",
      error: "The confirmation window expired.",
    });
    reopened.close();
  });
});

describe("local-agent portfolio sync lock ordering", () => {
  let agent: RunningAgent | undefined;
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rawIssuerId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  beforeAll(async () => {
    agent = await startAgent({ mode: "live", mockAnalyticsPortfolioLease: true });
  });
  afterAll(async () => { await stopAgent(agent); });

  it("lets an account writer queue behind portfolio sync without nesting a request-wide read lease", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const connected = await fetch(`${agent!.baseUrl}/api/connections/app-store-connect`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        profileName: "Lease test",
        issuerId: rawIssuerId,
        keyId: "LEASE12345",
        privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
    });
    expect(connected.status).toBe(200);
    const connectedBody = await connected.json() as { accounts: Array<{ id: string }> };
    const rawConnectionId = connectedBody.accounts[0]!.id;

    const starting = fetch(`${agent!.baseUrl}/api/analytics/portfolio/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: 2,
        selection: { kind: "ALL_CONNECTED" },
        force: false,
      }),
    });
    let discoveryStarted = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const calls = await readFile(agent!.providerCallLog!, "utf8");
      if (calls.includes("GET /v1/apps?limit=200")) {
        discoveryStarted = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(discoveryStarted).toBe(true);

    let writerSettled = false;
    const activating = fetch(`${agent!.baseUrl}/api/connections/app-store-connect/${encodeURIComponent(rawConnectionId)}/activate`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    }).finally(() => { writerSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(writerSettled).toBe(false);

    await writeFile(join(agent!.dataDirectory, "portfolio-discovery-release"), "release", "utf8");
    const [startedResponse, activatedResponse] = await Promise.race([
      Promise.all([starting, activating]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Portfolio sync and queued account writer deadlocked.")), 5_000)),
    ]);
    expect(startedResponse.status).toBe(202);
    expect(activatedResponse.status).toBe(200);
    const startedText = await startedResponse.text();
    const started = AnalyticsPortfolioSyncResponseSchema.parse(JSON.parse(startedText));

    let completed = started;
    let completedText = startedText;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const poll = await fetch(`${agent!.baseUrl}/api/analytics/portfolio/sync/${encodeURIComponent(started.runId)}`, {
        headers: authorization(guiToken),
      });
      completedText = await poll.text();
      expect(poll.status).toBe(200);
      completed = AnalyticsPortfolioSyncResponseSchema.parse(JSON.parse(completedText));
      if (["SUCCEEDED", "PARTIAL", "FAILED"].includes(completed.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(completed).toMatchObject({
      state: "SUCCEEDED",
      freshness: expect.objectContaining({ partial: true }),
      error: null,
    });
    for (const body of [startedText, completedText]) {
      expect(body).not.toContain(rawIssuerId);
      expect(body).not.toContain(rawConnectionId);
      expect(body).not.toContain("1234567890");
      expect(body).not.toContain("raw-lease-request");
      expect(body).not.toContain('"issuerId"');
    }
  });
});

describe("local-agent OpenAI connection setup", () => {
  let localAgent: RunningAgent | undefined;
  let environmentAgent: RunningAgent | undefined;

  beforeAll(async () => {
    [localAgent, environmentAgent] = await Promise.all([
      startAgent({ mode: "live", mockOpenAiValidation: true }),
      startAgent({
        mode: "live",
        environment: {
          OPENAI_API_KEY: "sk-environment-secret",
          ASC_STUDIO_OPENAI_MODEL: "gpt-environment-model",
        },
      }),
    ]);
  });
  afterAll(async () => {
    await Promise.all([stopAgent(localAgent), stopAgent(environmentAgent)]);
  });

  it("keeps connection reads and mutations inside the GUI bearer boundary", async () => {
    const [missing, wrongScope, saveMissing, removeWrongScope] = await Promise.all([
      fetch(`${localAgent!.baseUrl}/api/connections/openai`),
      fetch(`${localAgent!.baseUrl}/api/connections/openai`, { headers: authorization(mcpToken) }),
      fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: "sk-not-saved" }),
      }),
      fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
        method: "DELETE",
        headers: authorization(mcpToken),
      }),
    ]);
    expect([missing.status, wrongScope.status, saveMissing.status, removeWrongScope.status]).toEqual([401, 401, 401, 401]);
    await expect(stat(join(localAgent!.dataDirectory, "credentials", "openai.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates before saving, supports replacement without restart, and never returns the key", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const credentialDirectory = join(localAgent!.dataDirectory, "credentials");
    const initialKey = "sk-initial-secret";
    const initial = await fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apiKey: initialKey, model: "gpt-local-model" }),
    });
    const initialText = await initial.text();
    expect(initial.status).toBe(200);
    expect(initialText).not.toContain(initialKey);
    expect(JSON.parse(initialText)).toEqual({
      connection: {
        configured: true,
        source: "local",
        model: "gpt-local-model",
        modelSource: "local",
      },
    });
    await expect(stat(credentialDirectory)).rejects.toMatchObject({ code: "ENOENT" });

    const translationStatus = await fetch(`${localAgent!.baseUrl}/api/translations/status`, {
      headers: authorization(guiToken),
    });
    expect(await translationStatus.json()).toMatchObject({
      provider: "openai",
      configured: true,
      model: "gpt-local-model",
    });

    const rejectedKey = "sk-rejected-replacement";
    const rejected = await fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apiKey: rejectedKey, model: "gpt-other-model" }),
    });
    const rejectedText = await rejected.text();
    expect(rejected.status).toBe(422);
    expect(rejectedText).not.toContain(rejectedKey);
    expect(JSON.parse(rejectedText)).toMatchObject({ error: { code: "openai_invalid_api_key" } });
    const afterRejectedReplacement = await fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
      headers: authorization(guiToken),
    });
    expect(await afterRejectedReplacement.json()).toMatchObject({
      connection: { configured: true, source: "local", model: "gpt-local-model", modelSource: "local" },
    });

    const replacementKey = "sk-final-secret";
    const replacement = await fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apiKey: replacementKey, model: "" }),
    });
    const replacementText = await replacement.text();
    expect(replacement.status).toBe(200);
    expect(replacementText).not.toContain(replacementKey);
    expect(JSON.parse(replacementText)).toMatchObject({
      connection: { configured: true, source: "local", model: "gpt-5.6-luna", modelSource: "default" },
    });
    await expect(stat(credentialDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    const databaseBody = (await readFile(join(localAgent!.dataDirectory, "live.sqlite"))).toString("utf8");
    expect(databaseBody).not.toContain(initialKey);
    expect(databaseBody).not.toContain(replacementKey);

    const removed = await fetch(`${localAgent!.baseUrl}/api/connections/openai`, {
      method: "DELETE",
      headers: authorization(guiToken),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      connection: { configured: false, source: null, modelSource: "default" },
    });
    await expect(stat(credentialDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("gives environment configuration precedence and makes GUI mutation unavailable", async () => {
    const status = await fetch(`${environmentAgent!.baseUrl}/api/connections/openai`, {
      headers: authorization(guiToken),
    });
    const statusText = await status.text();
    expect(status.status).toBe(200);
    expect(statusText).not.toContain("sk-environment-secret");
    expect(JSON.parse(statusText)).toEqual({
      connection: {
        configured: true,
        source: "environment",
        model: "gpt-environment-model",
        modelSource: "environment",
      },
    });

    const save = await fetch(`${environmentAgent!.baseUrl}/api/connections/openai`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-local-candidate", model: "gpt-local" }),
    });
    const remove = await fetch(`${environmentAgent!.baseUrl}/api/connections/openai`, {
      method: "DELETE",
      headers: authorization(guiToken),
    });
    expect(save.status).toBe(409);
    expect(await save.json()).toMatchObject({ error: { code: "environment_credentials_active" } });
    expect(remove.status).toBe(409);
    expect(await remove.json()).toMatchObject({ error: { code: "environment_credentials_active" } });
    await expect(stat(join(environmentAgent!.dataDirectory, "credentials", "openai.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("local-agent damaged credential recovery", () => {
  let agent: RunningAgent | undefined;

  beforeAll(async () => {
    agent = await startAgent({
      mode: "live",
      prepareDataDirectory: async (dataDirectory) => {
        const credentials = join(dataDirectory, "credentials");
        await mkdir(credentials, { mode: 0o700 });
        await writeFile(join(credentials, "app-store-connect.json"), "not-json", { mode: 0o600 });
      },
    });
  });
  afterAll(async () => { await stopAgent(agent); });

  it("keeps the agent reachable and removes a damaged Apple vault only after exact confirmation", async () => {
    const before = await fetch(`${agent!.baseUrl}/api/connections/app-store-connect`, {
      headers: authorization(guiToken),
    });
    expect(before.status).toBe(500);
    expect(await before.json()).toMatchObject({ error: { code: "credential_store_damaged" } });

    const reset = await fetch(`${agent!.baseUrl}/api/connections/app-store-connect/reset-vault`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "RESET APPLE CONNECTIONS" }),
    });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ status: { connected: false }, accounts: [] });
    await expect(stat(join(agent!.dataDirectory, "credentials"))).rejects.toMatchObject({ code: "ENOENT" });

    const after = await fetch(`${agent!.baseUrl}/api/connections/app-store-connect`, {
      headers: authorization(guiToken),
    });
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ accounts: [] });
  });
});

const screenshotPng = (width: number, height: number, colorType = 2) => {
  const body = Buffer.alloc(45);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(body, 0);
  body.writeUInt32BE(13, 8);
  body.write("IHDR", 12, "ascii");
  body.writeUInt32BE(width, 16);
  body.writeUInt32BE(height, 20);
  body[24] = 8;
  body[25] = colorType;
  body.writeUInt32BE(0, 33);
  body.write("IEND", 37, "ascii");
  return body;
};

describe("local-agent session boundary", () => {
  let agent: RunningAgent | undefined;

  beforeAll(async () => { agent = await startAgent(); });
  afterAll(async () => { await stopAgent(agent); });

  it("separates GUI and MCP bearer scopes", async () => {
    const [missing, wrongScope, gui, guiOnMcp] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/status`),
      fetch(`${agent!.baseUrl}/api/status`, { headers: authorization(mcpToken) }),
      fetch(`${agent!.baseUrl}/api/status`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/mcp`, {
        method: "POST",
        headers: mcpHeaders(guiToken),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    ]);

    expect(missing.status).toBe(401);
    expect(wrongScope.status).toBe(401);
    expect(gui.status).toBe(200);
    expect(await gui.json()).toMatchObject({ mode: "demo", connected: true });
    expect(guiOnMcp.status).toBe(401);
  });

  it("serves a limited first app page for fast shell rendering", async () => {
    const response = await fetch(`${agent!.baseUrl}/api/apps?limit=1&paginate=false`, {
      headers: authorization(guiToken),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apps: [expect.objectContaining({ id: "demo-app-orbit-notes" })],
    });
  });

  it("serves a seeded portfolio overview and an app drilldown without depending on sidebar selection", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const portfolioQuery = {
      schemaVersion: 1,
      scope: "PORTFOLIO",
      appIds: ["demo-app-orbit-notes", "demo-app-field-log"],
      startDate: "2026-07-22",
      endDate: "2026-08-20",
      compare: "PREVIOUS_PERIOD",
      granularity: "DAY",
      breakdowns: ["APP", "TERRITORY", "SOURCE"],
      filters: { territories: ["USA"], sources: [], productPages: [], versions: [] },
    };
    const [status, portfolio, app] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/analytics/status`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/analytics/overview`, {
        method: "POST",
        headers,
        body: JSON.stringify(portfolioQuery),
      }),
      fetch(`${agent!.baseUrl}/api/analytics/overview`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...portfolioQuery, scope: "APP", appIds: ["demo-app-orbit-notes"] }),
      }),
    ]);

    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      issuerId: "demo-issuer",
      state: "PARTIAL",
      freshness: { dataThrough: "2026-08-17", partial: true },
    });
    expect(portfolio.status).toBe(200);
    const portfolioBody = await portfolio.json() as {
      scope: string;
      kpis: Array<{ metric: string; current: { value: number | null } }>;
      appContributions: Array<{ appId: string; appName: string }>;
      privacy: { mayIncludePrivacyAdjustments: boolean };
      appliedFilters: { territories: string[] };
      facets: { territories: string[] };
      metricCoverage: Array<{ metric: string; source: string; completeThrough: string | null }>;
    };
    expect(portfolioBody.scope).toBe("PORTFOLIO");
    expect(portfolioBody.kpis.find((kpi) => kpi.metric === "DOWNLOADS")?.current.value).toBeGreaterThan(0);
    expect(portfolioBody.appContributions).toEqual(expect.arrayContaining([
      expect.objectContaining({ appId: "demo-app-orbit-notes", appName: "Orbit Notes" }),
      expect.objectContaining({ appId: "demo-app-field-log", appName: "Field Log" }),
    ]));
    expect(portfolioBody.privacy.mayIncludePrivacyAdjustments).toBe(false);
    expect(portfolioBody.appliedFilters.territories).toEqual(["USA"]);
    expect(portfolioBody.facets.territories).toEqual(expect.arrayContaining(["USA", "MEX", "GBR", "JPN"]));
    expect(portfolioBody.metricCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "IMPRESSIONS", source: "APP_STORE_CONNECT_ANALYTICS_REPORTS" }),
      expect.objectContaining({ metric: "FIRST_TIME_DOWNLOADS", source: "APP_STORE_CONNECT_ANALYTICS_REPORTS" }),
    ]));
    expect(app.status).toBe(200);
    expect(await app.json()).toMatchObject({ scope: "APP", appId: "demo-app-orbit-notes" });
  });

  it("serves, syncs, and plans against the opaque V2 portfolio without leaking Apple identities", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const catalogResponse = await fetch(`${agent!.baseUrl}/api/analytics/portfolio`, {
      headers: authorization(guiToken),
    });
    const catalogText = await catalogResponse.text();
    expect(catalogResponse.status).toBe(200);
    const catalog = AnalyticsPortfolioCatalogResponseSchema.parse(JSON.parse(catalogText));
    expect(catalog.sources).toHaveLength(1);
    expect(catalog.apps).toHaveLength(2);
    const selectedApp = catalog.apps.find((candidate) => candidate.name === "Field Log")!;

    const [statusResponse, overviewResponse] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/analytics/portfolio/status`, {
        headers: authorization(guiToken),
      }),
      fetch(`${agent!.baseUrl}/api/analytics/overview`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          schemaVersion: 2,
          scope: "PORTFOLIO",
          selection: { kind: "ALL_CONNECTED" },
          startDate: "2026-07-22",
          endDate: "2026-08-20",
          compare: "PREVIOUS_PERIOD",
          granularity: "DAY",
          breakdowns: ["APP", "TERRITORY"],
        }),
      }),
    ]);
    const statusText = await statusResponse.text();
    const overviewText = await overviewResponse.text();
    expect(statusResponse.status).toBe(200);
    expect(overviewResponse.status).toBe(200);
    const status = AnalyticsPortfolioStatusResponseSchema.parse(JSON.parse(statusText));
    const overview = AnalyticsOverviewResponseV2Schema.parse(JSON.parse(overviewText));
    expect(overview.scope).toBe("PORTFOLIO");
    expect(status.catalogRevision).toBe(catalog.catalogRevision);
    expect(overview.catalogRevision).toBe(catalog.catalogRevision);
    expect(status.sources.map((source) => source.sourceId).sort()).toEqual(
      catalog.sources.map((source) => source.id).sort(),
    );
    expect(overview.sourceCoverage.map((source) => source.sourceId).sort()).toEqual(
      catalog.sources.map((source) => source.id).sort(),
    );
    expect(overview.apps.map((candidate) => candidate.id)).toEqual(catalog.apps.map((candidate) => candidate.id));

    const plannedResponse = await fetch(`${agent!.baseUrl}/api/plans/analytics-report-request`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: 2,
        appId: selectedApp.id,
        accessType: "ONE_TIME_SNAPSHOT",
      }),
    });
    const plannedText = await plannedResponse.text();
    expect(plannedResponse.status).toBe(201);
    const planned = AnalyticsPortfolioReportRequestPlanResponseSchema.parse(JSON.parse(plannedText));
    const pendingResponse = await fetch(`${agent!.baseUrl}/api/plans`, {
      headers: authorization(guiToken),
    });
    const pendingText = await pendingResponse.text();
    expect(pendingResponse.status).toBe(200);
    const pending = JSON.parse(pendingText) as { plans: unknown[] };
    const pendingPlan = pending.plans.find((candidate) => (
      typeof candidate === "object" && candidate !== null && "id" in candidate
      && candidate.id === planned.plan.id
    ));
    // Analytics plans use their dedicated V2 response contract and are not
    // mixed into the generic pending-plan feed, whose union remains V1.
    expect(pendingPlan).toBeUndefined();

    const confirmedResponse = await fetch(`${agent!.baseUrl}/api/plans/${encodeURIComponent(planned.plan.id)}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: planned.plan.digest }),
    });
    const confirmedText = await confirmedResponse.text();
    expect(confirmedResponse.status).toBe(200);
    expect(AnalyticsPortfolioReportRequestPlanResponseSchema.parse(JSON.parse(confirmedText)).plan.state).toBe("succeeded");

    const startedResponse = await fetch(`${agent!.baseUrl}/api/analytics/portfolio/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: 2,
        selection: { kind: "ALL_CONNECTED" },
        force: false,
      }),
    });
    const startedText = await startedResponse.text();
    expect(startedResponse.status).toBe(202);
    const started = AnalyticsPortfolioSyncResponseSchema.parse(JSON.parse(startedText));
    let completedText = "";
    let completed = started;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const poll = await fetch(`${agent!.baseUrl}/api/analytics/portfolio/sync/${encodeURIComponent(started.runId)}`, {
        headers: authorization(guiToken),
      });
      completedText = await poll.text();
      expect(poll.status).toBe(200);
      completed = AnalyticsPortfolioSyncResponseSchema.parse(JSON.parse(completedText));
      if (["SUCCEEDED", "PARTIAL", "FAILED"].includes(completed.state)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(completed.state).toBe("SUCCEEDED");

    const childRunIds = completed.sources.flatMap((source) => source.runIds);
    expect(childRunIds.length).toBeGreaterThan(0);
    for (const runId of [completed.runId, ...childRunIds]) {
      for (const rawIdentity of [
        "demo-issuer",
        "demo-app-orbit-notes",
        "demo-app-field-log",
        "demo-analytics-request-1",
        "demo-analytics-request-2",
        "demo-analytics-request-3",
      ]) expect(runId).not.toContain(rawIdentity);
    }
    for (const childRunId of childRunIds) {
      const legacyBridge = await fetch(`${agent!.baseUrl}/api/analytics/sync/${encodeURIComponent(childRunId)}`, {
        headers: authorization(guiToken),
      });
      expect(legacyBridge.status).toBe(404);
      expect(await legacyBridge.json()).toMatchObject({ error: { code: "analytics_sync_not_found" } });
    }

    const publicBodies = [
      catalogText,
      statusText,
      overviewText,
      plannedText,
      pendingText,
      confirmedText,
      startedText,
      completedText,
    ];
    for (const body of publicBodies) {
      for (const rawIdentity of [
        "demo-issuer",
        "demo-app-orbit-notes",
        "demo-app-field-log",
        "demo-analytics-request-1",
        "demo-analytics-request-2",
        "demo-analytics-request-3",
      ]) expect(body).not.toContain(rawIdentity);
      expect(body).not.toContain('"connectionId":"demo"');
      expect(body).not.toContain('"issuerId"');
    }
  });

  it("validates portfolio membership and exposes background analytics sync as a pollable job", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const invalid = await fetch(`${agent!.baseUrl}/api/analytics/overview`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: 1,
        scope: "PORTFOLIO",
        appIds: ["another-account-app"],
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        compare: "NONE",
        granularity: "DAY",
        breakdowns: ["APP"],
      }),
    });
    expect(invalid.status).toBe(404);
    expect(await invalid.json()).toMatchObject({ error: { code: "analytics_app_not_found" } });

    const started = await fetch(`${agent!.baseUrl}/api/analytics/sync`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: 1,
        appIds: ["demo-app-orbit-notes", "demo-app-field-log"],
        force: false,
      }),
    });
    expect(started.status).toBe(202);
    const queued = await started.json() as { runId: string; state: string };
    expect(queued).toMatchObject({ runId: expect.any(String) });

    let completed: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const poll = await fetch(`${agent!.baseUrl}/api/analytics/sync/${encodeURIComponent(queued.runId)}`, {
        headers: authorization(guiToken),
      });
      expect(poll.status).toBe(200);
      completed = await poll.json() as Record<string, unknown>;
      if (["SUCCEEDED", "PARTIAL", "FAILED"].includes(String(completed.state))) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(completed).toMatchObject({
      issuerId: "demo-issuer",
      runId: queued.runId,
      state: "SUCCEEDED",
      batchCount: 8,
    });
  });

  it("rejects duplicate analytics filter values at the API boundary", async () => {
    const response = await fetch(`${agent!.baseUrl}/api/analytics/overview`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        scope: "PORTFOLIO",
        appIds: ["demo-app-orbit-notes"],
        startDate: "2026-08-01",
        endDate: "2026-08-20",
        compare: "NONE",
        granularity: "DAY",
        breakdowns: ["TERRITORY"],
        filters: { territories: ["USA", "USA"], sources: [], productPages: [], versions: [] },
      }),
    });
    expect(response.status).toBe(400);
  });

  it("keeps analytics report-request creation behind plan review and exact confirmation", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const planned = await fetch(`${agent!.baseUrl}/api/plans/analytics-report-request`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-field-log",
        accessType: "ONE_TIME_SNAPSHOT",
      }),
    });
    expect(planned.status).toBe(201);
    const body = await planned.json() as { plan: { id: string; digest: string } };
    const pendingResponse = await fetch(`${agent!.baseUrl}/api/plans`, {
      headers: authorization(guiToken),
    });
    expect(pendingResponse.status).toBe(200);
    const pending = await pendingResponse.json() as {
      plans: Array<{ id: string; operation: string; after?: unknown }>;
    };
    expect(pending.plans).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: body.plan.id,
        operation: "analytics.report_request.create",
        after: { appId: "demo-app-field-log", accessType: "ONE_TIME_SNAPSHOT" },
      }),
    ]));
    const confirmed = await fetch(`${agent!.baseUrl}/api/plans/${body.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: body.plan.digest }),
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      plan: { operation: "analytics.report_request.create", state: "succeeded" },
    });
  });

  it("initializes MCP, lists read-only tools, and calls a tool", async () => {
    const initialize = await fetch(`${agent!.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(mcpToken),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0.1" } },
      }),
    });
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toMatchObject({ result: { serverInfo: { name: "asc-studio" } } });

    const tools = await fetch(`${agent!.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(mcpToken),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const toolsBody = await tools.json() as { result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> } };
    expect(tools.status).toBe(200);
    expect(toolsBody.result.tools.map((tool) => tool.name)).toEqual([
      "get_asc_status",
      "get_apple_ads_status",
      "research_apple_ads_keywords",
      "list_apple_ads_campaigns",
      "list_apple_ads_ad_groups",
      "list_apple_ads_keywords",
      "get_apple_ads_campaign_report",
      "plan_apple_ads_campaign_create",
      "plan_apple_ads_campaign_update",
      "plan_apple_ads_ad_group_create",
      "plan_apple_ads_keyword_create",
      "plan_apple_ads_keyword_update",
      "list_apps",
      "list_testflight_builds",
      "list_app_store_versions",
      "list_version_localizations",
      "list_version_screenshots",
      "get_version_submission_status",
    ]);
    expect(toolsBody.result.tools.filter((tool) => tool.name.startsWith("plan_apple_ads_")).every((tool) => tool.annotations?.readOnlyHint === false)).toBe(true);
    expect(toolsBody.result.tools.filter((tool) => !tool.name.startsWith("plan_apple_ads_")).every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const call = await fetch(`${agent!.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(mcpToken),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_asc_status", arguments: {} } }),
    });
    expect(call.status).toBe(200);
    expect(await call.json()).toMatchObject({ result: { structuredContent: { mode: "demo", connected: true } } });
  });

  it("serves demo Apple Ads keyword research, campaign hierarchy, and reports", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const [statusResponse, campaignsResponse, researchResponse] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/apple-ads/status`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/apple-ads/campaigns?appId=demo-app-orbit-notes`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/apple-ads/keywords/research`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          appId: "demo-app-orbit-notes",
          countryOrRegion: "US",
          genre: "PRODUCTIVITY_UTILITIES",
          start: "2026-08-09",
          end: "2026-08-15",
          granularity: "WEEKLY_SUN_SAT",
          seedTerms: ["writing"],
          limit: 10,
        }),
      }),
    ]);

    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ provider: "demo", connected: true, adAccountId: "demo-ads-account" });
    expect(campaignsResponse.status).toBe(200);
    expect(await campaignsResponse.json()).toMatchObject({ campaigns: expect.arrayContaining([
      expect.objectContaining({ id: "demo-ads-campaign-brand", promotedObjectId: "demo-app-orbit-notes" }),
      expect.objectContaining({ id: "demo-ads-campaign-discovery", promotedObjectId: "demo-app-orbit-notes" }),
    ]) });
    expect(researchResponse.status).toBe(200);
    expect(await researchResponse.json()).toMatchObject({ research: {
      countryOrRegion: "US",
      genre: "PRODUCTIVITY_UTILITIES",
      keywords: expect.arrayContaining([expect.objectContaining({ text: "notes app", source: "both" })]),
    } });

    const [adGroupsResponse, keywordsResponse, reportResponse] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/apple-ads/campaigns/demo-ads-campaign-brand/adgroups`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/apple-ads/campaigns/demo-ads-campaign-brand/keywords`, { headers: authorization(guiToken) }),
      fetch(`${agent!.baseUrl}/api/apple-ads/campaign-report`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          campaignId: "demo-ads-campaign-brand",
          start: "2026-08-01",
          end: "2026-08-15",
          timeZone: "ORTZ",
        }),
      }),
    ]);
    expect(await adGroupsResponse.json()).toMatchObject({ adGroups: [expect.objectContaining({ id: "demo-ads-group-brand-exact" })] });
    expect(await keywordsResponse.json()).toMatchObject({ keywords: expect.arrayContaining([expect.objectContaining({ text: "orbit notes" })]) });
    expect(await reportResponse.json()).toMatchObject({ report: { campaignId: "demo-ads-campaign-brand", impressions: 48_320 } });
  });

  it("reviews and confirms a paused Apple Ads campaign, ad group, and keyword", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const createPlanResponse = await fetch(`${agent!.baseUrl}/api/plans/apple-ads/campaign-create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        promotedObjectId: "demo-app-orbit-notes",
        name: "Orbit Notes · Growth Test",
        dailyBudget: { amount: "20.00", currency: "USD" },
        countriesOrRegions: ["US"],
      }),
    });
    const createPlanBody = await createPlanResponse.json() as { plan: { id: string; digest: string } };
    expect(createPlanResponse.status).toBe(201);
    const pendingResponse = await fetch(`${agent!.baseUrl}/api/plans`, { headers: authorization(guiToken) });
    expect(await pendingResponse.json()).toMatchObject({ plans: [expect.objectContaining({ id: createPlanBody.plan.id, operation: "apple_ads.campaign.create" })] });

    const campaignConfirm = await fetch(`${agent!.baseUrl}/api/plans/${createPlanBody.plan.id}/confirm`, {
      method: "POST", headers, body: JSON.stringify({ digest: createPlanBody.plan.digest }),
    });
    expect(campaignConfirm.status).toBe(200);
    const campaignsResponse = await fetch(`${agent!.baseUrl}/api/apple-ads/campaigns?appId=demo-app-orbit-notes`, { headers: authorization(guiToken) });
    const campaignsBody = await campaignsResponse.json() as { campaigns: Array<{ id: string; name: string; status: string }> };
    const campaign = campaignsBody.campaigns.find((candidate) => candidate.name === "Orbit Notes · Growth Test")!;
    expect(campaign).toMatchObject({ status: "PAUSED" });

    const groupPlanResponse = await fetch(`${agent!.baseUrl}/api/plans/apple-ads/ad-group-create`, {
      method: "POST", headers, body: JSON.stringify({ campaignId: campaign.id, name: "Category exact", bid: { amount: "1.25", currency: "USD" } }),
    });
    const groupPlan = await groupPlanResponse.json() as { plan: { id: string; digest: string } };
    await fetch(`${agent!.baseUrl}/api/plans/${groupPlan.plan.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ digest: groupPlan.plan.digest }) });
    const groupsResponse = await fetch(`${agent!.baseUrl}/api/apple-ads/campaigns/${campaign.id}/adgroups`, { headers: authorization(guiToken) });
    const groupsBody = await groupsResponse.json() as { adGroups: Array<{ id: string; name: string; status: string }> };
    expect(groupsBody.adGroups[0]).toMatchObject({ name: "Category exact", status: "PAUSED" });

    const keywordPlanResponse = await fetch(`${agent!.baseUrl}/api/plans/apple-ads/keyword-create`, {
      method: "POST", headers, body: JSON.stringify({ campaignId: campaign.id, adGroupId: groupsBody.adGroups[0]!.id, text: "task manager", matchType: "EXACT", bid: { amount: "1.10", currency: "USD" } }),
    });
    const keywordPlan = await keywordPlanResponse.json() as { plan: { id: string; digest: string } };
    await fetch(`${agent!.baseUrl}/api/plans/${keywordPlan.plan.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ digest: keywordPlan.plan.digest }) });
    const keywordsResponse = await fetch(`${agent!.baseUrl}/api/apple-ads/campaigns/${campaign.id}/keywords`, { headers: authorization(guiToken) });
    expect(await keywordsResponse.json()).toMatchObject({ keywords: [expect.objectContaining({ text: "task manager", status: "PAUSED" })] });
  });

  it("generates only the requested release-copy fields in demo mode", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const statusResponse = await fetch(`${agent!.baseUrl}/api/translations/status`, {
      headers: authorization(guiToken),
    });
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({ provider: "demo", configured: true });

    const response = await fetch(`${agent!.baseUrl}/api/translations/release-copy`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sourceLocale: "en-US",
        targetLocales: ["de-DE", "fr-FR"],
        fields: ["whatsNew"],
        source: {
          whatsNew: "A faster editor and more reliable sync.",
        },
      }),
    });
    const body = await response.json() as { translations: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(body.translations).toHaveLength(2);
    expect(body.translations[0]).toHaveProperty("whatsNew");
    expect(body.translations[0]).not.toHaveProperty("promotionalText");
    expect(body.translations[0]).not.toHaveProperty("keywords");
  });

  it("keeps OpenAI storage and provider calls disabled in demo mode", async () => {
    const status = await fetch(`${agent!.baseUrl}/api/connections/openai`, {
      headers: authorization(guiToken),
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({
      connection: {
        configured: true,
        source: "demo",
        model: null,
        modelSource: "demo",
      },
    });

    const save = await fetch(`${agent!.baseUrl}/api/connections/openai`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-must-not-be-stored", model: "gpt-live" }),
    });
    const remove = await fetch(`${agent!.baseUrl}/api/connections/openai`, {
      method: "DELETE",
      headers: authorization(guiToken),
    });
    expect(save.status).toBe(409);
    expect(await save.json()).toMatchObject({ error: { code: "demo_connection" } });
    expect(remove.status).toBe(409);
    expect(await remove.json()).toMatchObject({ error: { code: "demo_connection" } });
    await expect(stat(join(agent!.dataDirectory, "credentials", "openai.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects duplicate translation targets", async () => {
    const response = await fetch(`${agent!.baseUrl}/api/translations/release-copy`, {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: JSON.stringify({
        sourceLocale: "en-US",
        targetLocales: ["fr-FR", "fr-FR"],
        fields: ["whatsNew"],
        source: { whatsNew: "A faster editor." },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_input" } });
  });

  it("reviews and schedules guarded subscription parity prices through the GUI API", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 7);
    const startDate = start.toISOString().slice(0, 10);
    const subscriptionsResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/subscriptions`,
      { headers: authorization(guiToken) },
    );
    const subscriptions = await subscriptionsResponse.json() as { subscriptions: Array<{ id: string; period: string }> };
    expect(subscriptionsResponse.status).toBe(200);
    expect(subscriptions.subscriptions).toContainEqual(expect.objectContaining({
      id: "demo-subscription-orbit-pro-yearly",
      period: "ONE_YEAR",
    }));

    const pricesResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/subscriptions/demo-subscription-orbit-pro-yearly/prices?planType=UPFRONT`,
      { headers: authorization(guiToken) },
    );
    const prices = await pricesResponse.json() as { prices: Array<{ territory: string; customerPrice: string }> };
    expect(pricesResponse.status).toBe(200);
    expect(prices.prices).toContainEqual(expect.objectContaining({ territory: "USA", customerPrice: "119.99" }));

    const planResponse = await fetch(`${agent!.baseUrl}/api/plans/subscription-prices`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-orbit-notes",
        subscriptionId: "demo-subscription-orbit-pro-yearly",
        planType: "UPFRONT",
        baseTerritory: "USA",
        floorPercent: 70,
        strengthPercent: 50,
        startDate,
      }),
    });
    const planBody = await planResponse.json() as {
      plan: { id: string; digest: string; operation: string; after: { summary: { changes: number; floorProtected: number } } };
    };
    expect(planResponse.status).toBe(201);
    expect(planBody.plan).toMatchObject({
      operation: "subscription.prices.update",
      after: { summary: { floorProtected: expect.any(Number), changes: expect.any(Number) } },
    });
    expect(planBody.plan.after.summary.changes).toBeGreaterThan(0);
    expect(planBody.plan.after.summary.floorProtected).toBeGreaterThan(0);

    const confirmResponse = await fetch(`${agent!.baseUrl}/api/plans/${planBody.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: planBody.plan.digest }),
    });
    expect(confirmResponse.status).toBe(200);
    expect(await confirmResponse.json()).toMatchObject({
      plan: { operation: "subscription.prices.update", state: "succeeded" },
    });

    const scheduledResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/subscriptions/demo-subscription-orbit-pro-yearly/prices?planType=UPFRONT`,
      { headers: authorization(guiToken) },
    );
    const scheduled = await scheduledResponse.json() as { prices: Array<{ startDate: string | null }> };
    expect(scheduled.prices.filter((price) => price.startDate === startDate)).toHaveLength(planBody.plan.after.summary.changes);
  });

  it("plans, confirms, reads, and validates release metadata through the GUI API", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const versionsResponse = await fetch(`${agent!.baseUrl}/api/apps/demo-app-orbit-notes/versions?platform=IOS`, {
      headers: authorization(guiToken),
    });
    const versionsBody = await versionsResponse.json() as { versions: Array<{ id: string; versionString: string }> };
    expect(versionsResponse.status).toBe(200);
    expect(versionsBody.versions[0]).toMatchObject({ id: "demo-version-250", versionString: "2.5.0" });

    const buildsResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/builds?version=2.5.0&platform=IOS&includeGroups=false`,
      { headers: authorization(guiToken) },
    );
    expect(buildsResponse.status).toBe(200);
    expect(await buildsResponse.json()).toEqual({
      builds: [expect.objectContaining({ id: "demo-build-211", version: "2.5.0", platform: "IOS", groups: [] })],
    });

    const macVersionsResponse = await fetch(`${agent!.baseUrl}/api/apps/demo-app-orbit-notes/versions?platform=MAC_OS`, {
      headers: authorization(guiToken),
    });
    expect(macVersionsResponse.status).toBe(200);
    expect(await macVersionsResponse.json()).toMatchObject({
      versions: expect.arrayContaining([
        expect.objectContaining({ id: "demo-mac-version-310", versionString: "3.1.0", platform: "MAC_OS" }),
      ]),
    });

    const macBuildsResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/builds?version=3.1.0&platform=MAC_OS&includeGroups=false`,
      { headers: authorization(guiToken) },
    );
    expect(macBuildsResponse.status).toBe(200);
    expect(await macBuildsResponse.json()).toEqual({
      builds: [expect.objectContaining({ id: "demo-mac-build-44", version: "3.1.0", platform: "MAC_OS", groups: [] })],
    });

    const macVersionPlanResponse = await fetch(`${agent!.baseUrl}/api/plans/version`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-orbit-notes",
        versionString: "3.2.0",
        platform: "MAC_OS",
        copyMetadataFrom: "3.1.0",
        releaseType: "MANUAL",
        excludeWhatsNew: true,
      }),
    });
    expect(macVersionPlanResponse.status).toBe(201);
    expect(await macVersionPlanResponse.json()).toMatchObject({
      plan: { operation: "version.create", target: { platform: "MAC_OS", versionString: "3.2.0" } },
    });

    const localizationsResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/versions/demo-version-250/localizations`,
      { headers: authorization(guiToken) },
    );
    expect(localizationsResponse.status).toBe(200);
    expect(await localizationsResponse.json()).toMatchObject({ localizations: expect.arrayContaining([
      expect.objectContaining({ locale: "en-US" }),
      expect.objectContaining({ locale: "fr-FR" }),
    ]) });

    const planResponse = await fetch(`${agent!.baseUrl}/api/plans/localizations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-orbit-notes",
        versionId: "demo-version-250",
        localizations: [{
          locale: "en-US",
          description: "Capture and organize every idea in one private workspace.",
          whatsNew: "A faster editor, better search, and more reliable sync.",
          promotionalText: "Capture ideas faster and keep every note close.",
          keywords: "notes,writing,ideas,tasks,organizer,journal,productivity",
          marketingUrl: "https://example.com/orbit-notes",
          supportUrl: "https://example.com/orbit-notes/support",
          fields: ["description", "whatsNew", "promotionalText", "keywords", "marketingUrl", "supportUrl"],
        }],
      }),
    });
    const planBody = await planResponse.json() as { plan: { id: string; digest: string; operation: string } };
    expect(planResponse.status).toBe(201);
    expect(planBody.plan.operation).toBe("version.update_localizations");

    const confirmResponse = await fetch(`${agent!.baseUrl}/api/plans/${planBody.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: planBody.plan.digest }),
    });
    expect(confirmResponse.status).toBe(200);
    expect(await confirmResponse.json()).toMatchObject({ plan: { state: "succeeded" } });

    const validateResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/versions/demo-version-250/validate`,
      { method: "POST", headers: authorization(guiToken) },
    );
    expect(validateResponse.status).toBe(200);
    expect(await validateResponse.json()).toMatchObject({ report: { versionId: "demo-version-250", summary: { warnings: 1 } } });
  });

  it("reads and applies shared search metadata through the reviewed GUI API", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const path = "/api/apps/demo-app-orbit-notes/versions/demo-version-250/search-metadata?locale=fr-FR";
    const response = await fetch(`${agent!.baseUrl}${path}`, { headers });
    expect(response.status).toBe(200);
    const { metadata } = await response.json() as { metadata: SearchMetadata };
    const values = { name: "Orbit : Notes et idées", subtitle: "Organisez votre quotidien", keywords: "journal,écriture,tâches" };
    const planned = await fetch(`${agent!.baseUrl}/api/plans/search-metadata`, { method: "POST", headers, body: JSON.stringify({ appId: metadata.appId, versionId: metadata.versionId, locale: metadata.locale, expected: metadata, values }) });
    expect(planned.status).toBe(201);
    const { plan } = await planned.json() as { plan: MutationPlan };
    expect(plan.operation).toBe("app.search_metadata.update");
    const confirmed = await fetch(`${agent!.baseUrl}/api/plans/${plan.id}/confirm`, { method: "POST", headers, body: JSON.stringify({ digest: plan.digest }) });
    expect(confirmed.status).toBe(200);
    const saved = await fetch(`${agent!.baseUrl}${path}`, { headers });
    expect(await saved.json()).toMatchObject({ metadata: { values } });
    const stale = await fetch(`${agent!.baseUrl}/api/plans/search-metadata`, { method: "POST", headers, body: JSON.stringify({ appId: metadata.appId, versionId: metadata.versionId, locale: metadata.locale, expected: metadata, values }) });
    expect(stale.status).toBeGreaterThanOrEqual(400);
  });

  it("reviews and applies 13 locale drafts larger than the default request limit", async () => {
    const bulkAgent = await startAgent();
    try {
      const headers = { ...authorization(guiToken), "content-type": "application/json" };
      const localizations = AppStoreLocaleSchema.options.slice(0, 13).map((locale) => ({
        locale,
        description: "Localized description. ".repeat(170),
        whatsNew: "検索と同期を改善しました。".repeat(100),
        promotionalText: "New ways to organize your notes.",
        keywords: "notes,writing,ideas",
        marketingUrl: "https://example.com/notes",
        supportUrl: "https://example.com/support",
        fields: ["description", "whatsNew", "promotionalText", "keywords", "marketingUrl", "supportUrl"],
      }));
      const body = JSON.stringify({ appId: "demo-app-orbit-notes", versionId: "demo-version-250", localizations });
      expect(Buffer.byteLength(body)).toBeGreaterThan(64 * 1024);
      const response = await fetch(`${bulkAgent.baseUrl}/api/plans/localizations`, { method: "POST", headers, body });
      const responseBody = await response.json();
      expect(response.status, JSON.stringify(responseBody)).toBe(201);
      const { plan } = PlanResponseSchema.parse(responseBody);
      expect(plan).toMatchObject({ target: { locales: localizations.map((item) => item.locale).sort() } });
      const confirmed = await fetch(`${bulkAgent.baseUrl}/api/plans/${plan.id}/confirm`, {
        method: "POST", headers, body: JSON.stringify({ digest: plan.digest }),
      });
      expect(confirmed.status).toBe(200);
      const saved = await fetch(`${bulkAgent.baseUrl}/api/apps/demo-app-orbit-notes/versions/demo-version-250/localizations`, { headers });
      expect(await saved.json()).toMatchObject({
        localizations: expect.arrayContaining(localizations.map(({ fields: _fields, ...values }) => expect.objectContaining(values))),
      });
    } finally { await stopAgent(bulkAgent); }
  });

  it("accepts a full set of maximum-length locale drafts without Content-Length", async () => {
    const input = JSON.stringify({
      appId: "demo-app-orbit-notes",
      versionId: "demo-version-250",
      localizations: AppStoreLocaleSchema.options.map((locale) => ({
        locale,
        description: "\\".repeat(4_000),
        whatsNew: "検索".repeat(2_000),
        promotionalText: "新".repeat(170),
        keywords: "語".repeat(100),
        marketingUrl: `https://example.com/${"a".repeat(3_980)}`,
        supportUrl: `https://example.com/${"b".repeat(3_980)}`,
        fields: ["description", "whatsNew", "promotionalText", "keywords", "marketingUrl", "supportUrl"],
      })),
    });
    const bytes = new TextEncoder().encode(input);
    expect(bytes.byteLength).toBeGreaterThan(1_000_000);
    const options: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { ...authorization(guiToken), "content-type": "application/json" },
      body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
      duplex: "half",
    };
    const response = await fetch(`${agent!.baseUrl}/api/plans/localizations`, options);
    expect(response.status).toBe(201);
    const { plan } = PlanResponseSchema.parse(await response.json());
    expect(plan).toMatchObject({ target: { locales: expect.arrayContaining(AppStoreLocaleSchema.options) } });
  });

  it("bounds bulk localization bodies without increasing other API request limits", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    for (const [path, size] of [["/api/plans/localizations", 4 * 1024 * 1024], ["/api/plans/version", 64 * 1024]] as const) {
      // Send the oversized declaration alone: the server must reject it before
      // reading the body, without depending on a client's upload/socket timing.
      const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
        const request = httpRequest(`${agent!.baseUrl}${path}`, {
          method: "POST", headers: { ...headers, "content-length": size + 1 },
        }, (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk: string) => { body += chunk; });
          incoming.on("end", () => resolve({ status: incoming.statusCode, body }));
          incoming.on("error", reject);
        });
        request.on("error", reject);
        request.end();
      });
      expect(response.status).toBe(413);
      expect(JSON.parse(response.body)).toMatchObject({ error: { code: "body_too_large" } });
    }
    const unauthenticated = await fetch(`${agent!.baseUrl}/api/plans/localizations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(unauthenticated.status).toBe(401);
  });

  it("stages, reviews, and replaces a macOS screenshot set through the GUI API", async () => {
    const staged = await fetch(
      `${agent!.baseUrl}/api/uploads/screenshots?displayType=APP_DESKTOP&fileName=01-new-editor.png`,
      {
        method: "POST",
        headers: { ...authorization(guiToken), "content-type": "image/png" },
        body: screenshotPng(2880, 1800),
      },
    );
    const stagedBody = await staged.json() as { upload: { uploadId: string; fileName: string } };
    expect(staged.status).toBe(201);
    expect(stagedBody.upload).toMatchObject({
      fileName: "01-new-editor.png",
      displayType: "APP_DESKTOP",
      width: 2880,
      height: 1800,
      hasAlpha: false,
    });

    const before = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/versions/demo-mac-version-310/screenshots?localizationId=demo-mac-version-310-en-US&displayType=APP_DESKTOP`,
      { headers: authorization(guiToken) },
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ screenshots: expect.arrayContaining([
      expect.objectContaining({ id: "demo-mac-shot-1", fileName: "01-editor.png" }),
    ]) });

    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const planned = await fetch(`${agent!.baseUrl}/api/plans/screenshots`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-orbit-notes",
        versionId: "demo-mac-version-310",
        localizationId: "demo-mac-version-310-en-US",
        locale: "en-US",
        displayType: "APP_DESKTOP",
        strategy: "replace",
        uploads: [stagedBody.upload],
        deleteIds: [],
      }),
    });
    const planBody = await planned.json() as { plan: { id: string; digest: string; after: { deleteIds: string[] } } };
    expect(planned.status).toBe(201);
    expect(planBody.plan.after.deleteIds).toHaveLength(3);

    const confirmed = await fetch(`${agent!.baseUrl}/api/plans/${planBody.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: planBody.plan.digest }),
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      plan: { operation: "version.update_screenshots", state: "succeeded" },
    });

    const after = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/versions/demo-mac-version-310/screenshots?localizationId=demo-mac-version-310-en-US&displayType=APP_DESKTOP`,
      { headers: authorization(guiToken) },
    );
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ screenshots: [
      expect.objectContaining({ fileName: "01-new-editor.png", width: 2880, height: 1800 }),
    ] });
  });

  it("rejects screenshots with transparency before staging", async () => {
    const response = await fetch(
      `${agent!.baseUrl}/api/uploads/screenshots?displayType=APP_DESKTOP&fileName=transparent.png`,
      {
        method: "POST",
        headers: { ...authorization(guiToken), "content-type": "image/png" },
        body: screenshotPng(2880, 1800, 6),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "screenshot_has_alpha", message: "App Store screenshots cannot contain transparency." },
    });
  });

  it("reviews, confirms, and reads an App Review submission through the GUI API", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const planResponse = await fetch(`${agent!.baseUrl}/api/plans/submission`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-field-log",
        versionId: "demo-field-version-180",
        buildId: "demo-field-build-88",
      }),
    });
    const planBody = await planResponse.json() as { plan: { id: string; digest: string; operation: string; after: { attachBuild: boolean } } };
    expect(planResponse.status).toBe(201);
    expect(planBody.plan).toMatchObject({ operation: "version.submit", after: { attachBuild: true } });

    const confirmResponse = await fetch(`${agent!.baseUrl}/api/plans/${planBody.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: planBody.plan.digest }),
    });
    expect(confirmResponse.status).toBe(200);
    expect(await confirmResponse.json()).toMatchObject({ plan: { operation: "version.submit", state: "succeeded" } });

    const statusResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-field-log/versions/demo-field-version-180/submission`,
      { headers: authorization(guiToken) },
    );
    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toMatchObject({
      submission: { id: "demo-submission-demo-field-version-180", state: "WAITING_FOR_REVIEW" },
    });
  });

  it("keeps customer reviews and reply drafts inside the GUI bearer boundary", async () => {
    const [missing, wrongScope, planWithoutToken, replyWithoutToken, replyWithWrongScope] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews`),
      fetch(`${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews`, {
        headers: authorization(mcpToken),
      }),
      fetch(`${agent!.baseUrl}/api/plans/customer-review-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          appId: "demo-app-orbit-notes",
          reviewId: "demo-review-orbit-001",
          responseBody: "Thank you for the feedback.",
        }),
      }),
      fetch(`${agent!.baseUrl}/api/replies/customer-review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "demo-app-orbit-notes", reviewId: "demo-review-orbit-002" }),
      }),
      fetch(`${agent!.baseUrl}/api/replies/customer-review`, {
        method: "POST",
        headers: { ...authorization(mcpToken), "content-type": "application/json" },
        body: JSON.stringify({ appId: "demo-app-orbit-notes", reviewId: "demo-review-orbit-002" }),
      }),
    ]);

    expect(missing.status).toBe(401);
    expect(wrongScope.status).toBe(401);
    expect(planWithoutToken.status).toBe(401);
    expect(replyWithoutToken.status).toBe(401);
    expect(replyWithWrongScope.status).toBe(401);
  });

  it("lists, filters, sorts, and paginates demo customer reviews", async () => {
    const firstPageResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews?limit=2`,
      { headers: authorization(guiToken) },
    );
    const firstPage = await firstPageResponse.json() as {
      reviews: Array<{
        id: string;
        rating: number;
        createdAt: string;
        territory: string;
        response: { state: string } | null;
      }>;
      total: number | null;
      nextCursor: string | null;
    };

    expect(firstPageResponse.status).toBe(200);
    expect(firstPage.reviews).toHaveLength(2);
    expect(firstPage.total).toBe(8);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.reviews.map((review) => review.createdAt)).toEqual(
      [...firstPage.reviews].map((review) => review.createdAt).sort().reverse(),
    );

    const secondPageResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
      { headers: authorization(guiToken) },
    );
    const secondPage = await secondPageResponse.json() as typeof firstPage;
    expect(secondPageResponse.status).toBe(200);
    expect(secondPage.reviews).toHaveLength(2);
    expect(secondPage.reviews.map((review) => review.id)).not.toEqual(firstPage.reviews.map((review) => review.id));

    const [ratingsResponse, territoriesResponse, publishedResponse, emptyResponse] = await Promise.all([
      fetch(
        `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews?ratings=1,5&sort=rating&limit=50`,
        { headers: authorization(guiToken) },
      ),
      fetch(
        `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews?territories=USA,GBR&sort=createdDate`,
        { headers: authorization(guiToken) },
      ),
      fetch(
        `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews?publishedResponse=true`,
        { headers: authorization(guiToken) },
      ),
      fetch(
        `${agent!.baseUrl}/api/apps/demo-app-field-log/customer-reviews`,
        { headers: authorization(guiToken) },
      ),
    ]);
    const ratings = await ratingsResponse.json() as typeof firstPage;
    const territories = await territoriesResponse.json() as typeof firstPage;
    const published = await publishedResponse.json() as typeof firstPage;

    expect(ratingsResponse.status).toBe(200);
    expect(ratings.reviews.length).toBeGreaterThan(0);
    expect(ratings.reviews.every((review) => [1, 5].includes(review.rating))).toBe(true);
    expect(ratings.reviews.map((review) => review.rating)).toEqual(
      [...ratings.reviews].map((review) => review.rating).sort((left, right) => left - right),
    );
    expect(territoriesResponse.status).toBe(200);
    expect(territories.reviews.length).toBeGreaterThan(0);
    expect(territories.reviews.every((review) => ["USA", "GBR"].includes(review.territory))).toBe(true);
    expect(territories.reviews.map((review) => review.createdAt)).toEqual(
      [...territories.reviews].map((review) => review.createdAt).sort(),
    );
    expect(publishedResponse.status).toBe(200);
    expect(published.reviews.length).toBeGreaterThan(0);
    expect(published.reviews.every((review) => review.response?.state === "PUBLISHED")).toBe(true);
    expect(emptyResponse.status).toBe(200);
    expect(await emptyResponse.json()).toEqual({ reviews: [], total: 0, nextCursor: null });
  });

  it("generates an isolated customer-review reply draft without creating a plan or changing review state", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const readState = async () => {
      const [reviewsResponse, plansResponse, activityResponse] = await Promise.all([
        fetch(`${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews`, {
          headers: authorization(guiToken),
        }),
        fetch(`${agent!.baseUrl}/api/plans`, { headers: authorization(guiToken) }),
        fetch(`${agent!.baseUrl}/api/activity`, { headers: authorization(guiToken) }),
      ]);
      const reviews = await reviewsResponse.json() as {
        reviews: Array<{ id: string; response: unknown }>;
      };
      return {
        response: reviews.reviews.find((review) => review.id === "demo-review-orbit-002")?.response,
        plans: await plansResponse.json(),
        activity: await activityResponse.json(),
      };
    };
    const before = await readState();

    const first = await fetch(`${agent!.baseUrl}/api/replies/customer-review`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-orbit-notes",
        reviewId: "demo-review-orbit-002",
      }),
    });
    const second = await fetch(`${agent!.baseUrl}/api/replies/customer-review`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        appId: "demo-app-orbit-notes",
        reviewId: "demo-review-orbit-002",
      }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = await first.json() as { responseBody: string };
    expect(firstBody.responseBody).toContain("[Demo reply]");
    expect(firstBody.responseBody).toContain("Nearly perfect for research");
    expect(await second.json()).toEqual(firstBody);
    expect(await readState()).toEqual(before);
  });

  it("strictly validates customer-review reply draft targets and maps a missing review to 404", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const invalidInputs = [
      { appId: "", reviewId: "demo-review-orbit-002" },
      { appId: "demo-app-orbit-notes", reviewId: "" },
      { appId: "demo-app-orbit-notes", reviewId: "demo-review-orbit-002", body: "Use this instead" },
    ];
    const invalidResponses = await Promise.all(invalidInputs.map((body) => fetch(
      `${agent!.baseUrl}/api/replies/customer-review`,
      { method: "POST", headers, body: JSON.stringify(body) },
    )));
    expect(invalidResponses.map((response) => response.status)).toEqual([400, 400, 400]);

    const missing = await fetch(`${agent!.baseUrl}/api/replies/customer-review`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appId: "demo-app-orbit-notes", reviewId: "missing-review" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "review_not_found" } });
  });

  it("strictly validates customer-review query parameters", async () => {
    const paths = [
      "?ratings=0",
      "?ratings=5,5",
      "?ratings=1,,2",
      "?territories=us",
      "?territories=USA,USA",
      "?territories=US",
      "?cursor=",
      `?cursor=${"x".repeat(2_049)}`,
      "?sort=newest",
      "?limit=0",
      "?limit=01",
      "?publishedResponse=yes",
      "?unexpected=value",
      "?__proto__=value",
      "?limit=1&limit=2",
    ];
    const responses = await Promise.all(paths.map((path) => fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews${path}`,
      { headers: authorization(guiToken) },
    )));

    expect(responses.map((response) => response.status)).toEqual(paths.map(() => 400));
  });

  it("reviews, confirms, refreshes, and replaces a customer-review response", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const listResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews`,
      { headers: authorization(guiToken) },
    );
    const list = await listResponse.json() as {
      reviews: Array<{ id: string; response: { responseBody: string; state: string } | null }>;
    };
    const review = list.reviews[0]!;
    const responseBody = "Thanks for taking the time to share this. We are looking into it.";
    const planResponse = await fetch(`${agent!.baseUrl}/api/plans/customer-review-response`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appId: "demo-app-orbit-notes", reviewId: review.id, responseBody }),
    });
    const planBody = await planResponse.json() as { plan: { id: string; digest: string } };

    expect(planResponse.status).toBe(201);
    expect(planBody).toMatchObject({
      plan: {
        operation: "customer_review.response.upsert",
        state: "awaiting_confirmation",
        target: { appId: "demo-app-orbit-notes", reviewId: review.id },
        after: { responseBody },
      },
    });

    const confirmResponse = await fetch(`${agent!.baseUrl}/api/plans/${planBody.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: planBody.plan.digest }),
    });
    expect(confirmResponse.status).toBe(200);
    expect(await confirmResponse.json()).toMatchObject({
      plan: { operation: "customer_review.response.upsert", state: "succeeded" },
    });

    const refreshedResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews`,
      { headers: authorization(guiToken) },
    );
    const refreshed = await refreshedResponse.json() as typeof list;
    expect(refreshed.reviews.find((candidate) => candidate.id === review.id)?.response).toMatchObject({
      responseBody,
      state: "PENDING_PUBLISH",
    });

    const replacementBody = "Thank you again. We have passed this detail to the product team.";
    const replacementPlanResponse = await fetch(`${agent!.baseUrl}/api/plans/customer-review-response`, {
      method: "POST",
      headers,
      body: JSON.stringify({ appId: "demo-app-orbit-notes", reviewId: review.id, responseBody: replacementBody }),
    });
    const replacementPlan = await replacementPlanResponse.json() as typeof planBody;
    expect(replacementPlanResponse.status).toBe(201);
    const replacementConfirm = await fetch(`${agent!.baseUrl}/api/plans/${replacementPlan.plan.id}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: replacementPlan.plan.digest }),
    });
    expect(replacementConfirm.status).toBe(200);

    const replacedResponse = await fetch(
      `${agent!.baseUrl}/api/apps/demo-app-orbit-notes/customer-reviews`,
      { headers: authorization(guiToken) },
    );
    const replaced = await replacedResponse.json() as typeof list;
    expect(replaced.reviews.find((candidate) => candidate.id === review.id)?.response).toMatchObject({
      responseBody: replacementBody,
      state: "PENDING_PUBLISH",
    });
  });

  it("rejects empty customer-review responses and maps missing reviews to 404", async () => {
    const headers = { ...authorization(guiToken), "content-type": "application/json" };
    const [emptyBody, missingReview] = await Promise.all([
      fetch(`${agent!.baseUrl}/api/plans/customer-review-response`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          appId: "demo-app-orbit-notes",
          reviewId: "demo-review-orbit-001",
          responseBody: " \n\t ",
        }),
      }),
      fetch(`${agent!.baseUrl}/api/plans/customer-review-response`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          appId: "demo-app-orbit-notes",
          reviewId: "missing-review",
          responseBody: "Thank you for your feedback.",
        }),
      }),
    ]);

    expect(emptyBody.status).toBe(400);
    expect(await emptyBody.json()).toMatchObject({ error: { code: "invalid_input" } });
    expect(missingReview.status).toBe(404);
    expect(await missingReview.json()).toMatchObject({ error: { code: "review_not_found" } });
  });

  it("rejects oversized MCP bodies", async () => {
    const response = await fetch(`${agent!.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(mcpToken),
      body: JSON.stringify({ padding: "x".repeat(64 * 1024) }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "body_too_large", message: "The request body is too large." },
    });
  });
});

describe("local-agent built GUI", () => {
  it("serves built files without weakening API authentication", async () => {
    const agent = await startAgent({ serveWeb: true });
    try {
      const [index, asset, apiWithoutToken, healthWithoutToken] = await Promise.all([
        fetch(`${agent.baseUrl}/`),
        fetch(`${agent.baseUrl}/assets/app.js`),
        fetch(`${agent.baseUrl}/api/status`),
        fetch(`${agent.baseUrl}/health`),
      ]);
      expect(index.status).toBe(200);
      expect(index.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(await index.text()).toContain("ASC Studio built GUI");
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("text/javascript");
      expect(await asset.text()).toContain("document.title");
      expect(apiWithoutToken.status).toBe(401);
      expect(healthWithoutToken.status).toBe(401);
    } finally {
      await stopAgent(agent);
    }
  });
});

describe("local-agent mode selection", () => {
  it("rejects invalid mode values before listening", async () => {
    const child = spawn(process.execPath, launchArguments, {
      cwd: appRoot,
      env: { ...process.env, ASC_STUDIO_MODE: "LIVE" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => { output += chunk; });
    const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));

    expect(exitCode).not.toBe(0);
    expect(output).toContain('ASC_STUDIO_MODE must be exactly "demo" or "live"');
    expect(output).not.toContain("listening on");
  });
});
