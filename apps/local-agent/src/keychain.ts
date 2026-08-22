import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEYCHAIN_HELPER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "native",
  "bin",
  "asc-studio-keychain-helper",
);
const ENVELOPE_PREFIX = "asc-studio-keychain-v1:";
const HELPER_FRAME_PREFIX = "ASCSTUDIO1:";
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const KEYCHAIN_PROMPT_TIMEOUT_MS = 30_000;

export type CredentialBundleKind = "openai" | "app-store-connect" | "apple-ads";

const VAULT_ID_FILE = "keychain-vault-id";

const readVaultId = async (path: string) => {
  const details = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (details === null) return null;
  const ownerMismatch = typeof process.getuid === "function" && details.uid !== process.getuid();
  if (!details.isFile() || details.isSymbolicLink() || ownerMismatch || (details.mode & 0o077) !== 0) {
    throw new KeychainAccessError("damaged", "The nonsecret Keychain vault ID file is unsafe.");
  }
  const value = (await readFile(path, "utf8")).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new KeychainAccessError("damaged", "The nonsecret Keychain vault ID is damaged.");
  }
  return value;
};

export const keychainAccount = async (dataDirectory: string, kind: CredentialBundleKind) => {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const directoryDetails = await lstat(dataDirectory);
  const ownerMismatch = typeof process.getuid === "function" && directoryDetails.uid !== process.getuid();
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink() || ownerMismatch || (directoryDetails.mode & 0o022) !== 0) {
    throw new KeychainAccessError("damaged", "The ASC Studio data directory must be an owner-controlled regular directory.");
  }
  await chmod(dataDirectory, 0o700);

  const path = join(dataDirectory, VAULT_ID_FILE);
  let id = await readVaultId(path);
  if (id === null) {
    const candidate = randomUUID();
    const temporaryPath = `${path}.${candidate}.tmp`;
    try {
      const temporary = await open(temporaryPath, "wx", 0o600);
      try {
        await temporary.writeFile(`${candidate}\n`, "utf8");
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await link(temporaryPath, path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const directory = await open(dataDirectory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
    id = await readVaultId(path);
  }
  if (id === null) throw new KeychainAccessError("damaged", "ASC Studio could not create its nonsecret Keychain vault ID.");
  return `v1.${id}.${kind}`;
};

export class KeychainAccessError extends Error {
  constructor(
    readonly reason: "unavailable" | "denied" | "damaged",
    message: string,
    readonly commitUnknown = false,
  ) {
    super(message);
    this.name = "KeychainAccessError";
  }
}

export interface CredentialVault {
  read(account: string): Promise<string | null>;
  readFresh(account: string): Promise<string | null>;
  write(account: string, secret: string): Promise<void>;
  remove(account: string): Promise<boolean>;
}

export interface KeychainCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type KeychainCommandRunner = (
  arguments_: readonly string[],
  input?: string,
) => Promise<KeychainCommandResult>;

const requireSafeKeychainHelper = async (path: string) => {
  const details = await lstat(path).catch(() => null);
  const ownerMismatch = details !== null
    && typeof process.getuid === "function"
    && details.uid !== process.getuid();
  if (
    details === null
    || !details.isFile()
    || details.isSymbolicLink()
    || ownerMismatch
    || (details.mode & 0o022) !== 0
    || (details.mode & 0o100) === 0
  ) {
    throw new KeychainAccessError(
      "unavailable",
      "ASC Studio's native Keychain helper is missing or unsafe. Rebuild ASC Studio and try again.",
    );
  }
};

const assertIdentifier = (value: string, name: string) => {
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/.test(value)) {
    throw new KeychainAccessError("damaged", `The ${name} Keychain identifier is invalid.`);
  }
};

const encodeSecret = (secret: string) => (
  `${ENVELOPE_PREFIX}${Buffer.from(secret, "utf8").toString("base64")}`
);

const frameSecret = (secret: string) => {
  const encoded = encodeSecret(secret);
  const length = Buffer.byteLength(encoded, "utf8");
  return `${HELPER_FRAME_PREFIX}${length.toString(16).padStart(8, "0")}\n${encoded}`;
};

const decodeSecret = (stored: string) => {
  if (!stored.startsWith(ENVELOPE_PREFIX)) {
    throw new KeychainAccessError("damaged", "The saved Keychain credential uses an unsupported format.");
  }
  const encoded = stored.slice(ENVELOPE_PREFIX.length);
  if (encoded.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new KeychainAccessError("damaged", "The saved Keychain credential is damaged.");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) {
    throw new KeychainAccessError("damaged", "The saved Keychain credential is damaged.");
  }
  return decoded.toString("utf8");
};

export const createKeychainHelperRunner = (
  spawnProcess: typeof spawn = spawn,
  timeoutMs = KEYCHAIN_PROMPT_TIMEOUT_MS,
  helperPath = KEYCHAIN_HELPER,
): KeychainCommandRunner => async (arguments_, input) => {
  if (spawnProcess === spawn) await requireSafeKeychainHelper(helperPath);
  return new Promise((resolve, reject) => {
  const child = spawnProcess(helperPath, [...arguments_], {
    env: {
      LANG: process.env.LANG ?? "en_US.UTF-8",
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let settled = false;
  let forcedFailure: KeychainAccessError | null = null;
  const mutationCommand = arguments_[0] === "write" || arguments_[0] === "remove";
  const killOnParentExit = () => {
    if (!settled) child.kill("SIGKILL");
  };
  process.once("exit", killOnParentExit);

  const forceTerminate = (error: KeychainAccessError) => {
    if (settled || forcedFailure) return;
    forcedFailure = error;
    clearTimeout(timer);
    child.kill("SIGKILL");
  };

  const timer = setTimeout(() => {
    forceTerminate(new KeychainAccessError(
      "denied",
      "macOS Keychain authorization timed out. Try again and respond to the system prompt.",
      mutationCommand,
    ));
  }, timeoutMs);
  timer.unref();

  function finish(operation: () => void) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    process.removeListener("exit", killOnParentExit);
    operation();
  }
  const append = (target: "stdout" | "stderr", chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
      forceTerminate(new KeychainAccessError(
        "unavailable",
        "macOS Keychain returned an invalid response.",
        mutationCommand,
      ));
      return;
    }
    if (target === "stdout") stdout += chunk.toString("utf8");
    else stderr += chunk.toString("utf8");
  };

  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  child.stdin.on("error", () => {
    // EPIPE is expected if authorization is denied or the timeout kills the tool
    // while a bundle is still being written. The close/error path owns settlement.
  });
  child.once("error", () => {
    // A forced mutation kill remains commit-unknown even if Node also reports
    // that the kill failed. Do not replace that state with a weaker spawn
    // error while the child can still close later.
    if (forcedFailure) return;
    finish(() => reject(new KeychainAccessError("unavailable", "macOS Keychain is unavailable.")));
  });
  child.once("close", (exitCode, signal) => {
    if (forcedFailure) {
      finish(() => reject(forcedFailure!));
      return;
    }
    if (signal !== null || exitCode === null) {
      finish(() => reject(new KeychainAccessError(
        "unavailable",
        "ASC Studio's Keychain helper stopped before completing the request.",
        mutationCommand,
      )));
      return;
    }
    finish(() => resolve({ exitCode, stdout, stderr }));
  });

  if (input === undefined) child.stdin.end();
  else child.stdin.end(input, "utf8");
  });
};

export const runKeychainHelper = createKeychainHelperRunner();

const isItemNotFound = (result: KeychainCommandResult) => result.exitCode === 44;

const commandFailure = (result: KeychainCommandResult) => {
  // The tool's output can contain credential metadata. Never include it in an error,
  // response, or log. A locked keychain, denied prompt, and other access failures all
  // intentionally collapse to the same actionable message.
  void result.stdout;
  void result.stderr;
  return new KeychainAccessError(
    result.exitCode === 77 ? "denied" : "unavailable",
    result.exitCode === 77
      ? "ASC Studio could not access macOS Keychain. Unlock your login keychain and allow access, then try again."
      : "ASC Studio's Keychain helper could not complete the request. Rebuild ASC Studio and try again.",
  );
};

export class MacOsCredentialVault implements CredentialVault {
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly runner: KeychainCommandRunner = runKeychainHelper,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async read(account: string) {
    this.requireSupported();
    assertIdentifier(account, "account");
    const cached = this.cache.get(account);
    if (cached !== undefined) return cached;
    return this.readFresh(account);
  }

  async readFresh(account: string) {
    this.requireSupported();
    assertIdentifier(account, "account");
    this.cache.delete(account);

    const result = await this.runner(["read", account]);
    if (isItemNotFound(result)) return null;
    if (result.exitCode !== 0) throw commandFailure(result);
    const stored = result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout;
    const secret = decodeSecret(stored);
    this.cache.set(account, secret);
    return secret;
  }

  async write(account: string, secret: string) {
    this.requireSupported();
    assertIdentifier(account, "account");
    if (secret.length === 0) throw new KeychainAccessError("damaged", "Refusing to save an empty Keychain credential.");
    this.cache.delete(account);
    const result = await this.runner(["write", account], frameSecret(secret));
    if (result.exitCode !== 0) throw commandFailure(result);
  }

  async remove(account: string) {
    this.requireSupported();
    assertIdentifier(account, "account");
    this.cache.delete(account);
    const result = await this.runner(["remove", account]);
    if (isItemNotFound(result)) return false;
    if (result.exitCode !== 0) throw commandFailure(result);
    return true;
  }

  private requireSupported() {
    if (this.platform !== "darwin") {
      throw new KeychainAccessError(
        "unavailable",
        "GUI-managed credentials require macOS Keychain. Use environment credentials on this platform.",
      );
    }
  }
}

export class InMemoryCredentialVault implements CredentialVault {
  readonly values = new Map<string, string>();
  readonly operations: Array<{ operation: "read" | "readFresh" | "write" | "remove"; account: string }> = [];

  async read(account: string) {
    this.operations.push({ operation: "read", account });
    return this.values.get(account) ?? null;
  }

  async readFresh(account: string) {
    this.operations.push({ operation: "readFresh", account });
    return this.values.get(account) ?? null;
  }

  async write(account: string, secret: string) {
    this.operations.push({ operation: "write", account });
    this.values.set(account, secret);
  }

  async remove(account: string) {
    this.operations.push({ operation: "remove", account });
    return this.values.delete(account);
  }
}

export const systemCredentialVault: CredentialVault = new MacOsCredentialVault();
