import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

const startAgent = async (options: { serveWeb?: boolean; mode?: "demo" | "live" } = {}): Promise<RunningAgent> => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "asc-studio-agent-test-"));
  const webDirectory = join(dataDirectory, "web");
  if (options.serveWeb) {
    await mkdir(join(webDirectory, "assets"), { recursive: true });
    await writeFile(join(webDirectory, "index.html"), '<!doctype html><div id="root">ASC Studio built GUI</div>', "utf8");
    await writeFile(join(webDirectory, "assets", "app.js"), 'document.title = "ASC Studio";', "utf8");
  }
  const environment = { ...process.env };
  for (const name of [
    "ASC_STUDIO_PROFILE_NAME",
    "ASC_STUDIO_ISSUER_ID",
    "ASC_STUDIO_KEY_ID",
    "ASC_STUDIO_PRIVATE_KEY",
    "ASC_STUDIO_PRIVATE_KEY_PATH",
  ]) delete environment[name];
  const child = spawn(process.execPath, launchArguments, {
    cwd: appRoot,
    env: {
      ...environment,
      ASC_STUDIO_MODE: options.mode ?? "demo",
      ASC_STUDIO_PORT: "0",
      ASC_STUDIO_DATA_DIR: dataDirectory,
      ASC_STUDIO_GUI_TOKEN: guiToken,
      ASC_STUDIO_MCP_TOKEN: mcpToken,
      ...(options.serveWeb ? { ASC_STUDIO_WEB_DIR: webDirectory } : {}),
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
      "list_apps",
      "list_testflight_builds",
      "list_app_store_versions",
      "list_version_localizations",
      "list_version_screenshots",
      "get_version_submission_status",
    ]);
    expect(toolsBody.result.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);

    const call = await fetch(`${agent!.baseUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(mcpToken),
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_asc_status", arguments: {} } }),
    });
    expect(call.status).toBe(200);
    expect(await call.json()).toMatchObject({ result: { structuredContent: { mode: "demo", connected: true } } });
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
