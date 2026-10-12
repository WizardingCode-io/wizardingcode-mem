// Opens (and therefore migrates) the database in the given directory, then exits.
// With --extra-migration, pretends a later release added a migration.
// With --module-migration, adds a module with one migration that fails if applied twice.
import { MODULE_SCHEMAS } from "../../src/engine/module-schemas.ts";
import { MIGRATIONS, openDb } from "../../src/store/db.ts";

const dir = process.argv[2];
if (dir === undefined) {
  throw new Error("usage: open-db-worker <data-dir> [--extra-migration] [--module-migration]");
}
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
const moduleMigrations = process.argv.includes("--module-migration")
  ? [
      ...MODULE_SCHEMAS,
      {
        module: "fake",
        migrations: [
          { version: 1, name: "one", sql: "CREATE TABLE fake_module (id INTEGER PRIMARY KEY);" },
        ],
      },
    ]
  : MODULE_SCHEMAS;
openDb({ dataDir: dir, busyTimeoutMs: 100, migrations, moduleMigrations }).close();
