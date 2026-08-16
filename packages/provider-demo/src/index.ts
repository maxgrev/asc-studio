import type {
  AddBuildToGroupInput,
  AgentStatus,
  AppStorePlatform,
  AppStoreVersion,
  AppSummary,
  BuildSummary,
  CreateVersionInput,
  LocalizationSnapshot,
  ScreenshotAsset,
  ScreenshotAssetSnapshot,
  ScreenshotDisplayType,
  SubmitVersionInput,
  TesterGroup,
  ValidationCheck,
  ValidationReport,
  VersionLocalization,
  VersionLocalizationPatch,
  VersionSubmissionPreview,
  VersionSubmissionResult,
  VersionSubmissionStatus,
} from "@asc-studio/contracts";
import type { ApplyScreenshotChangesInput, AppListOptions, AscProvider, BuildListOptions, VersionListOptions } from "@asc-studio/core";

const orbitNotes: AppSummary = {
  id: "demo-app-orbit-notes",
  name: "Orbit Notes",
  bundleId: "com.example.orbitnotes",
  platforms: ["IOS", "MAC_OS"],
};

const fieldLog: AppSummary = {
  id: "demo-app-field-log",
  name: "Field Log",
  bundleId: "com.example.fieldlog",
  platforms: ["IOS"],
};

const apps = [orbitNotes, fieldLog];

const groupsByApp = new Map<string, TesterGroup[]>([
  [orbitNotes.id, [
    { id: "demo-group-team", name: "Team", testerCount: 8, internal: true },
    { id: "demo-group-qa", name: "QA", testerCount: 4, internal: true },
  ]],
  [fieldLog.id, [
    { id: "demo-field-group", name: "Field team", testerCount: 6, internal: true },
  ]],
]);

const now = Date.now();
const ago = (milliseconds: number) => new Date(now - milliseconds).toISOString();
const ahead = (days: number) => new Date(now + days * 86_400_000).toISOString();

const build = (
  app: AppSummary,
  id: string,
  buildNumber: string,
  version: string,
  uploadedAt: string,
  processingStatus: string,
  processingTone: BuildSummary["processingTone"],
  testingStatus: string,
  expiresAt: string | null,
  assignedGroups: TesterGroup[] = [],
  platform: AppStorePlatform = "IOS",
): BuildSummary => ({
  id,
  appId: app.id,
  buildNumber,
  version,
  uploadedAt,
  processingStatus,
  processingTone,
  testingStatus,
  expiresAt,
  expired: processingStatus === "Expired",
  platform,
  sdk: platform === "MAC_OS" ? "macOS 16.0" : "iOS 20.0",
  minimumOs: platform === "MAC_OS" ? "macOS 15.0" : "iOS 18.0",
  encryption: "No",
  groups: assignedGroups,
});

const orbitGroups = groupsByApp.get(orbitNotes.id)!;
const fieldGroups = groupsByApp.get(fieldLog.id)!;

const buildsByApp = new Map<string, BuildSummary[]>([
  [orbitNotes.id, [
    build(orbitNotes, "demo-build-211", "211", "2.5.0", ago(12 * 60_000), "Ready", "success", "Internal", ahead(89), [orbitGroups[0]!]),
    build(orbitNotes, "demo-mac-build-44", "44", "3.1.0", ago(35 * 60_000), "Ready", "success", "Internal", ahead(89), [orbitGroups[0]!], "MAC_OS"),
    build(orbitNotes, "demo-build-204", "204", "2.4.0", ago(86_400_000), "Ready", "success", "External", ahead(88), [orbitGroups[0]!]),
    build(orbitNotes, "demo-build-202", "202", "2.3.1", ago(4 * 86_400_000), "Missing compliance", "warning", "Internal", ahead(86)),
    build(orbitNotes, "demo-build-201", "201", "2.3.1", ago(7 * 86_400_000), "Expired", "neutral", "Closed", null),
    build(orbitNotes, "demo-build-200", "200", "2.3.0", ago(11 * 86_400_000), "Ready", "success", "External", ahead(79), [orbitGroups[1]!]),
  ]],
  [fieldLog.id, [
    build(fieldLog, "demo-field-build-88", "88", "1.8.0", ago(2 * 3_600_000), "Ready", "success", "Internal", ahead(89), fieldGroups),
  ]],
]);

