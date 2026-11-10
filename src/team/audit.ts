// The audit's reader: the newest rows first, the limit clamped. The rows are written through
// the store's `insertAudit`, with the sources the store names.
import type { Db } from "./db.ts";
import { type AuditRow, listAudit } from "./store.ts";

export type { AuditRow };

const AUDIT_LIMIT_DEFAULT = 50;
const AUDIT_LIMIT_MAX = 1000;

/** The newest rows first; `limit` 1 to 1000, clamped, 50 by default. */
export function readAudit(db: Db, limit?: number): AuditRow[] {
  const wanted = Number.isFinite(limit) ? Math.trunc(limit as number) : AUDIT_LIMIT_DEFAULT;
  return listAudit(db, Math.min(AUDIT_LIMIT_MAX, Math.max(1, wanted)));
}
