// The server's instance and the high-water file: how a database restored from an older copy
// is told from the live one, and what happens when it is (D-13).
import { readFileSync } from "node:fs";
import { writeFileAtomic } from "../modules/knowledge/repo.ts";
import type { Db } from "./db.ts";
import { newHexId } from "./ids.ts";
import {
  type AuditSource,
  advanceSequence,
  insertAudit,
  sequenceHighWater,
  setMeta,
  transaction,
} from "./store.ts";

/** The two `AUTOINCREMENT` high-waters the file records. */
export type Marks = { changes: number; audit: number };

/** How far the feed's sequence jumps at a renewal, so no new row reuses a number a client passed. */
export const SEQUENCE_MARGIN = 1_000_000;

/** Zeros without the file, or with one that is not what the server wrote. */
export function readHighWater(feedFile: string): Marks {
  try {
    const parsed = JSON.parse(readFileSync(feedFile, "utf8")) as {
      changes?: unknown;
      audit?: unknown;
    };
    const changes = typeof parsed.changes === "number" && parsed.changes >= 0 ? parsed.changes : 0;
    const audit = typeof parsed.audit === "number" && parsed.audit >= 0 ? parsed.audit : 0;
    return { changes, audit };
  } catch {
    return { changes: 0, audit: 0 };
  }
}

/** Written whole and renamed into place, so a reader never sees half a file. */
export function writeHighWater(feedFile: string, marks: Marks): void {
  writeFileAtomic(feedFile, `${JSON.stringify(marks)}\n`);
}

export function currentMarks(db: Db): Marks {
  return { changes: sequenceHighWater(db, "changes"), audit: sequenceHighWater(db, "audit") };
}

/**
 * A new instance: every client that sees it pulls from zero. In one transaction the feed's
 * sequence moves to `floor + SEQUENCE_MARGIN` and the audit records it; then the file is
 * rewritten with the database's marks. Returns the new instance id.
 */
export function renewInstance(
  db: Db,
  feedFile: string,
  now: number,
  source: AuditSource,
  floor: number,
  detail = "",
): string {
  const instance = newHexId();
  transaction(db, () => {
    setMeta(db, "server.instance", instance);
    advanceSequence(db, "changes", floor + SEQUENCE_MARGIN);
    insertAudit(db, { at: now, source, action: "instance renewed", target: instance, detail });
  });
  writeHighWater(feedFile, currentMarks(db));
  return instance;
}

/**
 * At start: a file ahead of the database on either mark means the database was restored
 * from an older copy, and the instance is renewed; a database ahead of the file (the file
 * lost, or never written) rewrites the file. The caller logs what came back.
 */
export function checkRestore(
  db: Db,
  feedFile: string,
  now: number,
): { renewed: boolean; file: Marks; db: Marks } {
  const file = readHighWater(feedFile);
  const current = currentMarks(db);
  if (file.changes > current.changes || file.audit > current.audit) {
    const floor = Math.max(file.changes, current.changes);
    const detail = `file changes=${file.changes} audit=${file.audit}; database changes=${current.changes} audit=${current.audit}`;
    insertAudit(db, { at: now, source: "system", action: "restore detected", detail });
    renewInstance(db, feedFile, now, "system", floor, detail);
    return { renewed: true, file, db: current };
  }
  if (current.changes > file.changes || current.audit > file.audit)
    writeHighWater(feedFile, current);
  return { renewed: false, file, db: current };
}