const version = (
  appId: string,
  id: string,
  versionString: string,
  state: string,
  editable: boolean,
  copiedFrom: string | null = null,
  platform: AppStorePlatform = "IOS",
): AppStoreVersion => ({
  id,
  appId,
  versionString,
  platform,
  state,
  releaseType: "MANUAL",
  copyright: "2026 Northstar Labs",
  createdAt: new Date(now - 86_400_000).toISOString(),
  copiedFrom,
  editable,
});

const versionsByApp = new Map<string, AppStoreVersion[]>([
  [orbitNotes.id, [
    version(orbitNotes.id, "demo-version-250", "2.5.0", "PREPARE_FOR_SUBMISSION", true, "2.4.0"),
    version(orbitNotes.id, "demo-version-240", "2.4.0", "READY_FOR_DISTRIBUTION", false),
    version(orbitNotes.id, "demo-version-231", "2.3.1", "READY_FOR_DISTRIBUTION", false),
    version(orbitNotes.id, "demo-mac-version-310", "3.1.0", "PREPARE_FOR_SUBMISSION", true, "3.0.0", "MAC_OS"),
    version(orbitNotes.id, "demo-mac-version-300", "3.0.0", "READY_FOR_DISTRIBUTION", false, null, "MAC_OS"),
  ]],
  [fieldLog.id, [
    version(fieldLog.id, "demo-field-version-180", "1.8.0", "PREPARE_FOR_SUBMISSION", true, "1.7.0"),
    version(fieldLog.id, "demo-field-version-170", "1.7.0", "READY_FOR_DISTRIBUTION", false),
  ]],
]);

const localization = (
  versionId: string,
  locale: VersionLocalization["locale"],
  values: Pick<VersionLocalization, "whatsNew" | "promotionalText" | "keywords">,
): VersionLocalization => ({
  id: `${versionId}-${locale}`,
  versionId,
  locale,
  description: "Orbit Notes keeps ideas organized across all your devices.",
  marketingUrl: "https://example.com/orbit-notes",
  supportUrl: "https://example.com/support",
  ...values,
});

const orbitSource = [
  localization("demo-version-240", "en-US", {
    whatsNew: "A faster editor, cleaner search, and fixes for sync edge cases.",
    promotionalText: "Capture ideas fast and keep every note close at hand.",
    keywords: "notes,writing,ideas,tasks,organizer,journal,markdown,productivity",
  }),
  localization("demo-version-240", "de-DE", {
    whatsNew: "Ein schnellerer Editor, eine klarere Suche und Verbesserungen bei der Synchronisierung.",
    promotionalText: "Halten Sie Ideen schnell fest und behalten Sie jede Notiz im Blick.",
    keywords: "notizen,schreiben,ideen,aufgaben,planer,tagebuch,produktivität",
  }),
  localization("demo-version-240", "fr-FR", {
    whatsNew: "Un éditeur plus rapide, une recherche plus claire et une synchronisation plus fiable.",
    promotionalText: "Capturez vos idées et gardez chaque note à portée de main.",
    keywords: "notes,prise de notes,carnet,organisation,productivité,tâches,rappels,écriture,idées,synchronisation",
  }),
  localization("demo-version-240", "es-ES", {
    whatsNew: "Un editor más rápido, búsquedas más claras y mejoras de sincronización.",
    promotionalText: "Captura ideas y ten siempre tus notas a mano.",
    keywords: "notas,escribir,ideas,tareas,organizador,diario,productividad",
  }),
  localization("demo-version-240", "ja", {
    whatsNew: "エディタの高速化、検索の改善、同期の安定性向上を行いました。",
    promotionalText: "アイデアをすばやく記録し、すべてのメモを手元に。",
    keywords: "メモ,ノート,文章,アイデア,タスク,整理,日記,生産性",
  }),
  localization("demo-version-240", "pt-BR", {
    whatsNew: "Editor mais rápido, busca mais clara e melhorias na sincronização.",
    promotionalText: "Registre ideias rápido e mantenha suas notas sempre por perto.",
    keywords: "notas,escrever,ideias,tarefas,organizador,diário,produtividade",
  }),
];

