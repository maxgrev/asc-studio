import type {
  AppleAdsAdGroup,
  AppleAdsCampaign,
  AppleAdsCampaignMetrics,
  AppleAdsCampaignReportInput,
  AppleAdsKeyword,
  AppleAdsKeywordResearchInput,
  AppleAdsKeywordResearchItem,
  AppleAdsKeywordResearchResult,
  AppleAdsStatus,
} from "@asc-studio/contracts";
import type { AppleAdsProvider } from "@asc-studio/core";
import type { z } from "zod";
import {
  AppleAdsApiError,
  AppleAdsClient,
  AppleAdsCredentialUnavailableError,
  type AppleAdsClientOptions,
  type AppleAdsCredentials,
} from "./client.js";
import {
  AdGroupPayloadSchema,
  AdGroupQueryResponseSchema,
  CampaignPayloadSchema,
  CampaignQueryResponseSchema,
  CampaignReportResponseSchema,
  KeywordPayloadSchema,
  KeywordQueryResponseSchema,
  KeywordSuggestionResponseSchema,
  SearchTermPopularityResponseSchema,
} from "./schemas.js";

export {
  AppleAdsApiError,
  AppleAdsClient,
  AppleAdsCredentialUnavailableError,
  type AppleAdsClientOptions,
  type AppleAdsCredentials,
} from "./client.js";

type CampaignPayload = z.infer<typeof CampaignPayloadSchema>;
type AdGroupPayload = z.infer<typeof AdGroupPayloadSchema>;
type KeywordPayload = z.infer<typeof KeywordPayloadSchema>;

const mapMoney = (value: { amount: string; currency: string }) => ({
  amount: value.amount,
  currency: value.currency,
});

const mapCampaign = (campaign: CampaignPayload): AppleAdsCampaign => ({
  id: campaign.id,
  adAccountId: campaign.adAccountId,
  name: campaign.name,
  promotedObjectId: campaign.promotedObjectId,
  status: campaign.status,
  systemStatus: campaign.systemStatus,
  displayStatus: campaign.displayStatus,
  startTime: campaign.startTime,
  endTime: campaign.endTime,
  dailyBudget: mapMoney(campaign.dailyBudget.value),
  countriesOrRegions: campaign.targeting.countryOrRegion?.include ?? [],
  supplyPlacements: campaign.targeting.supplyPlacement?.include ?? [],
  bidStrategyType: campaign.bidStrategy.bidStrategyType,
  deleted: campaign.deleted,
  modificationTime: campaign.modificationTime,
});

const mapAdGroup = (adGroup: AdGroupPayload): AppleAdsAdGroup => ({
  id: adGroup.id,
  campaignId: adGroup.campaignId,
  name: adGroup.name,
  status: adGroup.status,
  systemStatus: adGroup.systemStatus,
  displayStatus: adGroup.displayStatus,
  automatedKeywordsOptIn: adGroup.automatedKeywordsOptIn,
  bid: adGroup.bidStrategy?.bid ? mapMoney(adGroup.bidStrategy.bid) : null,
  startTime: adGroup.startTime,
  endTime: adGroup.endTime,
  deleted: adGroup.deleted,
  modificationTime: adGroup.modificationTime,
});

const mapKeyword = (keyword: KeywordPayload): AppleAdsKeyword => ({
  id: keyword.id,
  campaignId: keyword.campaignId,
  adGroupId: keyword.adGroupId,
  text: keyword.text,
  matchType: keyword.matchType,
  bid: keyword.bid ? mapMoney(keyword.bid) : null,
  status: keyword.status,
  displayStatus: keyword.displayStatus,
  deleted: keyword.deleted,
  modificationTime: keyword.modificationTime,
});

const pagination = (offset: number, pageSize = 1000) => ({ offset, pageSize, fetchTotalCount: true });

const scoreKeyword = (item: {
  suggestionPopularity: number | null;
  searchPopularity: number | null;
  searchPopularityInGenre: number | null;
}) => {
  const signals = [
    ...(item.searchPopularity === null ? [] : [{ value: item.searchPopularity, weight: 0.55 }]),
    ...(item.searchPopularityInGenre === null ? [] : [{ value: item.searchPopularityInGenre, weight: 0.20 }]),
    ...(item.suggestionPopularity === null ? [] : [{ value: item.suggestionPopularity, weight: 0.25 }]),
  ];
  const totalWeight = signals.reduce((total, signal) => total + signal.weight, 0);
  if (totalWeight === 0) return 0;
  return Math.round(signals.reduce((total, signal) => total + signal.value * signal.weight, 0) / totalWeight);
};

export class AppleAdsPlatformProvider implements AppleAdsProvider {
  private readonly client: AppleAdsClient;

  constructor(options: AppleAdsClientOptions) {
    this.client = new AppleAdsClient(options);
  }

