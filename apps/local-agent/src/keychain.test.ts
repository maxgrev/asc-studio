import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KeychainAccessError,
  MacOsCredentialVault,
  createKeychainHelperRunner,
  keychainAccount,
  type KeychainCommandRunner,
} from "./keychain.js";

const directories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("MacOsCredentialVault", () => {
  it("keeps secrets out of argv and uses the native helper's stdin protocol", async () => {
    const calls: Array<{ arguments_: readonly string[]; input: string | undefined }> = [];
    let stored = "";
    const runner: KeychainCommandRunner = async (arguments_, input) => {
      calls.push({ arguments_, input });
      if (arguments_[0] === "write") {
        const header = input!.indexOf("\n");
        expect(input!.slice(0, "ASCSTUDIO1:".length)).toBe("ASCSTUDIO1:");
        expect(header).toBe(19);
        const declaredLength = Number.parseInt(input!.slice("ASCSTUDIO1:".length, header), 16);
        stored = input!.slice(header + 1);
        expect(Buffer.byteLength(stored, "utf8")).toBe(declaredLength);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (arguments_[0] === "read") return { exitCode: 0, stdout: stored, stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const vault = new MacOsCredentialVault(runner, "darwin");
    const secret = `line one\n${"PRIVATE KEY material\n".repeat(40)}`;

    await vault.write("v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai", secret);
    const write = calls[0]!;
    expect(write.arguments_).toEqual(["write", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"]);
    expect(write.arguments_.join(" ")).not.toContain("PRIVATE KEY");
    expect(write.input).not.toContain("PRIVATE KEY");
    expect(Buffer.byteLength(write.input!, "utf8")).toBeGreaterThan(128);

    await expect(vault.readFresh("v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai")).resolves.toBe(secret);
    const callCount = calls.length;
    await expect(vault.read("v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai")).resolves.toBe(secret);
    expect(calls).toHaveLength(callCount);
  });

  it("redacts command output and fails closed when access is denied or unsupported", async () => {
    const runner: KeychainCommandRunner = async () => ({
      exitCode: 36,
      stdout: "sk-secret-from-stdout",
      stderr: "denied sk-secret-from-stderr",
    });
    const vault = new MacOsCredentialVault(runner, "darwin");
    const denied = await vault.read("v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai").catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(KeychainAccessError);
    expect(String(denied)).not.toContain("sk-secret");

    const unsupported = new MacOsCredentialVault(runner, "linux");
    await expect(unsupported.read("v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"))
      .rejects.toMatchObject({ reason: "unavailable" });
  });

  it("returns null when the native helper reports that an item does not exist", async () => {
    const runner = vi.fn<KeychainCommandRunner>().mockResolvedValue({ exitCode: 44, stdout: "", stderr: "not found" });
    const vault = new MacOsCredentialVault(runner, "darwin");
    await expect(vault.read("v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai")).resolves.toBeNull();
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]![0]).toEqual(["read", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"]);
  });
});

describe("native Keychain helper runner", () => {
  it("fails closed before spawn when the native helper is missing", async () => {
    const runner = createKeychainHelperRunner(spawn, 25, "/private/tmp/asc-studio-helper-does-not-exist");
    await expect(runner(["read", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"]))
      .rejects.toMatchObject({ reason: "unavailable" });
  });

  it("waits for close and marks a timed-out mutation as commit-unknown", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: EventEmitter & { end: (input?: string) => void };
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
    child.kill = vi.fn();
    const spawnProcess = vi.fn(() => child) as unknown as Parameters<typeof createKeychainHelperRunner>[0];
    const runner = createKeychainHelperRunner(spawnProcess, 25, "/test/asc-studio-keychain-helper");
    const result = runner(
      ["write", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"],
      "ASCSTUDIO1:00000001\nx",
    );
    let outcome = "pending";
    void result.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });

    expect(spawnProcess).toHaveBeenCalledWith(
      "/test/asc-studio-keychain-helper",
      ["write", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"],
      expect.objectContaining({ shell: false, stdio: ["pipe", "pipe", "pipe"] }),
    );

    await vi.advanceTimersByTimeAsync(25);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(outcome).toBe("pending");
    child.emit("error", new Error("kill failed"));
    expect(outcome).toBe("pending");
    child.emit("close", null, "SIGKILL");
    await expect(result).rejects.toMatchObject({ reason: "denied", commitUnknown: true });
  });

  it("marks output-limit kills and unexpected mutation signals as commit-unknown", async () => {
    const createChild = () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: EventEmitter & { end: (input?: string) => void };
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
      child.kill = vi.fn();
      return child;
    };

    const oversizedChild = createChild();
    const oversizedRunner = createKeychainHelperRunner(
      vi.fn(() => oversizedChild) as unknown as Parameters<typeof createKeychainHelperRunner>[0],
      30_000,
      "/test/asc-studio-keychain-helper",
    );
    const oversized = oversizedRunner(
      ["write", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"],
      "ASCSTUDIO1:00000001\nx",
    );
    let oversizedOutcome = "pending";
    void oversized.then(() => { oversizedOutcome = "resolved"; }, () => { oversizedOutcome = "rejected"; });
    oversizedChild.stdout.emit("data", Buffer.alloc(2 * 1024 * 1024 + 1));
    expect(oversizedChild.kill).toHaveBeenCalledWith("SIGKILL");
    expect(oversizedOutcome).toBe("pending");
    oversizedChild.emit("close", null, "SIGKILL");
    await expect(oversized).rejects.toMatchObject({ reason: "unavailable", commitUnknown: true });

    const signaledChild = createChild();
    const signaledRunner = createKeychainHelperRunner(
      vi.fn(() => signaledChild) as unknown as Parameters<typeof createKeychainHelperRunner>[0],
      30_000,
      "/test/asc-studio-keychain-helper",
    );
    const signaled = signaledRunner(
      ["remove", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"],
    );
    signaledChild.emit("close", null, "SIGTERM");
    await expect(signaled).rejects.toMatchObject({ reason: "unavailable", commitUnknown: true });
  });
});

describe("Keychain vault identity", () => {
  it("atomically shares one stable nonsecret UUID across concurrent bundle lookups and moves", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-vault-id-"));
    directories.push(root);
    const accounts = await Promise.all([
      keychainAccount(root, "openai"),
      keychainAccount(root, "app-store-connect"),
      keychainAccount(root, "apple-ads"),
      keychainAccount(root, "openai"),
    ]);
    const namespaces = accounts.map((account) => account.split(".")[1]);
    expect(new Set(namespaces).size).toBe(1);
    expect(accounts[0]).toBe(accounts[3]);
    const idPath = join(root, "keychain-vault-id");
    expect((await stat(idPath)).mode & 0o777).toBe(0o600);
    expect((await readFile(idPath, "utf8")).trim()).toBe(namespaces[0]);

    const moved = `${root}-moved`;
    await rename(root, moved);
    directories.splice(directories.indexOf(root), 1, moved);
    expect(await keychainAccount(moved, "openai")).toBe(accounts[0]);
  });

  it("accepts a pre-existing 0755 owner-controlled data directory and tightens it", async () => {
    const root = await mkdtemp(join(tmpdir(), "asc-studio-vault-id-mode-"));
    directories.push(root);
    await chmod(root, 0o755);
    await keychainAccount(root, "openai");
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(join(root, "keychain-vault-id"))).mode & 0o777).toBe(0o600);
  });
});
