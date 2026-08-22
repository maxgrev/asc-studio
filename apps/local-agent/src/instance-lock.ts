import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { keychainAccount } from "./keychain.js";

export class InstanceLockError extends Error {
  constructor(readonly code: "already_running" | "unsafe_lock" | "lock_failed", message: string) {
    super(message);
    this.name = "InstanceLockError";
  }
}

export interface InstanceLockOptions {
  runtimeDirectory?: string;
}

const requireOwnerControlledDirectory = async (path: string, label: string) => {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const details = await lstat(path);
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (!details.isDirectory() || details.isSymbolicLink() || ownerMismatch || (details.mode & 0o022) !== 0) {
    throw new InstanceLockError("unsafe_lock", `${label} is not owner-controlled.`);
  }
  await chmod(path, 0o700);
};

const requireSafeLockFile = async (path: string): Promise<void> => {
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) {
    const handle = await open(path, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return null;
      throw error;
    });
    await handle?.close();
    return requireSafeLockFile(path);
  }
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (!details.isFile() || details.isSymbolicLink() || ownerMismatch || (details.mode & 0o077) !== 0) {
    throw new InstanceLockError("unsafe_lock", "The ASC Studio instance-lock database is unsafe.");
  }
};

const sqliteErrorCode = (error: unknown) => (
  typeof error === "object" && error !== null && "errcode" in error
    ? (error as { errcode?: unknown }).errcode
    : undefined
);

export type ReleaseInstanceLock = () => Promise<void>;

export const acquireInstanceLock = async (
  dataDirectory: string,
  options: InstanceLockOptions = {},
): Promise<ReleaseInstanceLock> => {
  await requireOwnerControlledDirectory(dataDirectory, "The ASC Studio data directory");
  const account = await keychainAccount(dataDirectory, "openai");
  const vaultId = account.split(".")[1];
  if (!vaultId) throw new InstanceLockError("lock_failed", "ASC Studio could not resolve its instance-lock identity.");

  const homeDirectory = userInfo().homedir;
  const defaultRuntimeDirectory = process.platform === "darwin"
    ? join(homeDirectory, "Library", "Caches", "ASC Studio", "locks")
    : join(homeDirectory, ".cache", "asc-studio", "locks");
  const runtimeDirectory = options.runtimeDirectory ?? defaultRuntimeDirectory;
  await requireOwnerControlledDirectory(runtimeDirectory, "The ASC Studio lock directory");
  const path = join(runtimeDirectory, `${vaultId}.sqlite`);
  await requireSafeLockFile(path);

  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(path);
    database.exec("PRAGMA busy_timeout = 0");
    database.exec("PRAGMA journal_mode = DELETE");
    database.exec("CREATE TABLE IF NOT EXISTS instance_lock_guard (id INTEGER PRIMARY KEY CHECK (id = 1))");
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database?.close();
    if (sqliteErrorCode(error) === 5) {
      throw new InstanceLockError(
        "already_running",
        "Another ASC Studio local agent is already using this credential vault.",
      );
    }
    throw new InstanceLockError("lock_failed", "ASC Studio could not acquire its instance lock.");
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const ownedDatabase = database;
    database = null;
    if (!ownedDatabase) return;
    try {
      ownedDatabase.exec("ROLLBACK");
    } finally {
      ownedDatabase.close();
    }
  };
};
