import { createPrivateKey, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppStoreConnectCredentialsInputSchema, type AppStoreConnectCredentialsInput } from "@asc-studio/contracts";
import type { AppStoreConnectCredentials } from "@asc-studio/provider-app-store-connect";
import { z } from "zod";

const StoredConnectionSchema = z.object({
  version: z.literal(1),
  profileName: z.string().min(1).max(80),
  issuerId: z.string().min(1).max(128),
  keyId: z.string().regex(/^[A-Z0-9]{8,32}$/),
  privateKeyFile: z.string().regex(/^AuthKey-[A-Z0-9]{8,32}-[0-9a-f-]{36}\.p8$/).default("AuthKey.p8"),
}).strict();

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

export class AppStoreConnectCredentialStore {
  private readonly directory: string;
  private readonly metadataPath: string;

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "credentials");
    this.metadataPath = join(this.directory, "app-store-connect.json");
  }

  async load(): Promise<AppStoreConnectCredentials | null> {
    const environment = configuredEnvironmentValues();
    const hasEnvironmentConfiguration = Object.values(environment).some((value) => value !== undefined);
    if (hasEnvironmentConfiguration) {
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
        profileName: environment.profileName?.trim() || `API key ${environment.keyId}`,
        issuerId: environment.issuerId.trim(),
        keyId: environment.keyId.trim(),
        privateKey,
        authBackend: "Environment variables",
      };
    }

    const metadataBody = await readFile(this.metadataPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (metadataBody === null) return null;
    let metadataValue: unknown;
    try {
      metadataValue = JSON.parse(metadataBody);
    } catch {
      throw new Error("The saved App Store Connect connection is damaged.");
    }
    const metadata = StoredConnectionSchema.safeParse(metadataValue);
    if (!metadata.success) throw new Error("The saved App Store Connect connection is damaged.");
    const privateKey = await readFile(join(this.directory, metadata.data.privateKeyFile), "utf8").catch(() => {
      throw new Error("The saved App Store Connect private key is missing.");
    });
    validatePrivateKey(privateKey);
    return {
      profileName: metadata.data.profileName,
      issuerId: metadata.data.issuerId,
      keyId: metadata.data.keyId,
      privateKey,
      authBackend: "Owner-only local credential file",
    };
  }

  async save(input: AppStoreConnectCredentialsInput) {
    if (Object.values(configuredEnvironmentValues()).some((value) => value !== undefined)) {
      throw new Error("Environment credentials are active. Remove them before saving a connection from the GUI.");
    }
    const parsed = AppStoreConnectCredentialsInputSchema.parse(input);
    validatePrivateKey(parsed.privateKey);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const suffix = randomUUID();
    const privateKeyFile = `AuthKey-${parsed.keyId}-${suffix}.p8`;
    const privateKeyPath = join(this.directory, privateKeyFile);
    const temporaryKeyPath = `${privateKeyPath}.tmp`;
    const temporaryMetadataPath = `${this.metadataPath}.${suffix}.tmp`;
    const previousMetadata = await readFile(this.metadataPath, "utf8")
      .then((body) => StoredConnectionSchema.safeParse(JSON.parse(body)))
      .catch(() => null);
    let metadataCommitted = false;
    try {
      await writeFile(temporaryKeyPath, parsed.privateKey, { flag: "wx", mode: 0o600 });
      await writeFile(temporaryMetadataPath, JSON.stringify({
        version: 1,
        profileName: parsed.profileName,
        issuerId: parsed.issuerId,
        keyId: parsed.keyId,
        privateKeyFile,
      }, null, 2), { flag: "wx", mode: 0o600 });
      await rename(temporaryKeyPath, privateKeyPath);
      await rename(temporaryMetadataPath, this.metadataPath);
      metadataCommitted = true;
      await Promise.all([chmod(privateKeyPath, 0o600), chmod(this.metadataPath, 0o600)]);
      if (previousMetadata?.success && previousMetadata.data.privateKeyFile !== privateKeyFile) {
        await unlink(join(this.directory, previousMetadata.data.privateKeyFile)).catch(() => undefined);
      }
    } finally {
      await Promise.all([
        unlink(temporaryKeyPath).catch(() => undefined),
        unlink(temporaryMetadataPath).catch(() => undefined),
        ...(!metadataCommitted ? [unlink(privateKeyPath).catch(() => undefined)] : []),
      ]);
    }
  }
}
