import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "live";
if (mode !== "demo" && mode !== "live") {
  console.error(`Usage: node scripts/local.mjs [live|demo]; received ${JSON.stringify(mode)}.`);
  process.exitCode = 1;
} else {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const guiToken = randomBytes(32).toString("base64url");
  const mcpToken = randomBytes(32).toString("base64url");
  const environment = { ...process.env };
  delete environment.ASC_STUDIO_GUI_TOKEN;
  delete environment.ASC_STUDIO_MCP_TOKEN;
  delete environment.VITE_ASC_STUDIO_GUI_TOKEN;

  Object.assign(environment, {
    ASC_STUDIO_MODE: mode,
    ASC_STUDIO_PORT: environment.ASC_STUDIO_PORT ?? "8787",
    ASC_STUDIO_DATA_DIR: environment.ASC_STUDIO_DATA_DIR ?? join(repositoryRoot, ".asc-studio"),
    ASC_STUDIO_WEB_DIR: join(repositoryRoot, "apps", "web", "dist"),
    ASC_STUDIO_GUI_TOKEN: guiToken,
    ASC_STUDIO_MCP_TOKEN: mcpToken,
  });

  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(repositoryRoot, "apps", "local-agent", "src", "index.ts")],
    {
      cwd: join(repositoryRoot, "apps", "local-agent"),
      env: environment,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );

  let output = "";
  let sessionPrinted = false;
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
    output = `${output}${chunk}`.slice(-4_096);
    const match = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    if (!match?.[1] || sessionPrinted) return;
    sessionPrinted = true;
    const baseUrl = `http://127.0.0.1:${match[1]}`;
    console.log("");
    console.log(`GUI session URL: ${baseUrl}/#session=${encodeURIComponent(guiToken)}`);
    console.log(`MCP bearer token: ${mcpToken}`);
    console.log(mode === "live" ? "Using ASC Studio's direct App Store Connect API provider." : "Using isolated demo data.");
  });
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

  let requestedStop = false;
  const stop = (signal) => {
    requestedStop = true;
    if (child.exitCode === null) child.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveExit(requestedStop ? 0 : code ?? (signal ? 1 : 0)));
  }).catch((error) => {
    console.error(error);
    return 1;
  });
  process.exitCode = exitCode;
}
