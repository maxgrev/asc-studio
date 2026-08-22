import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppleAdsCredentialStore, AppStoreConnectCredentialStore, OpenAiCredentialStore } from "./credentials.js";
import { InMemoryCredentialVault, KeychainAccessError, keychainAccount, type CredentialVault } from "./keychain.js";

const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString();
const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const makeRoot = async (prefix = "asc-studio-credentials-") => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  directories.push(root);
  return root;
};
const makeCredentialDirectory = async (root: string) => {
  const directory = join(root, "credentials");
  await mkdir(directory, { mode: 0o700 });
  return directory;
};
const makeAppStoreStore = (root: string, vault: CredentialVault) => (
  new AppStoreConnectCredentialStore(root, vault, join(root, "recovery"))
);
const makeOpenAiStore = (root: string, vault: CredentialVault) => (
  new OpenAiCredentialStore(root, vault, join(root, "recovery"))
);
const makeAppleAdsStore = (root: string, now: () => Date, vault: CredentialVault) => (
  new AppleAdsCredentialStore(root, now, vault, join(root, "recovery"))
);
const expectNoLegacyCredentials = (root: string) => (
  expect(stat(join(root, "credentials"))).rejects.toMatchObject({ code: "ENOENT" })
);

class FailingVault extends InMemoryCredentialVault {
  failWrite = false;
  failReadFresh = false;

  override async write(account: string, secret: string) {
    if (this.failWrite) {
      this.operations.push({ operation: "write", account });
      throw new KeychainAccessError("denied", "Keychain denied.");
    }
    await super.write(account, secret);
  }

  override async readFresh(account: string) {
    if (this.failReadFresh) {
      this.operations.push({ operation: "readFresh", account });
      throw new KeychainAccessError("denied", "Keychain denied.");
    }
    return super.readFresh(account);
  }
}

class FailRollbackVerificationVault extends InMemoryCredentialVault {
  failVerification = true;
  private freshReads = 0;

  override async readFresh(account: string) {
    this.freshReads += 1;
    if (this.failVerification && this.freshReads >= 2) {
      this.operations.push({ operation: "readFresh", account });
      throw new KeychainAccessError("denied", "Keychain denied during verification.");
    }
    return super.readFresh(account);
  }
}

class CommitThenThrowVault extends InMemoryCredentialVault {
  failAfterNextWrite = false;

  override async write(account: string, secret: string) {
    await super.write(account, secret);
    if (this.failAfterNextWrite) {
      this.failAfterNextWrite = false;
      throw new KeychainAccessError("denied", "Keychain timed out after committing the item.", true);
    }
  }
}

class CommitUnknownBeforeObservationVault extends InMemoryCredentialVault {
  failNextWrite = false;

  override async write(account: string, secret: string) {
    if (!this.failNextWrite) return super.write(account, secret);
    this.failNextWrite = false;
    this.operations.push({ operation: "write", account });
    void secret;
    throw new KeychainAccessError("denied", "Keychain helper was killed during the update.", true);
  }
}

class RemoveThenThrowVault extends InMemoryCredentialVault {
  failAfterNextRemove = false;

  override async remove(account: string) {
    const removed = await super.remove(account);
    if (this.failAfterNextRemove) {
      this.failAfterNextRemove = false;
      throw new KeychainAccessError("denied", "Keychain timed out after removing the item.");
    }
    return removed;
  }
}

class CorruptNextWriteVault extends InMemoryCredentialVault {
  corruptNextWrite = false;

  override async write(account: string, secret: string) {
    if (!this.corruptNextWrite) return super.write(account, secret);
    this.corruptNextWrite = false;
    this.operations.push({ operation: "write", account });
    this.values.set(account, `${secret}-corrupt`);
  }
}

class DeferredVerificationVault extends InMemoryCredentialVault {
  private armed = false;
  private blockNextFreshRead = false;
  private verificationGate: Promise<void> | null = null;
  private announceWrite: (() => void) | null = null;

  arm() {
    this.armed = true;
    const candidateWritten = new Promise<void>((resolve) => {
      this.announceWrite = resolve;
    });
    let releaseVerification!: () => void;
    this.verificationGate = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    return {
      candidateWritten,
      releaseVerification,
    };
  }

