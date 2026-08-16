import type {
  AddBuildToGroupInput,
  AgentStatus,
  AppStoreLocale,
  AppStorePlatform,
  AppStoreVersion,
  AppSummary,
  AuditEvent,
  BuildSummary,
  CreateVersionInput,
  LocalizationSnapshot,
  MutationPlan,
  ScreenshotAsset,
  ScreenshotAssetSnapshot,
  ScreenshotDisplayType,
  ScreenshotUploadReceipt,
  SubmitVersionInput,
  TesterGroup,
  UpdateVersionLocalizationsInput,
  UpdateScreenshotSetInput,
  ValidationReport,
  VersionSubmissionPreview,
  VersionSubmissionResult,
  VersionSubmissionStatus,
  VersionLocalization,
  VersionLocalizationPatch,
} from "@asc-studio/contracts";

export interface AscProvider {
  getStatus(): Promise<AgentStatus>;
  listApps(options?: AppListOptions): Promise<AppSummary[]>;
  listBuilds(appId: string, options?: BuildListOptions): Promise<BuildSummary[]>;
  getBuild(appId: string, buildId: string): Promise<BuildSummary>;
  listGroups(appId: string): Promise<TesterGroup[]>;
  addBuildToGroup(input: AddBuildToGroupInput): Promise<void>;
  listVersions(appId: string, platform?: AppStorePlatform, options?: VersionListOptions): Promise<AppStoreVersion[]>;
  listVersionLocalizations(versionId: string): Promise<VersionLocalization[]>;
  listScreenshots(
    localizationId: string,
    locale: AppStoreLocale,
    displayType: ScreenshotDisplayType,
  ): Promise<ScreenshotAsset[]>;
  createVersion(input: CreateVersionInput): Promise<AppStoreVersion>;
  applyVersionLocalizationPatches(
    versionId: string,
    patches: VersionLocalizationPatch[],
    expected: LocalizationSnapshot[],
  ): Promise<void>;
  applyScreenshotChanges(input: ApplyScreenshotChangesInput): Promise<void>;
  validateVersion(appId: string, versionId: string, platform: AppStorePlatform): Promise<ValidationReport>;
  previewVersionSubmission(input: SubmitVersionInput): Promise<VersionSubmissionPreview>;
  submitVersion(input: SubmitVersionInput): Promise<VersionSubmissionResult>;
  getVersionSubmissionStatus(versionId: string): Promise<VersionSubmissionStatus>;
}

export interface ApplyScreenshotChangesInput {
  localizationId: string;
  locale: AppStoreLocale;
  displayType: ScreenshotDisplayType;
  uploads: ScreenshotUploadReceipt[];
  deleteIds: string[];
  expected: ScreenshotAssetSnapshot[];
}

export interface AppListOptions {
  limit?: number;
  paginate?: boolean;
}

export interface BuildListOptions {
  version?: string;
  platform?: AppStorePlatform;
  includeGroups?: boolean;
}

export interface VersionListOptions {
  limit?: number;
  paginate?: boolean;
}

export interface PlanStore {
  savePlan(plan: MutationPlan): Promise<void>;
  getPlan(id: string): Promise<MutationPlan | null>;
  claimPlan(id: string, expectedState: MutationPlan["state"], next: MutationPlan): Promise<boolean>;
  appendAudit(event: Omit<AuditEvent, "sequence">): Promise<AuditEvent>;
  listAudit(limit: number): Promise<AuditEvent[]>;
}

export interface CoreDependencies {
  provider: AscProvider;
  store: PlanStore;
  now: () => Date;
  id: () => string;
  digest: (value: string) => string;
}

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

const sortedUnique = (items: string[]) => [...new Set(items)].sort();

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

export const stableJson = (value: unknown) => JSON.stringify(stableValue(value));

const planDigestPayload = (plan: MutationPlan) => ({
  operation: plan.operation,
  context: plan.context,
  target: plan.target,
  before: plan.before,
  after: plan.after,
  expiresAt: plan.expiresAt,
});

