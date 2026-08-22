import type {
  AddBuildToGroupInput,
  AgentStatus,
  AppleAdsAdGroup,
  AppleAdsCampaign,
  AppleAdsKeyword,
  AppStorePlatform,
  AppStoreVersion,
  AppSummary,
  AuditEvent,
  BuildSummary,
  CreateVersionInput,
  CustomerReview,
  CustomerReviewResponse,
  LocalizationSnapshot,
  MutationPlan,
  ScreenshotAsset,
  ScreenshotDisplayType,
  SubmitVersionInput,
  TesterGroup,
  ValidationReport,
  VersionLocalization,
  VersionLocalizationPatch,
  VersionSubmissionPreview,
  VersionSubmissionResult,
  VersionSubmissionStatus,
} from "@asc-studio/contracts";
import { describe, expect, it } from "vitest";
import { AscStudioService, stableJson, type AppleAdsProvider, type AscProvider, type PlanStore } from "./index.js";

const app: AppSummary = {
  id: "demo-app-orbit-notes",
  name: "Orbit Notes",
  bundleId: "com.example.orbitnotes",
  platforms: ["IOS"],
};

const groups: TesterGroup[] = [
  { id: "demo-group-team", name: "Team", testerCount: 8, internal: true },
  { id: "demo-group-qa", name: "QA", testerCount: 4, internal: true },
];

const initialBuild: BuildSummary = {
  id: "demo-build-204",
  appId: app.id,
  buildNumber: "204",
  version: "2.4.0",
  uploadedAt: "2026-07-31T18:48:00.000Z",
  processingStatus: "Ready",
  processingTone: "success",
  testingStatus: "Internal",
  expiresAt: "2026-10-28T19:00:00.000Z",
  expired: false,
  platform: "IOS",
  sdk: "iOS 20.0",
  minimumOs: "iOS 18.0",
  encryption: "No",
  groups: [groups[0]!],
};

const submissionBuild: BuildSummary = {
  ...initialBuild,
  id: "demo-build-211",
  buildNumber: "211",
  version: "2.5.0",
  groups: [],
};

const initialReview: CustomerReview = {
  id: "review-1",
  appId: app.id,
  rating: 5,
  title: "Exactly what I needed",
  body: "Fast, focused, and reliable.",
  reviewerNickname: "MapleWriter",
  createdAt: "2026-07-30T18:00:00.000Z",
  territory: "USA",
  response: null,
};

class FakeAscProvider implements AscProvider, AppleAdsProvider {
  private readonly builds = [structuredClone(submissionBuild), structuredClone(initialBuild)];
  private readonly reviews = [structuredClone(initialReview)];
  private attachedBuildId: string | null = null;
  private submission: VersionSubmissionStatus | null = null;
  private validationBlocking = 0;
  private previewCalls = 0;
  private connectionId = "core-test";
  private lastReviewCursor: string | undefined;
  private readonly adsCampaigns: AppleAdsCampaign[] = [{
    id: "ads-campaign-1",
    adAccountId: "ads-account-1",
    name: "Orbit Notes · Category",
    promotedObjectId: app.id,
    status: "PAUSED",
    systemStatus: "NOT_RUNNING",
    displayStatus: "PAUSED",
    startTime: null,
    endTime: null,
    dailyBudget: { amount: "20.00", currency: "USD" },
    countriesOrRegions: ["US"],
    supplyPlacements: ["APPSTORE_SEARCH_RESULTS"],
    bidStrategyType: "MANUAL_CPT",
    deleted: false,
    modificationTime: "2026-07-31T18:00:00.000Z",
  }];
  private readonly adsAdGroups: AppleAdsAdGroup[] = [];
  private readonly adsKeywords: AppleAdsKeyword[] = [];
  private readonly versions: AppStoreVersion[] = [
    {
      id: "version-250",
      appId: app.id,
      versionString: "2.5.0",
      platform: "IOS",
      state: "PREPARE_FOR_SUBMISSION",
      releaseType: "MANUAL",
      copyright: "2026 Northstar Labs",
      createdAt: "2026-07-31T18:00:00.000Z",
      copiedFrom: "2.4.0",
      editable: true,
    },
    {
      id: "version-240",
      appId: app.id,
      versionString: "2.4.0",
      platform: "IOS",
      state: "READY_FOR_DISTRIBUTION",
      releaseType: "MANUAL",
      copyright: "2026 Northstar Labs",
      createdAt: "2026-06-20T18:00:00.000Z",
      copiedFrom: null,
      editable: false,
    },
  ];
  private readonly localizations: VersionLocalization[] = [
    {
      id: "localization-en-US",
      versionId: "version-250",
      locale: "en-US",
      description: "Keep every idea organized.",
      keywords: "notes,ideas,tasks",
      marketingUrl: "https://example.com",
      promotionalText: "Capture ideas fast.",
      supportUrl: "https://example.com/support",
      whatsNew: "A faster editor.",
    },
  ];
  private readonly screenshots: ScreenshotAsset[] = [{
    id: "screenshot-1",
    localizationId: "localization-en-US",
    locale: "en-US",
    displayType: "APP_IPHONE_67",
    fileName: "01-editor.png",
    fileSize: 1_200_000,
    width: 1290,
    height: 2796,
    checksum: "apple-checksum-1",
    state: "COMPLETE",
    imageUrl: null,
    fullImageUrl: null,
    sortOrder: 0,
  }];

