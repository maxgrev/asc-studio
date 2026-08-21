import { describe, expect, it } from "vitest";
import type { AppleAdsCampaign, AppStoreVersion, BuildSummary, MutationPlan } from "@asc-studio/contracts";
import {
  activePlans,
  budgetSummary,
  campaignCounts,
  pendingPlanCountLabel,
  selectPrimaryRelease,
  sortBuilds,
} from "./overviewData.js";

const build = (overrides: Partial<BuildSummary>): BuildSummary => ({
  id: "build",
  appId: "app",
  buildNumber: "1",
  version: "1.0.0",
  uploadedAt: "2026-08-20T12:00:00.000Z",
  processingStatus: "Ready",
  processingTone: "success",
  testingStatus: "Internal",
  expiresAt: null,
  expired: false,
  platform: "IOS",
  sdk: null,
  minimumOs: null,
  encryption: null,
  groups: [],
  ...overrides,
});

const version = (overrides: Partial<AppStoreVersion>): AppStoreVersion => ({
  id: "version",
  appId: "app",
  versionString: "1.0.0",
  platform: "IOS",
  state: "PREPARE_FOR_SUBMISSION",
  releaseType: "MANUAL",
  copyright: null,
  createdAt: null,
  copiedFrom: null,
  editable: true,
  ...overrides,
});

const campaign = (overrides: Partial<AppleAdsCampaign>): AppleAdsCampaign => ({
  id: "campaign",
  adAccountId: "account",
  name: "Campaign",
  promotedObjectId: "app",
  status: "ENABLED",
  systemStatus: "RUNNING",
  displayStatus: "RUNNING",
  startTime: null,
  endTime: null,
  dailyBudget: { amount: "10.00", currency: "USD" },
  countriesOrRegions: ["US"],
  supplyPlacements: ["APPSTORE_SEARCH_RESULTS"],
  bidStrategyType: "MANUAL_CPT",
  deleted: false,
  modificationTime: null,
  ...overrides,
});

describe("overview data helpers", () => {
  it("sorts builds by upload time and picks the editable release with the newest matching build", () => {
    const builds = [
      build({ id: "ios", uploadedAt: "2026-08-21T12:00:00.000Z", version: "2.5.0" }),
      build({ id: "mac", uploadedAt: "2026-08-21T11:00:00.000Z", version: "3.1.0", platform: "MAC_OS" }),
    ];
    const versions = [
      version({ id: "mac-version", versionString: "3.1.0", platform: "MAC_OS" }),
      version({ id: "ios-version", versionString: "2.5.0" }),
    ];

    expect(sortBuilds(builds).map((item) => item.id)).toEqual(["ios", "mac"]);
    expect(selectPrimaryRelease(versions, builds)?.id).toBe("ios-version");
  });

  it("keeps mixed Apple Ads currencies separate and excludes deleted campaigns", () => {
    const campaigns = [
      campaign({ id: "usd-enabled", dailyBudget: { amount: "35.00", currency: "USD" } }),
      campaign({ id: "usd-paused", status: "PAUSED", dailyBudget: { amount: "12.00", currency: "USD" } }),
      campaign({ id: "cad", dailyBudget: { amount: "20.00", currency: "CAD" } }),
      campaign({ id: "deleted", deleted: true, dailyBudget: { amount: "999.00", currency: "USD" } }),
    ];

    expect(campaignCounts(campaigns)).toEqual({ total: 3, enabled: 2, paused: 1 });
    expect(budgetSummary(campaigns)).toBe("CA$20.00 CAD · $47.00 USD");
  });

  it("uses release recency before platform when no matching build is available", () => {
    const versions = [
      version({ id: "older-ios", versionString: "2.5.0", createdAt: "2026-08-19T12:00:00.000Z" }),
      version({ id: "newer-mac", versionString: "3.1.0", platform: "MAC_OS", createdAt: "2026-08-20T12:00:00.000Z" }),
    ];

    expect(selectPrimaryRelease(versions, [])?.id).toBe("newer-mac");
  });

  it("filters expired plans and marks the capped count as inexact", () => {
    const plans = Array.from({ length: 50 }, (_, index) => ({
      id: `plan-${index}`,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: "2026-08-21T10:00:00.000Z",
      expiresAt: index === 0 ? "2026-08-21T10:05:00.000Z" : "2026-08-21T11:00:00.000Z",
      digest: `digest-${index}`,
      summary: "Pending change",
      context: { profile: null, connectionId: null, appleAdsAdAccountId: null, appleAdsMode: null },
      error: null,
      operation: "build.add_to_group",
      target: { appId: "app", buildId: "build", buildLabel: "1", groupId: "group", groupName: "QA" },
      before: { groupIds: [] },
      after: { groupIds: ["group"] },
    })) as MutationPlan[];

    const active = activePlans(plans, Date.parse("2026-08-21T10:30:00.000Z"));
    expect(active).toHaveLength(49);
    expect(pendingPlanCountLabel(plans, active.length)).toBe("49+");
  });

  it("keeps a capped all-expired plan response visibly uncertain", () => {
    const plans = Array.from({ length: 50 }, (_, index) => ({
      id: `expired-${index}`,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: "2026-08-21T10:00:00.000Z",
      expiresAt: "2026-08-21T10:05:00.000Z",
      digest: `digest-${index}`,
      summary: "Expired change",
      context: { profile: null, connectionId: null, appleAdsAdAccountId: null, appleAdsMode: null },
      error: null,
      operation: "build.add_to_group",
      target: { appId: "app", buildId: "build", buildLabel: "1", groupId: "group", groupName: "QA" },
      before: { groupIds: [] },
      after: { groupIds: ["group"] },
    })) as MutationPlan[];

    const active = activePlans(plans, Date.parse("2026-08-21T10:30:00.000Z"));
    expect(active).toHaveLength(0);
    expect(pendingPlanCountLabel(plans, active.length)).toBe("0+");
  });
});
