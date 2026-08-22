import { createHash, createPrivateKey, generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, rmdir, unlink } from "node:fs/promises";
import { userInfo } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  AppleAdsCredentialsInputSchema,
  AppStoreConnectCredentialsInputSchema,
  OpenAiCredentialsInputSchema,
  OpenAiModelSchema,
  type AppleAdsConnection,
  type AppleAdsCredentialsInput,
  type AppStoreConnectAccount,
  type AppStoreConnectCredentialsInput,
  type OpenAiCredentialsInput,
} from "@asc-studio/contracts";
import type { AppleAdsCredentials } from "@asc-studio/provider-apple-ads";
import type { AppStoreConnectCredentials } from "@asc-studio/provider-app-store-connect";
import { z } from "zod";
import {
  KeychainAccessError,
  keychainAccount,
  systemCredentialVault,
  type CredentialVault,
} from "./keychain.js";

const PrivateKeyFileSchema = z.string().regex(/^(?:AuthKey\.p8|AuthKey-[A-Z0-9]{8,32}-[0-9a-f-]{36}\.p8)$/);

const StoredConnectionV1Schema = z.object({
  version: z.literal(1),
  profileName: z.string().min(1).max(80),
  issuerId: z.string().min(1).max(128),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  privateKeyFile: PrivateKeyFileSchema.default("AuthKey.p8"),
}).strict();

const LegacyStoredAccountSchema = z.object({
  id: z.string().min(1).max(80),
  profileName: z.string().min(1).max(80),
  issuerId: z.string().min(1).max(128),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  privateKeyFile: PrivateKeyFileSchema,
}).strict();

const LegacyStoredConnectionsV2Schema = z.object({
  version: z.literal(2),
  activeConnectionId: z.string().min(1).max(80).nullable(),
  connections: z.array(LegacyStoredAccountSchema).max(50),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, connection] of value.connections.entries()) {
    if (ids.has(connection.id)) {
      context.addIssue({ code: "custom", message: "Connection IDs must be unique.", path: ["connections", index, "id"] });
    }
    ids.add(connection.id);
  }
  if (value.activeConnectionId !== null && !ids.has(value.activeConnectionId)) {
    context.addIssue({ code: "custom", message: "The active connection must exist.", path: ["activeConnectionId"] });
  }
});

type LegacyStoredAccount = z.infer<typeof LegacyStoredAccountSchema>;
type LegacyStoredConnections = z.infer<typeof LegacyStoredConnectionsV2Schema>;

const KeychainStoredAccountSchema = z.object({
  id: z.string().min(1).max(80),
  profileName: z.string().min(1).max(80),
  issuerId: z.string().min(1).max(128),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  privateKey: z.string().min(1).max(16 * 1024),
}).strict();

const KeychainStoredConnectionsSchema = z.object({
  version: z.literal(3),
  activeConnectionId: z.string().min(1).max(80).nullable(),
  connections: z.array(KeychainStoredAccountSchema).max(50),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, connection] of value.connections.entries()) {
    if (ids.has(connection.id)) {
      context.addIssue({ code: "custom", message: "Connection IDs must be unique.", path: ["connections", index, "id"] });
    }
    ids.add(connection.id);
  }
  if (value.activeConnectionId !== null && !ids.has(value.activeConnectionId)) {
    context.addIssue({ code: "custom", message: "The active connection must exist.", path: ["activeConnectionId"] });
  }
});

type KeychainStoredAccount = z.infer<typeof KeychainStoredAccountSchema>;
type KeychainStoredConnections = z.infer<typeof KeychainStoredConnectionsSchema>;

const AppleAdsPrivateKeyFileSchema = z.string().regex(/^AdsKey-[0-9a-f-]{36}\.pem$/);
const LegacyStoredAppleAdsConnectionSchema = z.object({
  appStoreConnectConnectionId: z.string().min(1).max(80),
  clientId: z.string().regex(/^SEARCHADS\.[A-Za-z0-9-]+$/),
  teamId: z.string().regex(/^SEARCHADS\.[A-Za-z0-9-]+$/),
  keyId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/),
  adAccountId: z.string().regex(/^\d+$/),
  privateKeyFile: AppleAdsPrivateKeyFileSchema,
}).strict();
const LegacyStoredAppleAdsConnectionsSchema = z.object({
  version: z.literal(1),
  connections: z.array(LegacyStoredAppleAdsConnectionSchema).max(50),
}).strict().superRefine((value, context) => {
  const connectionIds = new Set<string>();
  for (const [index, connection] of value.connections.entries()) {
    if (connectionIds.has(connection.appStoreConnectConnectionId)) {
      context.addIssue({ code: "custom", message: "Each Apple organization can have only one Apple Ads connection.", path: ["connections", index] });
    }
    connectionIds.add(connection.appStoreConnectConnectionId);
  }
});

type LegacyStoredAppleAdsConnection = z.infer<typeof LegacyStoredAppleAdsConnectionSchema>;
type LegacyStoredAppleAdsConnections = z.infer<typeof LegacyStoredAppleAdsConnectionsSchema>;

const KeychainStoredAppleAdsConnectionSchema = z.object({
  appStoreConnectConnectionId: z.string().min(1).max(80),
  clientId: z.string().regex(/^SEARCHADS\.[A-Za-z0-9-]+$/),
  teamId: z.string().regex(/^SEARCHADS\.[A-Za-z0-9-]+$/),
  keyId: z.string().regex(/^[A-Za-z0-9-]{1,128}$/),
  adAccountId: z.string().regex(/^\d+$/),
  privateKey: z.string().min(1).max(16 * 1024),
}).strict();
const KeychainStoredAppleAdsConnectionsSchema = z.object({
  version: z.literal(2),
  connections: z.array(KeychainStoredAppleAdsConnectionSchema).max(50),
}).strict().superRefine((value, context) => {
  const connectionIds = new Set<string>();
  for (const [index, connection] of value.connections.entries()) {
    if (connectionIds.has(connection.appStoreConnectConnectionId)) {
      context.addIssue({ code: "custom", message: "Each Apple organization can have only one Apple Ads connection.", path: ["connections", index] });
    }
    connectionIds.add(connection.appStoreConnectConnectionId);
  }
});

type KeychainStoredAppleAdsConnection = z.infer<typeof KeychainStoredAppleAdsConnectionSchema>;
type KeychainStoredAppleAdsConnections = z.infer<typeof KeychainStoredAppleAdsConnectionsSchema>;

const LegacyStoredOpenAiConnectionSchema = z.object({
  version: z.literal(1),
  apiKey: OpenAiCredentialsInputSchema.shape.apiKey,
  model: OpenAiModelSchema.nullable(),
}).strict();
type LegacyStoredOpenAiConnection = z.infer<typeof LegacyStoredOpenAiConnectionSchema>;

const KeychainStoredOpenAiConnectionSchema = z.object({
  version: z.literal(2),
  apiKey: OpenAiCredentialsInputSchema.shape.apiKey,
  model: OpenAiModelSchema.nullable(),
}).strict();
type KeychainStoredOpenAiConnection = z.infer<typeof KeychainStoredOpenAiConnectionSchema>;

interface PendingAppleAdsKey {
  appStoreConnectConnectionId: string;
  expiresAt: Date;
  privateKey: string;
}

const hasOpenAiEnvironmentConfiguration = () => process.env.OPENAI_API_KEY !== undefined;

