// The one check that the knowledge tables are this version's to touch. A leaf: every file
// of the module that reads or writes the tables calls it, and none of them is imported here.
import { moduleSchemaState } from "../../store/db.ts";
import { ModuleSchemaTooNewError } from "./errors.ts";
import { KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION } from "./migrations.ts";
import type { KnowledgeStore } from "./types.ts";

/**
 * Refuses to read or write tables a newer wizardingcode-mem wrote. `openDb` leaves such
 * tables alone so that memory keeps working; the knowledge store must not rewrite rows in
 * a shape it does not know, and that includes a rebuild and a listing, which write too.
 */
export function requireSchema(store: KnowledgeStore): void {
  if (moduleSchemaState(store.db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION) === "too-new") {
    throw new ModuleSchemaTooNewError(KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION);
  }
}
