import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rmdir, stat, unlink } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import {
  AppStoreLocaleSchema,
  ValidationReportSchema,
  type AddBuildToGroupInput,
  type AgentStatus,
  type AppStorePlatform,
  type AppStoreVersion,
  type AppSummary,
  type BuildSummary,
  type CreateVersionInput,
  type LocalizationSnapshot,
  type ScreenshotAsset,
  type ScreenshotAssetSnapshot,
  type ScreenshotDisplayType,
  type StatusTone,
  type SubmitVersionInput,
  type TesterGroup,
  type ValidationReport,
  type VersionLocalization,
  type VersionLocalizationPatch,
  type VersionSubmissionPreview,
  type VersionSubmissionResult,
  type VersionSubmissionStatus,
} from "@asc-studio/contracts";
import type { AppListOptions, AscProvider, BuildListOptions, VersionListOptions } from "@asc-studio/core";
import type { ApplyScreenshotChangesInput } from "@asc-studio/core";
import type { output, ZodTypeAny } from "zod";
import {
  AddGroupsEnvelopeSchema,
  allowedIdentifier,
  AppStoreVersionLocalizationsEnvelopeSchema,
  AppStoreVersionsEnvelopeSchema,
  AppsEnvelopeSchema,
  AuthStatusEnvelopeSchema,
  BetaGroupsEnvelopeSchema,
  BuildInfoEnvelopeSchema,
  BuildsEnvelopeSchema,
  CliVersionSchema,
  GroupBuildLinksEnvelopeSchema,
  ReviewSubmitEnvelopeSchema,
  ScreenshotListEnvelopeSchema,
  SubmissionStatusEnvelopeSchema,
  ValidationReportEnvelopeSchema,
  type BetaGroupsEnvelope,
  type BuildResource,
  type PreReleaseVersionResource,
} from "./schemas.js";

export { MockAscProvider } from "./mock.js";

interface CommandResult {
  stdout: string;
  exitCode: number;
}

export interface CliProviderOptions {
  binary?: string;
  profile?: string;
  timeoutMs?: number;
  uploadDirectory?: string;
}

class CliLaunchError extends Error {
  constructor(readonly binaryMissing: boolean) {
    super("The asc CLI could not be started.");
    this.name = "CliLaunchError";
  }
}

const assertIdentifier = (label: string, value: string) => {
  if (!allowedIdentifier.test(value)) throw new Error(`${label} contains unsupported characters.`);
  return value;
};

const run = (binary: string, args: string[], timeoutMs: number, profile?: string): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const fullArgs = profile ? [...args, "--profile", profile] : args;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, fullArgs, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch {
      reject(new CliLaunchError(false));
      return;
    }

    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream || !stderrStream) {
      reject(new CliLaunchError(false));
      return;
    }

    let stdout = "";
    let stderrLength = 0;
    let launchFailed = false;
    const maximum = 8 * 1024 * 1024;
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);

    stdoutStream.setEncoding("utf8");
    stderrStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maximum) child.kill("SIGTERM");
    });
    stderrStream.on("data", (chunk: string) => {
      stderrLength += chunk.length;
      if (stderrLength > maximum) child.kill("SIGTERM");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      launchFailed = true;
      clearTimeout(timer);
      reject(new CliLaunchError(error.code === "ENOENT"));
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (!launchFailed) resolve({ stdout, exitCode: exitCode ?? 1 });
    });
  });

const unsupportedOutput = (context: string) => new Error(`${context} returned an unsupported JSON shape.`);

const parseJson = <Schema extends ZodTypeAny>(
  result: CommandResult,
  context: string,
  schema: Schema,
  allowReportedError = false,
): output<Schema> => {
  if (result.exitCode !== 0 && !allowReportedError) throw new Error(`${context} failed.`);

  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    if (result.exitCode !== 0) throw new Error(`${context} failed.`);
    throw unsupportedOutput(context);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    if (result.exitCode !== 0) throw new Error(`${context} failed.`);
    throw unsupportedOutput(context);
  }
  return parsed.data;
};

