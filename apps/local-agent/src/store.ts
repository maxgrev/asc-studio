import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuditEventSchema, MutationPlanSchema, type AuditEvent, type MutationPlan } from "@asc-studio/contracts";
import type { PlanStore } from "@asc-studio/core";

export class SqlitePlanStore implements PlanStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS mutation_plans (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS portfolio_analytics_plan_markers (
        plan_id TEXT PRIMARY KEY,
        issuer_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES mutation_plans(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        operation TEXT NOT NULL,
        phase TEXT NOT NULL,
        target TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    // Migrate markers written by the initial multi-account implementation. Both
    // stores use this same SQLite file, but new V2 writes are deliberately kept
    // in the plan-store transaction below so a raw plan can never exist without
    // its fail-closed public marker.
    if (this.hasTable("analytics_portfolio_plans")) {
      this.database.exec(`
        INSERT OR IGNORE INTO portfolio_analytics_plan_markers (plan_id, issuer_id, created_at)
        SELECT legacy.plan_id, legacy.issuer_id, legacy.created_at
        FROM analytics_portfolio_plans AS legacy
        JOIN mutation_plans AS plans ON plans.id = legacy.plan_id
      `);
    }
  }

  async savePlan(plan: MutationPlan) {
    this.writePlan(plan);
  }

  async savePortfolioAnalyticsPlan(plan: MutationPlan, issuerId: string) {
    if (plan.operation !== "analytics.report_request.create") {
      throw new TypeError("Only Analytics report-request plans can use the portfolio plan marker.");
    }
    if (!issuerId.trim()) throw new TypeError("Portfolio Analytics issuer ID must not be empty.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.writePlan(plan);
      this.database.prepare(`
        INSERT INTO portfolio_analytics_plan_markers (plan_id, issuer_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(plan_id) DO UPDATE SET
          issuer_id = excluded.issuer_id,
          created_at = excluded.created_at
      `).run(plan.id, issuerId, plan.createdAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getPortfolioAnalyticsPlanIssuer(planId: string): string | null {
    const row = this.database.prepare(`
      SELECT issuer_id FROM portfolio_analytics_plan_markers WHERE plan_id = ?
    `).get(planId) as Record<string, unknown> | undefined;
    if (row) return String(row.issuer_id);
    // Fail closed for workspaces created by builds that used the legacy marker
    // table. The constructor migrates it when present; this fallback also covers
    // an unusual mixed-version startup order.
    if (!this.hasTable("analytics_portfolio_plans")) return null;
    const legacy = this.database.prepare(`
      SELECT issuer_id FROM analytics_portfolio_plans WHERE plan_id = ?
    `).get(planId) as Record<string, unknown> | undefined;
    return legacy ? String(legacy.issuer_id) : null;
  }

  async getPlan(id: string): Promise<MutationPlan | null> {
    const row = this.database
      .prepare("SELECT plan_json FROM mutation_plans WHERE id = ?")
      .get(id);
    if (!row) return null;
    if (typeof row.plan_json !== "string") throw new TypeError("Stored mutation plan is not JSON text.");
    return MutationPlanSchema.parse(JSON.parse(row.plan_json));
  }

  async listPlans(state: MutationPlan["state"], limit: number): Promise<MutationPlan[]> {
    const rows = this.database
      .prepare(`
        SELECT plan_json
        FROM mutation_plans
        WHERE state = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `)
      .all(state, limit);
    return rows.map((row) => {
      if (typeof row.plan_json !== "string") throw new TypeError("Stored mutation plan is not JSON text.");
      return MutationPlanSchema.parse(JSON.parse(row.plan_json));
    });
  }

  async listNonPortfolioPlans(state: MutationPlan["state"], limit: number): Promise<MutationPlan[]> {
    const rows = this.database.prepare(`
      SELECT plans.plan_json
      FROM mutation_plans AS plans
      LEFT JOIN portfolio_analytics_plan_markers AS markers ON markers.plan_id = plans.id
      WHERE plans.state = ? AND markers.plan_id IS NULL
      ORDER BY plans.updated_at DESC
      LIMIT ?
    `).all(state, limit);
    return rows.map((row) => {
      if (typeof row.plan_json !== "string") throw new TypeError("Stored mutation plan is not JSON text.");
      return MutationPlanSchema.parse(JSON.parse(row.plan_json));
    });
  }

  async listPortfolioAnalyticsPlans(
    state: MutationPlan["state"],
    limit: number,
  ): Promise<Array<{ plan: MutationPlan; issuerId: string }>> {
    const rows = this.database.prepare(`
      SELECT plans.plan_json, markers.issuer_id
      FROM mutation_plans AS plans
      JOIN portfolio_analytics_plan_markers AS markers ON markers.plan_id = plans.id
      WHERE plans.state = ?
      ORDER BY plans.updated_at DESC
      LIMIT ?
    `).all(state, limit);
    return rows.map((row) => {
      if (typeof row.plan_json !== "string") throw new TypeError("Stored mutation plan is not JSON text.");
      return {
        plan: MutationPlanSchema.parse(JSON.parse(row.plan_json)),
        issuerId: String(row.issuer_id),
      };
    });
  }

  expirePortfolioAnalyticsPlans(now: string) {
    if (Number.isNaN(Date.parse(now))) throw new TypeError("Portfolio plan expiry time must be an ISO-compatible timestamp.");
    let expiredCount = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database.prepare(`
        SELECT plans.plan_json
        FROM mutation_plans AS plans
        JOIN portfolio_analytics_plan_markers AS markers ON markers.plan_id = plans.id
        WHERE plans.state = 'awaiting_confirmation'
      `).all();
      for (const row of rows) {
        if (typeof row.plan_json !== "string") throw new TypeError("Stored mutation plan is not JSON text.");
        const plan = MutationPlanSchema.parse(JSON.parse(row.plan_json));
        if (Date.parse(plan.expiresAt) > Date.parse(now)) continue;
        this.writePlan({
          ...plan,
          state: "expired",
          error: "The confirmation window expired.",
        });
        expiredCount += 1;
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return expiredCount;
  }

  async claimPlan(id: string, expectedState: MutationPlan["state"], next: MutationPlan) {
    const result = this.database
      .prepare(`
        UPDATE mutation_plans
        SET state = ?, plan_json = ?, updated_at = ?
        WHERE id = ? AND state = ?
      `)
      .run(next.state, JSON.stringify(next), new Date().toISOString(), id, expectedState);
    return result.changes === 1;
  }

  async appendAudit(event: Omit<AuditEvent, "sequence">): Promise<AuditEvent> {
    const result = this.database
      .prepare(`
        INSERT INTO audit_events (id, timestamp, actor, operation, phase, target, summary, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(event.id, event.timestamp, event.actor, event.operation, event.phase, event.target, event.summary, event.status);
    return { ...event, sequence: Number(result.lastInsertRowid) };
  }

  async listAudit(limit: number): Promise<AuditEvent[]> {
    const rows = this.database
      .prepare(`
        SELECT id, sequence, timestamp, actor, operation, phase, target, summary, status
        FROM audit_events
        ORDER BY sequence DESC
        LIMIT ?
      `)
      .all(limit);
    return rows.map((row) => AuditEventSchema.parse(row));
  }

  close() {
    this.database.close();
  }

  private writePlan(plan: MutationPlan) {
    this.database
      .prepare(`
        INSERT INTO mutation_plans (id, state, plan_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          plan_json = excluded.plan_json,
          updated_at = excluded.updated_at
      `)
      .run(plan.id, plan.state, JSON.stringify(plan), new Date().toISOString());
  }

  private hasTable(name: string) {
    const row = this.database.prepare(`
      SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(name) as Record<string, unknown> | undefined;
    return row !== undefined;
  }
}
