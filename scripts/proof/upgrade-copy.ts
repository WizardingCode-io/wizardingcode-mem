// The one-time step the first opener pays when a store at sharing v1 meets this release
// (ADR 0027, AC-56): the upgrade runner copies the file (`VACUUM INTO`) before it runs the
// sharing namespace's migration 2 and knowledge's 8, and every other opener waits on the write
// lock for up to 10 s. Measured on a fixture store built here, never on the live one:
//
//   ./node_modules/.bin/bun scripts/proof/upgrade-copy.ts [--memories 40000] [--entries 2000] [--ledger 500] [--keep]
//
// 1. Builds a store at sharing v1 and knowledge v7 in a temporary directory: one project,
//    the memories with bodies of about a kilobyte, the entry rows in the index, the ledger rows.
// 2. Closes it, records its size, and times `openDb` with the current schemas (the upgrade,
//    its copy included), then a second open (the steady cost).
// 3. Prints the figures; with --keep the directory stays.
import type { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../../src/modules/knowledge/migrations.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../../src/sharing/migrations.ts";
import { DB_FILE, openDb } from "../../src/store/db.ts";

const arg = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : Number(process.argv[at + 1]);
};
const MEMORIES = arg("--memories", 40_000);
const ENTRIES = arg("--entries", 2_000);
const LEDGER = arg("--ledger", 500);
const KEEP = process.argv.includes("--keep");

const V1_SCHEMAS = [
  { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS.filter((m) => m.version <= 7) },
  { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS.filter((m) => m.version <= 1) },
];

const dir = mkdtempSync(join(tmpdir(), "wcm-upgrade-copy-"));
const path = join(dir, DB_FILE);
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const sizeOf = (file: string) => (existsSync(file) ? statSync(file).size : 0);

/** A row of a table by its columns: every NOT NULL column without a default filled by type. */
function insertRow(db: Database, table: string, values: Record<string, unknown>): void {
  const columns = db
    .query<
      { name: string; type: string; notnull: number; dflt_value: string | null; pk: number },
      []
    >(`PRAGMA table_info(${table})`)
    .all();
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    if (column.name in values) {
      row[column.name] = values[column.name];
      continue;
    }
    if (column.pk === 1 && /INT/i.test(column.type)) continue;
    if (column.notnull === 1 && column.dflt_value === null)
      row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : "x";
  }
  const names = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    names.map((name) => row[name]) as (string | number | null)[],
  );
}

const body = `${"The queue keeps one lease per worker, and a second worker waits for it. ".repeat(14)}\n`;
const hex = (n: number) => n.toString(16).padStart(8, "0");

// 1. The fixture at sharing v1 and knowledge v7.
const built = performance.now();
const v1 = openDb({ dataDir: dir, busyTimeoutMs: 5000, moduleSchemas: V1_SCHEMAS });
v1.run(
  "INSERT INTO projects (id, key, name, created_at) VALUES (1, 'remote:github.com/acme/site', 'site', 1)",
);
v1.run("INSERT INTO project_aliases (alias, project_id) VALUES ('remote:github.com/acme/site', 1)");
v1.transaction(() => {
  const insert = v1.query(
    `INSERT INTO memories (project_id, kind, title, body, terms, importance, origin, judge, judge_version, created_at, updated_at)
     VALUES (1, 'decision', ?, ?, '', 3, 'distilled', 'heuristic', '1', ?, ?)`,
  );
  for (let i = 0; i < MEMORIES; i++)
    insert.run(`Memory ${i}`, body, 1_700_000_000_000 + i, 1_700_000_000_000 + i);
})();
v1.transaction(() => {
  insertRow(v1, "knowledge_repos", {
    id: 1,
    scope: "project",
    project_id: 1,
    path: "knowledge/projects/5d1af69abf4b6b5e",
  });
  for (let i = 0; i < ENTRIES; i++) {
    insertRow(v1, "knowledge_entries", {
      id: `00000000-0000-4000-8000-${hex(i)}0000`,
      repo_id: 1,
      slug: `entry-${i}`,
      path: `entries/entry-${i}.md`,
      title: `Entry ${i}`,
      kind: "knowledge",
      area: "sales",
      status: "active",
      body: body.slice(0, 400),
      hash: hex(i).repeat(2),
      version: 1,
    });
  }
  for (let i = 0; i < LEDGER; i++) {
    insertRow(v1, "sharing_ledger", {
      destination: "team",
      item_kind: "entry",
      item_uid: `project:remote:github.com/acme/site:00000000-0000-4000-8000-${hex(i)}0000`,
      direction: "sent",
      version: 1,
      hash: hex(i).repeat(2),
      policy_epoch: 1,
      at: 1_700_000_000_000 + i,
    });
  }
})();
v1.run("PRAGMA wal_checkpoint(TRUNCATE)");
v1.close();
const size = sizeOf(path) + sizeOf(`${path}-wal`);
console.log(
  `fixture: ${MEMORIES.toLocaleString("en-GB")} memories, ${ENTRIES.toLocaleString("en-GB")} entries, ${LEDGER} ledger rows, ${mb(size)}, built in ${Math.round(performance.now() - built)} ms`,
);

// 2. The first open with the current schemas: the copy, then the two migrations.
const first = performance.now();
const upgraded = openDb({ dataDir: dir, busyTimeoutMs: 5000 });
const firstMs = performance.now() - first;
const copies = existsSync(join(dir, "backups"))
  ? readdirSync(join(dir, "backups")).filter((name) => name.endsWith(".db"))
  : [];
const indexes = upgraded
  .query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('sharing_memories_updated', 'sharing_memories_superseded', 'sharing_ledger_applied', 'knowledge_received_project', 'knowledge_received_fts', 'knowledge_entries_id')",
  )
  .all()
  .map((row) => row.name);
upgraded.close();
const second = performance.now();
openDb({ dataDir: dir, busyTimeoutMs: 5000 }).close();
const secondMs = performance.now() - second;

console.log(`first open (the upgrade, its copy included): ${Math.round(firstMs)} ms`);
console.log(
  `upgrade copies written: ${copies.length === 0 ? "none" : copies.map((name) => `${name} (${mb(sizeOf(join(dir, "backups", name)))})`).join(", ")}`,
);
console.log(`indexes after the upgrade: ${indexes.join(", ")}`);
console.log(`second open: ${Math.round(secondMs)} ms`);
console.log(
  `bar: 10,000 ms (what another opener waits); ${firstMs <= 10_000 ? "within it" : "OVER it: open the store once from a shell before the session"}`,
);
if (KEEP) console.log(`kept: ${dir}`);
else rmSync(dir, { recursive: true, force: true });
