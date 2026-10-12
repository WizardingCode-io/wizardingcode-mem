import type { ModuleMigration } from "../../store/db.ts";
import knowledge from "./migrations/0001_knowledge.sql" with { type: "text" };
import shown from "./migrations/0002_knowledge_shown.sql" with { type: "text" };
import proposals from "./migrations/0003_proposals.sql" with { type: "text" };

/** Knowledge's own tables (ruling K8). Forward-only; never edited once released. */
export const KNOWLEDGE_MIGRATIONS: readonly ModuleMigration[] = [
  { version: 1, name: "knowledge", sql: knowledge },
  { version: 2, name: "knowledge_shown", sql: shown },
  { version: 3, name: "proposals", sql: proposals },
];
