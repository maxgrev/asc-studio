import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildScript = join(packageRoot, "scripts", "build-keychain-helper.mjs");
const helper = join(packageRoot, "native", "bin", "asc-studio-keychain-helper");

function buildHelper() {
  const result = spawnSync(process.execPath, [buildScript], {
    cwd: packageRoot,
    encoding: "utf8",
    shell: false,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

async function sha256(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function signatureIdentity(path: string) {
  const result = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", path], {
    encoding: "utf8",
    shell: false,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const details = `${result.stdout}${result.stderr}`;
  const identifier = details.match(/^Identifier=(.+)$/m)?.[1];
  const cdHash = details.match(/^CDHash=(.+)$/m)?.[1];
  expect(identifier).toBe("com.asc-studio.keychain-helper");
  expect(cdHash).toMatch(/^[0-9a-f]+$/);
  return { cdHash, identifier };
}

describe.skipIf(process.platform !== "darwin")("native Keychain helper build", () => {
  it("reuses an unchanged signed helper without changing its binary identity", async () => {
    buildHelper();
    const firstHash = await sha256(helper);
    const firstIdentity = signatureIdentity(helper);

    const secondBuildOutput = buildHelper();
    const secondHash = await sha256(helper);
    const secondIdentity = signatureIdentity(helper);

    expect(secondBuildOutput).toContain(`Reusing ${helper}`);
    expect(secondHash).toBe(firstHash);
    expect(secondIdentity).toEqual(firstIdentity);

    const version = spawnSync(helper, ["version"], {
      encoding: "utf8",
      shell: false,
    });
    expect(version.error).toBeUndefined();
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout).toBe("asc-studio-keychain-helper-v2\n");

    const truncatedFrame = spawnSync(
      helper,
      ["write", "v1.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.openai"],
      { input: "ASCSTUDIO1:00000010\nshort", encoding: "utf8", shell: false },
    );
    expect(truncatedFrame.error).toBeUndefined();
    expect(truncatedFrame.status).toBe(2);
    expect(truncatedFrame.stdout).toBe("");
  }, 20_000);
});
