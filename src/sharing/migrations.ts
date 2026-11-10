// The sharing policy's tables, as `openDb` reads them. Every opener loads this file, hooks
// included, so it imports the migration's shape and nothing else of the sharing code.
import type { Database } from "bun:sqlite";
import type { Migration } from "../store/migration.ts";
import sharingPolicy from "./migrations/0001_sharing_policy.sql" with { type: "text" };

/** The namespace of these tables' versions in `module_migrations`. It is not an engine module. */
export const SHARING_MODULE = "sharing";

export const SHARING_SCHEMA_VERSION = 1;

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

/** Forward-only, like the core's. */
export const SHARING_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "sharing_policy", sql: sharingPolicy, run: mintGeneration },
];
