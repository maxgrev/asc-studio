import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireInstanceLock } from "./instance-lock.js";
import { keychainAccount } from "./keychain.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const makeDirectory = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

describe("acquireInstanceLock", () => {
  it("uses an OS-backed exclusive lock and releases it idempotently", async () => {
    const root = await makeDirectory("asc-studio-instance-lock-");
    const runtimeDirectory = await makeDirectory("asc-studio-instance-runtime-");
    const release = await acquireInstanceLock(root, { runtimeDirectory });

    await expect(acquireInstanceLock(root, { runtimeDirectory }))
      .rejects.toMatchObject({ code: "already_running" });

    await release();
    await release();
    const releaseAgain = await acquireInstanceLock(root, { runtimeDirectory });
    await releaseAgain();
  });

  it("shares the lock across data-directory copies with the same vault identity", async () => {
    const firstRoot = await makeDirectory("asc-studio-instance-first-");
    const secondRoot = await makeDirectory("asc-studio-instance-second-");
    const runtimeDirectory = await makeDirectory("asc-studio-instance-runtime-");
    await keychainAccount(firstRoot, "openai");
    await writeFile(
      join(secondRoot, "keychain-vault-id"),
      await readFile(join(firstRoot, "keychain-vault-id"), "utf8"),
      { mode: 0o600 },
    );

    const release = await acquireInstanceLock(firstRoot, { runtimeDirectory });
    await expect(acquireInstanceLock(secondRoot, { runtimeDirectory }))
      .rejects.toMatchObject({ code: "already_running" });
    await release();
  });

  it("creates only an owner-only nonsecret lock database", async () => {
    const root = await makeDirectory("asc-studio-instance-lock-");
    const runtimeDirectory = await makeDirectory("asc-studio-instance-runtime-");
    const account = await keychainAccount(root, "openai");
    const vaultId = account.split(".")[1]!;
    const release = await acquireInstanceLock(root, { runtimeDirectory });
    const lockPath = join(runtimeDirectory, `${vaultId}.sqlite`);
    expect((await stat(lockPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(lockPath)).not.toContain(Buffer.from("PRIVATE KEY"));
    await release();
  });

  it("refuses a symbolic-link lock without touching its target", async () => {
    const root = await makeDirectory("asc-studio-instance-lock-");
    const runtimeDirectory = await makeDirectory("asc-studio-instance-runtime-");
    const account = await keychainAccount(root, "openai");
    const vaultId = account.split(".")[1]!;
    const target = join(runtimeDirectory, "target.sqlite");
    await writeFile(target, "not a database", { mode: 0o600 });
    await symlink(target, join(runtimeDirectory, `${vaultId}.sqlite`));

    await expect(acquireInstanceLock(root, { runtimeDirectory }))
      .rejects.toMatchObject({ code: "unsafe_lock" });
    await expect(readFile(target, "utf8")).resolves.toBe("not a database");
  });
});
