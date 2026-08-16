import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppStoreConnectCredentialsInputSchema,
  type AppStoreConnectAccount,
  type AppStoreConnectCredentialsInput,
} from "@asc-studio/contracts";
import type { AppStoreConnectCredentials } from "@asc-studio/provider-app-store-connect";
import { z } from "zod";

const PrivateKeyFileSchema = z.string().regex(/^(?:AuthKey\.p8|AuthKey-[A-Z0-9]{8,32}-[0-9a-f-]{36}\.p8)$/);

const StoredConnectionV1Schema = z.object({
  version: z.literal(1),
  profileName: z.string().min(1).max(80),
  issuerId: z.string().min(1).max(128),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  privateKeyFile: PrivateKeyFileSchema.default("AuthKey.p8"),
}).strict();

const StoredAccountSchema = z.object({
  id: z.string().min(1).max(80),
  profileName: z.string().min(1).max(80),
  issuerId: z.string().min(1).max(128),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  privateKeyFile: PrivateKeyFileSchema,
}).strict();

const StoredConnectionsV2Schema = z.object({
  version: z.literal(2),
  activeConnectionId: z.string().min(1).max(80).nullable(),
  connections: z.array(StoredAccountSchema).max(50),
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

type StoredAccount = z.infer<typeof StoredAccountSchema>;
type StoredConnections = z.infer<typeof StoredConnectionsV2Schema>;

export class CredentialStoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "CredentialStoreError";
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

const legacyConnectionId = (connection: z.infer<typeof StoredConnectionV1Schema>) => (
  `legacy-${createHash("sha256")
    .update(connection.issuerId)
    .update("\0")
    .update(connection.keyId)
    .digest("hex")
    .slice(0, 32)}`
);

const localAccountSummary = (connection: StoredAccount, activeConnectionId: string | null): AppStoreConnectAccount => ({
  id: connection.id,
  profileName: connection.profileName,
  keyId: connection.keyId,
  active: connection.id === activeConnectionId,
  source: "local",
});

export class AppStoreConnectCredentialStore {
  private readonly directory: string;
  private readonly metadataPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "credentials");
    this.metadataPath = join(this.directory, "app-store-connect.json");
  }

  async load(): Promise<AppStoreConnectCredentials | null> {
    if (hasEnvironmentConfiguration()) return this.loadEnvironmentCredentials();

    const stored = await this.readStoredConnections();
    if (stored.activeConnectionId === null) return null;
    const active = stored.connections.find((connection) => connection.id === stored.activeConnectionId);
    if (!active) throw new Error("The saved App Store Connect connection is damaged.");
    return this.loadStoredCredentials(active);
  }

  async loadConnection(connectionId: string): Promise<AppStoreConnectCredentials> {
    if (hasEnvironmentConfiguration()) {
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
  }

  async list(): Promise<AppStoreConnectAccount[]> {
    if (hasEnvironmentConfiguration()) {
      const credentials = await this.loadEnvironmentCredentials();
      return [{
        id: credentials.connectionId!,
        profileName: credentials.profileName,
        keyId: credentials.keyId,
        active: true,
        source: "environment",
      }];
    }
    const stored = await this.readStoredConnections();
    return stored.connections.map((connection) => localAccountSummary(connection, stored.activeConnectionId));
  }

  save(input: AppStoreConnectCredentialsInput) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const parsed = AppStoreConnectCredentialsInputSchema.parse(input);
      validatePrivateKey(parsed.privateKey);
      const stored = await this.readStoredConnections();
      const existing = stored.connections.find((connection) => (
        connection.issuerId === parsed.issuerId && connection.keyId === parsed.keyId
      ));
      if (!existing && stored.connections.length >= 50) {
        throw new CredentialStoreError("connection_limit", "ASC Studio can save at most 50 Apple accounts.", 409);
      }

      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      const suffix = randomUUID();
      const connectionId = existing?.id ?? randomUUID();
      const privateKeyFile = `AuthKey-${parsed.keyId}-${suffix}.p8`;
      const privateKeyPath = join(this.directory, privateKeyFile);
      const temporaryKeyPath = `${privateKeyPath}.tmp`;
      const replacement: StoredAccount = {
        id: connectionId,
        profileName: parsed.profileName,
        issuerId: parsed.issuerId,
        keyId: parsed.keyId,
        privateKeyFile,
      };
      const connections = existing
        ? stored.connections.map((connection) => connection.id === existing.id ? replacement : connection)
        : [...stored.connections, replacement];
      const next: StoredConnections = { version: 2, activeConnectionId: connectionId, connections };
      let keyCommitted = false;
      try {
        await writeFile(temporaryKeyPath, parsed.privateKey, { flag: "wx", mode: 0o600 });
        await rename(temporaryKeyPath, privateKeyPath);
        keyCommitted = true;
        await this.writeStoredConnections(next, suffix);
        await chmod(privateKeyPath, 0o600);
        if (existing && existing.privateKeyFile !== privateKeyFile) {
          await unlink(join(this.directory, existing.privateKeyFile)).catch(() => undefined);
        }
      } finally {
        await unlink(temporaryKeyPath).catch(() => undefined);
        if (keyCommitted) {
          const current = await this.readStoredConnections().catch(() => null);
          const referenced = current?.connections.some((connection) => connection.privateKeyFile === privateKeyFile) ?? false;
          if (!referenced) await unlink(privateKeyPath).catch(() => undefined);
        }
      }
      return connectionId;
    });
  }

  activate(connectionId: string) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const stored = await this.readStoredConnections();
      if (!stored.connections.some((connection) => connection.id === connectionId)) {
        throw new CredentialStoreError("connection_not_found", "That Apple account is no longer saved.", 404);
      }
      if (stored.activeConnectionId === connectionId) return;
      await this.writeStoredConnections({ ...stored, activeConnectionId: connectionId }, randomUUID());
    });
  }

  remove(connectionId: string) {
    return this.mutate(async () => {
      this.requireLocallyManaged();
      const stored = await this.readStoredConnections();
      const index = stored.connections.findIndex((connection) => connection.id === connectionId);
      if (index < 0) {
        throw new CredentialStoreError("connection_not_found", "That Apple account is no longer saved.", 404);
      }
      const removed = stored.connections[index]!;
      const connections = stored.connections.filter((connection) => connection.id !== connectionId);
      const activeConnectionId = stored.activeConnectionId === connectionId
        ? connections[Math.min(index, connections.length - 1)]?.id ?? null
        : stored.activeConnectionId;
      await this.writeStoredConnections({ version: 2, activeConnectionId, connections }, randomUUID());
      await unlink(join(this.directory, removed.privateKeyFile)).catch(() => undefined);
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

  private async loadStoredCredentials(connection: StoredAccount): Promise<AppStoreConnectCredentials> {
    const privateKey = await readFile(join(this.directory, connection.privateKeyFile), "utf8").catch(() => {
      throw new Error("The saved App Store Connect private key is missing.");
    });
    validatePrivateKey(privateKey);
    return {
      connectionId: connection.id,
      profileName: connection.profileName,
      issuerId: connection.issuerId,
      keyId: connection.keyId,
      privateKey,
      authBackend: "Owner-only local credential file",
    };
  }

  private async readStoredConnections(): Promise<StoredConnections> {
    const metadataBody = await readFile(this.metadataPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (metadataBody === null) return { version: 2, activeConnectionId: null, connections: [] };
    let value: unknown;
    try {
      value = JSON.parse(metadataBody);
    } catch {
      throw new Error("The saved App Store Connect connection is damaged.");
    }
    const current = StoredConnectionsV2Schema.safeParse(value);
    if (current.success) return current.data;
    const legacy = StoredConnectionV1Schema.safeParse(value);
    if (!legacy.success) throw new Error("The saved App Store Connect connection is damaged.");
    const id = legacyConnectionId(legacy.data);
    const { version: _version, ...connection } = legacy.data;
    return {
      version: 2,
      activeConnectionId: id,
      connections: [{ id, ...connection }],
    };
  }

  private async writeStoredConnections(value: StoredConnections, suffix: string) {
    const parsed = StoredConnectionsV2Schema.parse(value);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporaryMetadataPath = `${this.metadataPath}.${suffix}.tmp`;
    try {
      await writeFile(temporaryMetadataPath, JSON.stringify(parsed, null, 2), { flag: "wx", mode: 0o600 });
      await rename(temporaryMetadataPath, this.metadataPath);
      await chmod(this.metadataPath, 0o600);
    } finally {
      await unlink(temporaryMetadataPath).catch(() => undefined);
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
