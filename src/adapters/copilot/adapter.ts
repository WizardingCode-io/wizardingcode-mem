import type { HookEvent } from "../../core/types.ts";
import { clip } from "../../util/text.ts";
import { isObject, text } from "../common/jsonl.ts";
import type { AgentAdapter, HookInput, TurnDetail } from "../types.ts";

// GitHub Copilot: one hooks file, ~/.copilot/hooks/wizardingcode-mem.json, read by the Copilot
// CLI and by VS Code's agent mode, documented but not yet captured (tests/fixtures/copilot).
// The CLI sends camelCase payloads (`sessionId`, `transcriptPath`) for the camelCase events
// we register; VS Code maps the file to its own events and sends snake_case ones
// (`session_id`, `hook_event_name`). Each is answered in its own shape.
//
// Only the session start can add context: the CLI drops a command hook's output on
// `userPromptSubmitted`, and VS Code documents no context there. No turn id and no final
// message are documented, and the transcript's format is not.

const MAX_INJECTION_CHARS = 10_000;

const SOURCES: Record<string, HookInput["source"]> = {
  startup: "startup",
  // VS Code's first prompt of a session, or the CLI's new session.
  new: "startup",
  resume: "resume",
};

const EMPTY: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};

type Dialect = "cli" | "vscode";

function parse(event: HookEvent, stdin: string): HookInput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const vscode = "hook_event_name" in raw || "session_id" in raw;
  const dialect: Dialect = vscode ? "vscode" : "cli";
  const sessionId = text(vscode ? raw.session_id : raw.sessionId);
  const cwd = text(raw.cwd);
  if (sessionId === null || cwd === null) return null;
  const source = text(raw.source);
  return {
    agent: "copilot",
    event,
    sessionId,
    cwd,
    turnId: null,
    transcriptPath: text(vscode ? raw.transcript_path : raw.transcriptPath),
    prompt: event === "prompt" ? text(raw.prompt) : null,
    finalText: null,
    source:
      event === "session-start" ? ((source === null ? null : SOURCES[source]) ?? "other") : null,
    toolFile: null,
    toolError: null,
    // Subagent events are separate hooks (subagentStop, SubagentStop); none is registered.
    subagent: false,
    dialect,
  };
}

export const copilot: AgentAdapter = {
  id: "copilot",
  capabilities: {
    sessionInjection: true,
    promptInjection: false,
    finalMessageInPayload: false,
    // The transcript's format (the CLI's events.jsonl) is not documented; nothing is guessed.
    transcript: false,
    maxInjectionChars: MAX_INJECTION_CHARS,
  },
  parse,
  readTurnDetail: () => ({ ...EMPTY }),
  render: (event, context, input) => {
    if (event !== "session-start" || context === null || context === "") return "";
    const additionalContext = clip(context, MAX_INJECTION_CHARS);
    // Always JSON: plain text that happens to start with "{" would be read as JSON.
    return JSON.stringify(
      input?.dialect === "vscode"
        ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }
        : { additionalContext },
    );
  },
};
