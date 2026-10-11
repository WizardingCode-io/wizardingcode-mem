import type { HookEvent } from "../../core/types.ts";
import { clip } from "../../util/text.ts";
import { parseHookJson, renderHookJson } from "../common/hook-json.ts";
import type { AgentAdapter, TurnDetail } from "../types.ts";

// Qwen Code: Claude-style hook payloads, documented but not yet captured (tests/fixtures/qwen).
// The turn is named by `prompt_id`. UserPromptSubmit also fires for tool-result and hook
// sends, so the prompt is taken only from `submitted_prompt`, the user's own text.

// UserPromptExpansion's context is documented as cut at 10 000 characters; stay within it.
const MAX_INJECTION_CHARS = 10_000;
const INJECTING: Partial<Record<HookEvent, string>> = {
  "session-start": "SessionStart",
  prompt: "UserPromptSubmit",
};

const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

export const qwen: AgentAdapter = {
  id: "qwen",
  capabilities: {
    sessionInjection: true,
    promptInjection: true,
    finalMessageInPayload: true,
    // The chat record's shape is not documented; nothing is guessed from it.
    transcript: false,
    maxInjectionChars: MAX_INJECTION_CHARS,
  },
  parse: (event, stdin) =>
    parseHookJson(
      "qwen",
      { turnIdField: "prompt_id", promptField: "submitted_prompt" },
      event,
      stdin,
    ),
  readTurnDetail: () => ({ ...EMPTY }),
  render: (event, context) =>
    renderHookJson(INJECTING, event, context, (s) => clip(s, MAX_INJECTION_CHARS)),
};
