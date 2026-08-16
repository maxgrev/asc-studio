import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AppStorePlatformSchema,
  AppStoreVersionSchema,
  AppSummarySchema,
  BuildSummarySchema,
  ScreenshotAssetSchema,
  ScreenshotDisplayTypeSchema,
  VersionLocalizationSchema,
  VersionSubmissionStatusSchema,
} from "@asc-studio/contracts";
import type { AscStudioService } from "@asc-studio/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";

const errorResult = (error: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: error instanceof Error ? error.message : "ASC Studio could not complete the request." }],
});

const createMcpServer = (service: AscStudioService) => {
  const server = new McpServer(
    { name: "asc-studio", version: "0.4.0" },
    {
      instructions:
        "Use read tools to resolve exact App Store Connect IDs before any action. This release exposes reads only through MCP; consequential changes require review in the local ASC Studio GUI.",
    },
  );

  server.registerTool(
    "get_asc_status",
    {
      title: "Check ASC Studio status",
      description: "Check whether ASC Studio is using isolated demo data or a live local asc profile.",
      inputSchema: {},
      outputSchema: {
        mode: z.enum(["live", "demo"]),
        connected: z.boolean(),
        detail: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const status = await service.getStatus();
        const structuredContent = { mode: status.mode, connected: status.connected, detail: status.detail };
        return {
          structuredContent,
          content: [{ type: "text", text: `${status.mode === "demo" ? "Demo" : "Live"} mode: ${status.detail}` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_apps",
    {
      title: "List App Store Connect apps",
      description: "List apps available to the active local asc profile, including stable IDs and bundle IDs.",
      inputSchema: {},
      outputSchema: { apps: z.array(AppSummarySchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      try {
        const apps = await service.listApps();
        return {
          structuredContent: { apps },
          content: [{ type: "text", text: `Found ${apps.length} app${apps.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_testflight_builds",
    {
      title: "List TestFlight builds",
      description: "List recent TestFlight builds for one resolved App Store Connect app ID.",
      inputSchema: { appId: z.string().min(1) },
      outputSchema: { builds: z.array(BuildSummarySchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ appId }) => {
      try {
        const builds = await service.listBuilds(appId);
        return {
          structuredContent: { builds },
          content: [{ type: "text", text: `Found ${builds.length} TestFlight build${builds.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_app_store_versions",
    {
      title: "List App Store versions",
      description: "List App Store versions for one resolved app ID, including editable state and stable version IDs.",
      inputSchema: {
        appId: z.string().min(1),
        platform: AppStorePlatformSchema.optional(),
      },
      outputSchema: { versions: z.array(AppStoreVersionSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ appId, platform }) => {
      try {
        const versions = await service.listVersions(appId, platform);
        return {
          structuredContent: { versions },
          content: [{ type: "text", text: `Found ${versions.length} App Store version${versions.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_version_localizations",
    {
      title: "List version localizations",
      description: "Read description, keywords, release notes, promotional text, and URLs for an exact app and version ID.",
      inputSchema: {
        appId: z.string().min(1),
        versionId: z.string().min(1),
      },
      outputSchema: { localizations: z.array(VersionLocalizationSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ appId, versionId }) => {
      try {
        const localizations = await service.listVersionLocalizations(appId, versionId);
        return {
          structuredContent: { localizations },
          content: [{ type: "text", text: `Found ${localizations.length} localization${localizations.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_version_screenshots",
    {
      title: "List version screenshots",
      description: "Read one locale and device screenshot set for an exact App Store version.",
      inputSchema: {
        appId: z.string().min(1),
        versionId: z.string().min(1),
        localizationId: z.string().min(1),
        displayType: ScreenshotDisplayTypeSchema,
      },
      outputSchema: { screenshots: z.array(ScreenshotAssetSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ appId, versionId, localizationId, displayType }) => {
      try {
        const screenshots = await service.listScreenshots(appId, versionId, localizationId, displayType);
        return {
          structuredContent: { screenshots },
          content: [{ type: "text", text: `Found ${screenshots.length} screenshot${screenshots.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_version_submission_status",
    {
      title: "Get version submission status",
      description: "Read the App Review submission or App Store version state for an exact app and version ID.",
      inputSchema: {
        appId: z.string().min(1),
        versionId: z.string().min(1),
      },
      outputSchema: { submission: VersionSubmissionStatusSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ appId, versionId }) => {
      try {
        const submission = await service.getVersionSubmissionStatus(appId, versionId);
        return {
          structuredContent: { submission },
          content: [{
            type: "text",
            text: submission.id
              ? `${submission.versionString} submission is ${submission.state}.`
              : `${submission.versionString} has no App Review submission; version state is ${submission.state}.`,
          }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
};

export const handleMcpRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  service: AscStudioService,
  parsedBody?: unknown,
) => {
  const server = createMcpServer(service);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  // SDK 1.x's Node transport has stricter optional callback accessors than its
  // shared Transport declaration when exactOptionalPropertyTypes is enabled.
  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(request, response, parsedBody);
};