export interface OpenAiCredential {
  apiKey: string;
  source: "environment" | "local";
  localModel: string | null;
}

export interface OpenAiCredentialSummary {
  configured: boolean;
  source: "environment" | "local" | null;
  localModel: string | null;
}

export class CredentialStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly commitUnknown = false,
  ) {
    super(message);
    this.name = "CredentialStoreError";
  }
}

type CredentialBundleStoreKind = "openai" | "app-store-connect" | "apple-ads";
const rollbackUncertainBundles = new Set<string>();
const rollbackMarkerBody = "asc-studio-keychain-rollback-uncertain-v1\n";
const resetTombstoneBody = "asc-studio-keychain-reset-v1\n";

export const defaultCredentialRecoveryDirectory = () => {
  const homeDirectory = userInfo().homedir;
  return process.platform === "darwin"
    ? join(homeDirectory, "Library", "Application Support", "ASC Studio", "recovery")
    : join(homeDirectory, ".local", "state", "asc-studio", "recovery");
};

const rollbackMarkerPath = (recoveryDirectory: string, account: string) => (
  join(recoveryDirectory, `${account}.uncertain`)
);
const resetTombstonePath = (recoveryDirectory: string, account: string) => (
  join(recoveryDirectory, `${account}.reset`)
);

const rollbackUncertainError = (kind: CredentialBundleStoreKind) => new CredentialStoreError(
  "keychain_rollback_failed",
  `A previous ${kind === "openai" ? "OpenAI" : kind === "app-store-connect" ? "App Store Connect" : "Apple Ads"} Keychain update could not be verified. ASC Studio will not use or modify that credential vault until you explicitly reset it.`,
  503,
);

const inspectRecoveryDirectory = async (recoveryDirectory: string) => {
  const details = await lstat(recoveryDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) return false;
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (
    !details.isDirectory()
    || details.isSymbolicLink()
    || ownerMismatch
    || (details.mode & 0o077) !== 0
  ) {
    throw new CredentialStoreError(
      "credential_store_damaged",
      "The Keychain recovery directory is not an owner-only regular directory.",
      500,
    );
  }
  return true;
};

const syncDirectory = async (directory: string) => {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const syncRecoveryDirectoryHierarchy = async (recoveryDirectory: string) => {
  let current = recoveryDirectory;
  for (let depth = 0; depth < 5; depth += 1) {
    await syncDirectory(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
};

const prepareRecoveryDirectory = async (recoveryDirectory: string) => {
  try {
    await mkdir(recoveryDirectory, { recursive: true, mode: 0o700 });
    const details = await lstat(recoveryDirectory);
    const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
    if (
      !details.isDirectory()
      || details.isSymbolicLink()
      || ownerMismatch
      || (details.mode & 0o022) !== 0
    ) {
      throw new Error("unsafe recovery directory");
    }
    await chmod(recoveryDirectory, 0o700);
    await inspectRecoveryDirectory(recoveryDirectory);
    // A child fsync does not persist its directory entry in the parent. Sync
    // the canonical recovery hierarchy before the helper can mutate Keychain.
    await syncRecoveryDirectoryHierarchy(recoveryDirectory);
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error;
    throw new CredentialStoreError(
      "keychain_unavailable",
      "ASC Studio could not prepare its owner-only Keychain recovery journal. The Keychain item was not changed.",
      503,
    );
  }
};

const inspectRollbackMarker = async (recoveryDirectory: string, account: string) => {
  if (!await inspectRecoveryDirectory(recoveryDirectory)) return false;
  const path = rollbackMarkerPath(recoveryDirectory, account);
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) return false;
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || ownerMismatch
    || (details.mode & 0o077) !== 0
    || details.size > 128
  ) {
    throw new CredentialStoreError(
      "credential_store_damaged",
      "The nonsecret Keychain recovery marker is unsafe. ASC Studio refused to access the credential vault.",
      500,
    );
  }
  return true;
};

const inspectCredentialResetTombstone = async (recoveryDirectory: string, account: string) => {
  if (!await inspectRecoveryDirectory(recoveryDirectory)) return false;
  const path = resetTombstonePath(recoveryDirectory, account);
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) return false;
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || ownerMismatch
    || (details.mode & 0o077) !== 0
    || details.size > 128
  ) {
    throw new CredentialStoreError(
      "credential_store_damaged",
      "The nonsecret Keychain reset tombstone is unsafe. ASC Studio refused to access the credential vault.",
      500,
    );
  }
  return true;
};

const assertCredentialBundleCertain = async (
  recoveryDirectory: string,
  account: string,
  kind: CredentialBundleStoreKind,
) => {
  const path = rollbackMarkerPath(recoveryDirectory, account);
  if (rollbackUncertainBundles.has(path) || await inspectRollbackMarker(recoveryDirectory, account)) {
    rollbackUncertainBundles.add(path);
    throw rollbackUncertainError(kind);
  }
};

const rewriteRecoveryFile = async (path: string, body: string, recoveryDirectory: string) => {
  const handle = await open(path, "r+");
  try {
    await handle.truncate(0);
    await handle.writeFile(body, "utf8");
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
  await syncDirectory(recoveryDirectory);
};

const markCredentialBundleUncertain = async (
  recoveryDirectory: string,
  account: string,
  kind: CredentialBundleStoreKind,
  acceptExisting = false,
) => {
  const path = rollbackMarkerPath(recoveryDirectory, account);
  await prepareRecoveryDirectory(recoveryDirectory);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new CredentialStoreError(
        "keychain_unavailable",
        "ASC Studio could not create its Keychain recovery journal. The Keychain item was not changed.",
        503,
      );
    }
    await inspectRollbackMarker(recoveryDirectory, account);
    rollbackUncertainBundles.add(path);
    if (acceptExisting) {
      try {
        await rewriteRecoveryFile(path, rollbackMarkerBody, recoveryDirectory);
      } catch {
        throw rollbackUncertainError(kind);
      }
      return;
    }
    throw rollbackUncertainError(kind);
  }
  rollbackUncertainBundles.add(path);
  try {
    await handle.writeFile(rollbackMarkerBody, "utf8");
    await handle.sync();
  } catch {
    throw rollbackUncertainError(kind);
  } finally {
    await handle.close().catch(() => undefined);
  }
  try {
    await syncDirectory(recoveryDirectory);
  } catch {
    throw rollbackUncertainError(kind);
  }
};

const ensureCredentialResetTombstone = async (recoveryDirectory: string, account: string) => {
  await prepareRecoveryDirectory(recoveryDirectory);
  const path = resetTombstonePath(recoveryDirectory, account);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await inspectCredentialResetTombstone(recoveryDirectory, account);
    await rewriteRecoveryFile(path, resetTombstoneBody, recoveryDirectory);
    return;
  }
  try {
    await handle.writeFile(resetTombstoneBody, "utf8");
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
  await syncDirectory(recoveryDirectory);
};

const clearCredentialResetTombstone = async (recoveryDirectory: string, account: string) => {
  const path = resetTombstonePath(recoveryDirectory, account);
  if (await inspectCredentialResetTombstone(recoveryDirectory, account)) {
    await unlink(path);
    await syncDirectory(recoveryDirectory);
  }
};

const clearCredentialBundleUncertain = async (
  recoveryDirectory: string,
  account: string,
  kind: CredentialBundleStoreKind,
) => {
  try {
    const path = rollbackMarkerPath(recoveryDirectory, account);
    if (await inspectRollbackMarker(recoveryDirectory, account)) {
      await unlink(path);
      await syncDirectory(recoveryDirectory);
    }
    rollbackUncertainBundles.delete(path);
  } catch {
    throw rollbackUncertainError(kind);
  }
};

const keychainOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof KeychainAccessError)) throw error;
    throw new CredentialStoreError(
      error.reason === "damaged" ? "credential_store_damaged" : "keychain_unavailable",
      error.message,
      error.reason === "damaged" ? 500 : 503,
      error.commitUnknown,
    );
  }
};

const readKeychainBundle = (vault: CredentialVault, account: string, fresh = false) => (
  keychainOperation(() => fresh ? vault.readFresh(account) : vault.read(account))
);

const writeVerifiedKeychainBundle = async (
  vault: CredentialVault,
  account: string,
  serialized: string,
  previous: string | null,
  markUncertain: () => Promise<void>,
  clearUncertain: () => Promise<void>,
  finalizeCommit: () => Promise<void>,
) => {
  // Persist a nonsecret intent marker before the native helper can replace an
  // item. A process crash after the Keychain commit therefore cannot make an
  // unverified candidate usable on the next launch.
  await markUncertain();
  let primaryFailure: unknown = null;
  let initialWriteCommitUnknown = false;
  try {
    await keychainOperation(() => vault.write(account, serialized));
  } catch (error) {
    // A timed-out Keychain command can report failure after macOS committed the
    // update. Reconcile the observed state before deciding whether to roll back.
    primaryFailure = error;
    initialWriteCommitUnknown = error instanceof CredentialStoreError && error.commitUnknown;
  }

  let observed: string | null | undefined;
  try {
    observed = await keychainOperation(() => vault.readFresh(account));
  } catch (error) {
    primaryFailure ??= error;
  }
  if (observed === serialized) {
    await finalizeCommit();
    await clearUncertain();
    return;
  }

  if (initialWriteCommitUnknown) {
    // A killed helper may already have handed the update to securityd. Seeing
    // the prior value now does not prove that a late commit cannot still land.
    // Keep the durable marker so no process can use either value until reset.
    throw new CredentialStoreError(
      "keychain_rollback_failed",
      "The Keychain helper stopped during a credential update, so the final item cannot be verified. The vault is blocked until you explicitly reset it.",
      503,
    );
  }

  primaryFailure ??= new CredentialStoreError(
    "keychain_verification_failed",
    "macOS Keychain did not return the credential ASC Studio just saved.",
    503,
  );

  if (observed === previous) {
    await clearUncertain();
    throw primaryFailure;
  }

  try {
    if (previous !== null) {
      await keychainOperation(() => vault.write(account, previous));
      const restored = await keychainOperation(() => vault.readFresh(account));
      if (restored !== previous) throw new Error("rollback mismatch");
    } else {
      await keychainOperation(() => vault.remove(account));
      const removed = await keychainOperation(() => vault.readFresh(account));
      if (removed !== null) throw new Error("removal mismatch");
    }
  } catch {
    // The pre-write marker remains in place. Every later process stays
    // fail-closed until the user performs a scoped reset.
    throw new CredentialStoreError(
      "keychain_rollback_failed",
      previous === null
        ? "macOS Keychain could not verify removal after a failed credential save. The vault is blocked until you explicitly reset it."
        : "macOS Keychain could not verify the prior credential after a failed replacement. The vault is blocked until you explicitly reset it.",
      503,
    );
  }

  await clearUncertain();
  throw primaryFailure;
};

const requireOwnerOnlyCredentialDirectory = async (directory: string, allowMissing: boolean) => {
  const details = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (allowMissing && error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) return false;
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (!details.isDirectory() || details.isSymbolicLink() || ownerMismatch || (details.mode & 0o077) !== 0) {
    throw new CredentialStoreError(
      "credential_store_damaged",
      "The legacy credential directory is not an owner-only local directory.",
      500,
    );
  }
  return true;
};

const readOwnerOnlyLegacyFile = async (
  directory: string,
  path: string,
  description: string,
  maxBytes = 1024 * 1024,
) => {
  if (!await requireOwnerOnlyCredentialDirectory(directory, true)) return null;
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) return null;
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (!details.isFile() || details.isSymbolicLink() || ownerMismatch || (details.mode & 0o077) !== 0) {
    throw new CredentialStoreError(
      "credential_store_damaged",
      `The legacy ${description} is not an owner-only regular file.`,
      500,
    );
  }
  if (details.size > maxBytes) {
    throw new CredentialStoreError("credential_store_damaged", `The legacy ${description} is unexpectedly large.`, 500);
  }
  return readFile(path, "utf8");
};

type LegacyCredentialKind = CredentialBundleStoreKind;
const LegacyUuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const OpenAiTemporaryFilePattern = new RegExp(`^openai\\.json\\.${LegacyUuidPattern}\\.tmp$`);
const AppStoreMetadataTemporaryFilePattern = new RegExp(`^app-store-connect\\.json\\.${LegacyUuidPattern}\\.tmp$`);
const AppStoreKeyTemporaryFilePattern = new RegExp(`^AuthKey-[A-Z0-9]{8,32}-${LegacyUuidPattern}\\.p8\\.tmp$`);
const AppleAdsMetadataTemporaryFilePattern = new RegExp(`^apple-ads\\.json\\.${LegacyUuidPattern}\\.tmp$`);
const AppleAdsKeyTemporaryFilePattern = new RegExp(`^AdsKey-${LegacyUuidPattern}\\.pem\\.tmp$`);

const isLegacyCredentialFile = (kind: LegacyCredentialKind, name: string) => {
  if (kind === "openai") return name === "openai.json" || OpenAiTemporaryFilePattern.test(name);
  if (kind === "app-store-connect") {
    return name === "app-store-connect.json"
      || PrivateKeyFileSchema.safeParse(name).success
      || AppStoreMetadataTemporaryFilePattern.test(name)
      || AppStoreKeyTemporaryFilePattern.test(name);
  }
  return name === "apple-ads.json"
    || AppleAdsPrivateKeyFileSchema.safeParse(name).success
    || AppleAdsMetadataTemporaryFilePattern.test(name)
    || AppleAdsKeyTemporaryFilePattern.test(name);
};

const listLegacyCredentialFiles = async (directory: string, kind: LegacyCredentialKind) => {
  if (!await requireOwnerOnlyCredentialDirectory(directory, true)) return [];
  const names = (await readdir(directory)).filter((name) => isLegacyCredentialFile(kind, name));
  const paths: string[] = [];
  for (const name of names) {
    const path = join(directory, name);
    const details = await lstat(path);
    const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
    if (!details.isFile() || details.isSymbolicLink() || ownerMismatch || (details.mode & 0o077) !== 0) {
      throw new CredentialStoreError(
        "credential_store_damaged",
        "A legacy credential path is not an owner-only regular file.",
        500,
      );
    }
    paths.push(path);
  }
  return paths;
};

const removeLegacyCredentialFiles = async (directory: string, kind: LegacyCredentialKind) => {
  // Validate every target before deleting any of them. This refuses symlink and
  // ownership tricks without partially cleaning a legacy credential set.
  const paths = await listLegacyCredentialFiles(directory, kind);
  await removeValidatedLegacyFiles(directory, paths);
};

