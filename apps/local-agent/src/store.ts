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
  }

  async savePlan(plan: MutationPlan) {
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
}
