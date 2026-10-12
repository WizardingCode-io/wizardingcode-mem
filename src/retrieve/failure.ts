import { redact } from "../core/redact.ts";
import { MOMENT_BUDGET } from "../engine/compose.ts";
import type { Db } from "../store/db.ts";
import { retrieveForPrompt } from "./prompt.ts";
import type { Note } from "./render.ts";

const MAX_QUERY_CHARS = 2000;
const MAX_NOTES = 2;

/**
 * The part of a failure worth searching for: redacted (a secret in an error must never
 * reach the search), without the exit-code line or the host's own markers, which every
 * failure shares and which would only add noise.
 */
export function failureQuery(error: string): string {
  const lines = redact(error).split("\n");
  if (lines[0] !== undefined && /^Exit code \d+$/.test(lines[0].trim())) lines.shift();
  return lines
    .filter((line) => !/^\s*Command timed out after\b/.test(line))
    .join("\n")
    .replace(/\.\.\. \[\d+ characters truncated\] \.\.\./g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_CHARS);
}

/**
 * Fixes and gotchas that may bear on a failed command. It is the prompt lookup with the
 * same evidence rule, so an ordinary error sharing one word with a memory injects nothing.
 */
export function notesForFailure(
  db: Db,
  input: {
    projectId: number;
    sessionId: number;
    epoch: number;
    error: string;
    branch: string | null;
    now: number;
    /** Default 1,200 characters. */
    budgetChars?: number;
  },
): Note[] {
  const prompt = failureQuery(input.error);
  if (prompt === "") return [];
  return retrieveForPrompt(db, {
    projectId: input.projectId,
    sessionId: input.sessionId,
    epoch: input.epoch,
    prompt,
    branch: input.branch,
    now: input.now,
    kinds: ["fix", "gotcha"],
    maxNotes: MAX_NOTES,
    budgetChars: input.budgetChars ?? MOMENT_BUDGET["tool-failed"],
  });
}
