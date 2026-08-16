import { randomBytes } from "node:crypto";
import concurrently from "concurrently";

const mode = process.argv[2] ?? "demo";
if (mode !== "demo" && mode !== "live") {
  console.error(`Usage: node scripts/dev.mjs [demo|live]; received ${JSON.stringify(mode)}.`);
  process.exitCode = 1;
} else {
  const guiToken = randomBytes(32).toString("base64url");
  const mcpToken = randomBytes(32).toString("base64url");
  const baseEnvironment = { ...process.env };
  delete baseEnvironment.ASC_STUDIO_GUI_TOKEN;
  delete baseEnvironment.ASC_STUDIO_MCP_TOKEN;
  delete baseEnvironment.VITE_ASC_STUDIO_GUI_TOKEN;

  const agentScript = mode === "live" ? "dev:live" : "dev";
  const { commands, result } = concurrently(
    [
      {
        command: `npm run ${agentScript} -w @asc-studio/local-agent`,
        name: "agent",
        prefixColor: "blue",
        env: {
          ...baseEnvironment,
          ASC_STUDIO_MODE: mode,
          ASC_STUDIO_GUI_TOKEN: guiToken,
          ASC_STUDIO_MCP_TOKEN: mcpToken,
        },
      },
      {
        command: "npm run dev -w @asc-studio/web",
        name: "web",
        prefixColor: "green",
        env: baseEnvironment,
      },
    ],
    { killOthersOn: ["failure", "success"], prefix: "name" },
  );

  const webCommand = commands.find((command) => command.name === "web");
  const agentCommand = commands.find((command) => command.name === "agent");
  let sessionPrinted = false;
  let webReady = false;
  let agentReady = false;
  let webOutput = "";
  let agentOutput = "";
  const printSession = () => {
    if (sessionPrinted || !webReady || !agentReady) return;
    sessionPrinted = true;
    console.log(`GUI session URL: http://127.0.0.1:5173/#session=${encodeURIComponent(guiToken)}`);
    console.log(`MCP bearer token: ${mcpToken}`);
  };
  webCommand?.stdout.subscribe((chunk) => {
    webOutput = `${webOutput}${chunk.toString("utf8")}`.slice(-4_096);
    webReady = webOutput.includes("http://127.0.0.1:5173/");
    printSession();
  });
  agentCommand?.stdout.subscribe((chunk) => {
    agentOutput = `${agentOutput}${chunk.toString("utf8")}`.slice(-4_096);
    agentReady = agentOutput.includes("listening on http://127.0.0.1:8787");
    printSession();
  });

  try {
    await result;
  } catch {
    process.exitCode = 1;
  }
}
