// The sharing policy's tables, as `openDb` reads them. Every opener loads this file, hooks
// included, so it imports the migration's shape and nothing else of the sharing code.
import type { Database } from "bun:sqlite";
import type { Migration } from "../store/migration.ts";
import sharingPolicy from "./migrations/0001_sharing_policy.sql" with { type: "text" };
import sharingServers from "./migrations/0002_sharing_servers.sql" with { type: "text" };

/** The namespace of these tables' versions in `module_migrations`. It is not an engine module. */
export const SHARING_MODULE = "sharing";

export const SHARING_SCHEMA_VERSION = 2;

/**
 * The `meta` key of the store's generation, which scopes a memory's identity on this
 * machine: a restore brings back a copy whose later row ids go to other memories, and
 * renews the generation so that the two lives of an id are two items.
 */
export const GENERATION_KEY = "sharing.generation";

/** Eight hex characters from four random bytes. */
export function newGeneration(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A store's first generation; one that is already there is kept. */
function mintGeneration(db: Database): void {
  db.run("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", [
    GENERATION_KEY,
    newGeneration(),
  ]);
}

/** The tests' switch that makes a named migration's `run` fail, to prove the rollback. */
const FAIL_SWITCH = "WIZARDINGCODE_MEM_TEST_FAIL_MIGRATION";

/**
 * A project may be bound to one server at most (ADR 0027): before the index that holds it,
 * a project with more than one row above Nothing keeps its `team` row, else the row with the
 * lowest destination in byte order (the table has no rowid), and each removed row is logged
 * as a system change. The index is created here, after the resolve, never in the file.
 */
function oneServerPerProject(db: Database): void {
  if (process.env[FAIL_SWITCH] === `${SHARING_MODULE}:2`) {
    throw new Error("test: migration refused");
  }
  const bound = db
    .query<{ project_id: number; destination: string; level: string }, []>(
      "SELECT project_id, destination, level FROM sharing_levels WHERE level != 'local' ORDER BY project_id, destination",
    )
    .all();
  const byProject = new Map<number, { destination: string; level: string }[]>();
  for (const row of bound) {
    const rows = byProject.get(row.project_id) ?? [];
    rows.push({ destination: row.destination, level: row.level });
    byProject.set(row.project_id, rows);
  }
  const now = Date.now();
  for (const [projectId, rows] of byProject) {
    if (rows.length < 2) continue;
    const kept = rows.find((row) => row.destination === "team") ?? rows[0];
    for (const row of rows) {
      if (row === kept) continue;
      db.run("DELETE FROM sharing_levels WHERE project_id = ? AND destination = ?", [
        projectId,
        row.destination,
      ]);
      db.run(
        "INSERT INTO sharing_changes (at, source, what, old, new) VALUES (?, 'system', ?, ?, 'local')",
        [now, `project:${projectId}@${row.destination}`, row.level],
      );
    }
  }
  db.run(
    "CREATE UNIQUE INDEX sharing_levels_one_server ON sharing_levels(project_id) WHERE level != 'local' AND destination != 'team'",
  );
}

/** Forward-only, like the core's. */
export const SHARING_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "sharing_policy", sql: sharingPolicy, run: mintGeneration },
  { version: 2, name: "sharing_servers", sql: sharingServers, run: oneServerPerProject },
];