const removeLegacyCredentialFilesJournaled = async (
  recoveryDirectory: string,
  account: string,
  directory: string,
  kind: LegacyCredentialKind,
) => {
  await markCredentialBundleUncertain(recoveryDirectory, account, kind);
  try {
    await removeLegacyCredentialFiles(directory, kind);
    await clearCredentialBundleUncertain(recoveryDirectory, account, kind);
  } catch {
    throw rollbackUncertainError(kind);
  }
};

const finalizeCredentialCommit = async (
  recoveryDirectory: string,
  account: string,
  directory: string,
  kind: LegacyCredentialKind,
) => {
  try {
    await removeLegacyCredentialFiles(directory, kind);
    await clearCredentialResetTombstone(recoveryDirectory, account);
  } catch {
    throw rollbackUncertainError(kind);
  }
};

const removeValidatedLegacyFiles = async (directory: string, paths: readonly string[]) => {
  for (const path of paths) await unlink(path);
  try {
    await rmdir(directory);
    // Persist removal of the credentials directory itself before the separate
    // recovery journal is allowed to clear.
    await syncDirectory(dirname(directory));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTEMPTY") {
      // Other provider files can legitimately share this directory. Persist
      // the scoped unlinks while the directory remains.
      await syncDirectory(directory);
      return;
    }
    if (code === "ENOENT") {
      await syncDirectory(dirname(directory));
      return;
    }
    throw error;
  }
};

const resetCredentialBundle = async (
  vault: CredentialVault,
  account: string,
  recoveryDirectory: string,
  directory: string,
  kind: LegacyCredentialKind,
) => {
  // Journal removal before deleting either copy. A crash can leave only some
  // legacy files or an already-removed Keychain item, but never a usable
  // unjournaled credential that a later launch could silently resurrect.
  await markCredentialBundleUncertain(recoveryDirectory, account, kind, true);
  try {
    const legacyPaths = await listLegacyCredentialFiles(directory, kind);
    await keychainOperation(() => vault.remove(account));
    await removeValidatedLegacyFiles(directory, legacyPaths);
    await ensureCredentialResetTombstone(recoveryDirectory, account);
    await clearCredentialBundleUncertain(recoveryDirectory, account, kind);
  } catch (error) {
    if (error instanceof CredentialStoreError && error.code === "keychain_rollback_failed") throw error;
    throw rollbackUncertainError(kind);
  }
};

const parseJson = (body: string, damagedMessage: string) => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new CredentialStoreError("credential_store_damaged", damagedMessage, 500);
  }
};

