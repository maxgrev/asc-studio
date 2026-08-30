import { describe, expect, it } from "vitest";
import { AnalyticsPortfolioCatalogResponseSchema } from "./index.js";

const accountA = {
  id: "portfolio-account-a",
  profileName: "Studio A",
  active: true,
  state: "READY" as const,
  appCount: 0,
  detail: "Connected.",
};

const accountB = {
  ...accountA,
  id: "portfolio-account-b",
  profileName: "Studio B",
  active: false,
};

const sourceA = {
  id: "portfolio-source-a",
  accounts: [accountA],
  state: "READY" as const,
  appCount: 0,
  lastDiscoveredAt: "2026-08-30T12:00:00.000Z",
  detail: "This organization currently has no apps.",
};

const sourceB = {
  ...sourceA,
  id: "portfolio-source-b",
  accounts: [accountB],
};

const catalog = {
  schemaVersion: 2,
  catalogRevision: "catalog-revision-a",
  complete: true,
  generatedAt: "2026-08-30T12:00:00.000Z",
  sources: [sourceA, sourceB],
  apps: [],
};

describe("analytics portfolio catalog identity", () => {
  it("rejects duplicate public source IDs", () => {
    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse(catalog).success).toBe(true);
    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse({
      ...catalog,
      sources: [sourceA, { ...sourceB, id: sourceA.id }],
    }).success).toBe(false);
  });

  it("rejects duplicate public account IDs across sources", () => {
    expect(AnalyticsPortfolioCatalogResponseSchema.safeParse({
      ...catalog,
      sources: [sourceA, {
        ...sourceB,
        accounts: [{ ...accountB, id: accountA.id }],
      }],
    }).success).toBe(false);
  });
});