const orbitDraft = orbitSource.map((item) => ({
  ...structuredClone(item),
  id: item.id.replace("demo-version-240", "demo-version-250"),
  versionId: "demo-version-250",
  whatsNew: item.locale === "ja" ? "" : item.whatsNew,
}));

const macSource = orbitSource.map((item) => ({
  ...structuredClone(item),
  id: item.id.replace("demo-version-240", "demo-mac-version-300"),
  versionId: "demo-mac-version-300",
}));

const macDraft = macSource.map((item) => ({
  ...structuredClone(item),
  id: item.id.replace("demo-mac-version-300", "demo-mac-version-310"),
  versionId: "demo-mac-version-310",
  whatsNew: item.locale === "en-US"
    ? "A faster Mac editor, improved menu commands, and more reliable sync."
    : item.whatsNew,
}));

const localizationsByVersion = new Map<string, VersionLocalization[]>([
  ["demo-version-250", orbitDraft],
  ["demo-version-240", orbitSource],
  ["demo-mac-version-310", macDraft],
  ["demo-mac-version-300", macSource],
  ["demo-field-version-180", [localization("demo-field-version-180", "en-US", {
    whatsNew: "Faster offline capture and clearer export status.",
    promotionalText: "Log field work without losing focus.",
    keywords: "field notes,inspection,offline,forms,work log,report",
  })]],
  ["demo-field-version-170", []],
]);

const screenshot = (
  localizationId: string,
  locale: VersionLocalization["locale"],
  displayType: ScreenshotDisplayType,
  id: string,
  fileName: string,
  width: number,
  height: number,
  sortOrder: number,
): ScreenshotAsset => ({
  id,
  localizationId,
  locale,
  displayType,
  fileName,
  fileSize: 1_240_000 + sortOrder * 82_000,
  width,
  height,
  checksum: `demo-checksum-${id}`,
  state: "COMPLETE",
  imageUrl: null,
  fullImageUrl: null,
  sortOrder,
});

const screenshotsBySet = new Map<string, ScreenshotAsset[]>([
  ["demo-version-250-en-US:APP_IPHONE_65", [
    screenshot("demo-version-250-en-US", "en-US", "APP_IPHONE_65", "demo-ios-shot-1", "01-capture.png", 1284, 2778, 0),
    screenshot("demo-version-250-en-US", "en-US", "APP_IPHONE_65", "demo-ios-shot-2", "02-organize.png", 1284, 2778, 1),
    screenshot("demo-version-250-en-US", "en-US", "APP_IPHONE_65", "demo-ios-shot-3", "03-search.png", 1284, 2778, 2),
  ]],
  ["demo-mac-version-310-en-US:APP_DESKTOP", [
    screenshot("demo-mac-version-310-en-US", "en-US", "APP_DESKTOP", "demo-mac-shot-1", "01-editor.png", 2880, 1800, 0),
    screenshot("demo-mac-version-310-en-US", "en-US", "APP_DESKTOP", "demo-mac-shot-2", "02-search.png", 2880, 1800, 1),
    screenshot("demo-mac-version-310-en-US", "en-US", "APP_DESKTOP", "demo-mac-shot-3", "03-sync.png", 2880, 1800, 2),
  ]],
  ["demo-mac-version-310-de-DE:APP_DESKTOP", [
    screenshot("demo-mac-version-310-de-DE", "de-DE", "APP_DESKTOP", "demo-mac-de-shot-1", "01-editor-de.png", 2880, 1800, 0),
  ]],
]);

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

export class MockAscProvider implements AscProvider {
  private readonly attachedBuildIds = new Map<string, string>();
  private readonly submissions = new Map<string, VersionSubmissionStatus>();