  override async write(account: string, secret: string) {
    await super.write(account, secret);
    if (this.armed) {
      this.armed = false;
      this.blockNextFreshRead = true;
      this.announceWrite?.();
    }
  }

  override async readFresh(account: string) {
    if (this.blockNextFreshRead) {
      this.blockNextFreshRead = false;
      const gate = this.verificationGate;
      this.verificationGate = null;
      if (gate) await gate;
    }
    return super.readFresh(account);
  }
}

describe("AppStoreConnectCredentialStore", () => {
  it("stores and updates multiple Apple accounts only in Keychain", async () => {
    const root = await makeRoot();
    const vault = new InMemoryCredentialVault();
    const store = makeAppStoreStore(root, vault);
    const personalId = await store.save({
      profileName: "Personal", issuerId: "issuer-1", keyId: "ABC123DEFG", privateKey,
    });
    const workId = await store.save({
      profileName: "Work", issuerId: "issuer-2", keyId: "WORK123456", privateKey,
    });
    await expect(store.list()).resolves.toEqual([
      { id: personalId, profileName: "Personal", keyId: "ABC123DEFG", active: false, source: "local" },
      { id: workId, profileName: "Work", keyId: "WORK123456", active: true, source: "local" },
    ]);
    await store.activate(personalId);
    await expect(store.load()).resolves.toMatchObject({
      connectionId: personalId, profileName: "Personal", privateKey, authBackend: "macOS Keychain",
    });
    await store.remove(personalId);
    await expect(store.load()).resolves.toMatchObject({ connectionId: workId });
    await store.remove(workId);
    await expect(store.list()).resolves.toEqual([]);
    await expectNoLegacyCredentials(root);
    expect(vault.values.size).toBe(0);
  });

  it("migrates a legacy multi-account bundle only after write and exact read-back", async () => {
    const root = await makeRoot();
    const directory = await makeCredentialDirectory(root);
    const firstFile = `AuthKey-ABC123DEFG-${randomUUID()}.p8`;
    const secondFile = `AuthKey-WORK123456-${randomUUID()}.p8`;
    await writeFile(join(directory, firstFile), privateKey, { mode: 0o600 });
    await writeFile(join(directory, secondFile), privateKey, { mode: 0o600 });
    await writeFile(join(directory, "app-store-connect.json"), JSON.stringify({
      version: 2,
      activeConnectionId: "work",
      connections: [
        { id: "personal", profileName: "Personal", issuerId: "issuer-1", keyId: "ABC123DEFG", privateKeyFile: firstFile },
        { id: "work", profileName: "Work", issuerId: "issuer-2", keyId: "WORK123456", privateKeyFile: secondFile },
      ],
    }), { mode: 0o600 });
    const vault = new InMemoryCredentialVault();
    const store = makeAppStoreStore(root, vault);
    await expect(store.list()).resolves.toHaveLength(2);
    expect(vault.operations.map(({ operation }) => operation)).toEqual(["read", "write", "readFresh"]);
    await expectNoLegacyCredentials(root);
    expect([...vault.values.values()][0]).toContain("PRIVATE KEY");
  });

  it("preserves all legacy files when Keychain write or read-back fails", async () => {
    for (const failure of ["write", "readFresh"] as const) {
      const root = await makeRoot();
      const directory = await makeCredentialDirectory(root);
      await writeFile(join(directory, "AuthKey.p8"), privateKey, { mode: 0o600 });
      await writeFile(join(directory, "app-store-connect.json"), JSON.stringify({
        version: 1,
        profileName: "Legacy",
        issuerId: "issuer",
        keyId: "ABC123DEFG",
        privateKeyFile: "AuthKey.p8",
      }), { mode: 0o600 });
      const vault = new FailingVault();
      if (failure === "write") vault.failWrite = true;
      else vault.failReadFresh = true;
      const store = makeAppStoreStore(root, vault);
      await expect(store.list()).rejects.toMatchObject({
        code: failure === "write" ? "keychain_unavailable" : "keychain_rollback_failed",
      });
      await expect(readFile(join(directory, "AuthKey.p8"), "utf8")).resolves.toBe(privateKey);
      await expect(readFile(join(directory, "app-store-connect.json"), "utf8")).resolves.toContain("Legacy");
    }
  });

  it("uses environment credentials without touching Keychain or creating a vault ID", async () => {
    const root = await makeRoot();
    vi.stubEnv("ASC_STUDIO_PROFILE_NAME", "CI release");
    vi.stubEnv("ASC_STUDIO_ISSUER_ID", "issuer-ci");
    vi.stubEnv("ASC_STUDIO_KEY_ID", "CIKEY12345");
    vi.stubEnv("ASC_STUDIO_PRIVATE_KEY", privateKey);
    const vault = new InMemoryCredentialVault();
    const store = makeAppStoreStore(root, vault);
    await expect(store.load()).resolves.toMatchObject({ authBackend: "Environment variables" });
    expect(vault.operations).toEqual([]);
    await expect(stat(join(root, "keychain-vault-id"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates legacy Apple credentials before applying environment precedence", async () => {
    const root = await makeRoot();
    const directory = await makeCredentialDirectory(root);
    await writeFile(join(directory, "AuthKey.p8"), privateKey, { mode: 0o600 });
    await writeFile(join(directory, "app-store-connect.json"), JSON.stringify({
      version: 1,
      profileName: "Legacy",
      issuerId: "issuer-legacy",
      keyId: "LEGACY1234",
      privateKeyFile: "AuthKey.p8",
    }), { mode: 0o600 });
    vi.stubEnv("ASC_STUDIO_ISSUER_ID", "issuer-ci");
    vi.stubEnv("ASC_STUDIO_KEY_ID", "CIKEY12345");
    vi.stubEnv("ASC_STUDIO_PRIVATE_KEY", privateKey);
    const vault = new InMemoryCredentialVault();

    await expect(makeAppStoreStore(root, vault).load())
      .resolves.toMatchObject({ connectionId: "environment" });
    await expectNoLegacyCredentials(root);
    expect([...vault.values.values()].join("\n")).toContain("issuer-legacy");
  });
});

describe("OpenAiCredentialStore", () => {
  it("saves, replaces, and removes without a plaintext credential file", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-");
    const vault = new InMemoryCredentialVault();
    const store = makeOpenAiStore(root, vault);
    await store.save({ apiKey: "sk-local-first", model: "gpt-5.6-luna" });
    await expect(store.load()).resolves.toMatchObject({ apiKey: "sk-local-first", localModel: "gpt-5.6-luna" });
    await store.save({ apiKey: "sk-local-replacement", model: "" });
    await expect(store.load()).resolves.toMatchObject({ apiKey: "sk-local-replacement", localModel: null });
    expect([...vault.values.values()].join("\n")).not.toContain("sk-local-first");
    await expectNoLegacyCredentials(root);
    await store.remove();
    await expect(store.load()).resolves.toBeNull();
  });

  it("cleans equal coexistence and crash temps, but preserves divergent legacy data", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-migration-");
    const directory = await makeCredentialDirectory(root);
    const legacy = { version: 1, apiKey: "sk-legacy", model: "gpt-local" };
    await writeFile(join(directory, "openai.json"), JSON.stringify(legacy), { mode: 0o600 });
    await writeFile(join(directory, `openai.json.${randomUUID()}.tmp`), "sk-crash", { mode: 0o600 });
    const vault = new InMemoryCredentialVault();
    vault.values.set(await keychainAccount(root, "openai"), JSON.stringify({
      version: 2, apiKey: "sk-legacy", model: "gpt-local",
    }));
    await expect(makeOpenAiStore(root, vault).load()).resolves.toMatchObject({ apiKey: "sk-legacy" });
    await expectNoLegacyCredentials(root);

    const conflictRoot = await makeRoot("asc-studio-openai-conflict-");
    const conflictDirectory = await makeCredentialDirectory(conflictRoot);
    await writeFile(join(conflictDirectory, "openai.json"), JSON.stringify(legacy), { mode: 0o600 });
    const conflictVault = new InMemoryCredentialVault();
    conflictVault.values.set(await keychainAccount(conflictRoot, "openai"), JSON.stringify({
      version: 2, apiKey: "sk-different", model: "gpt-local",
    }));
    await expect(makeOpenAiStore(conflictRoot, conflictVault).load())
      .rejects.toMatchObject({ code: "credential_store_conflict" });
    await expect(readFile(join(conflictDirectory, "openai.json"), "utf8")).resolves.toContain("sk-legacy");
  });

  it("gives environment configuration precedence and blocks local mutation", async () => {
    const root = await makeRoot("asc-studio-openai-env-");
    const vault = new InMemoryCredentialVault();
    const store = makeOpenAiStore(root, vault);
    vi.stubEnv("OPENAI_API_KEY", "sk-environment");
    await expect(store.load()).resolves.toMatchObject({ source: "environment" });
    await expect(store.save({ apiKey: "sk-local" })).rejects.toMatchObject({ code: "environment_credentials_active" });
    await expect(store.remove()).rejects.toMatchObject({ code: "environment_credentials_active" });
    expect(vault.operations).toEqual([]);
  });

  it("migrates a legacy OpenAI key before returning the environment override", async () => {
    const root = await makeRoot("asc-studio-openai-env-migration-");
    const directory = await makeCredentialDirectory(root);
    await writeFile(join(directory, "openai.json"), JSON.stringify({
      version: 1,
      apiKey: "sk-legacy",
      model: null,
    }), { mode: 0o600 });
    vi.stubEnv("OPENAI_API_KEY", "sk-environment");
    const vault = new InMemoryCredentialVault();

    await expect(makeOpenAiStore(root, vault).load())
      .resolves.toMatchObject({ apiKey: "sk-environment", source: "environment" });
    await expectNoLegacyCredentials(root);
    expect([...vault.values.values()].join("\n")).toContain("sk-legacy");
  });

  it("reconciles uncertain writes, restores replacements, and verifies first-write cleanup", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);

    const committedRoot = await makeRoot("asc-studio-openai-committed-");
    const committedVault = new CommitThenThrowVault();
    committedVault.failAfterNextWrite = true;
    const committedStore = makeOpenAiStore(committedRoot, committedVault);
    await expect(committedStore.save({ apiKey: "sk-committed" })).resolves.toBeUndefined();
    await expect(committedStore.load()).resolves.toMatchObject({ apiKey: "sk-committed" });

    const firstRoot = await makeRoot("asc-studio-openai-first-rollback-");
    const firstVault = new CorruptNextWriteVault();
    firstVault.corruptNextWrite = true;
    const firstStore = makeOpenAiStore(firstRoot, firstVault);
    await expect(firstStore.save({ apiKey: "sk-candidate" }))
      .rejects.toMatchObject({ code: "keychain_verification_failed" });
    expect(firstVault.values.size).toBe(0);

    const replacementRoot = await makeRoot("asc-studio-openai-replacement-rollback-");
    const replacementVault = new CorruptNextWriteVault();
    const replacementStore = makeOpenAiStore(replacementRoot, replacementVault);
    await replacementStore.save({ apiKey: "sk-current" });
    replacementVault.corruptNextWrite = true;
    await expect(replacementStore.save({ apiKey: "sk-candidate" }))
      .rejects.toMatchObject({ code: "keychain_verification_failed" });
    await expect(replacementStore.load()).resolves.toMatchObject({ apiKey: "sk-current" });
  });

  it("persists rollback uncertainty and blocks every local use until an explicit reset", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-uncertain-");
    const vault = new FailRollbackVerificationVault();
    const store = makeOpenAiStore(root, vault);

    await expect(store.save({ apiKey: "sk-unverified-candidate" }))
      .rejects.toMatchObject({ code: "keychain_rollback_failed" });
    const marker = join(root, "recovery", `${await keychainAccount(root, "openai")}.uncertain`);
    expect((await stat(marker)).mode & 0o777).toBe(0o600);
    await expect(readFile(marker, "utf8")).resolves.toBe("asc-studio-keychain-rollback-uncertain-v1\n");

    vault.failVerification = false;
    const operationsBeforeBlockedReads = vault.operations.length;
    await expect(store.load()).rejects.toMatchObject({ code: "keychain_rollback_failed" });
    await expect(store.save({ apiKey: "sk-another-candidate" }))
      .rejects.toMatchObject({ code: "keychain_rollback_failed" });
    expect(vault.operations).toHaveLength(operationsBeforeBlockedReads);

    const restartedStore = makeOpenAiStore(root, vault);
    await expect(restartedStore.summary()).rejects.toMatchObject({ code: "keychain_rollback_failed" });
    await writeFile(marker, "", { mode: 0o600 });
    await restartedStore.reset();
    await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, "recovery", `${await keychainAccount(root, "openai")}.reset`), "utf8"))
      .resolves.toBe("asc-studio-keychain-reset-v1\n");
    await expect(restartedStore.load()).resolves.toBeNull();
  });

  it("keeps the recovery marker when a timed-out write still shows the prior item", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-timeout-uncertain-");
    const vault = new CommitUnknownBeforeObservationVault();
    const store = makeOpenAiStore(root, vault);
    await store.save({ apiKey: "sk-current" });
    vault.failNextWrite = true;

    await expect(store.save({ apiKey: "sk-candidate" }))
      .rejects.toMatchObject({ code: "keychain_rollback_failed" });
    const marker = join(root, "recovery", `${await keychainAccount(root, "openai")}.uncertain`);
    await expect(readFile(marker, "utf8"))
      .resolves.toBe("asc-studio-keychain-rollback-uncertain-v1\n");
    await expect(store.load()).rejects.toMatchObject({ code: "keychain_rollback_failed" });

    await store.reset();
    await expect(store.load()).resolves.toBeNull();
  });

  it("treats a write-ahead recovery marker from an interrupted process as authoritative", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-crash-marker-");
    const recoveryDirectory = join(root, "recovery");
    await mkdir(recoveryDirectory, { mode: 0o700 });
    const marker = join(recoveryDirectory, `${await keychainAccount(root, "openai")}.uncertain`);
    await writeFile(marker, "asc-studio-keychain-rollback-uncertain-v1\n", { mode: 0o600 });
    const vault = new InMemoryCredentialVault();
    const store = makeOpenAiStore(root, vault);

    await expect(store.load()).rejects.toMatchObject({ code: "keychain_rollback_failed" });
    expect(vault.operations).toEqual([]);
    await store.reset();
    await expect(store.load()).resolves.toBeNull();
  });

  it("does not resurrect legacy plaintext after an interrupted vault reset", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-reset-crash-");
    const directory = await makeCredentialDirectory(root);
    await writeFile(join(directory, "openai.json"), JSON.stringify({
      version: 1,
      apiKey: "sk-legacy-must-not-return",
      model: null,
    }), { mode: 0o600 });
    const vault = new RemoveThenThrowVault();
    vault.values.set(await keychainAccount(root, "openai"), JSON.stringify({
      version: 2,
      apiKey: "sk-keychain",
      model: null,
    }));
    vault.failAfterNextRemove = true;
    const store = makeOpenAiStore(root, vault);

    await expect(store.reset()).rejects.toMatchObject({ code: "keychain_rollback_failed" });
    expect(vault.values.size).toBe(0);
    await expect(readFile(join(directory, "openai.json"), "utf8"))
      .resolves.toContain("sk-legacy-must-not-return");

    const restartedStore = makeOpenAiStore(root, vault);
    await expect(restartedStore.load()).rejects.toMatchObject({ code: "keychain_rollback_failed" });
    expect(vault.values.size).toBe(0);
    await restartedStore.reset();
    await expectNoLegacyCredentials(root);
    await expect(restartedStore.load()).resolves.toBeNull();
  });

  it("shares rollback recovery state across data-directory copies with the same vault ID", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const firstRoot = await makeRoot("asc-studio-openai-shared-first-");
    const copiedRoot = await makeRoot("asc-studio-openai-shared-copy-");
    const account = await keychainAccount(firstRoot, "openai");
    await writeFile(
      join(copiedRoot, "keychain-vault-id"),
      await readFile(join(firstRoot, "keychain-vault-id"), "utf8"),
      { mode: 0o600 },
    );
    expect(await keychainAccount(copiedRoot, "openai")).toBe(account);

    const recoveryDirectory = join(firstRoot, "shared-recovery");
    const vault = new FailRollbackVerificationVault();
    const firstStore = new OpenAiCredentialStore(firstRoot, vault, recoveryDirectory);
    await expect(firstStore.save({ apiKey: "sk-unverified-candidate" }))
      .rejects.toMatchObject({ code: "keychain_rollback_failed" });

    vault.failVerification = false;
    const copiedStore = new OpenAiCredentialStore(copiedRoot, vault, recoveryDirectory);
    await expect(copiedStore.summary()).rejects.toMatchObject({ code: "keychain_rollback_failed" });
    await copiedStore.reset();
    await expect(firstStore.summary()).resolves.toMatchObject({ configured: false });
  });

  it("uses a vault-wide reset tombstone to prevent stale copied legacy data from resurrecting", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const originRoot = await makeRoot("asc-studio-openai-reset-origin-");
    const resetRoot = await makeRoot("asc-studio-openai-reset-copy-");
    const account = await keychainAccount(originRoot, "openai");
    await writeFile(
      join(resetRoot, "keychain-vault-id"),
      await readFile(join(originRoot, "keychain-vault-id"), "utf8"),
      { mode: 0o600 },
    );
    const originCredentials = await makeCredentialDirectory(originRoot);
    await writeFile(join(originCredentials, "openai.json"), JSON.stringify({
      version: 1,
      apiKey: "sk-stale-copy",
      model: null,
    }), { mode: 0o600 });

    const recoveryDirectory = join(originRoot, "shared-reset-recovery");
    const vault = new InMemoryCredentialVault();
    vault.values.set(account, JSON.stringify({ version: 2, apiKey: "sk-current", model: null }));
    const resetStore = new OpenAiCredentialStore(resetRoot, vault, recoveryDirectory);
    await resetStore.reset();
    expect(vault.values.size).toBe(0);

    const tombstone = join(recoveryDirectory, `${account}.reset`);
    await expect(readFile(tombstone, "utf8")).resolves.toBe("asc-studio-keychain-reset-v1\n");
    await writeFile(tombstone, "", { mode: 0o600 });
    await resetStore.reset();
    await expect(readFile(tombstone, "utf8")).resolves.toBe("asc-studio-keychain-reset-v1\n");
    const originStore = new OpenAiCredentialStore(originRoot, vault, recoveryDirectory);
    await expect(originStore.load()).resolves.toBeNull();
    await expectNoLegacyCredentials(originRoot);
    expect(vault.values.size).toBe(0);

    await originStore.save({ apiKey: "sk-intentional-reconnect" });
    await expect(stat(tombstone)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(originStore.load()).resolves.toMatchObject({ apiKey: "sk-intentional-reconnect" });
  });

  it("keeps reads behind replacement verification", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-serialized-");
    const vault = new DeferredVerificationVault();
    const store = makeOpenAiStore(root, vault);
    await store.save({ apiKey: "sk-current" });
    const deferred = vault.arm();
    const saving = store.save({ apiKey: "sk-candidate" });
    await deferred.candidateWritten;

    let readSettled = false;
    const reading = store.load().finally(() => {
      readSettled = true;
    });
    await Promise.resolve();
    expect(readSettled).toBe(false);

    deferred.releaseVerification();
    await expect(saving).resolves.toBeUndefined();
    await expect(reading).resolves.toMatchObject({ apiKey: "sk-candidate" });
  });

  it("reports damaged Keychain data and resets it without parsing", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const root = await makeRoot("asc-studio-openai-reset-");
    const vault = new InMemoryCredentialVault();
    vault.values.set(await keychainAccount(root, "openai"), "not-json");
    const store = makeOpenAiStore(root, vault);
    await expect(store.summary()).rejects.toMatchObject({ code: "credential_store_damaged" });
    await store.reset();
    await expect(store.summary()).resolves.toMatchObject({ configured: false });
  });
});

