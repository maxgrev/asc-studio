import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuditEvent, MutationPlan } from "@asc-studio/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SqlitePlanStore } from "./store.js";

const plan: MutationPlan = {
  id: "plan-1",
  operation: "build.add_to_group",
  risk: "mutation",
  state: "awaiting_confirmation",
  createdAt: "2026-07-31T19:00:00.000Z",
  expiresAt: "2026-07-31T19:10:00.000Z",
  digest: "digest-1",
  summary: "Add build 2.4.0 (204) to QA",
  context: { profile: "Demo workspace", connectionId: "demo", appleAdsAdAccountId: null, appleAdsMode: null },
  target: {
    appId: "app-1",
    buildId: "build-204",
    buildLabel: "2.4.0 (204)",
    groupId: "group-qa",
    groupName: "QA",
  },
  before: { groupIds: ["group-team"] },
  after: { groupIds: ["group-qa", "group-team"] },
  error: null,
};

const portfolioAnalyticsPlan: MutationPlan = {
  id: "portfolio-analytics-plan-1",
  operation: "analytics.report_request.create",
  risk: "mutation",
  state: "awaiting_confirmation",
  createdAt: "2026-08-30T19:00:00.000Z",
  expiresAt: "2026-08-30T19:10:00.000Z",
  digest: "portfolio-analytics-digest-1",
  summary: "Create a one-time Analytics report request for Field Log.",
  context: {
    profile: "Inactive reports key",
    connectionId: "raw-inactive-connection",
    appleAdsAdAccountId: null,
    appleAdsMode: null,
  },
  target: {
    appId: "raw-inactive-app",
    appName: "Field Log",
    accessType: "ONE_TIME_SNAPSHOT",
  },
  before: {
    matchingReportRequestIds: [],
    activeOngoingReportRequestIds: [],
  },
  after: {
    appId: "raw-inactive-app",
    accessType: "ONE_TIME_SNAPSHOT",
  },
  error: null,
};

const audit: Omit<AuditEvent, "sequence"> = {
  id: "event-1",
  timestamp: "2026-07-31T19:00:00.000Z",
  actor: "gui",
  operation: "build.add_to_group",
  phase: "planned",
  target: "build-204",
  summary: plan.summary,
  status: "info",
};

const temporaryDirectories: string[] = [];