const snapshotFor = (
  locale: AppStoreLocale,
  localization: VersionLocalization | undefined,
): LocalizationSnapshot => ({
  id: localization?.id ?? null,
  locale,
  whatsNew: localization?.whatsNew ?? "",
  promotionalText: localization?.promotionalText ?? "",
  keywords: localization?.keywords ?? "",
});

const localizationFields = ["whatsNew", "promotionalText", "keywords"] as const;

const changedFieldCount = (before: LocalizationSnapshot, after: LocalizationSnapshot) =>
  localizationFields.filter((field) => before[field] !== after[field]).length;

const patchFor = (before: LocalizationSnapshot, after: LocalizationSnapshot): VersionLocalizationPatch => ({
  locale: after.locale,
  ...(before.whatsNew !== after.whatsNew ? { whatsNew: after.whatsNew } : {}),
  ...(before.promotionalText !== after.promotionalText ? { promotionalText: after.promotionalText } : {}),
  ...(before.keywords !== after.keywords ? { keywords: after.keywords } : {}),
});

const screenshotSnapshot = (asset: ScreenshotAsset): ScreenshotAssetSnapshot => ({
  id: asset.id,
  fileName: asset.fileName,
  fileSize: asset.fileSize,
  width: asset.width,
  height: asset.height,
  checksum: asset.checksum,
  state: asset.state,
  sortOrder: asset.sortOrder,
});

const screenshotTypesByPlatform: Record<AppStorePlatform, ScreenshotDisplayType[]> = {
  IOS: [
    "APP_IPHONE_55",
    "APP_IPHONE_65",
    "APP_IPHONE_67",
    "APP_IPHONE_69",
    "APP_IPAD_PRO_129",
    "APP_IPAD_PRO_3GEN_129",
    "APP_WATCH_SERIES_7",
    "APP_WATCH_SERIES_10",
    "APP_WATCH_ULTRA",
  ],
  MAC_OS: ["APP_DESKTOP"],
  TV_OS: ["APP_APPLE_TV"],
  VISION_OS: ["APP_APPLE_VISION_PRO"],
};

export class AscStudioService {
  constructor(private readonly dependencies: CoreDependencies) {}

  getStatus() {
    return this.dependencies.provider.getStatus();
  }

  listApps(options?: AppListOptions) {
    return this.dependencies.provider.listApps(options);
  }

  listBuilds(appId: string, options?: BuildListOptions) {
    return this.dependencies.provider.listBuilds(appId, options);
  }

  listGroups(appId: string) {
    return this.dependencies.provider.listGroups(appId);
  }

  listVersions(appId: string, platform?: AppStorePlatform, options?: VersionListOptions) {
    return this.dependencies.provider.listVersions(appId, platform, options);
  }

  async listVersionLocalizations(appId: string, versionId: string) {
    await this.requireVersion(appId, versionId);
    return this.dependencies.provider.listVersionLocalizations(versionId);
  }

  async listScreenshots(
    appId: string,
    versionId: string,
    localizationId: string,
    displayType: ScreenshotDisplayType,
  ) {
    const [version, localizations] = await Promise.all([
      this.requireVersion(appId, versionId),
      this.dependencies.provider.listVersionLocalizations(versionId),
    ]);
    if (!screenshotTypesByPlatform[version.platform].includes(displayType)) {
      throw new DomainError("screenshot_type_mismatch", `${displayType} is not available for ${version.platform}.`);
    }
    const localization = localizations.find((candidate) => candidate.id === localizationId);
    if (!localization) throw new DomainError("localization_not_found", "The selected localization no longer exists.");
    return this.dependencies.provider.listScreenshots(localization.id, localization.locale, displayType);
  }

  async validateVersion(appId: string, versionId: string) {
    const version = await this.requireVersion(appId, versionId);
    const report = await this.dependencies.provider.validateVersion(appId, versionId, version.platform);
    await this.audit(
      "gui",
      "version.validate",
      "completed",
      versionId,
      report.summary.blocking === 0
        ? `Validated ${version.versionString}: no blockers`
        : `Validated ${version.versionString}: ${report.summary.blocking} blocker${report.summary.blocking === 1 ? "" : "s"}`,
      report.summary.blocking === 0 ? "success" : "warning",
    );
    return report;
  }