  async getStatus(): Promise<AgentStatus> {
    return {
      mode: "demo",
      connected: true,
      provider: "demo",
      connectionId: this.connectionId,
      profile: null,
      authBackend: null,
      detail: "Core test provider",
    };
  }

  setConnectionId(connectionId: string) {
    this.connectionId = connectionId;
  }

  async listApps() {
    return [structuredClone(app)];
  }

  async listCustomerReviews(appId: string, options?: Parameters<AscProvider["listCustomerReviews"]>[1]) {
    this.assertApp(appId);
    this.lastReviewCursor = options?.cursor;
    return {
      reviews: structuredClone(this.reviews),
      total: this.reviews.length,
      nextCursor: null,
    };
  }

  async getCustomerReview(appId: string, reviewId: string) {
    this.assertApp(appId);
    const review = this.reviews.find((candidate) => candidate.id === reviewId);
    if (!review) throw new Error(`Review ${reviewId} was not found.`);
    return structuredClone(review);
  }

  async upsertCustomerReviewResponse(reviewId: string, responseBody: string): Promise<CustomerReviewResponse> {
    const review = this.reviews.find((candidate) => candidate.id === reviewId);
    if (!review) throw new Error(`Review ${reviewId} was not found.`);
    const response: CustomerReviewResponse = {
      id: review.response?.id ?? "response-1",
      reviewId,
      responseBody,
      lastModifiedAt: "2026-07-31T19:00:00.000Z",
      state: "PENDING_PUBLISH",
    };
    review.response = response;
    return structuredClone(response);
  }

  async listBuilds(appId: string) {
    this.assertApp(appId);
    return structuredClone(this.builds);
  }

  async getBuild(appId: string, buildId: string) {
    this.assertApp(appId);
    const build = this.builds.find((candidate) => candidate.id === buildId);
    if (!build) throw new Error(`Build ${buildId} was not found.`);
    return structuredClone(build);
  }

  async listGroups(appId: string) {
    this.assertApp(appId);
    return structuredClone(groups);
  }

  async addBuildToGroup(input: AddBuildToGroupInput) {
    this.assertApp(input.appId);
    const build = this.builds.find((candidate) => candidate.id === input.buildId);
    const group = groups.find((candidate) => candidate.id === input.groupId);
    if (!build || !group) throw new Error("The selected build or group was not found.");
    if (!build.groups.some((candidate) => candidate.id === group.id)) build.groups.push(structuredClone(group));
  }

  async listVersions(appId: string, platform?: AppStorePlatform) {
    this.assertApp(appId);
    return structuredClone(platform ? this.versions.filter((version) => version.platform === platform) : this.versions);
  }

  async listVersionLocalizations(versionId: string) {
    if (!this.versions.some((version) => version.id === versionId)) throw new Error(`Version ${versionId} was not found.`);
    return structuredClone(this.localizations.filter((localization) => localization.versionId === versionId));
  }

  async listScreenshots(
    localizationId: string,
    locale: VersionLocalization["locale"],
    displayType: ScreenshotDisplayType,
  ) {
    return structuredClone(this.screenshots.filter((asset) => (
      asset.localizationId === localizationId && asset.locale === locale && asset.displayType === displayType
    )));
  }

  async applyScreenshotChanges(input: Parameters<AscProvider["applyScreenshotChanges"]>[0]) {
    const current = this.screenshots.filter((asset) => (
      asset.localizationId === input.localizationId && asset.displayType === input.displayType
    ));
    const snapshot = current.map(({ localizationId: _localizationId, locale: _locale, displayType: _displayType, imageUrl: _imageUrl, fullImageUrl: _fullImageUrl, ...asset }) => asset);
    if (stableJson(snapshot) !== stableJson(input.expected)) throw new Error("Screenshots changed.");
    const deleteIds = new Set(input.deleteIds);
    for (let index = this.screenshots.length - 1; index >= 0; index -= 1) {
      if (deleteIds.has(this.screenshots[index]!.id)) this.screenshots.splice(index, 1);
    }
    for (const upload of input.uploads) {
      this.screenshots.push({
        id: `screenshot-${upload.uploadId}`,
        localizationId: input.localizationId,
        locale: input.locale,
        displayType: input.displayType,
        fileName: upload.fileName,
        fileSize: upload.fileSize,
        width: upload.width,
        height: upload.height,
        checksum: upload.checksum,
        state: "COMPLETE",
        imageUrl: null,
        fullImageUrl: null,
        sortOrder: this.screenshots.length,
      });
    }
  }

  async createVersion(input: CreateVersionInput) {
    this.assertApp(input.appId);
    const created: AppStoreVersion = {
      id: `version-${input.versionString}`,
      appId: input.appId,
      versionString: input.versionString,
      platform: input.platform,
      state: "PREPARE_FOR_SUBMISSION",
      releaseType: input.releaseType,
      copyright: null,
      createdAt: "2026-07-31T19:00:00.000Z",
      copiedFrom: input.copyMetadataFrom,
      editable: true,
    };
    this.versions.unshift(created);
    return structuredClone(created);
  }

