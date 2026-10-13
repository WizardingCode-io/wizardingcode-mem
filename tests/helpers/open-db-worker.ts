// Opens (and therefore migrates) the database in the given directory, then exits.
// With --extra-migration, pretends a later release added a migration.
import { MIGRATIONS, openDb } from "../../src/store/db.ts";

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: open-db-worker <data-dir> [--extra-migration]");
const migrations = process.argv.includes("--extra-migration")
  ? [
      ...MIGRATIONS,
      {
        version: MIGRATIONS.length + 1,
        name: "fake",
        sql: "CREATE TABLE fake_next (id INTEGER PRIMARY KEY);",
      },
    ]
  : MIGRATIONS;
openDb({ dataDir: dir, busyTimeoutMs: 100, migrations }).close();