  async getStatus(): Promise<AgentStatus> {
    return {
      mode: "demo",
      connected: true,
      provider: "demo",
      connectionId: "demo",
      profile: "Demo workspace",
      authBackend: "isolated demo data",
      detail: "Demo mode is isolated and never calls App Store Connect.",
    };
  }

  async listApps(options: AppListOptions = {}) {
    return structuredClone(options.paginate === false && options.limit ? apps.slice(0, options.limit) : apps);
  }

  async listBuilds(appId: string, options: BuildListOptions = {}) {
    const builds = this.requireAppValue(buildsByApp, appId, "builds").filter((build) => (
      (!options.version || build.version === options.version)
      && (!options.platform || build.platform === options.platform)
    ));
    return structuredClone(options.includeGroups === false
      ? builds.map((build) => ({ ...build, groups: [] }))
      : builds);
  }

  async getBuild(appId: string, buildId: string) {
    const selected = this.requireAppValue(buildsByApp, appId, "builds").find((candidate) => candidate.id === buildId);
    if (!selected) throw new Error(`Build ${buildId} was not found.`);
    return structuredClone(selected);
  }

  async listGroups(appId: string) {
    return structuredClone(this.requireAppValue(groupsByApp, appId, "groups"));
  }

  async addBuildToGroup(input: AddBuildToGroupInput) {
    const selected = this.requireAppValue(buildsByApp, input.appId, "builds").find((candidate) => candidate.id === input.buildId);
    const group = this.requireAppValue(groupsByApp, input.appId, "groups").find((candidate) => candidate.id === input.groupId);
    if (!selected || !group) throw new Error("The selected demo build or group was not found.");
    if (!selected.groups.some((candidate) => candidate.id === group.id)) selected.groups.push(group);
    selected.testingStatus = group.internal ? "Internal" : "External";
  }

  async listVersions(appId: string, platform?: AppStorePlatform, options: VersionListOptions = {}) {
    const versions = this.requireAppValue(versionsByApp, appId, "versions");
    const filtered = platform ? versions.filter((item) => item.platform === platform) : versions;
    const limited = options.paginate === false && options.limit ? filtered.slice(0, options.limit) : filtered;
    return structuredClone(limited.map((item) => {
      const submission = this.submissions.get(item.id);
      return submission ? { ...item, state: submission.state, editable: false } : item;
    }));
  }

  async listVersionLocalizations(versionId: string) {
    const localizations = localizationsByVersion.get(versionId);
    if (!localizations) throw new Error(`Version ${versionId} was not found.`);
    return structuredClone(localizations);
  }

  async listScreenshots(
    localizationId: string,
    locale: VersionLocalization["locale"],
    displayType: ScreenshotDisplayType,
  ) {
    return structuredClone(screenshotsBySet.get(`${localizationId}:${displayType}`) ?? []).map((asset) => ({
      ...asset,
      locale,
    }));
  }

  async applyScreenshotChanges(input: ApplyScreenshotChangesInput) {
    const key = `${input.localizationId}:${input.displayType}`;
    const current = screenshotsBySet.get(key) ?? [];
    if (JSON.stringify(current.map(screenshotSnapshot)) !== JSON.stringify(input.expected)) {
      throw new Error("Demo screenshots changed before the update started.");
    }
    const deleteIds = new Set(input.deleteIds);
    const next = current.filter((asset) => !deleteIds.has(asset.id));
    for (const upload of input.uploads) {
      next.push({
        id: `demo-screenshot-${upload.uploadId}`,
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
        sortOrder: next.length,
      });
    }
    next.forEach((asset, sortOrder) => { asset.sortOrder = sortOrder; });
    screenshotsBySet.set(key, next);
  }