  async getVersionSubmissionStatus(appId: string, versionId: string) {
    await this.requireVersion(appId, versionId);
    return this.dependencies.provider.getVersionSubmissionStatus(versionId);
  }

  listAudit(limit = 50) {
    return this.dependencies.store.listAudit(Math.min(Math.max(limit, 1), 200));
  }

  async createAddBuildToGroupPlan(
    input: AddBuildToGroupInput,
    actor: AuditEvent["actor"],
  ): Promise<MutationPlan> {
    const [build, groups, context] = await Promise.all([
      this.dependencies.provider.getBuild(input.appId, input.buildId),
      this.dependencies.provider.listGroups(input.appId),
      this.activeContext(),
    ]);
    const group = groups.find((candidate) => candidate.id === input.groupId);
    if (!group) {
      throw new DomainError("group_not_found", "The selected tester group no longer exists.");
    }

    const beforeGroupIds = sortedUnique(build.groups.map((candidate) => candidate.id));
    if (beforeGroupIds.includes(group.id)) {
      throw new DomainError("already_assigned", `${build.buildNumber} is already assigned to ${group.name}.`);
    }

    const createdAt = this.dependencies.now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const target = {
      appId: input.appId,
      buildId: build.id,
      buildLabel: `${build.version} (${build.buildNumber})`,
      groupId: group.id,
      groupName: group.name,
    };
    const planWithoutDigest = {
      operation: "build.add_to_group" as const,
      context,
      target,
      before: { groupIds: beforeGroupIds },
      after: { groupIds: sortedUnique([...beforeGroupIds, group.id]) },
      expiresAt: expiresAt.toISOString(),
    };
    const plan: MutationPlan = {
      id: this.dependencies.id(),
      ...planWithoutDigest,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: createdAt.toISOString(),
      digest: this.dependencies.digest(stableJson(planWithoutDigest)),
      summary: `Add build ${target.buildLabel} to ${group.name}`,
      error: null,
    };

    await this.savePlanned(plan, actor, build.id);
    return plan;
  }

  async createVersionPlan(
    input: CreateVersionInput,
    actor: AuditEvent["actor"],
  ): Promise<MutationPlan> {
    const [versions, context] = await Promise.all([
      this.dependencies.provider.listVersions(input.appId, input.platform),
      this.activeContext(),
    ]);
    if (versions.some((version) => version.versionString === input.versionString)) {
      throw new DomainError("version_exists", `${input.versionString} already exists for ${input.platform}.`);
    }

    const source = input.copyMetadataFrom === null
      ? null
      : versions.find((version) => version.versionString === input.copyMetadataFrom) ?? null;
    if (input.copyMetadataFrom !== null && !source) {
      throw new DomainError("source_version_not_found", `Source version ${input.copyMetadataFrom} was not found.`);
    }

    const createdAt = this.dependencies.now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const target = {
      appId: input.appId,
      versionString: input.versionString,
      platform: input.platform,
      sourceVersionId: source?.id ?? null,
    };
    const after = {
      versionString: input.versionString,
      platform: input.platform,
      copyMetadataFrom: input.copyMetadataFrom,
      releaseType: input.releaseType,
      excludeWhatsNew: input.excludeWhatsNew,
    };
    const planWithoutDigest = {
      operation: "version.create" as const,
      context,
      target,
      before: { versionId: null },
      after,
      expiresAt: expiresAt.toISOString(),
    };
    const copyLabel = input.copyMetadataFrom ? ` and copy metadata from ${input.copyMetadataFrom}` : "";
    const plan: MutationPlan = {
      id: this.dependencies.id(),
      ...planWithoutDigest,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: createdAt.toISOString(),
      digest: this.dependencies.digest(stableJson(planWithoutDigest)),
      summary: `Create ${input.platform} version ${input.versionString}${copyLabel}`,
      error: null,
    };

    await this.savePlanned(plan, actor, input.appId);
    return plan;
  }

