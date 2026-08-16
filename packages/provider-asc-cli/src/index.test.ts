import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliAscProvider } from "./index.js";

const fixtureBinary = fileURLToPath(new URL("./fixtures/fake-asc.mjs", import.meta.url));
const missingBinary = `${fixtureBinary}.missing`;

const provider = (options: { uploadDirectory?: string } = {}) => new CliAscProvider({
  binary: fixtureBinary,
  timeoutMs: 5_000,
  ...options,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CliAscProvider asc 1.4.2 fixtures", () => {
  it("maps the apps JSON:API envelope without guessing fields", async () => {
    await expect(provider().listApps()).resolves.toEqual([
      {
        id: "1234567890",
        name: "Orbit Notes",
        bundleId: "com.example.orbitnotes",
        platforms: [],
      },
      {
        id: "9876543210",
        name: "Field Log",
        bundleId: "com.example.fieldlog",
        platforms: [],
      },
    ]);
  });

  it("can return one limited app page without paginating the account", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "first-app-page");

    await expect(provider().listApps({ limit: 25, paginate: false })).resolves.toHaveLength(2);
  });

  it("joins included pre-release versions and group linkages onto every build", async () => {
    await expect(provider().listBuilds("1234567890")).resolves.toEqual([
      {
        id: "build-204",
        appId: "1234567890",
        buildNumber: "204",
        version: "2.4.0",
        uploadedAt: "2026-07-31T18:48:00Z",
        processingStatus: "Ready",
        processingTone: "success",
        testingStatus: "Internal",
        expiresAt: "2026-10-29T18:48:00Z",
        expired: false,
        platform: "IOS",
        sdk: null,
        minimumOs: "18.0",
        encryption: "No",
        groups: [
          { id: "group-team", name: "Team", testerCount: null, internal: true },
        ],
      },
      {
        id: "build-203",
        appId: "1234567890",
        buildNumber: "203",
        version: "2.4.0",
        uploadedAt: "2026-07-30T19:00:00Z",
        processingStatus: "Processing",
        processingTone: "progress",
        testingStatus: "External",
        expiresAt: "2026-10-28T19:00:00Z",
        expired: false,
        platform: "MAC_OS",
        sdk: null,
        minimumOs: "15.0",
        encryption: "Yes",
        groups: [
          { id: "group-team", name: "Team", testerCount: null, internal: true },
          { id: "group-external", name: "Early Access", testerCount: null, internal: false },
        ],
      },
    ]);
  });

  it("loads release builds without TestFlight group hydration", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "group-list-error");

    await expect(provider().listBuilds("1234567890", {
      version: "2.4.0",
      platform: "IOS",
      includeGroups: false,
    })).resolves.toEqual([
      expect.objectContaining({
        id: "build-204",
        version: "2.4.0",
        platform: "IOS",
        groups: [],
      }),
    ]);
  });

  it("uses the same explicit membership lookup for an individual build", async () => {
    const build = await provider().getBuild("1234567890", "build-204");

    expect(build).toMatchObject({
      id: "build-204",
      version: "2.4.0",
      platform: "IOS",
      testingStatus: "Internal",
      groups: [
        { id: "group-team", name: "Team", testerCount: null, internal: true },
      ],
    });
  });

  it("maps the beta-groups JSON:API envelope and keeps unknown counts null", async () => {
    await expect(provider().listGroups("1234567890")).resolves.toEqual([
      { id: "group-team", name: "Team", testerCount: null, internal: true },
      { id: "group-external", name: "Early Access", testerCount: null, internal: false },
      { id: "group-empty", name: "No Builds Yet", testerCount: null, internal: false },
    ]);
  });

  it("reads the exact auth status envelope and selects the default stored profile", async () => {
    await expect(provider().getStatus()).resolves.toEqual({
      mode: "live",
      connected: true,
      ascAvailable: true,
      cliVersion: "1.4.2 (commit: fixture, date: 2026-07-31)",
      profile: "Release Key",
      authBackend: "System Keychain",
      detail: "Connected through the local asc credential store.",
    });
  });

  it("recognizes complete environment credentials when no stored profile is active", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "environment-auth");

    await expect(provider().getStatus()).resolves.toEqual({
      mode: "live",
      connected: true,
      ascAvailable: true,
      cliVersion: "1.4.2 (commit: fixture, date: 2026-07-31)",
      profile: null,
      authBackend: "Environment variables",
      detail: "Connected through environment credentials.",
    });
  });

  it("validates the add-groups result against the requested build and group", async () => {
    await expect(provider().addBuildToGroup({
      appId: "1234567890",
      buildId: "build-204",
      groupId: "group-external",
    })).resolves.toBeUndefined();
  });

  it("maps App Store versions and keeps editability conservative", async () => {
    await expect(provider().listVersions("1234567890", "IOS")).resolves.toEqual([
      {
        id: "version-250",
        appId: "1234567890",
        versionString: "2.5.0",
        platform: "IOS",
        state: "PREPARE_FOR_SUBMISSION",
        releaseType: "MANUAL",
        copyright: "2026 Northstar Labs",
        createdAt: "2026-07-31T18:00:00Z",
        copiedFrom: null,
        editable: true,
      },
      {
        id: "version-240",
        appId: "1234567890",
        versionString: "2.4.0",
        platform: "IOS",
        state: "READY_FOR_DISTRIBUTION",
        releaseType: "MANUAL",
        copyright: null,
        createdAt: "2026-06-20T18:00:00Z",
        copiedFrom: null,
        editable: false,
      },
    ]);
  });

  it("maps macOS App Store versions independently from iOS", async () => {
    await expect(provider().listVersions("1234567890", "MAC_OS")).resolves.toEqual([
      expect.objectContaining({
        id: "version-mac-310",
        versionString: "3.1.0",
        platform: "MAC_OS",
        editable: true,
      }),
    ]);
  });

  it("can return one limited version page without paginating history", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "first-version-page");

    await expect(provider().listVersions("1234567890", "IOS", {
      limit: 25,
      paginate: false,
    })).resolves.toHaveLength(2);
  });

  it("maps version-localization fields without merging app-info metadata", async () => {
    const localizations = await provider().listVersionLocalizations("version-250");

    expect(localizations).toHaveLength(2);
    expect(localizations[0]).toEqual({
      id: "localization-en-US",
      versionId: "version-250",
      locale: "en-US",
      description: "Keep every idea organized.",
      keywords: "notes,ideas,tasks,writing",
      marketingUrl: "https://example.com/orbit-notes",
      promotionalText: "Capture ideas fast.",
      supportUrl: "https://example.com/support",
      whatsNew: "A faster editor and more reliable sync.",
    });
  });

  it("maps the asc 1.4.2 screenshot command wrapper for iOS and macOS", async () => {
    await expect(provider().listScreenshots(
      "localization-en-US",
      "en-US",
      "APP_IPHONE_67",
    )).resolves.toEqual([
      expect.objectContaining({
        id: "screenshot-editor",
        displayType: "APP_IPHONE_67",
        fileName: "01-editor.png",
        fileSize: 0,
        width: 1290,
        height: 2796,
        imageUrl: "https://is1-ssl.mzstatic.com/image/thumb/01-editor/332x720bb.jpg",
        fullImageUrl: "https://is1-ssl.mzstatic.com/image/thumb/01-editor/1290x2796bb.jpg",
        sortOrder: 0,
      }),
      expect.objectContaining({ id: "screenshot-search", sortOrder: 1 }),
    ]);
    await expect(provider().listScreenshots(
      "localization-en-US",
      "en-US",
      "APP_DESKTOP",
    )).resolves.toEqual([
      expect.objectContaining({
        id: "screenshot-mac-editor",
        displayType: "APP_DESKTOP",
        width: 2880,
        height: 1800,
      }),
    ]);
  });

  it("rejects a screenshot wrapper for a different localization", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "mismatched-screenshot-localization");

    await expect(provider().listScreenshots(
      "localization-en-US",
      "en-US",
      "APP_DESKTOP",
    )).rejects.toThrow("unsupported JSON shape");
  });

  it("preflights and applies staged screenshot uploads through allowlisted argv", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "asc-studio-provider-shots-"));
    const uploadId = "11111111-1111-4111-8111-111111111111";
    const fileName = "01-editor.png";
    const body = Buffer.from("fixture image");
    await mkdir(join(uploadRoot, uploadId));
    await writeFile(join(uploadRoot, uploadId, fileName), body);
    try {
      const target = provider({ uploadDirectory: uploadRoot });
      const current = await target.listScreenshots("localization-en-US", "en-US", "APP_IPHONE_67");
      await expect(target.applyScreenshotChanges({
        localizationId: "localization-en-US",
        locale: "en-US",
        displayType: "APP_IPHONE_67",
        uploads: [{
          uploadId,
          displayType: "APP_IPHONE_67",
          fileName,
          mediaType: "image/png",
          fileSize: body.length,
          width: 1290,
          height: 2796,
          checksum: createHash("sha256").update(body).digest("hex"),
          hasAlpha: false,
        }],
        deleteIds: [],
        expected: current.map(({ localizationId: _localizationId, locale: _locale, displayType: _displayType, imageUrl: _imageUrl, fullImageUrl: _fullImageUrl, ...asset }) => asset),
      })).resolves.toBeUndefined();
    } finally {
      await rm(uploadRoot, { recursive: true, force: true });
    }
  });

  it("creates a version with copied metadata and verifies the resulting version", async () => {
    await expect(provider().createVersion({
      appId: "1234567890",
      versionString: "2.5.0",
      platform: "IOS",
      copyMetadataFrom: "2.4.0",
      releaseType: "MANUAL",
      excludeWhatsNew: true,
    })).resolves.toMatchObject({
      id: "version-250",
      versionString: "2.5.0",
      copiedFrom: "2.4.0",
    });
  });

  it("rechecks, applies, and verifies a localization patch", async () => {
    const expected = [{
      id: "localization-en-US",
      locale: "en-US" as const,
      whatsNew: "A faster editor and more reliable sync.",
      promotionalText: "Capture ideas fast.",
      keywords: "notes,ideas,tasks,writing",
    }];

    await expect(provider().applyVersionLocalizationPatches("version-250", [{
      locale: "en-US",
      whatsNew: "A faster editor and more reliable sync.",
    }], expected)).resolves.toBeUndefined();
  });

  it("parses a structured validation report when asc exits for blockers", async () => {
    await expect(provider().validateVersion("1234567890", "version-250", "IOS")).resolves.toMatchObject({
      versionId: "version-250",
      summary: { errors: 1, warnings: 1, blocking: 1 },
      remediation: { totalActionable: 2 },
    });
  });

  it("maps the guarded review-submit dry run before any mutation", async () => {
    await expect(provider().previewVersionSubmission({
      appId: "1234567890",
      versionId: "version-250",
      buildId: "build-204",
    })).resolves.toEqual({
      appId: "1234567890",
      versionId: "version-250",
      versionString: "2.5.0",
      platform: "IOS",
      buildId: "build-204",
      currentBuildId: "build-200",
      wouldAttach: true,
      alreadyAttached: false,
      wouldSubmit: true,
      alreadySubmitted: false,
      submissionId: null,
    });
  });

  it("maps the confirmed review submission and attachment result", async () => {
    await expect(provider().submitVersion({
      appId: "1234567890",
      versionId: "version-250",
      buildId: "build-204",
    })).resolves.toEqual({
      appId: "1234567890",
      versionId: "version-250",
      versionString: "2.5.0",
      platform: "IOS",
      buildId: "build-204",
      submissionId: "review-submission-250",
      submittedAt: "2026-07-31T19:05:00Z",
      alreadySubmitted: false,
      attached: true,
      alreadyAttached: false,
    });
  });

  it("maps review status by exact App Store version ID", async () => {
    await expect(provider().getVersionSubmissionStatus("version-250")).resolves.toEqual({
      id: "review-submission-250",
      versionId: "version-250",
      versionString: "2.5.0",
      platform: "IOS",
      state: "WAITING_FOR_REVIEW",
      submittedAt: "2026-07-31T19:05:00Z",
    });
  });
});

