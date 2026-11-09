// The tables each module owns. `openDb` reads this one list, so every opener, hooks
// included, creates every module's tables without being told, and turning a module on
// later never migrates on a hook. It imports each module's migration list and no module
// code: opening the database loads no module.
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../modules/knowledge/migrations.ts";
import type { ModuleSchema } from "../store/migration.ts";

export const MODULE_SCHEMAS: readonly ModuleSchema[] = [
  { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS },
];
