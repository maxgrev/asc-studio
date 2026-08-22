import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const launchArguments = ["--import", "tsx", "src/index.ts"];
const guiToken = "g".repeat(43);
const mcpToken = "m".repeat(43);

interface RunningAgent {
  baseUrl: string;
  child: ChildProcess;
  dataDirectory: string;
}

interface StartAgentOptions {
  serveWeb?: boolean;
  mode?: "demo" | "live";
  environment?: Record<string, string>;
  mockOpenAiValidation?: boolean;
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
  let childArguments = launchArguments;
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
    childArguments = ["--import", preloadPath, ...launchArguments];
  }
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
      resolve({ baseUrl: `http://127.0.0.1:${match[1]}`, child, dataDirectory });
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
          promotionalText: "Capture ideas fast.",
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
        source: { whatsNew: "A faster editor.", promotionalText: "" },
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_input" } });
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
          whatsNew: "A faster editor, better search, and more reliable sync.",
          promotionalText: "Capture ideas faster and keep every note close.",
          keywords: "notes,writing,ideas,tasks,organizer,journal,productivity",
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
