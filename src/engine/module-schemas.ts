import { KNOWLEDGE_MIGRATIONS } from "../modules/knowledge/migrations.ts";
import type { ModuleSchema } from "../store/db.ts";

// The modules' own tables, applied by `openDb` after the core migrations (ruling K8). A
// leaf on purpose: the store reads it without loading the modules themselves. A module with
// tables lists the same array as its `migrations` (a test holds the two together). Every
// built-in module's tables are created whether or not the module is on: switching it on
// later must not need a migration on the hook path.

export const MODULE_SCHEMAS: readonly ModuleSchema[] = [
  { module: "knowledge", migrations: KNOWLEDGE_MIGRATIONS },
];
