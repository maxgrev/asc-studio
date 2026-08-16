import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AppleAdsAdGroupSchema,
  AppleAdsCampaignMetricsSchema,
  AppleAdsCampaignReportInputSchema,
  AppleAdsCampaignSchema,
  AppleAdsKeywordResearchInputSchema,
  AppleAdsKeywordResearchResultSchema,
  AppleAdsKeywordSchema,
  AppleAdsStatusSchema,
  CreateAppleAdsAdGroupInputSchema,
  CreateAppleAdsAdGroupMutationPlanSchema,
  CreateAppleAdsCampaignInputSchema,
  CreateAppleAdsCampaignMutationPlanSchema,
  CreateAppleAdsKeywordInputSchema,
  CreateAppleAdsKeywordMutationPlanSchema,
  AppStorePlatformSchema,
  AppStoreVersionSchema,
  AppSummarySchema,
  BuildSummarySchema,
  ScreenshotAssetSchema,
  ScreenshotDisplayTypeSchema,
  VersionLocalizationSchema,
  VersionSubmissionStatusSchema,
  UpdateAppleAdsCampaignInputSchema,
  UpdateAppleAdsCampaignMutationPlanSchema,
  UpdateAppleAdsKeywordInputSchema,
  UpdateAppleAdsKeywordMutationPlanSchema,
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
    { name: "asc-studio", version: "0.6.0" },
    {
      instructions:
        "Use read tools to resolve exact App Store Connect and Apple Ads IDs before any action. Apple Ads popularity is a relative first-party signal, not an absolute search count. Apple Ads plan tools only prepare a local review plan; the user must inspect and confirm every external change in the ASC Studio GUI.",
    },
  );

  server.registerTool(
    "get_asc_status",
    {
      title: "Check ASC Studio status",
      description: "Check whether ASC Studio is using isolated demo data or a direct App Store Connect API connection.",
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
    "get_apple_ads_status",
    {
      title: "Check Apple Ads status",
      description: "Check whether the separate Apple Ads Platform API v1 credential set is configured and connected.",
      inputSchema: {},
      outputSchema: AppleAdsStatusSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      try {
        const status = await service.getAppleAdsStatus();
        return {
          structuredContent: status,
          content: [{ type: "text", text: status.detail }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "research_apple_ads_keywords",
    {
      title: "Research App Store keywords",
      description: "Merge Apple Ads app-specific keyword suggestions with first-party search-term popularity for one country, genre, and weekly or monthly date range. Returns relative scores, not search counts or invented difficulty estimates.",
      inputSchema: AppleAdsKeywordResearchInputSchema.innerType().shape,
      outputSchema: { research: AppleAdsKeywordResearchResultSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        const research = await service.researchAppleAdsKeywords(AppleAdsKeywordResearchInputSchema.parse(input));
        return {
          structuredContent: { research },
          content: [{ type: "text", text: `Found ${research.keywords.length} ranked keyword candidate${research.keywords.length === 1 ? "" : "s"} for ${research.countryOrRegion} ${research.genre}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_apple_ads_campaigns",
    {
      title: "List Apple Ads campaigns",
      description: "List App Store campaigns in the configured Apple Ads ad account, optionally limited to one app ID.",
      inputSchema: { appId: z.string().min(1).optional() },
      outputSchema: { campaigns: z.array(AppleAdsCampaignSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ appId }) => {
      try {
        const campaigns = await service.listAppleAdsCampaigns(appId);
        return {
          structuredContent: { campaigns },
          content: [{ type: "text", text: `Found ${campaigns.length} Apple Ads campaign${campaigns.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_apple_ads_ad_groups",
    {
      title: "List Apple Ads ad groups",
      description: "List ad groups and Search Match state for one exact Apple Ads campaign ID.",
      inputSchema: { campaignId: z.string().min(1) },
      outputSchema: { adGroups: z.array(AppleAdsAdGroupSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ campaignId }) => {
      try {
        const adGroups = await service.listAppleAdsAdGroups(campaignId);
        return {
          structuredContent: { adGroups },
          content: [{ type: "text", text: `Found ${adGroups.length} Apple Ads ad group${adGroups.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_apple_ads_keywords",
    {
      title: "List Apple Ads keywords",
      description: "List keywords, match types, bids, and delivery state for one exact campaign or ad group ID.",
      inputSchema: {
        campaignId: z.string().min(1).optional(),
        adGroupId: z.string().min(1).optional(),
      },
      outputSchema: { keywords: z.array(AppleAdsKeywordSchema) },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async ({ campaignId, adGroupId }) => {
      try {
        const keywords = await service.listAppleAdsKeywords({
          ...(campaignId ? { campaignId } : {}),
          ...(adGroupId ? { adGroupId } : {}),
        });
        return {
          structuredContent: { keywords },
          content: [{ type: "text", text: `Found ${keywords.length} Apple Ads keyword${keywords.length === 1 ? "" : "s"}.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_apple_ads_campaign_report",
    {
      title: "Get Apple Ads campaign report",
      description: "Read spend, impressions, taps, installs, and unit costs for one campaign and date range.",
      inputSchema: AppleAdsCampaignReportInputSchema.innerType().shape,
      outputSchema: { report: AppleAdsCampaignMetricsSchema },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    },
    async (input) => {
      try {
        const report = await service.getAppleAdsCampaignReport(AppleAdsCampaignReportInputSchema.parse(input));
        return {
          structuredContent: { report },
          content: [{ type: "text", text: `${report.name}: ${report.impressions} impressions, ${report.taps} taps, ${report.totalInstalls} total installs.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "plan_apple_ads_campaign_create",
    {
      title: "Plan a new Apple Ads campaign",
      description: "Prepare a paused App Store search-results campaign for GUI review. This tool does not create the campaign in Apple Ads.",
      inputSchema: CreateAppleAdsCampaignInputSchema.innerType().shape,
      outputSchema: { plan: CreateAppleAdsCampaignMutationPlanSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const plan = await service.createAppleAdsCampaignPlan(CreateAppleAdsCampaignInputSchema.parse(input), "mcp");
        if (plan.operation !== "apple_ads.campaign.create") throw new Error("ASC Studio returned the wrong plan type.");
        return {
          structuredContent: { plan },
          content: [{ type: "text", text: `${plan.summary}. Review and confirm plan ${plan.id} in the ASC Studio GUI.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "plan_apple_ads_campaign_update",
    {
      title: "Plan Apple Ads campaign changes",
      description: "Prepare campaign name, daily budget, countries, end date, or run-state changes for GUI review. This tool does not update Apple Ads.",
      inputSchema: UpdateAppleAdsCampaignInputSchema.innerType().shape,
      outputSchema: { plan: UpdateAppleAdsCampaignMutationPlanSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const plan = await service.createUpdateAppleAdsCampaignPlan(UpdateAppleAdsCampaignInputSchema.parse(input), "mcp");
        if (plan.operation !== "apple_ads.campaign.update") throw new Error("ASC Studio returned the wrong plan type.");
        return {
          structuredContent: { plan },
          content: [{ type: "text", text: `${plan.summary}. Review and confirm plan ${plan.id} in the ASC Studio GUI.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "plan_apple_ads_ad_group_create",
    {
      title: "Plan a new Apple Ads ad group",
      description: "Prepare a paused manual-CPT ad group for GUI review. This tool does not create the ad group in Apple Ads.",
      inputSchema: CreateAppleAdsAdGroupInputSchema.innerType().shape,
      outputSchema: { plan: CreateAppleAdsAdGroupMutationPlanSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const plan = await service.createAppleAdsAdGroupPlan(CreateAppleAdsAdGroupInputSchema.parse(input), "mcp");
        if (plan.operation !== "apple_ads.ad_group.create") throw new Error("ASC Studio returned the wrong plan type.");
        return {
          structuredContent: { plan },
          content: [{ type: "text", text: `${plan.summary}. Review and confirm plan ${plan.id} in the ASC Studio GUI.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "plan_apple_ads_keyword_create",
    {
      title: "Plan a new Apple Ads keyword",
      description: "Prepare one paused exact- or broad-match keyword for GUI review. This tool does not create the keyword in Apple Ads.",
      inputSchema: CreateAppleAdsKeywordInputSchema.shape,
      outputSchema: { plan: CreateAppleAdsKeywordMutationPlanSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const plan = await service.createAppleAdsKeywordPlan(CreateAppleAdsKeywordInputSchema.parse(input), "mcp");
        if (plan.operation !== "apple_ads.keyword.create") throw new Error("ASC Studio returned the wrong plan type.");
        return {
          structuredContent: { plan },
          content: [{ type: "text", text: `${plan.summary}. Review and confirm plan ${plan.id} in the ASC Studio GUI.` }],
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "plan_apple_ads_keyword_update",
    {
      title: "Plan Apple Ads keyword changes",
      description: "Prepare a keyword bid or run-state change for GUI review. This tool does not update Apple Ads.",
      inputSchema: UpdateAppleAdsKeywordInputSchema.innerType().shape,
      outputSchema: { plan: UpdateAppleAdsKeywordMutationPlanSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (input) => {
      try {
        const plan = await service.createUpdateAppleAdsKeywordPlan(UpdateAppleAdsKeywordInputSchema.parse(input), "mcp");
        if (plan.operation !== "apple_ads.keyword.update") throw new Error("ASC Studio returned the wrong plan type.");
        return {
          structuredContent: { plan },
          content: [{ type: "text", text: `${plan.summary}. Review and confirm plan ${plan.id} in the ASC Studio GUI.` }],
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
      description: "List apps available to the active App Store Connect connection, including stable IDs and bundle IDs.",
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
