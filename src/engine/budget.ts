import type { Moment } from "./module.ts";

// A leaf: retrieval reads these defaults without loading the composer.

/**
 * Characters each moment may add to the agent's context, shared by every module. These
 * are the budgets memory had for each moment before there were modules, and its
 * retrieval's defaults.
 */
export const MOMENT_BUDGET: Readonly<Record<Moment, number>> = {
  /** About 1,200 tokens, and well under the size at which hosts stop showing hook output. */
  "session-start": 4200,
  /** About 700 tokens. */
  prompt: 2400,
  /** About 350 tokens: a file read is frequent, so each one gets little room. */
  "file-read": 1200,
  /** About 350 tokens: a failure can repeat, so each one gets little room. */
  "tool-failed": 1200,
};