  async createVersion(input: CreateVersionInput) {
    const versions = this.requireAppValue(versionsByApp, input.appId, "versions");
    if (versions.some((item) => item.versionString === input.versionString && item.platform === input.platform)) {
      throw new Error(`Version ${input.versionString} already exists.`);
    }
    const id = `demo-version-${input.appId.replace(/[^a-z0-9]/gi, "-")}-${input.platform.toLowerCase()}-${input.versionString.replaceAll(".", "-")}`;
    const created: AppStoreVersion = {
      id,
      appId: input.appId,
      versionString: input.versionString,
      platform: input.platform,
      state: "PREPARE_FOR_SUBMISSION",
      releaseType: input.releaseType,
      copyright: null,
      createdAt: new Date().toISOString(),
      copiedFrom: input.copyMetadataFrom,
      editable: true,
    };
    versions.unshift(created);

    const sourceVersion = input.copyMetadataFrom
      ? versions.find((item) => item.versionString === input.copyMetadataFrom && item.platform === input.platform)
      : undefined;
    const sourceLocalizations = sourceVersion ? localizationsByVersion.get(sourceVersion.id) ?? [] : [];
    localizationsByVersion.set(id, sourceLocalizations.map((item) => ({
      ...structuredClone(item),
      id: `${id}-${item.locale}`,
      versionId: id,
      whatsNew: input.excludeWhatsNew ? "" : item.whatsNew,
    })));
    return structuredClone(created);
  }

  async applyVersionLocalizationPatches(
    versionId: string,
    patches: VersionLocalizationPatch[],
    expected: LocalizationSnapshot[],
  ) {
    const localizations = localizationsByVersion.get(versionId);
    if (!localizations) throw new Error(`Version ${versionId} was not found.`);
    const byLocale = new Map(localizations.map((item) => [item.locale, item] as const));
    const current = expected.map((snapshot) => this.snapshot(snapshot.locale, byLocale.get(snapshot.locale)));
    if (JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error("Demo localization metadata changed before the update started.");
    }

    for (const patch of patches) {
      let target = byLocale.get(patch.locale);
      if (!target) {
        target = localization(versionId, patch.locale, { whatsNew: "", promotionalText: "", keywords: "" });
        localizations.push(target);
        byLocale.set(patch.locale, target);
      }
      if (patch.whatsNew !== undefined) target.whatsNew = patch.whatsNew;
      if (patch.promotionalText !== undefined) target.promotionalText = patch.promotionalText;
      if (patch.keywords !== undefined) target.keywords = patch.keywords;
    }
  }

  async validateVersion(appId: string, versionId: string, platform: AppStorePlatform): Promise<ValidationReport> {
    const version = this.requireAppValue(versionsByApp, appId, "versions").find((item) => item.id === versionId);
    if (!version) throw new Error(`Version ${versionId} was not found.`);
    const localizations = localizationsByVersion.get(versionId) ?? [];
    const checks: ValidationCheck[] = [];
    for (const item of localizations) {
      if (!item.whatsNew) checks.push({
        id: "metadata.whats_new_required",
        severity: "error",
        message: `What's new is missing for ${item.locale}.`,
        remediation: "Add release notes for this locale.",
        locale: item.locale,
        field: "whatsNew",
        resourceType: "appStoreVersionLocalizations",
        resourceId: item.id,
      });
      if (item.keywords.length > 100) checks.push({
        id: "metadata.keywords_too_long",
        severity: "error",
        message: `Keywords exceed 100 characters for ${item.locale}.`,
        remediation: "Shorten keywords to 100 characters or fewer.",
        locale: item.locale,
        field: "keywords",
        resourceType: "appStoreVersionLocalizations",
        resourceId: item.id,
      });
    }
    if (!this.attachedBuildIds.has(versionId)) {
      checks.push({
        id: "build.attached",
        severity: "warning",
        message: "A build must be attached before submission.",
        remediation: "Choose a processed build for submission.",
        locale: "",
        field: "build",
        resourceType: "appStoreVersions",
        resourceId: versionId,
      });
    }
    const errors = checks.filter((check) => check.severity === "error").length;
    const warnings = checks.filter((check) => check.severity === "warning").length;
    const actionable = checks.filter((check) => check.remediation);
    return {
      appId,
      versionId,
      versionString: version.versionString,
      platform,
      summary: { errors, warnings, infos: 0, blocking: errors },
      remediation: {
        totalActionable: actionable.length,
        steps: actionable.map((check, index) => ({
          order: index + 1,
          blocking: check.severity === "error",
          severity: check.severity,
          checkId: check.id,
          message: check.message,
          remediation: check.remediation,
          locale: check.locale,
          field: check.field,
          resourceType: check.resourceType,
          resourceId: check.resourceId,
        })),
      },
      checks,
      strict: false,
    };
  }