  async applyVersionLocalizationPatches(
    versionId: string,
    patches: VersionLocalizationPatch[],
    expected: LocalizationSnapshot[],
  ) {
    const current = expected.map((snapshot) => this.snapshot(versionId, snapshot.locale));
    if (stableJson(current) !== stableJson(expected)) throw new Error("Localization metadata changed.");
    for (const patch of patches) {
      let localization = this.localizations.find((item) => item.versionId === versionId && item.locale === patch.locale);
      if (!localization) {
        localization = {
          id: `${versionId}-${patch.locale}`,
          versionId,
          locale: patch.locale,
          description: "",
          keywords: "",
          marketingUrl: "",
          promotionalText: "",
          supportUrl: "",
          whatsNew: "",
        };
        this.localizations.push(localization);
      }
      if (patch.whatsNew !== undefined) localization.whatsNew = patch.whatsNew;
      if (patch.promotionalText !== undefined) localization.promotionalText = patch.promotionalText;
      if (patch.keywords !== undefined) localization.keywords = patch.keywords;
    }
  }

  async validateVersion(appId: string, versionId: string, platform: AppStorePlatform): Promise<ValidationReport> {
    this.assertApp(appId);
    return {
      appId,
      versionId,
      versionString: "2.5.0",
      platform,
      summary: {
        errors: this.validationBlocking,
        warnings: 0,
        infos: 0,
        blocking: this.validationBlocking,
      },
      remediation: { totalActionable: 0, steps: [] },
      checks: [],
      strict: false,
    };
  }

  async previewVersionSubmission(input: SubmitVersionInput): Promise<VersionSubmissionPreview> {
    this.previewCalls += 1;
    const { version, build } = this.submissionResources(input);
    return {
      appId: input.appId,
      versionId: input.versionId,
      versionString: version.versionString,
      platform: version.platform,
      buildId: input.buildId,
      currentBuildId: this.attachedBuildId,
      wouldAttach: !this.submission && this.attachedBuildId !== build.id,
      alreadyAttached: this.attachedBuildId === build.id,
      wouldSubmit: !this.submission,
      alreadySubmitted: Boolean(this.submission),
      submissionId: this.submission?.id ?? null,
    };
  }

  async submitVersion(input: SubmitVersionInput): Promise<VersionSubmissionResult> {
    const { version, build } = this.submissionResources(input);
    const alreadyAttached = this.attachedBuildId === build.id;
    this.attachedBuildId = build.id;
    this.submission = {
      id: "submission-250",
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      state: "WAITING_FOR_REVIEW",
      submittedAt: "2026-07-31T19:00:00.000Z",
    };
    return {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      buildId: build.id,
      submissionId: this.submission.id!,
      submittedAt: this.submission.submittedAt,
      alreadySubmitted: false,
      attached: !alreadyAttached,
      alreadyAttached,
    };
  }

  async getVersionSubmissionStatus(versionId: string): Promise<VersionSubmissionStatus> {
    if (this.submission?.versionId === versionId) return structuredClone(this.submission);
    const version = this.versions.find((candidate) => candidate.id === versionId);
    if (!version) throw new Error(`Version ${versionId} was not found.`);
    return {
      id: null,
      versionId,
      versionString: version.versionString,
      platform: version.platform,
      state: version.state,
      submittedAt: null,
    };
  }

  async getAppleAdsStatus() {
    return {
      mode: "demo" as const,
      configured: true,
      connected: true,
      provider: "demo" as const,
      adAccountId: "ads-account-1",
      detail: "Test Apple Ads account.",
    };
  }

  async researchAppleAdsKeywords(): Promise<never> { throw new Error("Not used in this test."); }
  async getAppleAdsCampaignReport(): Promise<never> { throw new Error("Not used in this test."); }

  async listAppleAdsCampaigns(appId?: string) {
    return structuredClone(appId ? this.adsCampaigns.filter((campaign) => campaign.promotedObjectId === appId) : this.adsCampaigns);
  }