describe("AppleAdsCredentialStore", () => {
  it("keeps generated private material in memory and persists only to Keychain", async () => {
    const root = await makeRoot("asc-studio-ads-");
    const vault = new InMemoryCredentialVault();
    const store = makeAppleAdsStore(root, () => new Date("2026-08-21T12:00:00.000Z"), vault);
    const setup = store.createSetup("asc-account-1");
    expect(setup.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(setup.publicKey).not.toContain("PRIVATE KEY");
    await store.save("asc-account-1", {
      clientId: "SEARCHADS.client-1", teamId: "SEARCHADS.team-1", keyId: "ads-key-1",
      adAccountId: "123456789", setupId: setup.setupId,
    });
    await expect(store.load({ connectionId: "asc-account-1", profileName: "Orbit Notes" })).resolves.toMatchObject({
      keyId: "ads-key-1", authBackend: "macOS Keychain",
    });
    await expectNoLegacyCredentials(root);
    await store.remove("asc-account-1");
  });

  it("migrates Apple Ads metadata, key, and crash-temp plaintext together", async () => {
    const root = await makeRoot("asc-studio-ads-migration-");
    const directory = await makeCredentialDirectory(root);
    const keyFile = `AdsKey-${randomUUID()}.pem`;
    await writeFile(join(directory, keyFile), privateKey, { mode: 0o600 });
    await writeFile(join(directory, `AdsKey-${randomUUID()}.pem.tmp`), privateKey, { mode: 0o600 });
    await writeFile(join(directory, "apple-ads.json"), JSON.stringify({
      version: 1,
      connections: [{ appStoreConnectConnectionId: "asc-account-1", clientId: "SEARCHADS.client-1",
        teamId: "SEARCHADS.team-1", keyId: "ads-key-1", adAccountId: "123456789", privateKeyFile: keyFile }],
    }), { mode: 0o600 });
    const vault = new InMemoryCredentialVault();
    const store = makeAppleAdsStore(root, () => new Date(), vault);
    await expect(store.summary({ connectionId: "asc-account-1", profileName: "Orbit Notes" }))
      .resolves.toMatchObject({ configured: true, source: "local" });
    expect(vault.operations.map(({ operation }) => operation)).toEqual(["read", "write", "readFresh"]);
    await expectNoLegacyCredentials(root);
  });

  it("migrates legacy Apple Ads credentials before applying environment precedence", async () => {
    const root = await makeRoot("asc-studio-ads-env-migration-");
    const directory = await makeCredentialDirectory(root);
    const keyFile = `AdsKey-${randomUUID()}.pem`;
    await writeFile(join(directory, keyFile), privateKey, { mode: 0o600 });
    await writeFile(join(directory, "apple-ads.json"), JSON.stringify({
      version: 1,
      connections: [{
        appStoreConnectConnectionId: "asc-account-legacy",
        clientId: "SEARCHADS.legacy-client",
        teamId: "SEARCHADS.legacy-team",
        keyId: "legacy-key",
        adAccountId: "123456789",
        privateKeyFile: keyFile,
      }],
    }), { mode: 0o600 });
    vi.stubEnv("ASC_STUDIO_ADS_CLIENT_ID", "SEARCHADS.env-client");
    vi.stubEnv("ASC_STUDIO_ADS_TEAM_ID", "SEARCHADS.env-team");
    vi.stubEnv("ASC_STUDIO_ADS_KEY_ID", "env-key");
    vi.stubEnv("ASC_STUDIO_ADS_AD_ACCOUNT_ID", "987654321");
    vi.stubEnv("ASC_STUDIO_ADS_PRIVATE_KEY", privateKey);
    const vault = new InMemoryCredentialVault();

    await expect(makeAppleAdsStore(root, () => new Date(), vault).summary(null))
      .resolves.toMatchObject({ configured: true, source: "environment", adAccountId: "987654321" });
    await expectNoLegacyCredentials(root);
    expect([...vault.values.values()].join("\n")).toContain("legacy-client");
  });

  it("expires pending setup and fails closed when Keychain is unavailable", async () => {
    const root = await makeRoot("asc-studio-ads-expiry-");
    let now = new Date("2026-08-21T12:00:00.000Z");
    const unavailable: CredentialVault = {
      read: async () => { throw new KeychainAccessError("unavailable", "Keychain unavailable."); },
      readFresh: async () => { throw new KeychainAccessError("unavailable", "Keychain unavailable."); },
      write: async () => { throw new KeychainAccessError("unavailable", "Keychain unavailable."); },
      remove: async () => { throw new KeychainAccessError("unavailable", "Keychain unavailable."); },
    };
    const store = makeAppleAdsStore(root, () => now, unavailable);
    const setup = store.createSetup("asc-account-1");
    now = new Date("2026-08-21T12:16:00.000Z");
    await expect(store.candidateCredentials("asc-account-1", "Orbit Notes", {
      clientId: "SEARCHADS.client-1", teamId: "SEARCHADS.team-1", keyId: "ads-key-1",
      adAccountId: "123456789", setupId: setup.setupId,
    })).rejects.toMatchObject({ code: "apple_ads_setup_expired" });
    await expect(store.summary({ connectionId: "asc-account-1", profileName: "Orbit Notes" }))
      .rejects.toMatchObject({ code: "keychain_unavailable", status: 503 });
  });
});
