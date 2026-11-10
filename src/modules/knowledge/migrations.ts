import type { Migration } from "../../store/migration.ts";
import knowledgeStore from "./migrations/0006_knowledge_store.sql" with { type: "text" };
import knowledgeAgent from "./migrations/0007_knowledge_agent.sql" with { type: "text" };

export const KNOWLEDGE_MODULE = "knowledge";

/**
 * Versions 1 to 5 of this module id belong to the module withdrawn before 0.6.0 (ADR 0020):
 * a store that ran it still holds those rows, for other tables. This module starts at 6.
 */
export const KNOWLEDGE_SCHEMA_VERSION = 7;

/** Forward-only, like the core's. */
export const KNOWLEDGE_MIGRATIONS: readonly Migration[] = [
  { version: 6, name: "knowledge_store", sql: knowledgeStore },
  { version: 7, name: "knowledge_agent", sql: knowledgeAgent },
];