  async getAppleAdsCampaign(campaignId: string) {
    const campaign = this.adsCampaigns.find((candidate) => candidate.id === campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    return structuredClone(campaign);
  }

  async createAppleAdsCampaign(input: Parameters<AppleAdsProvider["createAppleAdsCampaign"]>[0]) {
    const campaign: AppleAdsCampaign = {
      id: `ads-campaign-${this.adsCampaigns.length + 1}`,
      adAccountId: "ads-account-1",
      name: input.name,
      promotedObjectId: input.promotedObjectId,
      status: input.status,
      systemStatus: "NOT_RUNNING",
      displayStatus: "PAUSED",
      startTime: input.startTime,
      endTime: input.endTime,
      dailyBudget: input.dailyBudget,
      countriesOrRegions: input.countriesOrRegions,
      supplyPlacements: ["APPSTORE_SEARCH_RESULTS"],
      bidStrategyType: input.bidStrategyType,
      deleted: false,
      modificationTime: "2026-07-31T19:00:00.000Z",
    };
    this.adsCampaigns.push(campaign);
    return structuredClone(campaign);
  }

  async updateAppleAdsCampaign(input: Parameters<AppleAdsProvider["updateAppleAdsCampaign"]>[0]) {
    const campaign = this.adsCampaigns.find((candidate) => candidate.id === input.campaignId);
    if (!campaign) throw new Error("Campaign not found.");
    if (input.name !== undefined) campaign.name = input.name;
    if (input.dailyBudget !== undefined) campaign.dailyBudget = input.dailyBudget;
    if (input.countriesOrRegions !== undefined) campaign.countriesOrRegions = input.countriesOrRegions;
    if (input.endTime !== undefined) campaign.endTime = input.endTime;
    if (input.status !== undefined) campaign.status = input.status;
    return structuredClone(campaign);
  }

  async listAppleAdsAdGroups(campaignId: string) { return structuredClone(this.adsAdGroups.filter((group) => group.campaignId === campaignId)); }
  async getAppleAdsAdGroup(adGroupId: string) {
    const group = this.adsAdGroups.find((candidate) => candidate.id === adGroupId);
    if (!group) throw new Error("Ad group not found.");
    return structuredClone(group);
  }
  async createAppleAdsAdGroup(input: Parameters<AppleAdsProvider["createAppleAdsAdGroup"]>[0]) {
    const group: AppleAdsAdGroup = {
      id: `ads-group-${this.adsAdGroups.length + 1}`,
      campaignId: input.campaignId,
      name: input.name,
      status: input.status,
      systemStatus: "NOT_RUNNING",
      displayStatus: "PAUSED",
      automatedKeywordsOptIn: input.automatedKeywordsOptIn,
      bid: input.bid,
      startTime: input.startTime,
      endTime: input.endTime,
      deleted: false,
      modificationTime: "2026-07-31T19:00:00.000Z",
    };
    this.adsAdGroups.push(group);
    return structuredClone(group);
  }

  async listAppleAdsKeywords(input: { campaignId?: string; adGroupId?: string }) {
    return structuredClone(this.adsKeywords.filter((keyword) => (!input.campaignId || keyword.campaignId === input.campaignId) && (!input.adGroupId || keyword.adGroupId === input.adGroupId)));
  }
  async getAppleAdsKeyword(keywordId: string) {
    const keyword = this.adsKeywords.find((candidate) => candidate.id === keywordId);
    if (!keyword) throw new Error("Keyword not found.");
    return structuredClone(keyword);
  }
  async createAppleAdsKeyword(input: Parameters<AppleAdsProvider["createAppleAdsKeyword"]>[0]) {
    const keyword: AppleAdsKeyword = {
      id: `ads-keyword-${this.adsKeywords.length + 1}`,
      campaignId: input.campaignId,
      adGroupId: input.adGroupId,
      text: input.text,
      matchType: input.matchType,
      bid: input.bid,
      status: input.status,
      displayStatus: "PAUSED",
      deleted: false,
      modificationTime: "2026-07-31T19:00:00.000Z",
    };
    this.adsKeywords.push(keyword);
    return structuredClone(keyword);
  }
  async updateAppleAdsKeyword(input: Parameters<AppleAdsProvider["updateAppleAdsKeyword"]>[0]) {
    const keyword = this.adsKeywords.find((candidate) => candidate.id === input.keywordId);
    if (!keyword) throw new Error("Keyword not found.");
    if (input.bid !== undefined) keyword.bid = input.bid;
    if (input.status !== undefined) keyword.status = input.status;
    return structuredClone(keyword);
  }

  setAppleAdsCampaignBudget(amount: string) {
    this.adsCampaigns[0]!.dailyBudget.amount = amount;
  }

  setReviewTitle(title: string) {
    this.reviews[0]!.title = title;
  }

  setReviewResponse(response: CustomerReviewResponse | null) {
    this.reviews[0]!.response = structuredClone(response);
  }

  removeReview() {
    this.reviews.splice(0, this.reviews.length);
  }

  getLastReviewCursor() {
    return this.lastReviewCursor;
  }

  setWhatsNew(value: string) {
    const localization = this.localizations.find((item) => item.id === "localization-en-US");
    if (localization) localization.whatsNew = value;
  }

  setScreenshotFileName(value: string) {
    if (this.screenshots[0]) this.screenshots[0].fileName = value;
  }

  setValidationBlocking(value: number) {
    this.validationBlocking = value;
  }

  getPreviewCalls() {
    return this.previewCalls;
  }

  setAttachedBuild(buildId: string | null) {
    this.attachedBuildId = buildId;
  }

  private submissionResources(input: SubmitVersionInput) {
    this.assertApp(input.appId);
    const version = this.versions.find((candidate) => candidate.id === input.versionId);
    const build = this.builds.find((candidate) => candidate.id === input.buildId);
    if (!version || !build) throw new Error("The selected version or build was not found.");
    return { version, build };
  }

  private snapshot(versionId: string, locale: VersionLocalization["locale"]): LocalizationSnapshot {
    const localization = this.localizations.find((item) => item.versionId === versionId && item.locale === locale);
    return {
      id: localization?.id ?? null,
      locale,
      whatsNew: localization?.whatsNew ?? "",
      promotionalText: localization?.promotionalText ?? "",
      keywords: localization?.keywords ?? "",
    };
  }

  private assertApp(appId: string) {
    if (appId !== app.id) throw new Error(`App ${appId} was not found.`);
  }
}

class MemoryStore implements PlanStore {
  readonly plans = new Map<string, MutationPlan>();
  readonly events: AuditEvent[] = [];