  async createUpdateVersionLocalizationsPlan(
    input: UpdateVersionLocalizationsInput,
    actor: AuditEvent["actor"],
  ): Promise<MutationPlan> {
    const [version, current, context] = await Promise.all([
      this.requireVersion(input.appId, input.versionId),
      this.dependencies.provider.listVersionLocalizations(input.versionId),
      this.activeContext(),
    ]);
    if (!version.editable) {
      throw new DomainError("version_not_editable", `${version.versionString} is not editable in its current state.`);
    }

    const currentByLocale = new Map(current.map((localization) => [localization.locale, localization] as const));
    const changed = input.localizations
      .map((draft) => {
        const before = snapshotFor(draft.locale, currentByLocale.get(draft.locale));
        const after = { id: before.id, ...draft };
        return { before, after, count: changedFieldCount(before, after) };
      })
      .filter((entry) => entry.count > 0)
      .sort((left, right) => left.after.locale.localeCompare(right.after.locale));

    if (changed.length === 0) {
      throw new DomainError("no_changes", "The draft matches App Store Connect.");
    }

    const createdAt = this.dependencies.now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const before = { localizations: changed.map((entry) => entry.before) };
    const after = { localizations: changed.map((entry) => entry.after) };
    const fieldCount = changed.reduce((total, entry) => total + entry.count, 0);
    const target = {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      locales: changed.map((entry) => entry.after.locale),
    };
    const planWithoutDigest = {
      operation: "version.update_localizations" as const,
      context,
      target,
      before,
      after,
      expiresAt: expiresAt.toISOString(),
    };
    const plan: MutationPlan = {
      id: this.dependencies.id(),
      ...planWithoutDigest,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: createdAt.toISOString(),
      digest: this.dependencies.digest(stableJson(planWithoutDigest)),
      summary: `Update ${fieldCount} metadata field${fieldCount === 1 ? "" : "s"} across ${changed.length} locale${changed.length === 1 ? "" : "s"}`,
      error: null,
    };

    await this.savePlanned(plan, actor, version.id);
    return plan;
  }

  async createSubmitVersionPlan(
    input: SubmitVersionInput,
    actor: AuditEvent["actor"],
  ): Promise<MutationPlan> {
    const [version, build, context] = await Promise.all([
      this.requireVersion(input.appId, input.versionId),
      this.dependencies.provider.getBuild(input.appId, input.buildId),
      this.activeContext(),
    ]);
    if (!version.editable) {
      throw new DomainError("version_not_editable", `${version.versionString} is not editable in its current state.`);
    }
    this.requireSubmissionBuild(version, build);

    const validation = await this.dependencies.provider.validateVersion(input.appId, version.id, version.platform);
    if (validation.summary.blocking > 0) {
      throw new DomainError(
        "submission_blocked",
        `${version.versionString} has ${validation.summary.blocking} blocking validation issue${validation.summary.blocking === 1 ? "" : "s"}.`,
      );
    }
    const preview = await this.dependencies.provider.previewVersionSubmission(input);
    if (preview.alreadySubmitted) {
      throw new DomainError("version_already_submitted", `${version.versionString} is already submitted for review.`);
    }
    if (!preview.wouldSubmit) {
      throw new DomainError("submission_unavailable", `The Apple API did not confirm that ${version.versionString} can be submitted.`);
    }

    const createdAt = this.dependencies.now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const target = {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      buildId: build.id,
      buildNumber: build.buildNumber,
    };
    const before = {
      versionState: version.state,
      attachedBuildId: preview.currentBuildId,
      validation: {
        errors: validation.summary.errors,
        warnings: validation.summary.warnings,
        blocking: validation.summary.blocking,
      },
    };
    const after = {
      buildId: build.id,
      attachBuild: preview.wouldAttach,
      submitForReview: true as const,
    };
    const planWithoutDigest = {
      operation: "version.submit" as const,
      context,
      target,
      before,
      after,
      expiresAt: expiresAt.toISOString(),
    };
    const attachLabel = preview.wouldAttach ? `, attach build ${build.buildNumber},` : "";
    const plan: MutationPlan = {
      id: this.dependencies.id(),
      ...planWithoutDigest,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: createdAt.toISOString(),
      digest: this.dependencies.digest(stableJson(planWithoutDigest)),
      summary: `Validate ${version.versionString}${attachLabel} and submit it to App Review`,
      error: null,
    };

    await this.savePlanned(plan, actor, version.id);
    return plan;
  }

