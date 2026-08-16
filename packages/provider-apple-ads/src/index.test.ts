import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AppleAdsPlatformProvider, type AppleAdsCredentials } from "./index.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials: AppleAdsCredentials = {
  profileName: "Growth account",
  clientId: "SEARCHADS.client-id",
  teamId: "SEARCHADS.team-id",
  keyId: "key-id",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  adAccountId: "123456789",
  authBackend: "Test memory",
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
});

const campaign = {
  id: 444555666,
  adAccountId: 123456789,
  name: "Orbit Notes · Brand",
  promotedObjectId: "987654321",
  status: "ENABLED",
  systemStatus: "RUNNING",
  displayStatus: "RUNNING",
  startTime: "2026-08-01T00:00:00.000",
  endTime: null,
  dailyBudget: { value: { amount: "25.00", currency: "USD" } },
  targeting: {
    countryOrRegion: { include: ["US"] },
    supplyPlacement: { include: ["APPSTORE_SEARCH_RESULTS"] },
  },
  bidStrategy: { bidStrategyType: "MANUAL_CPT", bidStrategyGoal: "TAP" },
  deleted: false,
  modificationTime: "2026-08-16T08:00:00.000Z",
};

describe("AppleAdsPlatformProvider", () => {
  it("exchanges a signed client secret, scopes requests to the ad account, and maps campaigns", async () => {
    const clientSecrets: string[] = [];
    const apiAuthorizations: string[] = [];
    const contexts: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "appleid.apple.com") {
        const body = new URLSearchParams(String(init?.body));
        clientSecrets.push(body.get("client_secret") ?? "");
        expect(body.get("client_id")).toBe(credentials.clientId);
        expect(body.get("grant_type")).toBe("client_credentials");
        expect(body.get("scope")).toBe("searchadsorg");
        return json({ access_token: "apple-access-token", token_type: "Bearer", expires_in: 3600, scope: "searchadsorg" });
      }
      const headers = new Headers(init?.headers);
      apiAuthorizations.push(headers.get("authorization") ?? "");
      contexts.push(headers.get("x-ap-context") ?? "");
      expect(url.pathname).toBe("/v1/campaigns/query");
      return json({ result: [campaign], pagination: { offset: 0, pageSize: 1000, totalCount: 1 } });
    }) as unknown as typeof fetch;
    const provider = new AppleAdsPlatformProvider({ credentials, fetch: mockFetch });

    await expect(provider.getAppleAdsStatus()).resolves.toMatchObject({ configured: true, connected: true, adAccountId: credentials.adAccountId });
    await expect(provider.listAppleAdsCampaigns("987654321")).resolves.toEqual([{
      id: "444555666",
      adAccountId: "123456789",
      name: "Orbit Notes · Brand",
      promotedObjectId: "987654321",
      status: "ENABLED",
      systemStatus: "RUNNING",
      displayStatus: "RUNNING",
      startTime: "2026-08-01T00:00:00.000",
      endTime: null,
      dailyBudget: { amount: "25.00", currency: "USD" },
      countriesOrRegions: ["US"],
      supplyPlacements: ["APPSTORE_SEARCH_RESULTS"],
      bidStrategyType: "MANUAL_CPT",
      deleted: false,
      modificationTime: "2026-08-16T08:00:00.000Z",
    }]);

    expect(clientSecrets).toHaveLength(1);
    const [encodedHeader, encodedPayload, encodedSignature] = clientSecrets[0]!.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toEqual({ alg: "ES256", kid: credentials.keyId });
    expect(JSON.parse(Buffer.from(encodedPayload!, "base64url").toString())).toMatchObject({
      sub: credentials.clientId,
      iss: credentials.teamId,
      aud: "https://appleid.apple.com",
    });
    expect(Buffer.from(encodedSignature!, "base64url")).toHaveLength(64);
    expect(new Set(apiAuthorizations)).toEqual(new Set(["Bearer apple-access-token"]));
    expect(new Set(contexts)).toEqual(new Set([`adAccountId=${credentials.adAccountId}`]));
  });

  it("merges Apple keyword suggestions with genre popularity without inventing difficulty", async () => {
    const requestBodies = new Map<string, unknown>();
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "appleid.apple.com") {
        return json({ access_token: "token", token_type: "Bearer", expires_in: 3600, scope: "searchadsorg" });
      }
      requestBodies.set(url.pathname, JSON.parse(String(init?.body)));
      if (url.pathname === "/v1/suggestions/keywords/query") {
        return json({
          result: [
            { text: "notes app", popularity: 90 },
            { text: "markdown notes", popularity: 72 },
          ],
          pagination: { offset: 0, pageSize: 20, totalCount: 2 },
        });
      }
      if (url.pathname === "/v1/insights/apps/search-term-popularity/query") {
        return json({
          result: { rows: [
            {
              week: "2026-08-09",
              countryOrRegion: "US",
              genre: "PRODUCTIVITY_UTILITIES",
              searchTerm: "notes app",
              rankInGenre: 2,
              searchPopularityInGenre: 96,
              searchPopularity1to100: 88,
              searchPopularity1to5: 5,
            },
            {
              week: "2026-08-09",
              countryOrRegion: "US",
              genre: "PRODUCTIVITY_UTILITIES",
              searchTerm: "task manager",
              rankInGenre: 1,
              searchPopularityInGenre: 98,
              searchPopularity1to100: 92,
              searchPopularity1to5: 5,
            },
          ] },
          pagination: { offset: 0, pageSize: 20, totalCount: 2 },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const provider = new AppleAdsPlatformProvider({ credentials, fetch: mockFetch });

    const result = await provider.researchAppleAdsKeywords({
      appId: "987654321",
      countryOrRegion: "US",
      genre: "PRODUCTIVITY_UTILITIES",
      start: "2026-08-09",
      end: "2026-08-15",
      granularity: "WEEKLY_SUN_SAT",
      seedTerms: ["notes", "writing"],
      limit: 20,
    });

    expect(result.keywords).toEqual([
      expect.objectContaining({ text: "task manager", source: "popularity", suggestionPopularity: null, searchPopularity: 92, rankInGenre: 1 }),
      expect.objectContaining({ text: "notes app", source: "both", suggestionPopularity: 90, searchPopularity: 88, rankInGenre: 2 }),
      expect.objectContaining({ text: "markdown notes", source: "suggestion", suggestionPopularity: 72, searchPopularity: null }),
    ]);
    expect(result.note).toContain("does not provide keyword difficulty");
    expect(requestBodies.get("/v1/suggestions/keywords/query")).toMatchObject({
      filters: expect.arrayContaining([{ field: "terms", operator: "IN", value: ["notes", "writing"] }]),
    });
    expect(requestBodies.get("/v1/insights/apps/search-term-popularity/query")).toMatchObject({
      timeRange: { start: "2026-08-09", end: "2026-08-15", granularity: "WEEKLY_SUN_SAT" },
    });
  });

  it("maps campaign performance metrics", async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.hostname === "appleid.apple.com") {
        return json({ access_token: "token", token_type: "Bearer", expires_in: 3600, scope: "searchadsorg" });
      }
      return json({ result: { rows: [{
        metadata: { id: 444555666, name: "Orbit Notes · Brand" },
        totalMetrics: {
          localSpend: { amount: "120.50", currency: "USD" },
          impressions: 10_000,
          taps: 500,
          ttr: 0.05,
          cpt: { amount: "0.24", currency: "USD" },
          tapInstalls: 220,
          totalInstalls: 240,
          tapInstallCPI: { amount: "0.55", currency: "USD" },
        },
      }] }, pagination: { offset: 0, pageSize: 1, totalCount: 1 } });
    }) as unknown as typeof fetch;
    const provider = new AppleAdsPlatformProvider({ credentials, fetch: mockFetch });

    await expect(provider.getAppleAdsCampaignReport({
      campaignId: "444555666",
      start: "2026-08-01",
      end: "2026-08-15",
      timeZone: "ORTZ",
    })).resolves.toEqual({
      campaignId: "444555666",
      name: "Orbit Notes · Brand",
      localSpend: { amount: "120.50", currency: "USD" },
      impressions: 10_000,
      taps: 500,
      tapThroughRate: 0.05,
      tapInstalls: 220,
      totalInstalls: 240,
      averageCostPerTap: { amount: "0.24", currency: "USD" },
      averageCostPerAcquisition: { amount: "0.55", currency: "USD" },
    });
  });
});