  async savePlan(plan: MutationPlan) {
    this.plans.set(plan.id, structuredClone(plan));
  }

  async getPlan(id: string) {
    return structuredClone(this.plans.get(id) ?? null);
  }

  async listPlans(state: MutationPlan["state"], limit: number) {
    return [...this.plans.values()].filter((plan) => plan.state === state).slice(0, limit);
  }

  async claimPlan(id: string, expectedState: MutationPlan["state"], next: MutationPlan) {
    if (this.plans.get(id)?.state !== expectedState) return false;
    this.plans.set(id, structuredClone(next));
    return true;
  }

  async appendAudit(event: Omit<AuditEvent, "sequence">) {
    const stored = { ...event, sequence: this.events.length + 1 };
    this.events.unshift(stored);
    return stored;
  }

  async listAudit(limit: number) {
    return this.events.slice(0, limit);
  }
}

const createHarness = () => {
  const provider = new FakeAscProvider();
  const store = new MemoryStore();
  let id = 0;
  let currentTime = new Date("2026-07-31T19:00:00.000Z");
  const coreService = new AscStudioService({
    provider,
    adsProvider: provider,
    store,
    now: () => currentTime,
    id: () => `id-${++id}`,
    digest: (value) => `digest:${value}`,
  });
  const service = {
    listCustomerReviews: (appId: string, options?: Parameters<AscStudioService["listCustomerReviews"]>[1]) =>
      coreService.listCustomerReviews(appId, options),
    getCustomerReview: (appId: string, reviewId: string) => coreService.getCustomerReview(appId, reviewId),
    createUpsertCustomerReviewResponsePlan: (
      input: Parameters<AscStudioService["createUpsertCustomerReviewResponsePlan"]>[0],
    ) => coreService.createUpsertCustomerReviewResponsePlan(input, "gui"),
    createAddBuildToGroupPlan: (input: AddBuildToGroupInput) => coreService.createAddBuildToGroupPlan(input, "gui"),
    confirmAddBuildToGroupPlan: (planId: string, digest: string) => coreService.confirmAddBuildToGroupPlan(planId, digest, "gui"),
    listBuilds: (appId: string) => coreService.listBuilds(appId),
    createVersionPlan: (input: CreateVersionInput) => coreService.createVersionPlan(input, "gui"),
    createUpdateVersionLocalizationsPlan: (input: Parameters<AscStudioService["createUpdateVersionLocalizationsPlan"]>[0]) =>
      coreService.createUpdateVersionLocalizationsPlan(input, "gui"),
    createUpdateScreenshotsPlan: (input: Parameters<AscStudioService["createUpdateScreenshotsPlan"]>[0]) =>
      coreService.createUpdateScreenshotsPlan(input, "gui"),
    createSubmitVersionPlan: (input: SubmitVersionInput) => coreService.createSubmitVersionPlan(input, "gui"),
    createAppleAdsCampaignPlan: (input: Parameters<AscStudioService["createAppleAdsCampaignPlan"]>[0]) => coreService.createAppleAdsCampaignPlan(input, "gui"),
    createUpdateAppleAdsCampaignPlan: (input: Parameters<AscStudioService["createUpdateAppleAdsCampaignPlan"]>[0]) => coreService.createUpdateAppleAdsCampaignPlan(input, "gui"),
    createAppleAdsAdGroupPlan: (input: Parameters<AscStudioService["createAppleAdsAdGroupPlan"]>[0]) => coreService.createAppleAdsAdGroupPlan(input, "gui"),
    createAppleAdsKeywordPlan: (input: Parameters<AscStudioService["createAppleAdsKeywordPlan"]>[0]) => coreService.createAppleAdsKeywordPlan(input, "gui"),
    confirmPlan: (planId: string, digest: string) => coreService.confirmPlan(planId, digest, "gui"),
    listVersions: (appId: string) => coreService.listVersions(appId),
    listVersionLocalizations: (appId: string, versionId: string) => coreService.listVersionLocalizations(appId, versionId),
    listScreenshots: (
      appId: string,
      versionId: string,
      localizationId: string,
      displayType: ScreenshotDisplayType,
    ) => coreService.listScreenshots(appId, versionId, localizationId, displayType),
    getVersionSubmissionStatus: (appId: string, versionId: string) =>
      coreService.getVersionSubmissionStatus(appId, versionId),
  };
  return {
    provider,
    service,
    store,
    advance: (milliseconds: number) => { currentTime = new Date(currentTime.getTime() + milliseconds); },
  };
};

describe("stableJson", () => {
  it("orders object keys while preserving array order", () => {
    expect(stableJson({ z: 1, a: { d: 4, c: 3 }, list: ["b", "a"] })).toBe(
      '{"a":{"c":3,"d":4},"list":["b","a"],"z":1}',
    );
  });
});

describe("AscStudioService mutation plans", () => {
  it("plans an exact first customer-review response with a stable digest", async () => {
    const { service } = createHarness();
    const responseBody = "  Thanks for the thoughtful review.\nWe appreciate it.  ";
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody,
    });

    expect(plan.operation).toBe("customer_review.response.upsert");
    if (plan.operation !== "customer_review.response.upsert") throw new Error("Expected customer-review response plan.");
    expect(plan.target).toEqual({
      appId: app.id,
      reviewId: initialReview.id,
      reviewTitle: initialReview.title,
      reviewerNickname: initialReview.reviewerNickname,
    });
    expect(plan.before).toEqual(initialReview);
    expect(plan.after).toEqual({ responseBody });
    expect(plan.summary).toBe("Respond to review from MapleWriter");
    expect(plan.digest).toBe(`digest:${stableJson({
      operation: plan.operation,
      context: plan.context,
      target: plan.target,
      before: plan.before,
      after: plan.after,
      expiresAt: plan.expiresAt,
    })}`);
  });

