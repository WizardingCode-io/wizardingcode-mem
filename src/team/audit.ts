// The audit: one row per act that changes who may do what, or what the server holds.
import type { Db } from "./db.ts";
import { type AuditRow, insertAudit, listAudit } from "./store.ts";

export type AuditSource = "api" | "cli" | "bootstrap" | "system";

export type { AuditRow };

export function audit(
  db: Db,
  row: {
    at: number;
    source: AuditSource;
    deviceId?: string | null;
    address?: string | null;
    action: string;
    target?: string | null;
    detail?: string;
  },
): void {
  insertAudit(db, row);
}

const AUDIT_LIMIT_DEFAULT = 50;
const AUDIT_LIMIT_MAX = 1000;

/** The newest rows first; `limit` 1 to 1000, clamped, 50 by default. */
export function readAudit(db: Db, limit?: number): AuditRow[] {
  const wanted = Number.isFinite(limit) ? Math.trunc(limit as number) : AUDIT_LIMIT_DEFAULT;
  return listAudit(db, Math.min(AUDIT_LIMIT_MAX, Math.max(1, wanted)));
}