const parseKeychainJson = <T>(body: string, schema: z.ZodType<T>, damagedMessage: string): T => {
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch {
    throw new CredentialStoreError("credential_store_damaged", damagedMessage, 500);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CredentialStoreError("credential_store_damaged", damagedMessage, 500);
  return parsed.data;
};

const credentialConflict = (name: string) => new CredentialStoreError(
  "credential_store_conflict",
  `${name} exists in both macOS Keychain and legacy files, but the values differ. ASC Studio preserved both and refused to choose one.`,
  409,
);

export class OpenAiCredentialStore {
  private readonly directory: string;
  private readonly connectionPath: string;
  private keychainAccountPromise: Promise<string> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDirectory: string,
    private readonly vault: CredentialVault = systemCredentialVault,
    private readonly recoveryDirectory: string = defaultCredentialRecoveryDirectory(),
  ) {
    this.directory = join(dataDirectory, "credentials");
    this.connectionPath = join(this.directory, "openai.json");
  }

  async load(): Promise<OpenAiCredential | null> {
    return this.mutate(async () => {
      if (hasOpenAiEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        const parsed = OpenAiCredentialsInputSchema.shape.apiKey.safeParse(process.env.OPENAI_API_KEY);
        if (!parsed.success) throw new Error("OPENAI_API_KEY is empty or invalid.");
        return { apiKey: parsed.data, source: "environment" as const, localModel: null };
      }
      const stored = await this.readStoredConnection();
      if (!stored) return null;
      return { apiKey: stored.apiKey, source: "local" as const, localModel: stored.model };
    });
  }

  async summary(): Promise<OpenAiCredentialSummary> {
    return this.mutate(async () => {
      if (hasOpenAiEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        return {
          configured: OpenAiCredentialsInputSchema.shape.apiKey.safeParse(process.env.OPENAI_API_KEY).success,
          source: "environment" as const,
          localModel: null,
        };
      }
      const stored = await this.readStoredConnection();
      return stored
        ? { configured: true, source: "local" as const, localModel: stored.model }
        : { configured: false, source: null, localModel: null };
    });
  }

  candidate(input: unknown): OpenAiCredentialsInput {
    this.requireLocallyManaged();
    return OpenAiCredentialsInputSchema.parse(input);
  }

  save(input: OpenAiCredentialsInput) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const parsed = OpenAiCredentialsInputSchema.parse(input);
      const current = await this.readStoredConnection(true);
      const stored: KeychainStoredOpenAiConnection = {
        version: 2,
        apiKey: parsed.apiKey,
        model: parsed.model?.trim() || null,
      };
      const serialized = JSON.stringify(stored);
      const account = await this.account();
      await writeVerifiedKeychainBundle(
        this.vault,
        account,
        serialized,
        current ? JSON.stringify(current) : null,
        () => markCredentialBundleUncertain(this.recoveryDirectory, account, "openai"),
        () => clearCredentialBundleUncertain(this.recoveryDirectory, account, "openai"),
        () => finalizeCredentialCommit(this.recoveryDirectory, account, this.directory, "openai"),
      );
    });
  }

  remove() {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const account = await this.account();
      await assertCredentialBundleCertain(this.recoveryDirectory, account, "openai");
      await resetCredentialBundle(this.vault, account, this.recoveryDirectory, this.directory, "openai");
    });
  }

  reset() {
    return this.mutate(async () => {
      const account = await this.account();
      await resetCredentialBundle(this.vault, account, this.recoveryDirectory, this.directory, "openai");
    });
  }

  private requireLocallyManaged() {
    if (hasOpenAiEnvironmentConfiguration()) {
      throw new CredentialStoreError(
        "environment_credentials_active",
        "OPENAI_API_KEY is active. Remove it before managing the OpenAI API key in the GUI.",
        409,
      );
    }
  }

  private async readStoredConnection(fresh = false): Promise<KeychainStoredOpenAiConnection | null> {
    const account = await this.account();
    await assertCredentialBundleCertain(this.recoveryDirectory, account, "openai");
    if (await inspectCredentialResetTombstone(this.recoveryDirectory, account)) {
      await removeLegacyCredentialFiles(this.directory, "openai");
      return null;
    }
    const keychainBody = await readKeychainBundle(this.vault, account, fresh);
    const legacyBody = await readOwnerOnlyLegacyFile(this.directory, this.connectionPath, "OpenAI connection");
    let migratedLegacy: KeychainStoredOpenAiConnection | null = null;
    if (legacyBody !== null) {
      const legacy = LegacyStoredOpenAiConnectionSchema.safeParse(parseJson(
        legacyBody,
        "The saved OpenAI connection is damaged.",
      ));
      if (!legacy.success) {
        throw new CredentialStoreError("credential_store_damaged", "The saved OpenAI connection is damaged.", 500);
      }
      migratedLegacy = {
        version: 2,
        apiKey: legacy.data.apiKey,
        model: legacy.data.model,
      };
    }

    if (keychainBody !== null) {
      const parsed = parseKeychainJson(
        keychainBody,
        KeychainStoredOpenAiConnectionSchema,
        "The saved OpenAI Keychain credential is damaged.",
      );
      if (migratedLegacy !== null && JSON.stringify(parsed) !== JSON.stringify(migratedLegacy)) {
        throw credentialConflict("The OpenAI credential");
      }
      if (migratedLegacy !== null) {
        await removeLegacyCredentialFilesJournaled(
          this.recoveryDirectory,
          account,
          this.directory,
          "openai",
        );
      }
      return parsed;
    }

    if (migratedLegacy === null) {
      const orphaned = await listLegacyCredentialFiles(this.directory, "openai");
      if (orphaned.length > 0) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "A legacy OpenAI credential temporary file exists without metadata.",
          500,
        );
      }
      return null;
    }
    const serialized = JSON.stringify(migratedLegacy);
    await writeVerifiedKeychainBundle(
      this.vault,
      account,
      serialized,
      null,
      () => markCredentialBundleUncertain(this.recoveryDirectory, account, "openai"),
      () => clearCredentialBundleUncertain(this.recoveryDirectory, account, "openai"),
      () => finalizeCredentialCommit(this.recoveryDirectory, account, this.directory, "openai"),
    );
    return migratedLegacy;
  }

  private async migrateLegacyIfPresent() {
    if ((await listLegacyCredentialFiles(this.directory, "openai")).length > 0) {
      await this.readStoredConnection(true);
    }
  }

  private account() {
    return this.keychainAccountPromise ??= keychainOperation(() => keychainAccount(this.dataDirectory, "openai"));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

const validatePrivateKey = (value: string) => {
  let key;
  try {
    key = createPrivateKey(value);
  } catch {
    throw new Error("The selected file is not a valid App Store Connect .p8 private key.");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("The App Store Connect private key must use the P-256 elliptic curve.");
  }
};

const validateAppleAdsPrivateKey = (value: string) => {
  let key;
  try {
    key = createPrivateKey(value);
  } catch {
    throw new Error("The selected file is not a valid Apple Ads private key.");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("The Apple Ads private key must use the P-256 elliptic curve.");
  }
};

const configuredEnvironmentValues = () => ({
  profileName: process.env.ASC_STUDIO_PROFILE_NAME,
  issuerId: process.env.ASC_STUDIO_ISSUER_ID,
  keyId: process.env.ASC_STUDIO_KEY_ID,
  privateKey: process.env.ASC_STUDIO_PRIVATE_KEY,
  privateKeyPath: process.env.ASC_STUDIO_PRIVATE_KEY_PATH,
});

const hasEnvironmentConfiguration = () => (
  Object.values(configuredEnvironmentValues()).some((value) => value !== undefined)
);

const configuredAppleAdsEnvironmentValues = () => ({
  profileName: process.env.ASC_STUDIO_ADS_PROFILE_NAME,
  clientId: process.env.ASC_STUDIO_ADS_CLIENT_ID,
  teamId: process.env.ASC_STUDIO_ADS_TEAM_ID,
  keyId: process.env.ASC_STUDIO_ADS_KEY_ID,
  privateKey: process.env.ASC_STUDIO_ADS_PRIVATE_KEY,
  privateKeyPath: process.env.ASC_STUDIO_ADS_PRIVATE_KEY_PATH,
  adAccountId: process.env.ASC_STUDIO_ADS_AD_ACCOUNT_ID,
});

const hasAppleAdsEnvironmentConfiguration = () => (
  Object.values(configuredAppleAdsEnvironmentValues()).some((value) => value !== undefined)
);

const legacyConnectionId = (connection: z.infer<typeof StoredConnectionV1Schema>) => (
  `legacy-${createHash("sha256")
    .update(connection.issuerId)
    .update("\0")
    .update(connection.keyId)
    .digest("hex")
    .slice(0, 32)}`
);

const localAccountSummary = (connection: KeychainStoredAccount, activeConnectionId: string | null): AppStoreConnectAccount => ({
  id: connection.id,
  profileName: connection.profileName,
  keyId: connection.keyId,
  active: connection.id === activeConnectionId,
  source: "local",
});

export class AppStoreConnectCredentialStore {
  private readonly directory: string;
  private readonly metadataPath: string;
  private keychainAccountPromise: Promise<string> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDirectory: string,
    private readonly vault: CredentialVault = systemCredentialVault,
    private readonly recoveryDirectory: string = defaultCredentialRecoveryDirectory(),
  ) {
    this.directory = join(dataDirectory, "credentials");
    this.metadataPath = join(this.directory, "app-store-connect.json");
  }

  async load(): Promise<AppStoreConnectCredentials | null> {
    return this.mutate(async () => {
      if (hasEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        return this.loadEnvironmentCredentials();
      }
      const stored = await this.readStoredConnections();
      if (stored.activeConnectionId === null) return null;
      const active = stored.connections.find((connection) => connection.id === stored.activeConnectionId);
      if (!active) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved App Store Connect connection is damaged.",
          500,
        );
      }
      return this.loadStoredCredentials(active);
    });
  }

  async loadConnection(connectionId: string): Promise<AppStoreConnectCredentials> {
    return this.mutate(async () => {
      if (hasEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        if (connectionId !== "environment") {
          throw new CredentialStoreError("connection_not_found", "That Apple account is no longer saved.", 404);
        }
        return this.loadEnvironmentCredentials();
      }
      const stored = await this.readStoredConnections();
      const connection = stored.connections.find((candidate) => candidate.id === connectionId);
      if (!connection) {
        throw new CredentialStoreError("connection_not_found", "That Apple account is no longer saved.", 404);
      }
      return this.loadStoredCredentials(connection);
    });
  }

  async list(): Promise<AppStoreConnectAccount[]> {
    return this.mutate(async () => {
      if (hasEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        const credentials = await this.loadEnvironmentCredentials();
        return [{
          id: credentials.connectionId!,
          profileName: credentials.profileName,
          keyId: credentials.keyId,
          active: true,
          source: "environment" as const,
        }];
      }
      const stored = await this.readStoredConnections();
      return stored.connections.map((connection) => localAccountSummary(connection, stored.activeConnectionId));
    });
  }

  save(input: AppStoreConnectCredentialsInput) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const parsed = AppStoreConnectCredentialsInputSchema.parse(input);
      validatePrivateKey(parsed.privateKey);
      const stored = await this.readStoredConnections(true);
      const existing = stored.connections.find((connection) => (
        connection.issuerId === parsed.issuerId && connection.keyId === parsed.keyId
      ));
      if (!existing && stored.connections.length >= 50) {
        throw new CredentialStoreError("connection_limit", "ASC Studio can save at most 50 Apple accounts.", 409);
      }

      const connectionId = existing?.id ?? randomUUID();
      const replacement: KeychainStoredAccount = {
        id: connectionId,
        profileName: parsed.profileName,
        issuerId: parsed.issuerId,
        keyId: parsed.keyId,
        privateKey: parsed.privateKey,
      };
      const connections = existing
        ? stored.connections.map((connection) => connection.id === existing.id ? replacement : connection)
        : [...stored.connections, replacement];
      const next: KeychainStoredConnections = { version: 3, activeConnectionId: connectionId, connections };
      await this.writeStoredConnections(next, stored);
      return connectionId;
    });
  }

  activate(connectionId: string) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const stored = await this.readStoredConnections(true);
      if (!stored.connections.some((connection) => connection.id === connectionId)) {
        throw new CredentialStoreError("connection_not_found", "That Apple account is no longer saved.", 404);
      }
      if (stored.activeConnectionId === connectionId) return;
      await this.writeStoredConnections({ ...stored, activeConnectionId: connectionId }, stored);
    });
  }

  remove(connectionId: string) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const stored = await this.readStoredConnections(true);
      const index = stored.connections.findIndex((connection) => connection.id === connectionId);
      if (index < 0) {
        throw new CredentialStoreError("connection_not_found", "That Apple account is no longer saved.", 404);
      }
      const connections = stored.connections.filter((connection) => connection.id !== connectionId);
      const activeConnectionId = stored.activeConnectionId === connectionId
        ? connections[Math.min(index, connections.length - 1)]?.id ?? null
        : stored.activeConnectionId;
      if (connections.length === 0) {
        const account = await this.account();
        await resetCredentialBundle(
          this.vault,
          account,
          this.recoveryDirectory,
          this.directory,
          "app-store-connect",
        );
      } else {
        await this.writeStoredConnections({ version: 3, activeConnectionId, connections }, stored);
      }
    });
  }

  reset() {
    return this.mutate(async () => {
      const account = await this.account();
      await resetCredentialBundle(
        this.vault,
        account,
        this.recoveryDirectory,
        this.directory,
        "app-store-connect",
      );
    });
  }

  private requireLocallyManaged() {
    if (hasEnvironmentConfiguration()) {
      throw new CredentialStoreError(
        "environment_credentials_active",
        "Environment credentials are active. Remove them before managing Apple accounts in the GUI.",
        409,
      );
    }
  }

  private async loadEnvironmentCredentials(): Promise<AppStoreConnectCredentials> {
    const environment = configuredEnvironmentValues();
    if (!environment.issuerId || !environment.keyId || (!environment.privateKey && !environment.privateKeyPath)) {
      throw new Error(
        "Environment authentication requires ASC_STUDIO_ISSUER_ID, ASC_STUDIO_KEY_ID, and ASC_STUDIO_PRIVATE_KEY_PATH or ASC_STUDIO_PRIVATE_KEY.",
      );
    }
    const privateKey = environment.privateKey
      ?? await readFile(environment.privateKeyPath!, "utf8").catch(() => {
        throw new Error("ASC_STUDIO_PRIVATE_KEY_PATH is not readable.");
      });
    validatePrivateKey(privateKey);
    return {
      connectionId: "environment",
      profileName: environment.profileName?.trim() || `API key ${environment.keyId}`,
      issuerId: environment.issuerId.trim(),
      keyId: environment.keyId.trim(),
      privateKey,
      authBackend: "Environment variables",
    };
  }

  private async loadStoredCredentials(connection: KeychainStoredAccount): Promise<AppStoreConnectCredentials> {
    validatePrivateKey(connection.privateKey);
    return {
      connectionId: connection.id,
      profileName: connection.profileName,
      issuerId: connection.issuerId,
      keyId: connection.keyId,
      privateKey: connection.privateKey,
      authBackend: "macOS Keychain",
    };
  }

  private async readStoredConnections(fresh = false): Promise<KeychainStoredConnections> {
    const account = await this.account();
    await assertCredentialBundleCertain(this.recoveryDirectory, account, "app-store-connect");
    if (await inspectCredentialResetTombstone(this.recoveryDirectory, account)) {
      await removeLegacyCredentialFiles(this.directory, "app-store-connect");
      return { version: 3, activeConnectionId: null, connections: [] };
    }
    const keychainBody = await readKeychainBundle(this.vault, account, fresh);
    const legacy = await this.readLegacyConnections();
    if (keychainBody !== null) {
      const parsed = parseKeychainJson(
        keychainBody,
        KeychainStoredConnectionsSchema,
        "The saved App Store Connect Keychain credential is damaged.",
      );
      try {
        for (const connection of parsed.connections) validatePrivateKey(connection.privateKey);
      } catch {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved App Store Connect Keychain credential is damaged.",
          500,
        );
      }
      if (legacy !== null && JSON.stringify(parsed) !== JSON.stringify(legacy)) {
        throw credentialConflict("The App Store Connect credential bundle");
      }
      if (legacy !== null) {
        await removeLegacyCredentialFilesJournaled(
          this.recoveryDirectory,
          account,
          this.directory,
          "app-store-connect",
        );
      }
      return parsed;
    }

    if (legacy === null) return { version: 3, activeConnectionId: null, connections: [] };
    await writeVerifiedKeychainBundle(
      this.vault,
      account,
      JSON.stringify(legacy),
      null,
      () => markCredentialBundleUncertain(this.recoveryDirectory, account, "app-store-connect"),
      () => clearCredentialBundleUncertain(this.recoveryDirectory, account, "app-store-connect"),
      () => finalizeCredentialCommit(this.recoveryDirectory, account, this.directory, "app-store-connect"),
    );
    return legacy;
  }

  private async migrateLegacyIfPresent() {
    if ((await listLegacyCredentialFiles(this.directory, "app-store-connect")).length > 0) {
      await this.readStoredConnections(true);
    }
  }

  private async readLegacyConnections(): Promise<KeychainStoredConnections | null> {
    const legacyMetadataBody = await readOwnerOnlyLegacyFile(
      this.directory,
      this.metadataPath,
      "App Store Connect metadata",
    );
    if (legacyMetadataBody === null) {
      const orphaned = await listLegacyCredentialFiles(this.directory, "app-store-connect");
      if (orphaned.length > 0) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "A legacy App Store Connect private key exists without metadata.",
          500,
        );
      }
      return null;
    }

    const value = parseJson(legacyMetadataBody, "The saved App Store Connect connection is damaged.");
    const current = LegacyStoredConnectionsV2Schema.safeParse(value);
    let legacy: LegacyStoredConnections;
    if (current.success) {
      legacy = current.data;
    } else {
      const single = StoredConnectionV1Schema.safeParse(value);
      if (!single.success) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved App Store Connect connection is damaged.",
          500,
        );
      }
      const id = legacyConnectionId(single.data);
      const { version: _version, ...connection } = single.data;
      legacy = { version: 2, activeConnectionId: id, connections: [{ id, ...connection }] };
    }

    const migratedConnections: KeychainStoredAccount[] = [];
    for (const connection of legacy.connections) {
      const privateKey = await readOwnerOnlyLegacyFile(
        this.directory,
        join(this.directory, connection.privateKeyFile),
        "App Store Connect private key",
        16 * 1024,
      );
      if (privateKey === null) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved App Store Connect private key is missing.",
          500,
        );
      }
      try {
        validatePrivateKey(privateKey);
      } catch {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved App Store Connect private key is damaged.",
          500,
        );
      }
      const { privateKeyFile: _privateKeyFile, ...metadata } = connection;
      migratedConnections.push({ ...metadata, privateKey });
    }
    const migrated: KeychainStoredConnections = {
      version: 3,
      activeConnectionId: legacy.activeConnectionId,
      connections: migratedConnections,
    };
    return migrated;
  }

  private async writeStoredConnections(value: KeychainStoredConnections, previous: KeychainStoredConnections) {
    const parsed = KeychainStoredConnectionsSchema.parse(value);
    const account = await this.account();
    await writeVerifiedKeychainBundle(
      this.vault,
      account,
      JSON.stringify(parsed),
      previous.connections.length > 0 ? JSON.stringify(previous) : null,
      () => markCredentialBundleUncertain(this.recoveryDirectory, account, "app-store-connect"),
      () => clearCredentialBundleUncertain(this.recoveryDirectory, account, "app-store-connect"),
      () => finalizeCredentialCommit(this.recoveryDirectory, account, this.directory, "app-store-connect"),
    );
  }

  private account() {
    return this.keychainAccountPromise ??= keychainOperation(() => keychainAccount(this.dataDirectory, "app-store-connect"));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export class AppleAdsCredentialStore {
  private readonly directory: string;
  private readonly metadataPath: string;
  private keychainAccountPromise: Promise<string> | null = null;
  private readonly pendingKeys = new Map<string, PendingAppleAdsKey>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataDirectory: string,
    private readonly now: () => Date = () => new Date(),
    private readonly vault: CredentialVault = systemCredentialVault,
    private readonly recoveryDirectory: string = defaultCredentialRecoveryDirectory(),
  ) {
    this.directory = join(dataDirectory, "credentials");
    this.metadataPath = join(this.directory, "apple-ads.json");
  }

  async load(activeAccount: { connectionId: string; profileName: string } | null): Promise<AppleAdsCredentials | null> {
    return this.mutate(async () => {
      if (hasAppleAdsEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        return this.loadEnvironmentCredentials();
      }
      if (!activeAccount) {
        await this.migrateLegacyIfPresent();
        return null;
      }
      const stored = await this.readStoredConnections();
      const connection = stored.connections.find((candidate) => (
        candidate.appStoreConnectConnectionId === activeAccount.connectionId
      ));
      if (!connection) return null;
      return this.loadStoredCredentials(connection, activeAccount.profileName);
    });
  }

  async summary(activeAccount: { connectionId: string; profileName: string } | null): Promise<AppleAdsConnection> {
    return this.mutate(async () => {
      if (hasAppleAdsEnvironmentConfiguration()) {
        await this.migrateLegacyIfPresent();
        const credentials = await this.loadEnvironmentCredentials();
        return {
          configured: true,
          profileName: credentials.profileName,
          appStoreConnectConnectionId: activeAccount?.connectionId ?? null,
          adAccountId: credentials.adAccountId,
          keyId: credentials.keyId,
          source: "environment" as const,
        };
      }
      if (!activeAccount) {
        await this.migrateLegacyIfPresent();
        return this.emptySummary();
      }
      const stored = await this.readStoredConnections();
      const connection = stored.connections.find((candidate) => (
        candidate.appStoreConnectConnectionId === activeAccount.connectionId
      ));
      if (!connection) return this.emptySummary();
      return {
        configured: true,
        profileName: activeAccount.profileName,
        appStoreConnectConnectionId: activeAccount.connectionId,
        adAccountId: connection.adAccountId,
        keyId: connection.keyId,
        source: "local" as const,
      };
    });
  }

  createSetup(appStoreConnectConnectionId: string) {
    this.purgeExpiredSetups();
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const setupId = randomUUID();
    const expiresAt = new Date(this.now().getTime() + 15 * 60 * 1_000);
    this.pendingKeys.set(setupId, {
      appStoreConnectConnectionId,
      expiresAt,
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    return {
      setupId,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async candidateCredentials(
    appStoreConnectConnectionId: string,
    profileName: string,
    input: AppleAdsCredentialsInput,
  ): Promise<AppleAdsCredentials> {
    this.requireLocallyManaged();
    const parsed = AppleAdsCredentialsInputSchema.parse(input);
    const privateKey = this.resolvePrivateKey(appStoreConnectConnectionId, parsed);
    validateAppleAdsPrivateKey(privateKey);
    return {
      profileName,
      clientId: parsed.clientId,
      teamId: parsed.teamId,
      keyId: parsed.keyId,
      privateKey,
      adAccountId: parsed.adAccountId,
      authBackend: "Pending macOS Keychain credential",
    };
  }

  save(appStoreConnectConnectionId: string, input: AppleAdsCredentialsInput) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const parsed = AppleAdsCredentialsInputSchema.parse(input);
      const privateKey = this.resolvePrivateKey(appStoreConnectConnectionId, parsed);
      validateAppleAdsPrivateKey(privateKey);
      const stored = await this.readStoredConnections(true);
      const existing = stored.connections.find((connection) => (
        connection.appStoreConnectConnectionId === appStoreConnectConnectionId
      ));
      if (!existing && stored.connections.length >= 50) {
        throw new CredentialStoreError("connection_limit", "ASC Studio can save Apple Ads credentials for at most 50 Apple organizations.", 409);
      }

      const replacement: KeychainStoredAppleAdsConnection = {
        appStoreConnectConnectionId,
        clientId: parsed.clientId,
        teamId: parsed.teamId,
        keyId: parsed.keyId,
        adAccountId: parsed.adAccountId,
        privateKey,
      };
      const connections = existing
        ? stored.connections.map((connection) => connection.appStoreConnectConnectionId === appStoreConnectConnectionId ? replacement : connection)
        : [...stored.connections, replacement];
      await this.writeStoredConnections({ version: 2, connections }, stored);
      if (parsed.setupId) this.pendingKeys.delete(parsed.setupId);
    });
  }

  remove(appStoreConnectConnectionId: string) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      await this.removeStoredConnection(appStoreConnectConnectionId, true);
    });
  }

  removeLinked(appStoreConnectConnectionId: string) {
    return this.mutate(() => this.removeStoredConnection(appStoreConnectConnectionId, false));
  }

  reset() {
    return this.mutate(async () => {
      const account = await this.account();
      await resetCredentialBundle(
        this.vault,
        account,
        this.recoveryDirectory,
        this.directory,
        "apple-ads",
      );
      this.pendingKeys.clear();
    });
  }

  private emptySummary(): AppleAdsConnection {
    return {
      configured: false,
      profileName: null,
      appStoreConnectConnectionId: null,
      adAccountId: null,
      keyId: null,
      source: null,
    };
  }

  private resolvePrivateKey(appStoreConnectConnectionId: string, input: AppleAdsCredentialsInput) {
    if (input.privateKey) return input.privateKey;
    this.purgeExpiredSetups();
    const pending = input.setupId ? this.pendingKeys.get(input.setupId) : undefined;
    if (!pending || pending.appStoreConnectConnectionId !== appStoreConnectConnectionId) {
      throw new CredentialStoreError("apple_ads_setup_expired", "Generate a new Apple Ads public key before connecting.", 409);
    }
    return pending.privateKey;
  }

  private purgeExpiredSetups() {
    const now = this.now().getTime();
    for (const [setupId, pending] of this.pendingKeys) {
      if (pending.expiresAt.getTime() <= now) this.pendingKeys.delete(setupId);
    }
  }

  private async removeStoredConnection(appStoreConnectConnectionId: string, required: boolean) {
    const stored = await this.readStoredConnections(true);
    const removed = stored.connections.find((connection) => (
      connection.appStoreConnectConnectionId === appStoreConnectConnectionId
    ));
    if (!removed) {
      if (required) {
        throw new CredentialStoreError("connection_not_found", "Apple Ads is not connected for this Apple organization.", 404);
      }
      return;
    }
    const connections = stored.connections.filter((connection) => connection !== removed);
    if (connections.length === 0) {
      const account = await this.account();
      await resetCredentialBundle(
        this.vault,
        account,
        this.recoveryDirectory,
        this.directory,
        "apple-ads",
      );
      return;
    }
    await this.writeStoredConnections({ version: 2, connections }, stored);
  }

  private requireLocallyManaged() {
    if (hasAppleAdsEnvironmentConfiguration()) {
      throw new CredentialStoreError(
        "environment_credentials_active",
        "Apple Ads environment credentials are active. Remove them before managing Apple Ads in the GUI.",
        409,
      );
    }
  }

  private async loadEnvironmentCredentials(): Promise<AppleAdsCredentials> {
    const values = configuredAppleAdsEnvironmentValues();
    if (!values.clientId || !values.teamId || !values.keyId || !values.adAccountId) {
      throw new Error("Apple Ads requires ASC_STUDIO_ADS_CLIENT_ID, ASC_STUDIO_ADS_TEAM_ID, ASC_STUDIO_ADS_KEY_ID, and ASC_STUDIO_ADS_AD_ACCOUNT_ID.");
    }
    if ((values.privateKey ? 1 : 0) + (values.privateKeyPath ? 1 : 0) !== 1) {
      throw new Error("Set exactly one of ASC_STUDIO_ADS_PRIVATE_KEY or ASC_STUDIO_ADS_PRIVATE_KEY_PATH.");
    }
    if (!/^\d+$/.test(values.adAccountId)) throw new Error("ASC_STUDIO_ADS_AD_ACCOUNT_ID must be numeric.");
    if (!values.clientId.startsWith("SEARCHADS.") || !values.teamId.startsWith("SEARCHADS.")) {
      throw new Error("Apple Ads client and team IDs must start with SEARCHADS.");
    }
    let privateKey = values.privateKey;
    let authBackend = "Environment variable";
    if (values.privateKeyPath) {
      if (!isAbsolute(values.privateKeyPath)) throw new Error("ASC_STUDIO_ADS_PRIVATE_KEY_PATH must be absolute.");
      privateKey = await readFile(values.privateKeyPath, "utf8").catch(() => {
        throw new Error("ASC_STUDIO_ADS_PRIVATE_KEY_PATH is not readable.");
      });
      authBackend = `Environment file ${basename(values.privateKeyPath)}`;
    }
    validateAppleAdsPrivateKey(privateKey!);
    return {
      profileName: values.profileName?.trim() || "Apple Ads",
      clientId: values.clientId.trim(),
      teamId: values.teamId.trim(),
      keyId: values.keyId.trim(),
      privateKey: privateKey!,
      adAccountId: values.adAccountId.trim(),
      authBackend,
    };
  }

  private async loadStoredCredentials(connection: KeychainStoredAppleAdsConnection, profileName: string): Promise<AppleAdsCredentials> {
    validateAppleAdsPrivateKey(connection.privateKey);
    return {
      profileName,
      clientId: connection.clientId,
      teamId: connection.teamId,
      keyId: connection.keyId,
      privateKey: connection.privateKey,
      adAccountId: connection.adAccountId,
      authBackend: "macOS Keychain",
    };
  }

  private async readStoredConnections(fresh = false): Promise<KeychainStoredAppleAdsConnections> {
    const account = await this.account();
    await assertCredentialBundleCertain(this.recoveryDirectory, account, "apple-ads");
    if (await inspectCredentialResetTombstone(this.recoveryDirectory, account)) {
      await removeLegacyCredentialFiles(this.directory, "apple-ads");
      return { version: 2, connections: [] };
    }
    const keychainBody = await readKeychainBundle(this.vault, account, fresh);
    const legacy = await this.readLegacyConnections();
    if (keychainBody !== null) {
      const parsed = parseKeychainJson(
        keychainBody,
        KeychainStoredAppleAdsConnectionsSchema,
        "The saved Apple Ads Keychain credential is damaged.",
      );
      try {
        for (const connection of parsed.connections) validateAppleAdsPrivateKey(connection.privateKey);
      } catch {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved Apple Ads Keychain credential is damaged.",
          500,
        );
      }
      if (legacy !== null && JSON.stringify(parsed) !== JSON.stringify(legacy)) {
        throw credentialConflict("The Apple Ads credential bundle");
      }
      if (legacy !== null) {
        await removeLegacyCredentialFilesJournaled(
          this.recoveryDirectory,
          account,
          this.directory,
          "apple-ads",
        );
      }
      return parsed;
    }

    if (legacy === null) return { version: 2, connections: [] };
    await writeVerifiedKeychainBundle(
      this.vault,
      account,
      JSON.stringify(legacy),
      null,
      () => markCredentialBundleUncertain(this.recoveryDirectory, account, "apple-ads"),
      () => clearCredentialBundleUncertain(this.recoveryDirectory, account, "apple-ads"),
      () => finalizeCredentialCommit(this.recoveryDirectory, account, this.directory, "apple-ads"),
    );
    return legacy;
  }

  private async migrateLegacyIfPresent() {
    if ((await listLegacyCredentialFiles(this.directory, "apple-ads")).length > 0) {
      await this.readStoredConnections(true);
    }
  }

  private async readLegacyConnections(): Promise<KeychainStoredAppleAdsConnections | null> {
    const legacyMetadataBody = await readOwnerOnlyLegacyFile(
      this.directory,
      this.metadataPath,
      "Apple Ads metadata",
    );
    if (legacyMetadataBody === null) {
      const orphaned = await listLegacyCredentialFiles(this.directory, "apple-ads");
      if (orphaned.length > 0) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "A legacy Apple Ads private key exists without metadata.",
          500,
        );
      }
      return null;
    }
    const parsed = LegacyStoredAppleAdsConnectionsSchema.safeParse(parseJson(
      legacyMetadataBody,
      "The saved Apple Ads connection is damaged.",
    ));
    if (!parsed.success) {
      throw new CredentialStoreError("credential_store_damaged", "The saved Apple Ads connection is damaged.", 500);
    }

    const connections: KeychainStoredAppleAdsConnection[] = [];
    for (const connection of parsed.data.connections) {
      const privateKey = await readOwnerOnlyLegacyFile(
        this.directory,
        join(this.directory, connection.privateKeyFile),
        "Apple Ads private key",
        16 * 1024,
      );
      if (privateKey === null) {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved Apple Ads private key is missing.",
          500,
        );
      }
      try {
        validateAppleAdsPrivateKey(privateKey);
      } catch {
        throw new CredentialStoreError(
          "credential_store_damaged",
          "The saved Apple Ads private key is damaged.",
          500,
        );
      }
      const { privateKeyFile: _privateKeyFile, ...metadata } = connection;
      connections.push({ ...metadata, privateKey });
    }
    const migrated: KeychainStoredAppleAdsConnections = { version: 2, connections };
    return migrated;
  }

  private async writeStoredConnections(
    value: KeychainStoredAppleAdsConnections,
    previous: KeychainStoredAppleAdsConnections,
  ) {
    const parsed = KeychainStoredAppleAdsConnectionsSchema.parse(value);
    const account = await this.account();
    await writeVerifiedKeychainBundle(
      this.vault,
      account,
      JSON.stringify(parsed),
      previous.connections.length > 0 ? JSON.stringify(previous) : null,
      () => markCredentialBundleUncertain(this.recoveryDirectory, account, "apple-ads"),
      () => clearCredentialBundleUncertain(this.recoveryDirectory, account, "apple-ads"),
      () => finalizeCredentialCommit(this.recoveryDirectory, account, this.directory, "apple-ads"),
    );
  }

  private account() {
    return this.keychainAccountPromise ??= keychainOperation(() => keychainAccount(this.dataDirectory, "apple-ads"));
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