  it("publishes a first customer-review response only after confirmation", async () => {
    const { service, store } = createHarness();
    const responseBody = "  Thank you for taking the time to review us.  ";
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody,
    });

    await expect(service.confirmPlan(plan.id, plan.digest)).resolves.toMatchObject({ state: "succeeded" });
    await expect(service.getCustomerReview(app.id, initialReview.id)).resolves.toMatchObject({
      response: { responseBody, state: "PENDING_PUBLISH" },
    });
    expect(store.events.map((event) => `${event.operation}:${event.phase}`)).toEqual([
      "customer_review.response.upsert:succeeded",
      "customer_review.response.upsert:running",
      "customer_review.response.upsert:planned",
    ]);
  });

  it("distinguishes and applies a replacement customer-review response", async () => {
    const { provider, service } = createHarness();
    provider.setReviewResponse({
      id: "response-1",
      reviewId: initialReview.id,
      responseBody: "Original response",
      lastModifiedAt: "2026-07-30T20:00:00.000Z",
      state: "PUBLISHED",
    });
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: "Replacement response",
    });

    expect(plan.summary).toBe("Replace response to review from MapleWriter");
    await service.confirmPlan(plan.id, plan.digest);
    await expect(service.getCustomerReview(app.id, initialReview.id)).resolves.toMatchObject({
      response: { id: "response-1", responseBody: "Replacement response", state: "PENDING_PUBLISH" },
    });
  });

  it("rejects empty and exactly unchanged customer-review responses", async () => {
    const { provider, service } = createHarness();
    await expect(service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: " \n\t ",
    })).rejects.toMatchObject({ code: "invalid_response_body" });

    provider.setReviewResponse({
      id: "response-1",
      reviewId: initialReview.id,
      responseBody: "Keep this exact response",
      lastModifiedAt: null,
      state: "PENDING_PUBLISH",
    });
    await expect(service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: "Keep this exact response",
    })).rejects.toMatchObject({ code: "no_changes" });
  });

  it("maps a missing customer review to a domain error during planning", async () => {
    const { service } = createHarness();
    await expect(service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: "missing-review",
      responseBody: "Thanks for your feedback.",
    })).rejects.toMatchObject({ code: "review_not_found" });
  });

  it("fails closed when customer-review content changes after planning", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: "Thanks for the review.",
    });
    provider.setReviewTitle("Edited remotely");

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("marks a customer-review response plan stale when the review disappears", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: "Thanks for the review.",
    });
    provider.removeReview();

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("fails closed when a pending customer-review response becomes published", async () => {
    const { provider, service, store } = createHarness();
    const pending: CustomerReviewResponse = {
      id: "response-1",
      reviewId: initialReview.id,
      responseBody: "Original response",
      lastModifiedAt: "2026-07-30T20:00:00.000Z",
      state: "PENDING_PUBLISH",
    };
    provider.setReviewResponse(pending);
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: "Replacement response",
    });
    provider.setReviewResponse({ ...pending, state: "PUBLISHED" });

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("rejects a customer-review response plan after the active Apple account changes", async () => {
    const { provider, service } = createHarness();
    const plan = await service.createUpsertCustomerReviewResponsePlan({
      appId: app.id,
      reviewId: initialReview.id,
      responseBody: "Thanks for the review.",
    });
    provider.setConnectionId("another-account");

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "workspace_changed" });
  });

  it("treats customer-review cursors as opaque and rejects overlong cursors", async () => {
    const { provider, service } = createHarness();
    await expect(service.listCustomerReviews(app.id, { cursor: "opaque+/=cursor" })).resolves.toMatchObject({ total: 1 });
    expect(provider.getLastReviewCursor()).toBe("opaque+/=cursor");
    await expect(service.listCustomerReviews(app.id, { cursor: "x".repeat(2_049) })).rejects.toMatchObject({
      code: "invalid_cursor",
    });
  });

  it("plans, confirms, applies, and audits a group assignment", async () => {
    const { service, store } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });

    expect(plan.operation).toBe("build.add_to_group");
    if (plan.operation !== "build.add_to_group") throw new Error("Expected build group plan.");
    expect(plan.state).toBe("awaiting_confirmation");
    expect(plan.before.groupIds).toEqual(["demo-group-team"]);
    expect(plan.after.groupIds).toEqual(["demo-group-qa", "demo-group-team"]);

    const result = await service.confirmAddBuildToGroupPlan(plan.id, plan.digest);
    const builds = await service.listBuilds("demo-app-orbit-notes");

    expect(result.state).toBe("succeeded");
    expect(builds.find((build) => build.id === "demo-build-204")?.groups.map((group) => group.name)).toEqual(["Team", "QA"]);
    expect(store.events.map((event) => event.phase)).toEqual(["succeeded", "running", "planned"]);
    expect(store.events.every((event) => event.actor === "gui")).toBe(true);
  });

  it("rejects a confirmation that does not match the reviewed digest", async () => {
    const { service } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });

    await expect(service.confirmAddBuildToGroupPlan(plan.id, "different-digest")).rejects.toMatchObject({
      code: "plan_changed",
    });
  });

  it("rejects a reviewed plan after the active Apple account changes", async () => {
    const { provider, service } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });
    provider.setConnectionId("another-account");

    await expect(service.confirmAddBuildToGroupPlan(plan.id, plan.digest)).rejects.toMatchObject({
      code: "workspace_changed",
    });
  });

  it("rejects a stored plan whose reviewed fields were changed", async () => {
    const { service, store } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });
    if (plan.operation !== "build.add_to_group") throw new Error("Expected build group plan.");
    store.plans.set(plan.id, {
      ...plan,
      target: { ...plan.target, groupName: "Release" },
    });

    await expect(service.confirmAddBuildToGroupPlan(plan.id, plan.digest)).rejects.toMatchObject({
      code: "plan_changed",
    });
  });

  it("creates and confirms a new version plan with metadata carry-forward", async () => {
    const { service, store } = createHarness();
    const plan = await service.createVersionPlan({
      appId: app.id,
      versionString: "2.6.0",
      platform: "IOS",
      copyMetadataFrom: "2.5.0",
      releaseType: "MANUAL",
      excludeWhatsNew: true,
    });

    expect(plan.operation).toBe("version.create");
    if (plan.operation !== "version.create") throw new Error("Expected version plan.");
    expect(plan.target.sourceVersionId).toBe("version-250");
    expect(plan.after.excludeWhatsNew).toBe(true);

    await service.confirmPlan(plan.id, plan.digest);
    expect((await service.listVersions(app.id)).some((version) => version.versionString === "2.6.0")).toBe(true);
    expect(store.events.map((event) => event.operation)).toContain("version.create");
  });

  it("plans exact localization diffs and applies them", async () => {
    const { service } = createHarness();
    const plan = await service.createUpdateVersionLocalizationsPlan({
      appId: app.id,
      versionId: "version-250",
      localizations: [{
        locale: "en-US",
        whatsNew: "A faster editor with better sync.",
        promotionalText: "Capture every idea faster.",
        keywords: "notes,ideas,tasks,writing",
      }],
    });

    expect(plan.operation).toBe("version.update_localizations");
    if (plan.operation !== "version.update_localizations") throw new Error("Expected localization plan.");
    expect(plan.before.localizations[0]?.whatsNew).toBe("A faster editor.");
    expect(plan.after.localizations[0]?.keywords).toBe("notes,ideas,tasks,writing");

    await service.confirmPlan(plan.id, plan.digest);
    const localizations = await service.listVersionLocalizations(app.id, "version-250");
    expect(localizations[0]).toMatchObject({
      whatsNew: "A faster editor with better sync.",
      promotionalText: "Capture every idea faster.",
      keywords: "notes,ideas,tasks,writing",
    });
  });

  it("fails closed when localization metadata changes after review", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createUpdateVersionLocalizationsPlan({
      appId: app.id,
      versionId: "version-250",
      localizations: [{
        locale: "en-US",
        whatsNew: "A faster editor with better sync.",
        promotionalText: "Capture ideas fast.",
        keywords: "notes,ideas,tasks",
      }],
    });
    provider.setWhatsNew("Changed in App Store Connect.");

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("plans and confirms an exact screenshot-set replacement", async () => {
    const { service, store } = createHarness();
    const plan = await service.createUpdateScreenshotsPlan({
      appId: app.id,
      versionId: "version-250",
      localizationId: "localization-en-US",
      locale: "en-US",
      displayType: "APP_IPHONE_67",
      strategy: "replace",
      uploads: [{
        uploadId: "11111111-1111-4111-8111-111111111111",
        displayType: "APP_IPHONE_67",
        fileName: "01-new-editor.png",
        mediaType: "image/png",
        fileSize: 1_500_000,
        width: 1290,
        height: 2796,
        checksum: "a".repeat(64),
        hasAlpha: false,
      }],
      deleteIds: [],
    });

    expect(plan.operation).toBe("version.update_screenshots");
    if (plan.operation !== "version.update_screenshots") throw new Error("Expected screenshot plan.");
    expect(plan.before.screenshots.map((asset) => asset.id)).toEqual(["screenshot-1"]);
    expect(plan.after.deleteIds).toEqual(["screenshot-1"]);

    await service.confirmPlan(plan.id, plan.digest);
    await expect(service.listScreenshots(
      app.id,
      "version-250",
      "localization-en-US",
      "APP_IPHONE_67",
    )).resolves.toEqual([
      expect.objectContaining({ fileName: "01-new-editor.png", checksum: "a".repeat(64) }),
    ]);
    expect(store.events.map((event) => event.operation)).toContain("version.update_screenshots");
  });

  it("fails closed when screenshots change after review", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createUpdateScreenshotsPlan({
      appId: app.id,
      versionId: "version-250",
      localizationId: "localization-en-US",
      locale: "en-US",
      displayType: "APP_IPHONE_67",
      strategy: "append",
      uploads: [],
      deleteIds: ["screenshot-1"],
    });
    provider.setScreenshotFileName("changed-remotely.png");

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("plans, attaches, and submits an eligible version after exact review", async () => {
    const { service, store } = createHarness();
    const plan = await service.createSubmitVersionPlan({
      appId: app.id,
      versionId: "version-250",
      buildId: "demo-build-211",
    });

    expect(plan.operation).toBe("version.submit");
    if (plan.operation !== "version.submit") throw new Error("Expected submission plan.");
    expect(plan.before).toMatchObject({
      versionState: "PREPARE_FOR_SUBMISSION",
      attachedBuildId: null,
      validation: { blocking: 0 },
    });
    expect(plan.after).toEqual({ buildId: "demo-build-211", attachBuild: true, submitForReview: true });

    const confirmed = await service.confirmPlan(plan.id, plan.digest);
    const status = await service.getVersionSubmissionStatus(app.id, "version-250");
    expect(confirmed.state).toBe("succeeded");
    expect(status).toMatchObject({ id: "submission-250", state: "WAITING_FOR_REVIEW" });
    expect(store.events.map((event) => event.operation)).toContain("version.submit");
  });

  it("blocks submission planning when validation has blockers", async () => {
    const { provider, service } = createHarness();
    provider.setValidationBlocking(2);
    await expect(service.createSubmitVersionPlan({
      appId: app.id,
      versionId: "version-250",
      buildId: "demo-build-211",
    })).rejects.toMatchObject({ code: "submission_blocked" });
    expect(provider.getPreviewCalls()).toBe(0);
  });

  it("fails closed when build attachment changes after submission review", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createSubmitVersionPlan({
      appId: app.id,
      versionId: "version-250",
      buildId: "demo-build-211",
    });
    provider.setAttachedBuild("demo-build-211");

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("fails closed when the build changes after planning", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });
    await provider.addBuildToGroup({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });

    await expect(service.confirmAddBuildToGroupPlan(plan.id, plan.digest)).rejects.toMatchObject({
      code: "stale_plan",
    });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("creates a paused Apple Ads campaign only after exact review", async () => {
    const { service, store } = createHarness();
    const plan = await service.createAppleAdsCampaignPlan({
      promotedObjectId: app.id,
      name: "Orbit Notes · Discovery",
      dailyBudget: { amount: "15.00", currency: "USD" },
      countriesOrRegions: ["US"],
      startTime: null,
      endTime: null,
      status: "PAUSED",
      bidStrategyType: "MANUAL_CPT",
    });
    expect(plan.operation).toBe("apple_ads.campaign.create");
    expect(plan.context).toMatchObject({ appleAdsAdAccountId: "ads-account-1", appleAdsMode: "demo" });

    const confirmed = await service.confirmPlan(plan.id, plan.digest);
    expect(confirmed.state).toBe("succeeded");
    expect(store.events.map((event) => event.operation)).toContain("apple_ads.campaign.create");
  });

  it("fails closed when an Apple Ads campaign changes after review", async () => {
    const { provider, service, store } = createHarness();
    const plan = await service.createUpdateAppleAdsCampaignPlan({ campaignId: "ads-campaign-1", dailyBudget: { amount: "35.00", currency: "USD" } });
    provider.setAppleAdsCampaignBudget("25.00");

    await expect(service.confirmPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "stale_plan" });
    expect(store.plans.get(plan.id)?.state).toBe("stale");
  });

  it("creates a paused ad group and keyword through separate reviewed plans", async () => {
    const { service } = createHarness();
    const groupPlan = await service.createAppleAdsAdGroupPlan({
      campaignId: "ads-campaign-1",
      name: "Category exact",
      bid: { amount: "1.25", currency: "USD" },
      automatedKeywordsOptIn: false,
      startTime: null,
      endTime: null,
      status: "PAUSED",
    });
    await service.confirmPlan(groupPlan.id, groupPlan.digest);

    const keywordPlan = await service.createAppleAdsKeywordPlan({
      campaignId: "ads-campaign-1",
      adGroupId: "ads-group-1",
      text: "task manager",
      matchType: "EXACT",
      bid: { amount: "1.10", currency: "USD" },
      status: "PAUSED",
    });
    await expect(service.confirmPlan(keywordPlan.id, keywordPlan.digest)).resolves.toMatchObject({ state: "succeeded" });
  });

  it("allows only one request to claim a confirmed plan", async () => {
    const { service, store } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });

    const results = await Promise.allSettled([
      service.confirmAddBuildToGroupPlan(plan.id, plan.digest),
      service.confirmAddBuildToGroupPlan(plan.id, plan.digest),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.events.filter((event) => event.phase === "succeeded")).toHaveLength(1);
  });

  it("expires a plan before it can execute", async () => {
    const { advance, service, store } = createHarness();
    const plan = await service.createAddBuildToGroupPlan({
      appId: "demo-app-orbit-notes",
      buildId: "demo-build-204",
      groupId: "demo-group-qa",
    });
    advance(11 * 60 * 1000);

    await expect(service.confirmAddBuildToGroupPlan(plan.id, plan.digest)).rejects.toMatchObject({ code: "plan_expired" });
    expect(store.plans.get(plan.id)?.state).toBe("expired");
  });
});
