import { searchTokens } from "../../util/words.ts";

// Session artifacts are not knowledge (final review I1, layer 2). The distiller and the
// history import sometimes file a record of what happened in a session (an agent dispatched,
// a review verdict, a pull request opened, the plan for an afternoon) as a convention or a
// decision. Such a memory names the session's own artifacts, or its title copies the prompt
// it came from. Exact, lexical and deliberately narrow: a standing rule that mentions a file
// path or a version number must pass. Pure; no database.

export interface EpisodicPattern {
  /** Named in the proof's report, so that what each pattern dropped can be checked by eye. */
  name: string;
  pattern: RegExp;
}

/**
 * Every pattern, in the order they are tried; the first that matches names the drop (ids
 * before hashes: an agent's id or a UUID holds hex too).
 */
export const EPISODIC_PATTERNS: readonly EpisodicPattern[] = [
  {
    // An agent's, a tool call's or a session's id. The id must hold a digit, so that
    // "session cookies" or "task runner" are not ids.
    name: "agent-id",
    pattern: /\b(?:agent|subagent|task|toolu|session)[-_ ]?(?=[0-9a-z]*\d)[0-9a-z]{6,}\b/i,
  },
  {
    name: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  {
    // A commit hash: 7 to 40 lower-case hex characters with at least one digit and one letter
    // (so neither "2026" nor "facade" is one).
    name: "commit",
    pattern: /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/,
  },
  {
    name: "pull-request",
    pattern:
      /\b(?:PR|MR|pull request|issue)\s*#?\d+\b|(?:^|\s)#\d{2,}\b|\/(?:pull|issues|merge_requests)\/\d+/i,
  },
  {
    // The language of a session's process: who was dispatched, what a review said, how
    // sessions were coordinated, how a check came out, the plan for now.
    name: "process",
    pattern:
      /\b(?:dispatch(?:ed|ing)?|re-?dispatch|subagents?|implementer|reviewer|review verdict|verdict|fix round|round \d+\/\d+|task \d+|wave \d+|(?:opened|merged|closed) (?:a |the )?(?:PR|pull request)|this session|next session|(?:multi|cross)-session|today|tonight|session plan|plan for (?:the|this) session|(?:validation|verification|tests?|build|checks?|review) (?:succeeded|successful|passed|failed))\b/i,
  },
];

/** How much of the prompt's opening a title is compared with. */
const PROMPT_OPENING = 300;
/** A title that is this much a run of the prompt's opening copies it. */
const COPIED_SHARE = 0.8;

/** The longest run of `title`'s tokens that appears, in order and unbroken, in `prompt`'s. */
function longestRun(title: string[], prompt: string[]): number {
  let best = 0;
  let previous = new Array<number>(prompt.length + 1).fill(0);
  for (let i = 1; i <= title.length; i++) {
    const current = new Array<number>(prompt.length + 1).fill(0);
    for (let j = 1; j <= prompt.length; j++) {
      if (title[i - 1] === prompt[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) best = current[j] ?? 0;
      }
    }
    previous = current;
  }
  return best;
}

/**
 * True when the title is a copy of the prompt it came from: it equals the prompt's first
 * line, or 80 % or more of its words are one unbroken run of the prompt's first 300
 * characters. Compared as the full-text index splits words (lower case, accents folded).
 */
export function copiesPrompt(title: string, prompt: string | null): boolean {
  if (prompt === null) return false;
  const words = searchTokens(title);
  if (words.length === 0) return false;
  const firstLine = searchTokens(prompt.split("\n", 1)[0] ?? "");
  if (firstLine.length > 0 && firstLine.join(" ") === words.join(" ")) return true;
  const opening = searchTokens(prompt.slice(0, PROMPT_OPENING));
  return longestRun(words, opening) >= Math.ceil(COPIED_SHARE * words.length);
}

/**
 * Why the memory looks like a record of a session rather than a standing rule: the name of
 * the first pattern its title or body matches, `"prompt-copy"` when its title copies the
 * prompt it came from, or null when it looks like neither.
 */
export function looksEpisodic(title: string, body: string, prompt: string | null): string | null {
  for (const { name, pattern } of EPISODIC_PATTERNS) {
    if (pattern.test(title) || pattern.test(body)) return name;
  }
  return copiesPrompt(title, prompt) ? "prompt-copy" : null;
}