describe("CliAscProvider failure handling", () => {
  it("fails closed on a guessed or malformed apps wrapper", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "malformed-apps");

    await expect(provider().listApps()).rejects.toThrow(
      "asc apps list returned an unsupported JSON shape.",
    );
  });

  it("fails closed when a build's pre-release linkage is absent from included data", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "missing-included");

    await expect(provider().listBuilds("1234567890")).rejects.toThrow(
      "asc builds list returned an unsupported JSON shape.",
    );
  });

  it("does not expose CLI stderr in command errors", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "stderr-error");

    const error = await provider().listApps().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("asc apps list failed.");
    expect((error as Error).message).not.toContain("SECRET_PRIVATE_KEY");
    expect((error as Error).message).not.toContain("AuthKey.p8");
  });

  it("does not expose auth stderr in status details", async () => {
    vi.stubEnv("ASC_STUDIO_FAKE_SCENARIO", "auth-stderr-error");

    const status = await provider().getStatus();
    expect(status).toMatchObject({
      connected: false,
      ascAvailable: true,
      detail: "App Store Connect authentication is not configured.",
    });
    expect(status.detail).not.toContain("SECRET_ISSUER_ID");
    expect(status.detail).not.toContain("AuthKey.p8");
  });

  it("reports a missing binary without exposing the configured path", async () => {
    const missingProvider = new CliAscProvider({ binary: missingBinary });

    await expect(missingProvider.getStatus()).resolves.toMatchObject({
      connected: false,
      ascAvailable: false,
      cliVersion: null,
      detail: "The asc CLI is not installed or is not on PATH.",
    });

    const error = await missingProvider.listApps().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("asc apps list could not start the asc CLI.");
    expect((error as Error).message).not.toContain(missingBinary);
  });

  it("rejects unsafe identifiers before starting a command", async () => {
    await expect(provider().listBuilds("123;open /tmp/secret")).rejects.toThrow(
      "App ID contains unsupported characters.",
    );
  });
});
