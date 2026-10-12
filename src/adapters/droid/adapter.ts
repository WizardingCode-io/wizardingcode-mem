import type { HookEvent } from "../../core/types.ts";
import { clip } from "../../util/text.ts";
import { CLAUDE_STYLE_EVENTS, parseHookJson, renderHookJson } from "../common/hook-json.ts";
import type { AgentAdapter, TurnDetail } from "../types.ts";

// Factory Droid: Claude-style hook payloads, documented but not yet captured
// (tests/fixtures/droid). The documentation names no turn id that Stop shares with
// UserPromptSubmit and no assistant text in Stop, so a turn is the session's open one and
// its final message is not read.

const MAX_INJECTION_CHARS = 10_000;
const INJECTING: Partial<Record<HookEvent, string>> = {
  "session-start": CLAUDE_STYLE_EVENTS["session-start"] as string,
  prompt: CLAUDE_STYLE_EVENTS.prompt as string,
};

const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

export const droid: AgentAdapter = {
  id: "droid",
  capabilities: {
    sessionInjection: true,
    promptInjection: true,
    finalMessageInPayload: false,
    // The transcript's shape is not documented; nothing is guessed from it.
    transcript: false,
    maxInjectionChars: MAX_INJECTION_CHARS,
  },
  parse: (event, stdin) => {
    // "message_id" is optional and not documented as shared by a turn's events: not used.
    const input = parseHookJson("droid", { turnIdField: "message_id" }, event, stdin);
    return input === null ? null : { ...input, turnId: null, finalText: null };
  },
  readTurnDetail: () => ({ ...EMPTY }),
  render: (event, context) =>
    renderHookJson(INJECTING, event, context, (s) => clip(s, MAX_INJECTION_CHARS)),
};
