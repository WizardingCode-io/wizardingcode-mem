import type { HookEvent } from "../../core/types.ts";
import { clip } from "../../util/text.ts";
import { isObject, text } from "../common/jsonl.ts";
import type { AgentAdapter, HookInput, TurnDetail } from "../types.ts";

// Cursor: hooks.json with its own event names and payloads. The conversation is the
// session and the first workspace root is the cwd. Cursor takes context only at session
// start (`additional_context`); a prompt hook may only let the prompt through. Payloads
// follow Cursor's documentation; none has been captured from a live session yet.

const MAX_INJECTION_CHARS = 10_000;

function parse(event: HookEvent, stdin: string): HookInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const sessionId = text(raw.conversation_id);
  const roots = Array.isArray(raw.workspace_roots) ? raw.workspace_roots : [];
  const cwd = text(roots[0]);
  if (sessionId === null || cwd === null) return null;
  return {
    agent: "cursor",
    event,
    sessionId,
    cwd,
    // Cursor's generation id has not been seen to hold across a prompt and its response.
    turnId: null,
    transcriptPath: text(raw.transcript_path),
    prompt: event === "prompt" ? text(raw.prompt) : null,
    finalText: event === "turn-end" ? text(raw.text) : null,
    source: event === "session-start" ? "startup" : null,
    toolFile: null,
    toolError: null,
    subagent: raw.is_background_agent === true,
  };
}

const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

export const cursor: AgentAdapter = {
  id: "cursor",
  capabilities: {
    sessionInjection: true,
    promptInjection: false,
    finalMessageInPayload: true,
    transcript: false,
    maxInjectionChars: MAX_INJECTION_CHARS,
  },
  parse,
  readTurnDetail: () => ({ ...EMPTY }),
  render(event, context) {
    // Cursor reads JSON; a prompt hook that prints nothing valid is logged as broken.
    if (event === "prompt") return JSON.stringify({ continue: true });
    if (event === "session-start" && context !== null && context !== "") {
      return JSON.stringify({ additional_context: clip(context, MAX_INJECTION_CHARS) });
    }
    return "";
  },
};