const createDatabasePath = () => {
  const directory = mkdtempSync(join(tmpdir(), "asc-studio-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "store.sqlite");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SqlitePlanStore", () => {
  it("round-trips plans and audit events", async () => {
    const store = new SqlitePlanStore(createDatabasePath());

    await store.savePlan(plan);
    const storedEvent = await store.appendAudit(audit);

    expect(await store.getPlan(plan.id)).toEqual(plan);
    expect(storedEvent).toEqual({ ...audit, sequence: 1 });
    expect(await store.listAudit(10)).toEqual([storedEvent]);
    store.close();
  });

  it("allows only one store connection to claim a plan", async () => {
    const path = createDatabasePath();
    const firstStore = new SqlitePlanStore(path);
    const secondStore = new SqlitePlanStore(path);
    const running = { ...plan, state: "running" as const };
    await firstStore.savePlan(plan);

    const results = await Promise.all([
      firstStore.claimPlan(plan.id, "awaiting_confirmation", running),
      secondStore.claimPlan(plan.id, "awaiting_confirmation", running),
    ]);

    expect(results.sort()).toEqual([false, true]);
    expect(await firstStore.getPlan(plan.id)).toEqual(running);
    firstStore.close();
    secondStore.close();
  });

  it("commits a portfolio Analytics plan and its V2 marker atomically and rolls both back on marker failure", async () => {
    const path = createDatabasePath();
    const firstStore = new SqlitePlanStore(path);
    await firstStore.savePortfolioAnalyticsPlan(portfolioAnalyticsPlan, "raw-inactive-issuer");

    const reopened = new SqlitePlanStore(path);
    expect(await reopened.getPlan(portfolioAnalyticsPlan.id)).toEqual(portfolioAnalyticsPlan);
    expect(reopened.getPortfolioAnalyticsPlanIssuer(portfolioAnalyticsPlan.id)).toBe("raw-inactive-issuer");
    firstStore.close();
    reopened.close();

    const rollbackPath = createDatabasePath();
    const rollbackStore = new SqlitePlanStore(rollbackPath);
    const triggerWriter = new DatabaseSync(rollbackPath);
    triggerWriter.exec(`
      CREATE TRIGGER reject_portfolio_analytics_marker
      BEFORE INSERT ON portfolio_analytics_plan_markers
      BEGIN
        SELECT RAISE(ABORT, 'fixture marker failure');
      END;
    `);
    triggerWriter.close();

    await expect(rollbackStore.savePortfolioAnalyticsPlan(
      { ...portfolioAnalyticsPlan, id: "portfolio-analytics-plan-rollback" },
      "raw-inactive-issuer",
    )).rejects.toThrow("fixture marker failure");
    expect(await rollbackStore.getPlan("portfolio-analytics-plan-rollback")).toBeNull();
    expect(rollbackStore.getPortfolioAnalyticsPlanIssuer("portfolio-analytics-plan-rollback")).toBeNull();
    rollbackStore.close();
  });

  it("persists expired portfolio plans once and keeps a valid pending sibling after reopen", async () => {
    const path = createDatabasePath();
    const store = new SqlitePlanStore(path);
    const expired = {
      ...portfolioAnalyticsPlan,
      id: "expired-portfolio-analytics-plan",
      expiresAt: "2026-08-30T18:59:59.000Z",
    } satisfies MutationPlan;
    const valid = {
      ...portfolioAnalyticsPlan,
      id: "valid-portfolio-analytics-plan",
      expiresAt: "2030-08-30T19:10:00.000Z",
    } satisfies MutationPlan;
    await store.savePortfolioAnalyticsPlan(expired, "raw-inactive-issuer");
    await store.savePortfolioAnalyticsPlan(valid, "raw-inactive-issuer");

    expect(store.expirePortfolioAnalyticsPlans("2026-08-30T19:00:00.000Z")).toBe(1);
    expect(await store.getPlan(expired.id)).toMatchObject({
      state: "expired",
      error: "The confirmation window expired.",
    });
    expect((await store.listPortfolioAnalyticsPlans("awaiting_confirmation", 50)).map(({ plan }) => plan.id))
      .toEqual([valid.id]);
    expect(store.getPortfolioAnalyticsPlanIssuer(expired.id)).toBe("raw-inactive-issuer");
    store.close();

    const reopened = new SqlitePlanStore(path);
    expect(reopened.expirePortfolioAnalyticsPlans("2026-08-30T19:00:00.000Z")).toBe(0);
    expect(await reopened.getPlan(expired.id)).toMatchObject({
      state: "expired",
      error: "The confirmation window expired.",
    });
    expect((await reopened.listPortfolioAnalyticsPlans("awaiting_confirmation", 50)).map(({ plan }) => plan.id))
      .toEqual([valid.id]);
    reopened.close();
  });

  it("rejects a stored plan that does not match the shared schema", async () => {
    const path = createDatabasePath();
    const store = new SqlitePlanStore(path);
    const writer = new DatabaseSync(path);
    writer.prepare(`
      INSERT INTO mutation_plans (id, state, plan_json, updated_at)
      VALUES (?, ?, ?, ?)
    `).run("invalid-plan", "awaiting_confirmation", JSON.stringify({ ...plan, id: 42 }), plan.createdAt);
    writer.close();

    await expect(store.getPlan("invalid-plan")).rejects.toThrow();
    store.close();
  });

  it("rejects an audit row that does not match the shared schema", async () => {
    const path = createDatabasePath();
    const store = new SqlitePlanStore(path);
    const writer = new DatabaseSync(path);
    writer.prepare(`
      INSERT INTO audit_events (id, timestamp, actor, operation, phase, target, summary, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("invalid-event", audit.timestamp, "unknown", audit.operation, audit.phase, audit.target, audit.summary, audit.status);
    writer.close();

    await expect(store.listAudit(10)).rejects.toThrow();
    store.close();
  });
});
