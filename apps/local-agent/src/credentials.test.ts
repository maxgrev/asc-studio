import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStoreConnectCredentialStore } from "./credentials.js";

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

    await store.save({
      profileName: "Personal",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKey,
    });

    await expect(store.load()).resolves.toEqual({
      profileName: "Personal",
      issuerId: "11111111-2222-3333-4444-555555555555",
      keyId: "ABC123DEFG",
      privateKey,
      authBackend: "Owner-only local credential file",
    });
    const credentialDirectory = join(root, "credentials");
    const metadataPath = join(credentialDirectory, "app-store-connect.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { privateKeyFile: string };
    const keyPath = join(credentialDirectory, metadata.privateKeyFile);
    expect((await stat(credentialDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(metadataPath)).mode & 0o777).toBe(0o600);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(metadataPath, "utf8")).not.toContain("PRIVATE KEY");
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
      profileName: "CI release",
      issuerId: "issuer-ci",
      keyId: "CIKEY12345",
      authBackend: "Environment variables",
    });
    await expect(stat(join(root, "credentials"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
