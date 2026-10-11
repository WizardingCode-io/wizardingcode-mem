import type { AgentId, HookEvent } from "../core/types.ts";

/** A host agent's hook payload, reduced to what wizardingcode-mem uses. Nothing here is redacted yet. */
export interface HookInput {
  agent: AgentId;
  event: HookEvent;
  /** The host's own session id. */
  sessionId: string;
  cwd: string;
  /** The host's id for the prompt that started the turn, when it provides one. */
  turnId: string | null;
  transcriptPath: string | null;
  /** Only on "prompt". */
  prompt: string | null;
  /** The assistant's final message. Only on "turn-end". */
  finalText: string | null;
  /** Only on "session-start". "clear" and "compact" mean earlier context is gone. */
  source: "startup" | "resume" | "clear" | "compact" | "other" | null;
  /** Only on "file-read": the path the tool read, as the host gave it (absolute). */
  toolFile: string | null;
  /** Only on "tool-failed": what the host says went wrong. Null when the tool was interrupted. */
  toolError: string | null;
  /** The event came from inside a subagent, not from the user's own conversation. */
  subagent: boolean;
}

/** What a turn did, recovered from the host's transcript. Best effort: any part may be empty. */
export interface TurnDetail {
  filesRead: string[];
  filesChanged: string[];
  commands: string[];
  errors: string[];
  /** The agent stored a memory itself during the turn, through wizardingcode-mem's own tool. */
  savedMemory: boolean;
}

/** What a host can and cannot do. The core degrades to match; it never simulates. */
export interface AdapterCapabilities {
  sessionInjection: boolean;
  promptInjection: boolean;
  /** The turn-end payload carries the assistant's final message. */
  finalMessageInPayload: boolean;
  transcript: boolean;
  maxInjectionChars: number;
}

export interface AgentAdapter {
  readonly id: AgentId;
  readonly capabilities: AdapterCapabilities;
  /** Null when the payload cannot be used. Never throws: the payload is another program's output. */
  parse(event: HookEvent, stdin: string): HookInput | null;
  /** Never throws; an unreadable transcript yields an empty detail. */
  readTurnDetail(
    transcriptPath: string,
    turnId: string | null,
    options?: { maxBytes?: number },
  ): TurnDetail;
  /** Exactly what to write to stdout. An empty string means: print nothing. */
  render(event: HookEvent, context: string | null): string;
}
