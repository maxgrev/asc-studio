import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const releaseWorkspace = readFileSync(
  new URL("./components/ReleaseWorkspace.tsx", import.meta.url),
  "utf8",
);

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

describe("release dock responsive contract", () => {
  it("keeps readiness and submission reachable with visible labels at 620px and below", () => {
    const compactStyles = mediaBlocks("(max-width: 620px)");

    expect(compactStyles).toMatch(
      /\.release-dock\s*\{[^}]*(?:flex-wrap:\s*wrap|overflow-x:\s*auto|display:\s*grid)/s,
    );
    expect(compactStyles).not.toMatch(
      /\.release-dock\s*>\s*\.button\.secondary\s*\{[^}]*display:\s*none/s,
    );
    expect(compactStyles).not.toMatch(
      /\.release-dock\s*>\s*\.button\.primary\s*\{[^}]*font-size:\s*0\s*;/s,
    );

    const dockMarkup = releaseWorkspace.slice(releaseWorkspace.indexOf('<div className="release-dock">'));
    expect(dockMarkup).toContain("Check readiness</button>");
    expect(dockMarkup).toContain('"Submit for review"');
  });
});