  async getAppleAdsStatus(): Promise<AppleAdsStatus> {
    try {
      const credentials = await this.client.credentials();
      await this.client.request("POST", "/v1/campaigns/query", CampaignQueryResponseSchema, {
        retry: true,
        body: { pagination: pagination(0, 1) },
      });
      return {
        mode: "live",
        configured: true,
        connected: true,
        provider: "apple-ads-platform-api",
        adAccountId: credentials.adAccountId,
        detail: `Connected to Apple Ads as ${credentials.profileName}.`,
      };
    } catch (error) {
      if (error instanceof AppleAdsCredentialUnavailableError) {
        return {
          mode: "live",
          configured: false,
          connected: false,
          provider: "apple-ads-platform-api",
          adAccountId: null,
          detail: error.message,
        };
      }
      const credentials = await this.client.credentials().catch(() => null);
      return {
        mode: "live",
        configured: credentials !== null,
        connected: false,
        provider: "apple-ads-platform-api",
        adAccountId: credentials?.adAccountId ?? null,
        detail: error instanceof Error ? error.message : "Apple Ads could not validate the configured API key.",
      };
    }
  }

  async listAppleAdsCampaigns(appId?: string) {
    const campaigns: AppleAdsCampaign[] = [];
    for (let offset = 0; ; offset += 1000) {
      const response = await this.client.request("POST", "/v1/campaigns/query", CampaignQueryResponseSchema, {
        retry: true,
        body: {
          filters: [
            ...(appId ? [{ field: "promotedObjectId", operator: "EQUALS", value: appId }] : []),
            { field: "promotedObjectType", operator: "EQUALS", value: "APPSTORE_APP" },
          ],
          sorting: [{ field: "modificationTime", order: "DESC" }],
          pagination: pagination(offset),
        },
      });
      campaigns.push(...response.result.map(mapCampaign));
      if (response.result.length < 1000 || campaigns.length >= (response.pagination?.totalCount ?? Number.POSITIVE_INFINITY)) break;
    }
    return campaigns;
  }

  async listAppleAdsAdGroups(campaignId: string) {
    const adGroups: AppleAdsAdGroup[] = [];
    for (let offset = 0; ; offset += 1000) {
      const response = await this.client.request("POST", "/v1/adgroups/query", AdGroupQueryResponseSchema, {
        retry: true,
        body: {
          filters: [{ field: "campaignId", operator: "EQUALS", value: campaignId }],
          sorting: [{ field: "modificationTime", order: "DESC" }],
          pagination: pagination(offset),
        },
      });
      adGroups.push(...response.result.map(mapAdGroup));
      if (response.result.length < 1000 || adGroups.length >= (response.pagination?.totalCount ?? Number.POSITIVE_INFINITY)) break;
    }
    return adGroups;
  }

  async listAppleAdsKeywords(input: { campaignId?: string; adGroupId?: string }) {
    if (!input.campaignId && !input.adGroupId) throw new Error("A campaign ID or ad group ID is required.");
    const keywords: AppleAdsKeyword[] = [];
    for (let offset = 0; ; offset += 1000) {
      const response = await this.client.request("POST", "/v1/keywords/query", KeywordQueryResponseSchema, {
        retry: true,
        body: {
          filters: [{
            field: input.adGroupId ? "adGroupId" : "campaignId",
            operator: "EQUALS",
            value: input.adGroupId ?? input.campaignId,
          }],
          sorting: [{ field: "modificationTime", order: "DESC" }],
          pagination: pagination(offset),
        },
      });
      keywords.push(...response.result.map(mapKeyword));
      if (response.result.length < 1000 || keywords.length >= (response.pagination?.totalCount ?? Number.POSITIVE_INFINITY)) break;
    }
    return keywords;
  }