const runJson = async <Schema extends ZodTypeAny>(
  binary: string,
  args: string[],
  timeoutMs: number,
  profile: string | undefined,
  context: string,
  schema: Schema,
  allowReportedError = false,
): Promise<output<Schema>> => {
  let result: CommandResult;
  try {
    result = await run(binary, args, timeoutMs, profile);
  } catch {
    throw new Error(`${context} could not start the asc CLI.`);
  }
  return parseJson(result, context, schema, allowReportedError);
};

const runSuccess = async (
  binary: string,
  args: string[],
  timeoutMs: number,
  profile: string | undefined,
  context: string,
) => {
  let result: CommandResult;
  try {
    result = await run(binary, args, timeoutMs, profile);
  } catch {
    throw new Error(`${context} could not start the asc CLI.`);
  }
  if (result.exitCode !== 0) throw new Error(`${context} failed.`);
};

const processingFor = (
  state: BuildResource["attributes"]["processingState"],
  expired: boolean,
): { status: string; tone: StatusTone } => {
  if (expired) return { status: "Expired", tone: "neutral" };
  switch (state) {
    case "VALID":
      return { status: "Ready", tone: "success" };
    case "PROCESSING":
      return { status: "Processing", tone: "progress" };
    case "FAILED":
      return { status: "Failed", tone: "danger" };
    case "INVALID":
      return { status: "Invalid", tone: "danger" };
  }
};

const normalizeGroup = (raw: BetaGroupsEnvelope["data"][number]): TesterGroup => ({
  id: raw.id,
  name: raw.attributes.name,
  testerCount: null,
  internal: raw.attributes.isInternalGroup ?? false,
});

const preReleaseVersionsById = (included: PreReleaseVersionResource[] | undefined) =>
  new Map((included ?? []).map((item) => [item.id, item] as const));

const testingStatusFor = (groups: TesterGroup[]) => {
  if (groups.some((group) => !group.internal)) return "External";
  if (groups.length > 0) return "Internal";
  return "Not assigned";
};

const editableVersionStates = new Set([
  "DEVELOPER_REJECTED",
  "INVALID_BINARY",
  "METADATA_REJECTED",
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "REJECTED",
]);

const metadataFlags = (patch: VersionLocalizationPatch) => [
  ...(patch.whatsNew !== undefined ? ["--whats-new", patch.whatsNew] : []),
  ...(patch.promotionalText !== undefined ? ["--promotional-text", patch.promotionalText] : []),
  ...(patch.keywords !== undefined ? ["--keywords", patch.keywords] : []),
];

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

const screenshotImageUrl = (
  templateUrl: string | undefined,
  width: number | undefined,
  height: number | undefined,
  maximumDimension?: number,
) => {
  if (!templateUrl || !width || !height) return null;
  const scale = maximumDimension ? Math.min(1, maximumDimension / Math.max(width, height)) : 1;
  return templateUrl
    .replaceAll("{w}", String(Math.max(1, Math.round(width * scale))))
    .replaceAll("{h}", String(Math.max(1, Math.round(height * scale))))
    .replaceAll("{f}", "jpg")
    .replaceAll("{c}", "bb");
};

const releaseSnapshot = (
  locale: LocalizationSnapshot["locale"],
  localization: VersionLocalization | undefined,
): LocalizationSnapshot => ({
  id: localization?.id ?? null,
  locale,
  whatsNew: localization?.whatsNew ?? "",
  promotionalText: localization?.promotionalText ?? "",
  keywords: localization?.keywords ?? "",
});

const normalizeBuild = (
  raw: BuildResource,
  appId: string,
  preReleaseVersions: Map<string, PreReleaseVersionResource>,
  groups: TesterGroup[],
): BuildSummary => {
  const preReleaseVersionId = raw.relationships.preReleaseVersion.data.id;
  const preReleaseVersion = preReleaseVersions.get(preReleaseVersionId);
  if (!preReleaseVersion) throw unsupportedOutput("asc builds");

  const expired = raw.attributes.expired ?? false;
  const processing = processingFor(raw.attributes.processingState, expired);
  return {
    id: raw.id,
    appId,
    buildNumber: raw.attributes.version,
    version: preReleaseVersion.attributes.version,
    uploadedAt: raw.attributes.uploadedDate,
    processingStatus: processing.status,
    processingTone: processing.tone,
    testingStatus: testingStatusFor(groups),
    expiresAt: raw.attributes.expirationDate ?? null,
    expired,
    platform: preReleaseVersion.attributes.platform,
    sdk: null,
    minimumOs: raw.attributes.minOsVersion ?? null,
    encryption: raw.attributes.usesNonExemptEncryption === undefined
      ? null
      : raw.attributes.usesNonExemptEncryption ? "Yes" : "No",
    groups,
  };
};

