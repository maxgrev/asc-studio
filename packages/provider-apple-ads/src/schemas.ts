import { z } from "zod";

export const AppleAdsIdSchema = z.union([z.string().min(1), z.number().int()]).transform(String);

export const AppleAdsMoneyPayloadSchema = z.object({
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
}).passthrough();

const TargetingDataSchema = z.object({ include: z.array(z.string()) }).passthrough();

export const CampaignPayloadSchema = z.object({
  id: AppleAdsIdSchema,
  adAccountId: AppleAdsIdSchema,
  name: z.string().min(1),
  promotedObjectId: AppleAdsIdSchema,
  status: z.string().min(1),
  systemStatus: z.string().min(1).optional().default("UNKNOWN"),
  displayStatus: z.string().min(1).optional().default("UNKNOWN"),
  startTime: z.string().nullable().optional().default(null),
  endTime: z.string().nullable().optional().default(null),
  dailyBudget: z.object({ value: AppleAdsMoneyPayloadSchema }).passthrough(),
  targeting: z.object({
    countryOrRegion: TargetingDataSchema.optional(),
    supplyPlacement: TargetingDataSchema.optional(),
  }).passthrough(),
  bidStrategy: z.object({ bidStrategyType: z.string().min(1) }).passthrough(),
  deleted: z.boolean().optional().default(false),
  modificationTime: z.string().nullable().optional().default(null),
}).passthrough();

export const AdGroupPayloadSchema = z.object({
  id: AppleAdsIdSchema,
  campaignId: AppleAdsIdSchema,
  name: z.string().min(1),
  status: z.string().min(1),
  systemStatus: z.string().min(1).optional().default("UNKNOWN"),
  displayStatus: z.string().min(1).optional().default("UNKNOWN"),
  automatedKeywordsOptIn: z.boolean().optional().default(false),
  bidStrategy: z.object({ bid: AppleAdsMoneyPayloadSchema.nullable().optional() }).passthrough().optional(),
  startTime: z.string().nullable().optional().default(null),
  endTime: z.string().nullable().optional().default(null),
  deleted: z.boolean().optional().default(false),
  modificationTime: z.string().nullable().optional().default(null),
}).passthrough();

export const KeywordPayloadSchema = z.object({
  id: AppleAdsIdSchema,
  campaignId: AppleAdsIdSchema,
  adGroupId: AppleAdsIdSchema,
  text: z.string().min(1),
  matchType: z.string().min(1),
  bid: AppleAdsMoneyPayloadSchema.nullable().optional().default(null),
  status: z.string().min(1),
  displayStatus: z.string().min(1).optional().default("UNKNOWN"),
  deleted: z.boolean().optional().default(false),
  modificationTime: z.string().nullable().optional().default(null),
}).passthrough();

const PaginationSchema = z.object({
  offset: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  totalCount: z.number().int().nonnegative().optional(),
}).passthrough();

const queryResponse = <Schema extends z.ZodTypeAny>(schema: Schema) => z.object({
  result: z.array(schema),
  pagination: PaginationSchema.optional(),
}).passthrough();

export const CampaignQueryResponseSchema = queryResponse(CampaignPayloadSchema);
export const AdGroupQueryResponseSchema = queryResponse(AdGroupPayloadSchema);
export const KeywordQueryResponseSchema = queryResponse(KeywordPayloadSchema);

export const KeywordSuggestionResponseSchema = z.object({
  result: z.array(z.object({
    text: z.string().min(1),
    popularity: z.number().min(0).max(100),
  }).passthrough()),
  pagination: PaginationSchema.optional(),
}).passthrough();

export const SearchTermPopularityResponseSchema = z.object({
  result: z.object({
    rows: z.array(z.object({
      countryOrRegion: z.string().regex(/^[A-Z]{2}$/),
      genre: z.string().min(1),
      searchTerm: z.string().min(1),
      week: z.string().optional(),
      month: z.string().optional(),
      rankInGenre: z.number().int().positive().nullable().optional(),
      searchPopularityInGenre: z.number().min(1).max(100).nullable().optional(),
      searchPopularity1to100: z.number().min(1).max(100).nullable().optional(),
      searchPopularity1to5: z.number().int().min(1).max(5).nullable().optional(),
    }).passthrough()),
  }).passthrough(),
  pagination: PaginationSchema.optional(),
}).passthrough();

const ReportMoneySchema = AppleAdsMoneyPayloadSchema.nullable().optional();
const CampaignReportMetricsSchema = z.object({
  localSpend: ReportMoneySchema,
  impressions: z.number().int().nonnegative().optional().default(0),
  taps: z.number().int().nonnegative().optional().default(0),
  ttr: z.number().nonnegative().optional().default(0),
  tapInstalls: z.number().int().nonnegative().optional().default(0),
  totalInstalls: z.number().int().nonnegative().optional().default(0),
  cpt: ReportMoneySchema,
  tapInstallCPI: ReportMoneySchema,
  totalAvgCPI: ReportMoneySchema,
}).passthrough();

export const CampaignReportResponseSchema = z.object({
  result: z.object({
    rows: z.array(z.object({
      metadata: z.object({
        id: AppleAdsIdSchema,
        name: z.string().min(1),
      }).passthrough(),
      totalMetrics: CampaignReportMetricsSchema,
    }).passthrough()),
  }).passthrough(),
  pagination: PaginationSchema.optional(),
}).passthrough();

export const OAuthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1),
}).passthrough();