  async researchAppleAdsKeywords(input: AppleAdsKeywordResearchInput): Promise<AppleAdsKeywordResearchResult> {
    const suggestionFilters: Array<Record<string, unknown>> = [
      { field: "promotedObjectId", operator: "EQUALS", value: [input.appId] },
      { field: "promotedObjectType", operator: "EQUALS", value: ["APPSTORE_APP"] },
      { field: "countriesOrRegions", operator: "IN", value: [input.countryOrRegion] },
      ...(input.seedTerms.length ? [{ field: "terms", operator: "IN", value: input.seedTerms }] : []),
    ];
    const [suggestions, popularity] = await Promise.all([
      this.client.request("POST", "/v1/suggestions/keywords/query", KeywordSuggestionResponseSchema, {
        retry: true,
        body: {
          filters: suggestionFilters,
          sorting: [{ field: "popularity", order: "DESC" }],
          pagination: { offset: 0, pageSize: Math.min(input.limit, 200), fetchTotalCount: true },
        },
      }),
      this.client.request("POST", "/v1/insights/apps/search-term-popularity/query", SearchTermPopularityResponseSchema, {
        retry: true,
        body: {
          fields: ["rankInGenre", "searchPopularityInGenre", "searchPopularity1to100", "searchPopularity1to5"],
          filters: [
            { field: "countryOrRegion", operator: "EQUALS", value: input.countryOrRegion },
            { field: "genre", operator: "EQUALS", value: input.genre },
          ],
          timeRange: { start: input.start, end: input.end, granularity: input.granularity },
          sorting: [{ field: "rankInGenre", order: "ASC" }],
          pagination: { offset: 0, pageSize: Math.min(input.limit, 200) },
        },
      }),
    ]);

    const merged = new Map<string, AppleAdsKeywordResearchItem>();
    for (const suggestion of suggestions.result) {
      const key = suggestion.text.trim().toLocaleLowerCase("en-US");
      merged.set(key, {
        text: suggestion.text.trim(),
        source: "suggestion",
        suggestionPopularity: suggestion.popularity,
        searchPopularity: null,
        searchPopularityInGenre: null,
        rankInGenre: null,
        searchPopularityTier: null,
        opportunityScore: suggestion.popularity,
      });
    }
    for (const row of popularity.result.rows) {
      const key = row.searchTerm.trim().toLocaleLowerCase("en-US");
      const existing = merged.get(key);
      const candidate = {
        text: existing?.text ?? row.searchTerm.trim(),
        source: existing ? "both" as const : "popularity" as const,
        suggestionPopularity: existing?.suggestionPopularity ?? null,
        searchPopularity: Math.max(existing?.searchPopularity ?? 0, row.searchPopularity1to100 ?? 0) || null,
        searchPopularityInGenre: Math.max(existing?.searchPopularityInGenre ?? 0, row.searchPopularityInGenre ?? 0) || null,
        rankInGenre: Math.min(existing?.rankInGenre ?? Number.POSITIVE_INFINITY, row.rankInGenre ?? Number.POSITIVE_INFINITY),
        searchPopularityTier: Math.max(existing?.searchPopularityTier ?? 0, row.searchPopularity1to5 ?? 0) || null,
        opportunityScore: 0,
      };
      const item: AppleAdsKeywordResearchItem = {
        ...candidate,
        rankInGenre: Number.isFinite(candidate.rankInGenre) ? candidate.rankInGenre : null,
        opportunityScore: scoreKeyword(candidate),
      };
      merged.set(key, item);
    }

    const keywords = [...merged.values()]
      .map((item) => ({ ...item, opportunityScore: scoreKeyword(item) }))
      .sort((left, right) => right.opportunityScore - left.opportunityScore
        || (left.rankInGenre ?? Number.POSITIVE_INFINITY) - (right.rankInGenre ?? Number.POSITIVE_INFINITY)
        || left.text.localeCompare(right.text))
      .slice(0, input.limit);

    return {
      appId: input.appId,
      countryOrRegion: input.countryOrRegion,
      genre: input.genre,
      start: input.start,
      end: input.end,
      granularity: input.granularity,
      keywords,
      note: "Opportunity uses only Apple-provided popularity and app-suggestion signals. Apple Ads does not provide keyword difficulty, so ASC Studio does not invent one.",
    };
  }

  async getAppleAdsCampaignReport(input: AppleAdsCampaignReportInput): Promise<AppleAdsCampaignMetrics> {
    const response = await this.client.request("POST", "/v1/reports/apps/campaigns/query", CampaignReportResponseSchema, {
      retry: true,
      body: {
        fields: ["localSpend", "impressions", "taps", "ttr", "cpt", "tapInstalls", "totalInstalls", "tapInstallCPI", "totalAvgCPI"],
        filters: [{ field: "campaignId", operator: "EQUALS", value: input.campaignId }],
        timeRange: {
          start: input.start,
          end: input.end,
          timeZone: input.timeZone,
          ...(input.start === input.end ? {} : { granularity: "DAILY" }),
        },
        pagination: { offset: 0, pageSize: 1 },
      },
    });
    const row = response.result.rows[0];
    if (!row) {
      throw new AppleAdsApiError("Apple Ads returned no report row for this campaign and date range.", 404, "REPORT_EMPTY", null, []);
    }
    const metrics = row.totalMetrics;
    return {
      campaignId: row.metadata.id,
      name: row.metadata.name,
      localSpend: metrics.localSpend ? mapMoney(metrics.localSpend) : null,
      impressions: metrics.impressions,
      taps: metrics.taps,
      tapThroughRate: metrics.ttr,
      tapInstalls: metrics.tapInstalls,
      totalInstalls: metrics.totalInstalls,
      averageCostPerTap: metrics.cpt ? mapMoney(metrics.cpt) : null,
      averageCostPerAcquisition: metrics.tapInstallCPI
        ? mapMoney(metrics.tapInstallCPI)
        : metrics.totalAvgCPI ? mapMoney(metrics.totalAvgCPI) : null,
    };
  }
}