export class CliAscProvider implements AscProvider {
  private readonly binary: string;
  private readonly profile: string | undefined;
  private readonly timeoutMs: number;
  private readonly uploadDirectory: string | null;

  constructor(options: CliProviderOptions = {}) {
    this.binary = options.binary ?? "asc";
    this.profile = options.profile;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.uploadDirectory = options.uploadDirectory ? resolve(options.uploadDirectory) : null;
  }

  async getStatus(): Promise<AgentStatus> {
    const [versionOutcome, authOutcome] = await Promise.allSettled([
      run(this.binary, ["--version"], 5_000, this.profile),
      run(this.binary, ["auth", "status", "--output", "json"], 8_000, this.profile),
    ]);

    if (versionOutcome.status === "rejected") {
      const detail = versionOutcome.reason instanceof CliLaunchError && versionOutcome.reason.binaryMissing
        ? "The asc CLI is not installed or is not on PATH."
        : "ASC Studio could not start the asc CLI.";
      return {
        mode: "live",
        connected: false,
        ascAvailable: false,
        cliVersion: null,
        profile: this.profile ?? null,
        authBackend: null,
        detail,
      };
    }

    if (versionOutcome.value.exitCode !== 0) {
      return {
        mode: "live",
        connected: false,
        ascAvailable: false,
        cliVersion: null,
        profile: this.profile ?? null,
        authBackend: null,
        detail: "The asc CLI is not available.",
      };
    }

    const parsedVersion = CliVersionSchema.safeParse(versionOutcome.value.stdout);
    if (!parsedVersion.success) {
      return {
        mode: "live",
        connected: false,
        ascAvailable: true,
        cliVersion: null,
        profile: this.profile ?? null,
        authBackend: null,
        detail: "The asc CLI returned an unsupported version string.",
      };
    }

    const cliVersion = parsedVersion.data;
    const semanticVersion = /^\d+\.\d+\.\d+/.exec(cliVersion)?.[0];
    if (semanticVersion !== "1.4.2" && process.env.ASC_STUDIO_ALLOW_UNTESTED_ASC !== "1") {
      return {
        mode: "live",
        connected: false,
        ascAvailable: true,
        cliVersion,
        profile: this.profile ?? null,
        authBackend: null,
        detail: `ASC Studio 0.3 supports asc 1.4.2; found ${semanticVersion ?? "an unknown version"}.`,
      };
    }

    if (authOutcome.status === "rejected") {
      return {
        mode: "live",
        connected: false,
        ascAvailable: true,
        cliVersion,
        profile: this.profile ?? null,
        authBackend: null,
        detail: "ASC Studio could not read the asc authentication status.",
      };
    }
    if (authOutcome.value.exitCode !== 0) {
      return {
        mode: "live",
        connected: false,
        ascAvailable: true,
        cliVersion,
        profile: this.profile ?? null,
        authBackend: null,
        detail: "App Store Connect authentication is not configured.",
      };
    }

    let payload;
    try {
      payload = parseJson(authOutcome.value, "asc auth status", AuthStatusEnvelopeSchema);
    } catch {
      return {
        mode: "live",
        connected: false,
        ascAvailable: true,
        cliVersion,
        profile: this.profile ?? null,
        authBackend: null,
        detail: "asc auth status returned an unsupported JSON shape.",
      };
    }

    const requestedProfile = payload.profile ?? this.profile ?? "";
    const storedCredential = requestedProfile
      ? payload.credentials.find((credential) => credential.name === requestedProfile)
      : payload.credentials.find((credential) => credential.isDefault);
    const environmentActive = !requestedProfile
      && !storedCredential
      && payload.environmentCredentialsComplete;
    const connected = Boolean(storedCredential || environmentActive);
    const activeProfile = storedCredential?.name ?? requestedProfile;

    return {
      mode: "live",
      connected,
      ascAvailable: true,
      cliVersion,
      profile: activeProfile || null,
      authBackend: environmentActive ? "Environment variables" : payload.storageBackend,
      detail: environmentActive
        ? "Connected through environment credentials."
        : storedCredential
          ? "Connected through the local asc credential store."
          : "No App Store Connect credential is configured in asc.",
    };
  }