  async previewVersionSubmission(input: SubmitVersionInput): Promise<VersionSubmissionPreview> {
    const { version, build: selectedBuild } = this.requireSubmissionResources(input);
    const currentBuildId = this.attachedBuildIds.get(version.id) ?? null;
    const submission = this.submissions.get(version.id);
    return {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      buildId: selectedBuild.id,
      currentBuildId,
      wouldAttach: !submission && currentBuildId !== selectedBuild.id,
      alreadyAttached: currentBuildId === selectedBuild.id,
      wouldSubmit: !submission,
      alreadySubmitted: Boolean(submission),
      submissionId: submission?.id ?? null,
    };
  }

  async submitVersion(input: SubmitVersionInput): Promise<VersionSubmissionResult> {
    const { version, build: selectedBuild } = this.requireSubmissionResources(input);
    const existing = this.submissions.get(version.id);
    if (existing?.id) {
      return {
        appId: input.appId,
        versionId: version.id,
        versionString: version.versionString,
        platform: version.platform,
        buildId: selectedBuild.id,
        submissionId: existing.id,
        submittedAt: existing.submittedAt,
        alreadySubmitted: true,
        attached: false,
        alreadyAttached: this.attachedBuildIds.get(version.id) === selectedBuild.id,
      };
    }

    const alreadyAttached = this.attachedBuildIds.get(version.id) === selectedBuild.id;
    this.attachedBuildIds.set(version.id, selectedBuild.id);
    const submittedAt = new Date().toISOString();
    const submission: VersionSubmissionStatus = {
      id: `demo-submission-${version.id}`,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      state: "WAITING_FOR_REVIEW",
      submittedAt,
    };
    this.submissions.set(version.id, submission);
    return {
      appId: input.appId,
      versionId: version.id,
      versionString: version.versionString,
      platform: version.platform,
      buildId: selectedBuild.id,
      submissionId: submission.id!,
      submittedAt,
      alreadySubmitted: false,
      attached: !alreadyAttached,
      alreadyAttached,
    };
  }

  async getVersionSubmissionStatus(versionId: string): Promise<VersionSubmissionStatus> {
    const submission = this.submissions.get(versionId);
    if (submission) return structuredClone(submission);
    for (const versions of versionsByApp.values()) {
      const version = versions.find((item) => item.id === versionId);
      if (version) {
        return {
          id: null,
          versionId: version.id,
          versionString: version.versionString,
          platform: version.platform,
          state: version.state,
          submittedAt: null,
        };
      }
    }
    throw new Error(`Version ${versionId} was not found.`);
  }

  private requireSubmissionResources(input: SubmitVersionInput) {
    const version = this.requireAppValue(versionsByApp, input.appId, "versions")
      .find((item) => item.id === input.versionId);
    const selectedBuild = this.requireAppValue(buildsByApp, input.appId, "builds")
      .find((item) => item.id === input.buildId);
    if (!version || !selectedBuild) throw new Error("The selected demo version or build was not found.");
    return { version, build: selectedBuild };
  }

  private snapshot(locale: LocalizationSnapshot["locale"], item: VersionLocalization | undefined): LocalizationSnapshot {
    return {
      id: item?.id ?? null,
      locale,
      whatsNew: item?.whatsNew ?? "",
      promotionalText: item?.promotionalText ?? "",
      keywords: item?.keywords ?? "",
    };
  }

  private requireAppValue<T>(map: Map<string, T>, appId: string, label: string) {
    const value = map.get(appId);
    if (!value || !apps.some((app) => app.id === appId)) throw new Error(`App ${appId} ${label} were not found.`);
    return value;
  }
}
