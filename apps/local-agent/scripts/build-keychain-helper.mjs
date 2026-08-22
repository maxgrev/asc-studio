import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("Skipping the macOS Keychain helper build on this platform.");
  process.exit(0);
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(packageRoot, "native", "keychain-helper.c");
const outputDirectory = join(packageRoot, "native", "bin");
const output = join(outputDirectory, "asc-studio-keychain-helper");
const temporary = `${output}.${process.pid}.tmp`;
const stamp = `${output}.sha256`;
const temporaryStamp = `${stamp}.${process.pid}.tmp`;
await mkdir(outputDirectory, { recursive: true, mode: 0o755 });

const compiler = spawnSync("/usr/bin/xcrun", ["--sdk", "macosx", "clang", "--version"], {
  encoding: "utf8",
  shell: false,
});
if (compiler.status !== 0) {
  throw new Error("ASC Studio requires Xcode Command Line Tools to build its macOS Keychain helper.");
}
const fingerprint = createHash("sha256")
  .update(await readFile(source))
  .update("asc-studio-keychain-helper-build-v3\0")
  .update(process.arch)
  .update(compiler.stdout)
  .digest("hex");
const existingStamp = await readFile(stamp, "utf8").catch(() => "");
const existingOutput = await lstat(output).catch(() => null);
if (
  existingStamp.trim() === fingerprint
  && existingOutput?.isFile()
  && !existingOutput.isSymbolicLink()
  && (existingOutput.mode & 0o022) === 0
) {
  const signature = spawnSync("/usr/bin/codesign", ["--verify", "--strict", output], { shell: false });
  const protocol = spawnSync(output, ["version"], { encoding: "utf8", shell: false });
  if (signature.status === 0 && protocol.status === 0 && protocol.stdout === "asc-studio-keychain-helper-v2\n") {
    console.log(`Reusing ${output}`);
    process.exit(0);
  }
}

try {
  const compiled = spawnSync("/usr/bin/xcrun", [
    "--sdk", "macosx",
    "clang",
    source,
    "-o", temporary,
    "-std=c17",
    "-Os",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-Wno-deprecated-declarations",
    "-mmacosx-version-min=11.0",
    "-framework", "CoreFoundation",
    "-framework", "Security",
  ], { encoding: "utf8", shell: false });
  if (compiled.status !== 0) {
    throw new Error(`ASC Studio could not compile its macOS Keychain helper. ${compiled.stderr.trim()}`);
  }
  const signed = spawnSync("/usr/bin/codesign", [
    "--force",
    "--sign", "-",
    "--identifier", "com.asc-studio.keychain-helper",
    temporary,
  ], { encoding: "utf8", shell: false });
  if (signed.status !== 0) {
    throw new Error(`ASC Studio could not sign its macOS Keychain helper. ${signed.stderr.trim()}`);
  }
  await chmod(temporary, 0o755);
  const verified = spawnSync("/usr/bin/codesign", ["--verify", "--strict", temporary], {
    encoding: "utf8",
    shell: false,
  });
  const protocol = spawnSync(temporary, ["version"], { encoding: "utf8", shell: false });
  if (
    verified.status !== 0
    || protocol.status !== 0
    || protocol.stdout !== "asc-studio-keychain-helper-v2\n"
  ) {
    throw new Error("ASC Studio built a Keychain helper that failed its signature or launch check.");
  }
  await rename(temporary, output);
  await writeFile(temporaryStamp, `${fingerprint}\n`, { mode: 0o644 });
  await rename(temporaryStamp, stamp);
} finally {
  await rm(temporary, { force: true });
  await rm(temporaryStamp, { force: true });
}

console.log(`Built ${output}`);
