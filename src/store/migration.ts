// The shape of a migration, apart from the runner: `db.ts` applies them and each module
// lists its own, so both import this leaf and neither imports the other.
import type { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  name: string;
  /** A schema change; a change to the data that needs code goes in `run`. */
  sql?: string;
  run?: (db: Database) => void;
}

/** The tables one module owns, versioned apart from the core schema. */
export interface ModuleSchema {
  /** The module's id: the namespace of its versions in `module_migrations`. */
  module: string;
  migrations: readonly Migration[];
}
