import { isFromTheHost } from "../../core/host-prompt.ts";
import type { EngineModule, MomentInput } from "../../engine/module.ts";
import { buildQuery } from "../../retrieve/query.ts";
import type { Db } from "../../store/db.ts";
import type { KnowledgeEntry } from "./files.ts";
import { essentialEntries, searchKnowledge } from "./index-store.ts";
import { KNOWLEDGE_MIGRATIONS } from "./migrations.ts";
import { freshenForHook } from "./refresh.ts";
import { isRelevant } from "./relevance.ts";
import { renderEssential, renderRelevant } from "./render.ts";

// Knowledge as a module: the project's curated entries (its `.wizardingcode/knowledge`
// folder) put in front of the agent, the essential ones at session start and the relevant
// ones on a prompt, within a fifth of each budget (K4), each at most once per context.
// With no folder it costs one `stat` and says nothing, so memory keeps its whole budget.

/** At most this many entries beside one prompt. */
const MAX_PER_PROMPT = 2;
/** Candidates read from the index for a prompt, best first, before the floor and the filters. */
const CANDIDATES = 10;

type Moment = "session-start" | "prompt";

/** The entries this context has already been shown, by slug. */
function alreadyShown(db: Db, input: MomentInput): Set<string> {
  return new Set(
    db
      .query<{ slug: string }, [number, number, number]>(
        `SELECT slug FROM knowledge_shown
          WHERE session_id = ? AND context_epoch = ? AND project_id = ?`,
      )
      .all(input.sessionId, input.epoch, input.projectId)
      .map((row) => row.slug),
  );
}

function recordShown(
  db: Db,
  input: MomentInput,
  moment: Moment,
  entries: readonly KnowledgeEntry[],
): void {
  const insert = db.query(
    `INSERT OR IGNORE INTO knowledge_shown (session_id, context_epoch, project_id, slug, event, at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const entry of entries) {
    insert.run(input.sessionId, input.epoch, input.projectId, entry.slug, moment, input.now);
  }
}

function atStart(input: MomentInput): string | null {
  const { db } = input;
  const seen = alreadyShown(db, input);
  const entries = essentialEntries(db, input.projectId).filter((entry) => !seen.has(entry.slug));
  const { text, shown } = renderEssential(entries, input.budgetChars);
  // Measured before recorded (F6): only what is in the text counts as shown.
  if (shown.length === 0) return null;
  recordShown(db, input, "session-start", shown);
  return text;
}

function onPrompt(input: MomentInput): string | null {
  const { db, prompt } = input;
  if (prompt === null || isFromTheHost(prompt)) return null;
  const query = buildQuery(prompt);
  if (query === null) return null;
  const seen = alreadyShown(db, input);
  const relevant = searchKnowledge(db, input.projectId, prompt, CANDIDATES)
    .filter((entry) => entry.status === "active" && !seen.has(entry.slug))
    .filter((entry) => isRelevant(entry, query))
    .slice(0, MAX_PER_PROMPT);
  const { text, shown } = renderRelevant(relevant, input.budgetChars);
  if (shown.length === 0) return null;
  recordShown(db, input, "prompt", shown);
  return text;
}

function contribute(input: MomentInput): string | null {
  if (input.moment !== "session-start" && input.moment !== "prompt") return null;
  if (input.budgetChars <= 0) return null;
  // No folder: nothing more than this one look at the disk.
  if (!freshenForHook(input.db, input.projectId, input.projectRoot)) return null;
  return input.moment === "session-start" ? atStart(input) : onPrompt(input);
}

export const knowledge: EngineModule = {
  id: "knowledge",
  name: "Knowledge",
  // A fifth of session start and prompt; file reads and failures get nothing (K4).
  share: 0.2,
  contribute,
  // Loaded only when a server or the bridge asks: the hooks never pay for zod or the tools.
  tools: async (mode) => (await import("./tools.ts")).knowledgeTools(mode),
  migrations: KNOWLEDGE_MIGRATIONS,
};
