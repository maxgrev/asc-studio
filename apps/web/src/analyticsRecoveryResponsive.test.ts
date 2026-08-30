import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("./components/AnalyticsWorkspace.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

const mediaBlocks = (query: string) => {
  const blocks: string[] = [];
  const marker = `@media ${query}`;
  let start = styles.indexOf(marker);
  while (start >= 0) {
    const openingBrace = styles.indexOf("{", start + marker.length);
    let depth = 1;
    let cursor = openingBrace + 1;
    while (depth > 0 && cursor < styles.length) {
      if (styles[cursor] === "{") depth += 1;
      if (styles[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    blocks.push(styles.slice(openingBrace + 1, cursor - 1));
    start = styles.indexOf(marker, cursor);
  }
  return blocks.join("\n");
};

describe("analytics recovery presentation contract", () => {
  it("replaces the empty dashboard with one focused readiness action", () => {
    expect(workspace).toContain("!initialLoading && !recoveryMode ?");
    expect(workspace).toContain("recoveryMode ? (");
    expect(workspace).toContain('className="analytics-recovery-card"');
    expect(workspace).toContain('className="analytics-recovery-sources"');
    expect(workspace).toContain("What ASC Studio checked");
    expect(workspace).not.toContain("Incomplete portfolio coverage.");
    expect(workspace).not.toContain("Sync all accounts");
    expect(workspace).not.toContain("Refresh view");

    const recoveryStart = workspace.indexOf('className="analytics-recovery-card"');
    const dashboardStart = workspace.indexOf('<div className="analytics-content">', recoveryStart);
    const recoveryMarkup = workspace.slice(recoveryStart, dashboardStart);
    expect(recoveryMarkup.match(/className="button primary"/g)).toHaveLength(1);
  });

  it("stacks account rows and makes the recovery action full width on small screens", () => {
    const compact = mediaBlocks("(max-width: 620px)");
    expect(compact).toMatch(/\.analytics-recovery-source\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(compact).toMatch(/\.analytics-recovery-footer \.button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/s);
  });
});