  async listApps(options: AppListOptions = {}): Promise<AppSummary[]> {
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200)) {
      throw new Error("App limit must be between 1 and 200.");
    }
    const payload = await runJson(
      this.binary,
      [
        "apps", "list",
        ...(options.limit ? ["--limit", String(options.limit)] : []),
        ...(options.paginate === false ? [] : ["--paginate"]),
        "--output", "json",
      ],
      this.timeoutMs,
      this.profile,
      "asc apps list",
      AppsEnvelopeSchema,
    );
    return payload.data.map((raw) => ({
      id: raw.id,
      name: raw.attributes.name,
      bundleId: raw.attributes.bundleId,
      platforms: [],
    }));
  }

  async listBuilds(appId: string, options: BuildListOptions = {}): Promise<BuildSummary[]> {
    assertIdentifier("App ID", appId);
    if (options.version) assertIdentifier("Version", options.version);
    const payloadPromise = runJson(
      this.binary,
      [
        "builds", "list", "--app", appId,
        ...(options.version ? ["--version", options.version] : []),
        ...(options.platform ? ["--platform", options.platform] : []),
        "--processing-state", "all", "--sort", "-uploadedDate", "--paginate", "--output", "json",
      ],
      this.timeoutMs,
      this.profile,
      "asc builds list",
      BuildsEnvelopeSchema,
    );
    const groupsPromise = options.includeGroups === false
      ? Promise.resolve([] as TesterGroup[])
      : this.listGroups(appId);
    const [payload, groups] = await Promise.all([payloadPromise, groupsPromise]);
    if (payload.data.length === 0) return [];

    const memberships = options.includeGroups === false ? new Map<string, TesterGroup[]>() : await this.listGroupMemberships(groups);
    const preReleaseVersions = preReleaseVersionsById(payload.included);
    return payload.data
      .map((raw) => normalizeBuild(raw, appId, preReleaseVersions, memberships.get(raw.id) ?? []))
      .filter((build) => (
        (!options.version || build.version === options.version)
        && (!options.platform || build.platform === options.platform)
      ));
  }

  async getBuild(appId: string, buildId: string): Promise<BuildSummary> {
    assertIdentifier("App ID", appId);
    assertIdentifier("Build ID", buildId);
    const [payload, groups] = await Promise.all([
      runJson(
        this.binary,
        ["builds", "info", "--build-id", buildId, "--output", "json"],
        this.timeoutMs,
        this.profile,
        "asc builds info",
        BuildInfoEnvelopeSchema,
      ),
      this.listGroups(appId),
    ]);
    if (payload.data.id !== buildId) throw unsupportedOutput("asc builds info");

    const memberships = await this.listGroupMemberships(groups);
    const preReleaseVersions = preReleaseVersionsById(payload.included);
    return normalizeBuild(payload.data, appId, preReleaseVersions, memberships.get(buildId) ?? []);
  }

  async listGroups(appId: string): Promise<TesterGroup[]> {
    assertIdentifier("App ID", appId);
    const payload = await runJson(
      this.binary,
      ["testflight", "groups", "list", "--app", appId, "--paginate", "--output", "json"],
      this.timeoutMs,
      this.profile,
      "asc testflight groups list",
      BetaGroupsEnvelopeSchema,
    );
    return payload.data.map(normalizeGroup);
  }

  async addBuildToGroup(input: AddBuildToGroupInput): Promise<void> {
    assertIdentifier("App ID", input.appId);
    assertIdentifier("Build ID", input.buildId);
    assertIdentifier("Group ID", input.groupId);
    const payload = await runJson(
      this.binary,
      ["builds", "add-groups", "--build-id", input.buildId, "--group", input.groupId, "--output", "json"],
      this.timeoutMs,
      this.profile,
      "asc builds add-groups",
      AddGroupsEnvelopeSchema,
    );
    if (payload.buildId !== input.buildId || payload.groupIds.length !== 1 || payload.groupIds[0] !== input.groupId) {
      throw unsupportedOutput("asc builds add-groups");
    }
  }

  async listVersions(
    appId: string,
    platform?: AppStorePlatform,
    options: VersionListOptions = {},
  ): Promise<AppStoreVersion[]> {
    assertIdentifier("App ID", appId);
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200)) {
      throw new Error("Version limit must be between 1 and 200.");
    }
    const payload = await runJson(
      this.binary,
      [
        "versions", "list", "--app", appId,
        ...(platform ? ["--platform", platform] : []),
        ...(options.limit ? ["--limit", String(options.limit)] : []),
        ...(options.paginate === false ? [] : ["--paginate"]),
        "--output", "json",
      ],
      this.timeoutMs,
      this.profile,
      "asc versions list",
      AppStoreVersionsEnvelopeSchema,
    );
    return payload.data.map((raw) => {
      const state = raw.attributes.appVersionState ?? raw.attributes.appStoreState;
      if (!state) throw unsupportedOutput("asc versions list");
      return {
        id: raw.id,
        appId,
        versionString: raw.attributes.versionString,
        platform: raw.attributes.platform,
        state,
        releaseType: raw.attributes.releaseType ?? null,
        copyright: raw.attributes.copyright ?? null,
        createdAt: raw.attributes.createdDate ?? null,
        copiedFrom: null,
        editable: editableVersionStates.has(state),
      };
    }).filter((version) => !platform || version.platform === platform);
  }

  async listVersionLocalizations(versionId: string): Promise<VersionLocalization[]> {
    assertIdentifier("Version ID", versionId);
    const payload = await runJson(
      this.binary,
      ["localizations", "list", "--version", versionId, "--paginate", "--output", "json"],
      this.timeoutMs,
      this.profile,
      "asc localizations list",
      AppStoreVersionLocalizationsEnvelopeSchema,
    );
    return payload.data.map((raw) => {
      const locale = AppStoreLocaleSchema.safeParse(raw.attributes.locale);
      if (!locale.success) throw unsupportedOutput("asc localizations list");
      return {
        id: raw.id,
        versionId,
        locale: locale.data,
        description: raw.attributes.description ?? "",
        keywords: raw.attributes.keywords ?? "",
        marketingUrl: raw.attributes.marketingUrl ?? "",
        promotionalText: raw.attributes.promotionalText ?? "",
        supportUrl: raw.attributes.supportUrl ?? "",
        whatsNew: raw.attributes.whatsNew ?? "",
      };
    });
  }

  async listScreenshots(
    localizationId: string,
    locale: VersionLocalization["locale"],
    displayType: ScreenshotDisplayType,
  ): Promise<ScreenshotAsset[]> {
    assertIdentifier("Localization ID", localizationId);
    const payload = await runJson(
      this.binary,
      ["screenshots", "list", "--version-localization", localizationId, "--output", "json"],
      this.timeoutMs,
      this.profile,
      "asc screenshots list",
      ScreenshotListEnvelopeSchema,
    );
    if (payload.versionLocalizationId !== localizationId) throw unsupportedOutput("asc screenshots list");
    const item = payload.sets.find((candidate) => candidate.set.attributes.screenshotDisplayType === displayType);
    if (!item) return [];
    return item.screenshots.map((raw, sortOrder) => {
      const imageAsset = raw.attributes.imageAsset;
      return {
        id: raw.id,
        localizationId,
        locale,
        displayType,
        fileName: raw.attributes.fileName,
        fileSize: raw.attributes.fileSize,
        width: imageAsset?.width ?? null,
        height: imageAsset?.height ?? null,
        checksum: raw.attributes.sourceFileChecksum ?? null,
        state: raw.attributes.assetDeliveryState?.state ?? "COMPLETE",
        imageUrl: screenshotImageUrl(imageAsset?.templateUrl, imageAsset?.width, imageAsset?.height, 720),
        fullImageUrl: screenshotImageUrl(imageAsset?.templateUrl, imageAsset?.width, imageAsset?.height),
        sortOrder,
      };
    });
  }

  async applyScreenshotChanges(input: ApplyScreenshotChangesInput): Promise<void> {
    const current = await this.listScreenshots(input.localizationId, input.locale, input.displayType);
    if (JSON.stringify(current.map(screenshotSnapshot)) !== JSON.stringify(input.expected)) {
      throw new Error("App Store Connect screenshots changed before the update started.");
    }
    const staged = await Promise.all(input.uploads.map(async (upload) => {
      const path = this.screenshotUploadPath(upload.uploadId, upload.fileName);
      const [body, details] = await Promise.all([readFile(path), stat(path)]);
      if (!details.isFile() || details.size !== upload.fileSize) {
        throw new Error(`Staged screenshot ${upload.fileName} changed before upload.`);
      }
      const checksum = createHash("sha256").update(body).digest("hex");
      if (checksum !== upload.checksum) {
        throw new Error(`Staged screenshot ${upload.fileName} changed before upload.`);
      }
      const sourceChecksum = createHash("md5").update(body).digest("hex");
      await runSuccess(
        this.binary,
        ["screenshots", "validate", "--path", path, "--device-type", input.displayType, "--output", "json"],
        this.timeoutMs,
        this.profile,
        "asc screenshots validate",
      );
      await runSuccess(
        this.binary,
        [
          "screenshots", "upload",
          "--version-localization", input.localizationId,
          "--path", path,
          "--device-type", input.displayType,
          "--skip-existing",
          "--dry-run",
          "--output", "json",
        ],
        this.timeoutMs,
        this.profile,
        "asc screenshots upload --dry-run",
      );
      return { upload, path, sourceChecksum };
    }));

    for (const id of input.deleteIds) {
      assertIdentifier("Screenshot ID", id);
      await runSuccess(
        this.binary,
        ["screenshots", "delete", "--id", id, "--confirm", "--output", "json"],
        this.timeoutMs,
        this.profile,
        "asc screenshots delete",
      );
    }
    for (const item of staged) {
      await runSuccess(
        this.binary,
        [
          "screenshots", "upload",
          "--version-localization", input.localizationId,
          "--path", item.path,
          "--device-type", input.displayType,
          "--skip-existing",
          "--output", "json",
        ],
        this.timeoutMs,
        this.profile,
        "asc screenshots upload",
      );
    }

    const verified = await this.listScreenshots(input.localizationId, input.locale, input.displayType);
    for (const item of staged) {
      if (!verified.some((asset) => (
        asset.fileName === item.upload.fileName
        && (asset.checksum
          ? asset.checksum.toLowerCase() === item.sourceChecksum
          : asset.fileSize > 0 && asset.fileSize === item.upload.fileSize)
        && (asset.width === null || asset.width === item.upload.width)
        && (asset.height === null || asset.height === item.upload.height)
      ))) {
        throw new Error(`asc screenshots upload could not verify ${item.upload.fileName}.`);
      }
    }
    for (const id of input.deleteIds) {
      if (verified.some((asset) => asset.id === id)) throw new Error(`asc screenshots delete could not verify ${id}.`);
    }
    await Promise.all(staged.map(async ({ upload, path }) => {
      await unlink(path).catch(() => undefined);
      await rmdir(join(this.requireUploadDirectory(), upload.uploadId)).catch(() => undefined);
    }));
  }

  async createVersion(input: CreateVersionInput): Promise<AppStoreVersion> {
    assertIdentifier("App ID", input.appId);
    const args = [
      "versions", "create",
      "--app", input.appId,
      "--version", input.versionString,
      "--platform", input.platform,
      "--release-type", input.releaseType,
      ...(input.copyMetadataFrom
        ? [
            "--copy-metadata-from", input.copyMetadataFrom,
            ...(input.excludeWhatsNew ? ["--exclude-fields", "whatsNew"] : []),
          ]
        : []),
      "--output", "json",
    ];
    await runSuccess(this.binary, args, this.timeoutMs, this.profile, "asc versions create");
    const versions = await this.listVersions(input.appId, input.platform);
    const created = versions.find((version) => version.versionString === input.versionString);
    if (!created) throw new Error("asc versions create completed but the new version could not be verified.");
    return { ...created, copiedFrom: input.copyMetadataFrom };
  }

  async applyVersionLocalizationPatches(
    versionId: string,
    patches: VersionLocalizationPatch[],
    expected: LocalizationSnapshot[],
  ): Promise<void> {
    assertIdentifier("Version ID", versionId);
    const current = await this.listVersionLocalizations(versionId);
    const currentByLocale = new Map(current.map((localization) => [localization.locale, localization] as const));
    const currentSnapshots = expected.map((snapshot) => releaseSnapshot(snapshot.locale, currentByLocale.get(snapshot.locale)));
    if (JSON.stringify(currentSnapshots) !== JSON.stringify(expected)) {
      throw new Error("App Store Connect localization metadata changed before the update started.");
    }

    for (const patch of patches) {
      const existing = currentByLocale.get(patch.locale);
      const command = existing ? "update" : "create";
      await runSuccess(
        this.binary,
        [
          "localizations", command,
          "--version", versionId,
          "--locale", patch.locale,
          ...metadataFlags(patch),
          "--output", "json",
        ],
        this.timeoutMs,
        this.profile,
        `asc localizations ${command}`,
      );
    }

    const verified = await this.listVersionLocalizations(versionId);
    const verifiedByLocale = new Map(verified.map((localization) => [localization.locale, localization] as const));
    for (const patch of patches) {
      const localization = verifiedByLocale.get(patch.locale);
      if (!localization) throw new Error(`asc localizations update could not verify ${patch.locale}.`);
      if (patch.whatsNew !== undefined && localization.whatsNew !== patch.whatsNew) {
        throw new Error(`asc localizations update could not verify what's new for ${patch.locale}.`);
      }
      if (patch.promotionalText !== undefined && localization.promotionalText !== patch.promotionalText) {
        throw new Error(`asc localizations update could not verify promotional text for ${patch.locale}.`);
      }
      if (patch.keywords !== undefined && localization.keywords !== patch.keywords) {
        throw new Error(`asc localizations update could not verify keywords for ${patch.locale}.`);
      }
    }
  }

  async validateVersion(
    appId: string,
    versionId: string,
    platform: AppStorePlatform,
  ): Promise<ValidationReport> {
    assertIdentifier("App ID", appId);
    assertIdentifier("Version ID", versionId);
    const payload = await runJson(
      this.binary,
      ["validate", "--app", appId, "--version-id", versionId, "--platform", platform, "--output", "json"],
      this.timeoutMs,
      this.profile,
      "asc validate",
      ValidationReportEnvelopeSchema,
      true,
    );
    return ValidationReportSchema.parse(payload);
  }

  async previewVersionSubmission(input: SubmitVersionInput): Promise<VersionSubmissionPreview> {
    this.assertSubmissionInput(input);
    const payload = await runJson(
      this.binary,
      [
        "review", "submit",
        "--app", input.appId,
        "--version-id", input.versionId,
        "--build", input.buildId,
        "--dry-run",
        "--output", "json",
      ],
      this.timeoutMs,
      this.profile,
      "asc review submit --dry-run",
      ReviewSubmitEnvelopeSchema,
    );
    this.assertSubmissionEnvelope(input, payload, "asc review submit --dry-run");
    if (payload.dryRun !== true || (!payload.alreadySubmitted && !payload.buildAttachment)) {
      throw unsupportedOutput("asc review submit --dry-run");
    }
    return {
      appId: payload.appId,
      versionId: payload.versionId,
      versionString: payload.version ?? "",
      platform: payload.platform,
      buildId: payload.buildId,
      currentBuildId: payload.buildAttachment?.currentBuildId ?? null,
      wouldAttach: payload.buildAttachment?.wouldAttach ?? false,
      alreadyAttached: payload.buildAttachment?.alreadyAttached ?? false,
      wouldSubmit: payload.wouldSubmit ?? false,
      alreadySubmitted: payload.alreadySubmitted ?? false,
      submissionId: payload.submissionId ?? null,
    };
  }

  async submitVersion(input: SubmitVersionInput): Promise<VersionSubmissionResult> {
    this.assertSubmissionInput(input);
    const payload = await runJson(
      this.binary,
      [
        "review", "submit",
        "--app", input.appId,
        "--version-id", input.versionId,
        "--build", input.buildId,
        "--confirm",
        "--output", "json",
      ],
      this.timeoutMs,
      this.profile,
      "asc review submit",
      ReviewSubmitEnvelopeSchema,
    );
    this.assertSubmissionEnvelope(input, payload, "asc review submit");
    if (payload.dryRun || !payload.submissionId) throw unsupportedOutput("asc review submit");
    return {
      appId: payload.appId,
      versionId: payload.versionId,
      versionString: payload.version ?? "",
      platform: payload.platform,
      buildId: payload.buildId,
      submissionId: payload.submissionId,
      submittedAt: payload.submittedDate ?? null,
      alreadySubmitted: payload.alreadySubmitted ?? false,
      attached: payload.buildAttachment?.attached ?? false,
      alreadyAttached: payload.buildAttachment?.alreadyAttached ?? false,
    };
  }

  async getVersionSubmissionStatus(versionId: string): Promise<VersionSubmissionStatus> {
    assertIdentifier("Version ID", versionId);
    const payload = await runJson(
      this.binary,
      ["submit", "status", "--version-id", versionId, "--output", "json"],
      this.timeoutMs,
      this.profile,
      "asc submit status",
      SubmissionStatusEnvelopeSchema,
    );
    if (
      payload.versionId !== versionId
      || !payload.versionString
      || !payload.platform
      || !payload.state
    ) {
      throw unsupportedOutput("asc submit status");
    }
    return {
      id: payload.id || null,
      versionId: payload.versionId,
      versionString: payload.versionString,
      platform: payload.platform,
      state: payload.state,
      submittedAt: payload.createdDate ?? null,
    };
  }

  private requireUploadDirectory() {
    if (!this.uploadDirectory) throw new Error("Screenshot uploads are not configured for this provider.");
    return this.uploadDirectory;
  }

  private screenshotUploadPath(uploadId: string, fileName: string) {
    if (!/^[0-9a-f-]{36}$/.test(uploadId) || basename(fileName) !== fileName) {
      throw new Error("The staged screenshot reference is invalid.");
    }
    const root = this.requireUploadDirectory();
    const path = resolve(root, uploadId, fileName);
    const pathFromRoot = relative(root, path);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) {
      throw new Error("The staged screenshot reference is invalid.");
    }
    return path;
  }

  private assertSubmissionInput(input: SubmitVersionInput) {
    assertIdentifier("App ID", input.appId);
    assertIdentifier("Version ID", input.versionId);
    assertIdentifier("Build ID", input.buildId);
  }

  private assertSubmissionEnvelope(
    input: SubmitVersionInput,
    payload: { appId: string; versionId: string; buildId: string; version?: string | undefined },
    context: string,
  ) {
    if (
      payload.appId !== input.appId
      || payload.versionId !== input.versionId
      || payload.buildId !== input.buildId
      || !payload.version
    ) {
      throw unsupportedOutput(context);
    }
  }

  private async listGroupMemberships(groups: TesterGroup[]): Promise<Map<string, TesterGroup[]>> {
    if (groups.length === 0) return new Map();

    const linkedBuildIdsByGroup = new Map<string, string[]>();
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < groups.length) {
        const group = groups[nextIndex++];
        if (!group) return;
        const payload = await runJson(
          this.binary,
          ["testflight", "groups", "links", "view", "--group-id", group.id, "--type", "builds", "--paginate", "--output", "json"],
          this.timeoutMs,
          this.profile,
          "asc testflight groups links view",
          GroupBuildLinksEnvelopeSchema,
        );
        linkedBuildIdsByGroup.set(group.id, payload.data.map((linkage) => linkage.id));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, groups.length) }, () => worker()));

    const memberships = new Map<string, TesterGroup[]>();
    for (const group of groups) {
      for (const buildId of linkedBuildIdsByGroup.get(group.id) ?? []) {
        const assigned = memberships.get(buildId) ?? [];
        assigned.push(group);
        memberships.set(buildId, assigned);
      }
    }
    return memberships;
  }
}
