import type { AgentId, HookEvent } from "../../core/types.ts";
import type { HookInput } from "../types.ts";
import { isObject, text } from "./jsonl.ts";

// Claude Code's hook payload became a de facto standard: Codex speaks it too, with the
// turn's id under another name. Field names were captured from each host; see tests/fixtures.

const SOURCES = new Set(["startup", "resume", "clear", "compact"]);

export interface HookJsonShape {
  /** The field naming the prompt that started the turn. */
  turnIdField: string;
}

function toolInput(payload: Record<string, unknown>): Record<string, unknown> | null {
  return isObject(payload.tool_input) ? payload.tool_input : null;
}

export function parseHookJson(
  agent: AgentId,
  shape: HookJsonShape,
  event: HookEvent,
  stdin: string,
): HookInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const payload = raw;

  const sessionId = text(payload.session_id);
  const cwd = text(payload.cwd);
  if (sessionId === null || cwd === null) return null;

  const source = text(payload.source);
  return {
    agent,
    event,
    sessionId,
    cwd,
    turnId: text(payload[shape.turnIdField]),
    transcriptPath: text(payload.transcript_path),
    prompt: event === "prompt" ? text(payload.prompt) : null,
    finalText: event === "turn-end" ? text(payload.last_assistant_message) : null,
    source:
      event === "session-start"
        ? source !== null && SOURCES.has(source)
          ? (source as HookInput["source"])
          : "other"
        : null,
    toolFile: event === "file-read" ? text(toolInput(payload)?.file_path) : null,
    toolError:
      event === "tool-failed" && payload.is_interrupt !== true ? text(payload.error) : null,
    subagent: text(payload.agent_id) !== null,
  };
}

/** Events that may add context, and the name Claude Code and Codex expect back for each. */
export const CLAUDE_STYLE_EVENTS: Partial<Record<HookEvent, string>> = {
  "session-start": "SessionStart",
  prompt: "UserPromptSubmit",
  "file-read": "PostToolUse",
  "tool-failed": "PostToolUseFailure",
};

/** The JSON these hosts read from a hook's stdout to add context for the model. */
export function renderHookJson(
  names: Partial<Record<HookEvent, string>>,
  event: HookEvent,
  context: string | null,
  clipTo: (s: string) => string,
): string {
  const hookEventName = names[event];
  if (hookEventName === undefined || context === null || context === "") return "";
  // Always the JSON form: plain text that happens to start with "{" would be read as JSON.
  return JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext: clipTo(context) },
  });
}
