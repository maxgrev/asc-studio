#!/usr/bin/env node

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const profileIndex = args.indexOf("--profile");
if (profileIndex !== -1) args.splice(profileIndex, 2);

const scenario = process.env.ASC_STUDIO_FAKE_SCENARIO ?? "golden";
const fixture = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const respond = (name) => process.stdout.write(fixture(name));
const matches = (...expected) => expected.every((value, index) => args[index] === value);

if (matches("--version")) {
  process.stdout.write("1.4.2 (commit: fixture, date: 2026-07-31)\n");
} else if (matches("auth", "status")) {
  if (scenario === "auth-stderr-error") {
    process.stderr.write("SECRET_ISSUER_ID and /Users/private/AuthKey.p8\n");
    process.exitCode = 1;
  } else {
    respond(scenario === "environment-auth" ? "auth-status-environment.json" : "auth-status.json");
  }
} else if (matches("apps", "list")) {
  if (scenario === "stderr-error") {
    process.stderr.write("SECRET_PRIVATE_KEY and /Users/private/AuthKey.p8\n");
    process.exitCode = 1;
  } else if (scenario === "first-app-page" && (args.includes("--paginate") || !args.includes("--limit") || !args.includes("25"))) {
    process.stderr.write("Expected one limited app page.\n");
    process.exitCode = 1;
  } else {
    respond(scenario === "malformed-apps" ? "malformed-apps.json" : "apps.json");
  }
} else if (matches("builds", "list")) {
  respond(scenario === "missing-included" ? "builds-missing-included.json" : "builds.json");
} else if (matches("builds", "info")) {
  respond("build-info.json");
} else if (matches("builds", "add-groups")) {
  respond("add-groups.json");
} else if (matches("versions", "list")) {
  if (scenario === "first-version-page" && (args.includes("--paginate") || !args.includes("--limit") || !args.includes("25"))) {
    process.stderr.write("Expected one limited version page.\n");
    process.exitCode = 1;
  } else {
    respond("versions.json");
  }
} else if (matches("versions", "create")) {
  process.stdout.write('{"id":"version-250"}\n');
} else if (matches("localizations", "list")) {
  respond("localizations.json");
} else if (matches("localizations", "update") || matches("localizations", "create")) {
  process.stdout.write('{"data":{"type":"appStoreVersionLocalizations","id":"localization-en-US","attributes":{"locale":"en-US"}},"links":{"self":"fixture"}}\n');
} else if (matches("screenshots", "list")) {
  if (scenario === "mismatched-screenshot-localization") {
    const payload = JSON.parse(fixture("screenshots.json"));
    payload.versionLocalizationId = "different-localization";
    process.stdout.write(JSON.stringify(payload));
  } else {
    respond("screenshots.json");
  }
} else if (matches("screenshots", "validate") || matches("screenshots", "upload") || matches("screenshots", "delete")) {
  process.stdout.write('{"ok":true}\n');
} else if (matches("validate")) {
  respond("validation.json");
  process.exitCode = 1;
} else if (matches("review", "submit")) {
  respond(args.includes("--dry-run") ? "review-submit-dry-run.json" : "review-submit-confirm.json");
} else if (matches("submit", "status")) {
  respond("submission-status.json");
} else if (matches("testflight", "groups", "list")) {
  if (scenario === "group-list-error") {
    process.stderr.write("Group loading should have been skipped.\n");
    process.exitCode = 1;
  } else {
    respond("groups.json");
  }
} else if (matches("testflight", "groups", "links", "view")) {
  const groupIdIndex = args.indexOf("--group-id");
  const groupId = groupIdIndex === -1 ? "" : args[groupIdIndex + 1];
  const membershipFixture = groupId === "group-team"
    ? "group-team-builds.json"
    : groupId === "group-external"
      ? "group-external-builds.json"
      : "group-empty-builds.json";
  respond(membershipFixture);
} else {
  process.stderr.write("Unsupported fake asc command.\n");
  process.exitCode = 64;
}
