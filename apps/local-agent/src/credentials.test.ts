import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleAdsCredentialStore, AppStoreConnectCredentialStore } from "./credentials.js";

const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("AppStoreConnectCredentialStore", () => {
  it("saves the key outside metadata with owner-only permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-credentials-"));
    directories.push(root);
    const store = new AppStoreConnectCredentialStore(root);

    const connectionId = await store.save({
      profileName: "Personal",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKey,
    });

    await expect(store.load()).resolves.toEqual({
      connectionId,
      profileName: "Personal",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKey,
      authBackend: "Owner-only local credential file",
    });
    const credentialDirectory = join(root, "credentials");
    const metadataPath = join(credentialDirectory, "app-store-connect.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
      version: number;
      activeConnectionId: string;
      connections: Array<{ privateKeyFile: string }>;
    };
    const keyPath = join(credentialDirectory, metadata.connections[0]!.privateKeyFile);
    expect(metadata).toMatchObject({ version: 2, activeConnectionId: connectionId });
    expect((await stat(credentialDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(metadataPath)).mode & 0o777).toBe(0o600);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(metadataPath, "utf8")).not.toContain("PRIVATE KEY");
  });

  it("saves, switches, and removes multiple Apple accounts", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-credentials-"));
    directories.push(root);
    const store = new AppStoreConnectCredentialStore(root);
    const personalId = await store.save({
      profileName: "Personal",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKey,
    });
    const workId = await store.save({
      profileName: "Work",
      issuerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      keyId: "WORK123456",
      privateKey,
    });

    await expect(store.list()).resolves.toEqual([
      { id: personalId, profileName: "Personal", keyId: "ABC123DEFG", active: false, source: "local" },
      { id: workId, profileName: "Work", keyId: "WORK123456", active: true, source: "local" },
    ]);
    await store.activate(personalId);
    await expect(store.load()).resolves.toMatchObject({ connectionId: personalId, profileName: "Personal" });
    await store.remove(personalId);
    await expect(store.load()).resolves.toMatchObject({ connectionId: workId, profileName: "Work" });
    await expect(store.list()).resolves.toEqual([
      { id: workId, profileName: "Work", keyId: "WORK123456", active: true, source: "local" },
    ]);
  });

  it("reads a legacy single connection and migrates it on the next change", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-credentials-"));
    directories.push(root);
    const credentialDirectory = join(root, "credentials");
    await mkdir(credentialDirectory, { recursive: true });
    await writeFile(join(credentialDirectory, "AuthKey.p8"), privateKey);
    await writeFile(join(credentialDirectory, "app-store-connect.json"), JSON.stringify({
      version: 1,
      profileName: "Legacy",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKeyFile: "AuthKey.p8",
    }));
    const store = new AppStoreConnectCredentialStore(root);

    const accounts = await store.list();
    expect(accounts).toEqual([expect.objectContaining({ profileName: "Legacy", active: true })]);
    await store.activate(accounts[0]!.id);
    const secondId = await store.save({
      profileName: "Second",
      issuerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      keyId: "WORK123456",
      privateKey,
    });

    const metadata = JSON.parse(await readFile(join(credentialDirectory, "app-store-connect.json"), "utf8"));
    expect(metadata).toMatchObject({ version: 2, activeConnectionId: secondId });
    expect(metadata.connections).toHaveLength(2);
  });

  it("uses complete environment credentials without writing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-credentials-"));
    directories.push(root);
    vi.stubEnv("ASC_STUDIO_PROFILE_NAME", "CI release");
    vi.stubEnv("ASC_STUDIO_ISSUER_ID", "issuer-ci");
    vi.stubEnv("ASC_STUDIO_KEY_ID", "CIKEY12345");
    vi.stubEnv("ASC_STUDIO_PRIVATE_KEY", privateKey);
    const store = new AppStoreConnectCredentialStore(root);

    await expect(store.load()).resolves.toMatchObject({
      connectionId: "environment",
      profileName: "CI release",
      issuerId: "issuer-ci",
      keyId: "CIKEY12345",
      authBackend: "Environment variables",
    });
    await expect(store.list()).resolves.toEqual([{
      id: "environment",
      profileName: "CI release",
      keyId: "CIKEY12345",
      active: true,
      source: "environment",
    }]);
    await expect(stat(join(root, "credentials"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("AppleAdsCredentialStore", () => {
  it("generates a browser-safe public key and saves the private key in an owner-only file", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-ads-credentials-"));
    directories.push(root);
    const store = new AppleAdsCredentialStore(root);
    const generated = store.createSetup("asc-account-1");
    expect(generated.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(generated.publicKey).not.toContain("PRIVATE KEY");

    const input = {
      clientId: "SEARCHADS.client-1",
      teamId: "SEARCHADS.team-1",
      keyId: "ads-key-1",
      adAccountId: "123456789",
      setupId: generated.setupId,
    };
    await expect(store.candidateCredentials("asc-account-1", "Orbit Notes Team", input)).resolves.toMatchObject({
      profileName: "Orbit Notes Team",
      clientId: input.clientId,
      adAccountId: input.adAccountId,
    });
    await store.save("asc-account-1", input);

    await expect(store.load({ connectionId: "asc-account-1", profileName: "Orbit Notes Team" })).resolves.toMatchObject({
      profileName: "Orbit Notes Team",
      keyId: "ads-key-1",
      adAccountId: "123456789",
      authBackend: "Owner-only local credential file",
    });
    await expect(store.summary({ connectionId: "asc-account-1", profileName: "Orbit Notes Team" })).resolves.toEqual({
      configured: true,
      profileName: "Orbit Notes Team",
      appStoreConnectConnectionId: "asc-account-1",
      adAccountId: "123456789",
      keyId: "ads-key-1",
      source: "local",
    });

    const credentialDirectory = join(root, "credentials");
    const metadataPath = join(credentialDirectory, "apple-ads.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { connections: Array<{ privateKeyFile: string }> };
    const keyPath = join(credentialDirectory, metadata.connections[0]!.privateKeyFile);
    expect((await stat(metadataPath)).mode & 0o777).toBe(0o600);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(metadataPath, "utf8")).not.toContain("PRIVATE KEY");

    await store.remove("asc-account-1");
    await expect(store.load({ connectionId: "asc-account-1", profileName: "Orbit Notes Team" })).resolves.toBeNull();
  });

  it("expires generated private keys without exposing them to the browser", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-ads-credentials-"));
    directories.push(root);
    let now = new Date("2026-08-16T12:00:00.000Z");
    const store = new AppleAdsCredentialStore(root, () => now);
    const generated = store.createSetup("asc-account-1");
    now = new Date("2026-08-16T12:16:00.000Z");

    await expect(store.candidateCredentials("asc-account-1", "Orbit Notes Team", {
      clientId: "SEARCHADS.client-1",
      teamId: "SEARCHADS.team-1",
      keyId: "ads-key-1",
      adAccountId: "123456789",
      setupId: generated.setupId,
    })).rejects.toMatchObject({ code: "apple_ads_setup_expired", status: 409 });
  });
});
