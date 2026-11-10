// The tables each module owns. `openDb` reads this one list, so every opener, hooks
// included, creates every module's tables without being told, and turning a module on
// later never migrates on a hook. It imports each module's migration list and no module
// code: opening the database loads no module. The sharing policy's tables are listed
// too: they belong to no module (no contribution, no tools), and this list is the one
// place that knows their namespace.
import { KNOWLEDGE_MIGRATIONS, KNOWLEDGE_MODULE } from "../modules/knowledge/migrations.ts";
import { SHARING_MIGRATIONS, SHARING_MODULE } from "../sharing/migrations.ts";
import type { ModuleSchema } from "../store/migration.ts";

export const MODULE_SCHEMAS: readonly ModuleSchema[] = [
  { module: KNOWLEDGE_MODULE, migrations: KNOWLEDGE_MIGRATIONS },
  { module: SHARING_MODULE, migrations: SHARING_MIGRATIONS },
];
