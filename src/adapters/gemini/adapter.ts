import type { HookEvent } from "../../core/types.ts";
import { clip } from "../../util/text.ts";
import { renderHookJson } from "../common/hook-json.ts";
import { isObject, text } from "../common/jsonl.ts";
import type { AgentAdapter, HookInput, TurnDetail } from "../types.ts";

// Gemini CLI 0.26: hooks in settings.json; BeforeAgent brings the prompt, AfterAgent the
// prompt and its response. No turn id: a turn is the session's open one. Field names of
// SessionStart and SessionEnd were captured; the agent events follow the documentation.

const MAX_INJECTION_CHARS = 10_000;
const SOURCES = new Set(["startup", "resume", "clear"]);
const INJECTING: Partial<Record<HookEvent, string>> = {
  "session-start": "SessionStart",
  prompt: "BeforeAgent",
};

function parse(event: HookEvent, stdin: string): HookInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const sessionId = text(raw.session_id);
  const cwd = text(raw.cwd);
  if (sessionId === null || cwd === null) return null;
  const source = text(raw.source);
  return {
    agent: "gemini",
    event,
    sessionId,
    cwd,
    turnId: null,
    transcriptPath: text(raw.transcript_path),
    prompt: event === "prompt" ? text(raw.prompt) : null,
    finalText: event === "turn-end" ? text(raw.prompt_response) : null,
    source:
      event === "session-start"
        ? source !== null && SOURCES.has(source)
          ? (source as HookInput["source"])
          : "other"
        : null,
    toolFile: null,
    toolError: null,
    subagent: false,
  };
}

const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

export const gemini: AgentAdapter = {
  id: "gemini",
  capabilities: {
    sessionInjection: true,
    promptInjection: true,
    finalMessageInPayload: true,
    // The chat file's format has not been captured yet; nothing is guessed from it.
    transcript: false,
    maxInjectionChars: MAX_INJECTION_CHARS,
  },
  parse,
  readTurnDetail: () => ({ ...EMPTY }),
  render: (event, context) =>
    renderHookJson(INJECTING, event, context, (s) => clip(s, MAX_INJECTION_CHARS)),
};