  async createUpdateScreenshotsPlan(
    input: UpdateScreenshotSetInput,
    actor: AuditEvent["actor"],
  ): Promise<MutationPlan> {
    const [version, localizations, context] = await Promise.all([
      this.requireVersion(input.appId, input.versionId),
      this.dependencies.provider.listVersionLocalizations(input.versionId),
      this.activeContext(),
    ]);
    if (!version.editable) {
      throw new DomainError("version_not_editable", `${version.versionString} is not editable in its current state.`);
    }
    if (!screenshotTypesByPlatform[version.platform].includes(input.displayType)) {
      throw new DomainError("screenshot_type_mismatch", `${input.displayType} is not available for ${version.platform}.`);
    }
    const localization = localizations.find((candidate) => candidate.id === input.localizationId);
    if (!localization || localization.locale !== input.locale) {
      throw new DomainError("localization_not_found", "The selected localization no longer exists.");
    }
    if (input.uploads.some((upload) => upload.displayType !== input.displayType)) {
      throw new DomainError("screenshot_type_mismatch", "A staged screenshot belongs to another device type.");
    }

    const current = await this.dependencies.provider.listScreenshots(
      localization.id,
      localization.locale,
      input.displayType,
    );
    const currentIds = new Set(current.map((asset) => asset.id));
    if (input.deleteIds.some((id) => !currentIds.has(id))) {
      throw new DomainError("screenshot_not_found", "A screenshot selected for removal no longer exists.");
    }
    const deleteIds = input.strategy === "replace"
      ? current.map((asset) => asset.id)
      : [...input.deleteIds];
    const finalCount = current.length - deleteIds.length + input.uploads.length;
    if (finalCount > 10) {
      throw new DomainError("screenshot_limit", "An App Store screenshot set can contain at most 10 images.");
    }
    if (deleteIds.length === 0 && input.uploads.length === 0) {
      throw new DomainError("no_changes", "The screenshot set matches App Store Connect.");
    }

    const createdAt = this.dependencies.now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000);
    const target = {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      localizationId: localization.id,
      locale: localization.locale,
      displayType: input.displayType,
    };
    const before = { screenshots: current.map(screenshotSnapshot) };
    const after = { strategy: input.strategy, uploads: input.uploads, deleteIds };
    const planWithoutDigest = {
      operation: "version.update_screenshots" as const,
      context,
      target,
      before,
      after,
      expiresAt: expiresAt.toISOString(),
    };
    const actionLabels = [
      input.uploads.length ? `upload ${input.uploads.length}` : "",
      deleteIds.length ? `remove ${deleteIds.length}` : "",
    ].filter(Boolean).join(" and ");
    const plan: MutationPlan = {
      id: this.dependencies.id(),
      ...planWithoutDigest,
      risk: "mutation",
      state: "awaiting_confirmation",
      createdAt: createdAt.toISOString(),
      digest: this.dependencies.digest(stableJson(planWithoutDigest)),
      summary: `${actionLabels.charAt(0).toUpperCase()}${actionLabels.slice(1)} screenshot${input.uploads.length + deleteIds.length === 1 ? "" : "s"} for ${localization.locale}`,
      error: null,
    };
    await this.savePlanned(plan, actor, version.id);
    return plan;
  }

  async confirmPlan(
    planId: string,
    expectedDigest: string,
    actor: AuditEvent["actor"],
  ): Promise<MutationPlan> {
    const plan = await this.loadConfirmablePlan(planId, expectedDigest);
    switch (plan.operation) {
      case "build.add_to_group":
        return this.confirmBuildGroupPlan(plan, actor);
      case "version.create":
        return this.confirmCreateVersionPlan(plan, actor);
      case "version.update_localizations":
        return this.confirmUpdateLocalizationsPlan(plan, actor);
      case "version.update_screenshots":
        return this.confirmUpdateScreenshotsPlan(plan, actor);
      case "version.submit":
        return this.confirmSubmitVersionPlan(plan, actor);
    }
  }

  confirmAddBuildToGroupPlan(planId: string, expectedDigest: string, actor: AuditEvent["actor"]) {
    return this.confirmPlan(planId, expectedDigest, actor);
  }

  async recordSync(count: number, actor: AuditEvent["actor"]) {
    await this.audit(actor, "builds.sync", "succeeded", "testflight", `Synced ${count} builds`, "success");
  }

  private async confirmBuildGroupPlan(
    plan: Extract<MutationPlan, { operation: "build.add_to_group" }>,
    actor: AuditEvent["actor"],
  ) {
    const current = await this.dependencies.provider.getBuild(plan.target.appId, plan.target.buildId);
    const currentGroupIds = sortedUnique(current.groups.map((group) => group.id));
    if (stableJson(currentGroupIds) !== stableJson(plan.before.groupIds)) {
      await this.markStale(plan, actor, current.id, "Tester-group assignments changed after planning.");
    }

    return this.runPlan(plan, actor, current.id, async () => {
      await this.dependencies.provider.addBuildToGroup({
        appId: plan.target.appId,
        buildId: plan.target.buildId,
        groupId: plan.target.groupId,
      });
    });
  }

  private async confirmCreateVersionPlan(
    plan: Extract<MutationPlan, { operation: "version.create" }>,
    actor: AuditEvent["actor"],
  ) {
    const versions = await this.dependencies.provider.listVersions(plan.target.appId, plan.target.platform);
    if (versions.some((version) => version.versionString === plan.target.versionString)) {
      await this.markStale(plan, actor, plan.target.appId, "The target version was created after planning.");
    }
    if (plan.target.sourceVersionId && !versions.some((version) => version.id === plan.target.sourceVersionId)) {
      await this.markStale(plan, actor, plan.target.appId, "The metadata source version changed after planning.");
    }

    return this.runPlan(plan, actor, plan.target.appId, async () => {
      await this.dependencies.provider.createVersion({
        appId: plan.target.appId,
        versionString: plan.after.versionString,
        platform: plan.after.platform,
        copyMetadataFrom: plan.after.copyMetadataFrom,
        releaseType: plan.after.releaseType,
        excludeWhatsNew: plan.after.excludeWhatsNew,
      });
    });
  }

  private async confirmUpdateLocalizationsPlan(
    plan: Extract<MutationPlan, { operation: "version.update_localizations" }>,
    actor: AuditEvent["actor"],
  ) {
    const [version, current] = await Promise.all([
      this.requireVersion(plan.target.appId, plan.target.versionId),
      this.dependencies.provider.listVersionLocalizations(plan.target.versionId),
    ]);
    if (!version.editable) {
      await this.markStale(plan, actor, version.id, "The version is no longer editable.");
    }
    const currentByLocale = new Map(current.map((localization) => [localization.locale, localization] as const));
    const currentSnapshots = plan.target.locales.map((locale) => snapshotFor(locale, currentByLocale.get(locale)));
    if (stableJson(currentSnapshots) !== stableJson(plan.before.localizations)) {
      await this.markStale(plan, actor, version.id, "Localization metadata changed after planning.");
    }

    const patches = plan.after.localizations.map((after, index) => {
      const before = plan.before.localizations[index];
      if (!before) throw new DomainError("plan_changed", "The localization plan is incomplete.");
      return patchFor(before, after);
    });
    return this.runPlan(plan, actor, version.id, async () => {
      await this.dependencies.provider.applyVersionLocalizationPatches(version.id, patches, plan.before.localizations);
    });
  }

  private async confirmSubmitVersionPlan(
    plan: Extract<MutationPlan, { operation: "version.submit" }>,
    actor: AuditEvent["actor"],
  ) {
    const input: SubmitVersionInput = {
      appId: plan.target.appId,
      versionId: plan.target.versionId,
      buildId: plan.target.buildId,
    };
    const [version, build, validation] = await Promise.all([
      this.requireVersion(plan.target.appId, plan.target.versionId),
      this.dependencies.provider.getBuild(plan.target.appId, plan.target.buildId),
      this.dependencies.provider.validateVersion(plan.target.appId, plan.target.versionId, plan.target.platform),
    ]);
    if (!version.editable) {
      await this.markStale(plan, actor, version.id, "The version is no longer editable.");
    }
    try {
      this.requireSubmissionBuild(version, build);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The selected build is no longer eligible.";
      await this.markStale(plan, actor, version.id, reason);
    }
    if (validation.summary.blocking > 0) {
      await this.markStale(plan, actor, version.id, "Blocking validation issues appeared after planning.");
    }
    const preview = await this.dependencies.provider.previewVersionSubmission(input);
    if (preview.alreadySubmitted || !preview.wouldSubmit) {
      await this.markStale(plan, actor, version.id, "The version submission state changed after planning.");
    }

    const currentBefore = {
      versionState: version.state,
      attachedBuildId: preview.currentBuildId,
      validation: {
        errors: validation.summary.errors,
        warnings: validation.summary.warnings,
        blocking: validation.summary.blocking,
      },
    };
    if (
      stableJson(currentBefore) !== stableJson(plan.before)
      || preview.wouldAttach !== plan.after.attachBuild
    ) {
      await this.markStale(plan, actor, version.id, "The reviewed version, build, or validation result changed after planning.");
    }

    return this.runPlan(plan, actor, version.id, async () => {
      await this.dependencies.provider.submitVersion(input);
    });
  }

  private async confirmUpdateScreenshotsPlan(
    plan: Extract<MutationPlan, { operation: "version.update_screenshots" }>,
    actor: AuditEvent["actor"],
  ) {
    const [version, localizations, current] = await Promise.all([
      this.requireVersion(plan.target.appId, plan.target.versionId),
      this.dependencies.provider.listVersionLocalizations(plan.target.versionId),
      this.dependencies.provider.listScreenshots(
        plan.target.localizationId,
        plan.target.locale,
        plan.target.displayType,
      ),
    ]);
    if (!version.editable) {
      await this.markStale(plan, actor, version.id, "The version is no longer editable.");
    }
    if (!localizations.some((localization) => (
      localization.id === plan.target.localizationId && localization.locale === plan.target.locale
    ))) {
      await this.markStale(plan, actor, version.id, "The screenshot localization changed after planning.");
    }
    if (stableJson(current.map(screenshotSnapshot)) !== stableJson(plan.before.screenshots)) {
      await this.markStale(plan, actor, version.id, "The screenshot set changed after planning.");
    }

    return this.runPlan(plan, actor, version.id, async () => {
      await this.dependencies.provider.applyScreenshotChanges({
        localizationId: plan.target.localizationId,
        locale: plan.target.locale,
        displayType: plan.target.displayType,
        uploads: plan.after.uploads,
        deleteIds: plan.after.deleteIds,
        expected: plan.before.screenshots,
      });
    });
  }

  private requireSubmissionBuild(version: AppStoreVersion, build: BuildSummary) {
    if (build.appId !== version.appId) {
      throw new DomainError("build_app_mismatch", "The selected build does not belong to this app.");
    }
    if (build.version !== version.versionString || build.platform !== version.platform) {
      throw new DomainError(
        "build_version_mismatch",
        `Build ${build.buildNumber} is not for ${version.platform} ${version.versionString}.`,
      );
    }
    if (build.expired || build.processingStatus !== "Ready") {
      throw new DomainError("build_not_ready", `Build ${build.buildNumber} is not processed and ready for submission.`);
    }
  }

  private async requireVersion(appId: string, versionId: string) {
    const versions = await this.dependencies.provider.listVersions(appId);
    const version = versions.find((candidate) => candidate.id === versionId);
    if (!version) throw new DomainError("version_not_found", "The selected App Store version no longer exists.");
    return version;
  }

  private async activeContext() {
    const status = await this.dependencies.provider.getStatus();
    if (!status.connected) throw new DomainError("workspace_disconnected", status.detail);
    return { profile: status.profile, connectionId: status.connectionId };
  }

  private async loadConfirmablePlan(planId: string, expectedDigest: string) {
    const plan = await this.dependencies.store.getPlan(planId);
    if (!plan) throw new DomainError("plan_not_found", "This change plan no longer exists.");
    if (plan.state !== "awaiting_confirmation") {
      throw new DomainError("plan_not_confirmable", `This plan is ${plan.state}.`);
    }
    const savedDigest = this.dependencies.digest(stableJson(planDigestPayload(plan)));
    if (plan.digest !== savedDigest || plan.digest !== expectedDigest) {
      throw new DomainError("plan_changed", "The reviewed change does not match the saved plan.");
    }
    if (this.dependencies.now().getTime() >= new Date(plan.expiresAt).getTime()) {
      const expired: MutationPlan = { ...plan, state: "expired", error: "The confirmation window expired." };
      const claimed = await this.dependencies.store.claimPlan(plan.id, "awaiting_confirmation", expired);
      if (!claimed) throw new DomainError("plan_not_confirmable", "Another request already claimed this plan.");
      throw new DomainError("plan_expired", "The confirmation window expired. Review the change again.");
    }
    const context = await this.activeContext();
    if (context.connectionId !== plan.context.connectionId || context.profile !== plan.context.profile) {
      throw new DomainError("workspace_changed", "The active App Store Connect connection changed. Review a fresh plan in this workspace.");
    }
    return plan;
  }

  private async markStale(
    plan: MutationPlan,
    actor: AuditEvent["actor"],
    target: string,
    reason: string,
  ): Promise<never> {
    const stale: MutationPlan = { ...plan, state: "stale", error: reason };
    const claimed = await this.dependencies.store.claimPlan(plan.id, "awaiting_confirmation", stale);
    if (!claimed) throw new DomainError("plan_not_confirmable", "Another request already claimed this plan.");
    await this.audit(actor, plan.operation, "stale", target, reason, "warning");
    throw new DomainError("stale_plan", `${reason} Review a fresh plan.`);
  }

  private async runPlan(
    plan: MutationPlan,
    actor: AuditEvent["actor"],
    target: string,
    execute: () => Promise<void>,
  ) {
    const running: MutationPlan = { ...plan, state: "running", error: null };
    const claimed = await this.dependencies.store.claimPlan(plan.id, "awaiting_confirmation", running);
    if (!claimed) throw new DomainError("plan_not_confirmable", "Another request already claimed this plan.");
    await this.audit(actor, plan.operation, "running", target, plan.summary, "info");

    try {
      await execute();
      const succeeded: MutationPlan = { ...running, state: "succeeded", error: null };
      await this.dependencies.store.savePlan(succeeded);
      await this.audit(actor, plan.operation, "succeeded", target, plan.summary, "success");
      return succeeded;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The App Store Connect command failed.";
      const failed: MutationPlan = { ...running, state: "failed", error: message };
      await this.dependencies.store.savePlan(failed);
      await this.audit(actor, plan.operation, "failed", target, message, "error");
      throw error;
    }
  }

  private async savePlanned(plan: MutationPlan, actor: AuditEvent["actor"], target: string) {
    await this.dependencies.store.savePlan(plan);
    await this.audit(actor, plan.operation, "planned", target, plan.summary, "info");
  }

  private async audit(
    actor: AuditEvent["actor"],
    operation: string,
    phase: string,
    target: string,
    summary: string,
    status: AuditEvent["status"],
  ) {
    return this.dependencies.store.appendAudit({
      id: this.dependencies.id(),
      timestamp: this.dependencies.now().toISOString(),
      actor,
      operation,
      phase,
      target,
      summary,
      status,
    });
  }
}
