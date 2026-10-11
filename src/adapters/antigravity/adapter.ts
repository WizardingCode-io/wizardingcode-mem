import type { HookEvent } from "../../core/types.ts";
import { clip } from "../../util/text.ts";
import { isObject, text } from "../common/jsonl.ts";
import type { AgentAdapter, HookInput, TurnDetail } from "../types.ts";

// Google Antigravity (its CLI, `agy`; Antigravity 2.0; the Antigravity IDE): all three read
// ~/.gemini/config/hooks.json and send the same camelCase payloads, documented but not yet
// captured (tests/fixtures/antigravity).
//
// There is no session-start event and no prompt event. `PreInvocation` fires before every
// model call and carries `invocationNum`, documented as the 0-indexed number of the model
// invocation, "the first invocation is 0": that first call is taken as the conversation's
// start, and every later call is nothing, so the brief is never sent once per model call.
// No payload carries the user's prompt or the model's final message, and the transcript's
// format is not documented, so nothing of a turn is captured: the brief at the start and
// the memory tools are what Antigravity gets. `Stop` still ends the turn (it keeps the
// session alive and lets backups run); there is no session-end event.
//
// No payload carries a working directory: the first of `workspacePaths` stands for it.

const MAX_INJECTION_CHARS = 10_000;

const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

function parse(event: HookEvent, stdin: string): HookInput | null {
  if (event !== "session-start" && event !== "turn-end") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const sessionId = text(raw.conversationId);
  const cwd = Array.isArray(raw.workspacePaths) ? text(raw.workspacePaths[0]) : null;
  if (sessionId === null || cwd === null) return null;
  // Only the conversation's first model call starts it; a missing or odd number is not a start.
  if (event === "session-start" && raw.invocationNum !== 0) return null;
  return {
    agent: "antigravity",
    event,
    sessionId,
    cwd,
    turnId: null,
    transcriptPath: text(raw.transcriptPath),
    prompt: null,
    finalText: null,
    source: event === "session-start" ? "startup" : null,
    toolFile: null,
    toolError: null,
    // Subagents are not documented to run hooks of their own, nor marked if they do.
    subagent: false,
  };
}

export const antigravity: AgentAdapter = {
  id: "antigravity",
  capabilities: {
    sessionInjection: true,
    promptInjection: false,
    finalMessageInPayload: false,
    // Only the transcript's path is documented, not its format; nothing is guessed.
    transcript: false,
    maxInjectionChars: MAX_INJECTION_CHARS,
  },
  parse,
  readTurnDetail: () => ({ ...EMPTY }),
  render: (event, context) => {
    if (event !== "session-start" || context === null || context === "") return "";
    // One transient system message before the first model call: injectSteps' ephemeralMessage.
    return JSON.stringify({
      injectSteps: [{ ephemeralMessage: clip(context, MAX_INJECTION_CHARS) }],
    });
  },
};
